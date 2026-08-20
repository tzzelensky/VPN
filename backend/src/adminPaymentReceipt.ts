import {
  findPromoCodeUsageBySessionId,
  findUsersByTelegramChatId,
  getPromoCodeById,
  getSubscriptionShop,
  getUser,
  type PaymentSessionRow,
  type UserRow,
} from "./db.js";
import { getDeviceLimitSettings } from "./deviceLimitStore.js";
import { getPanelSettings } from "./panelSettings.js";
import { getTestPlanRuntimeMeta } from "./testSubscription.js";
import { escHtml, subscriptionPublicName } from "./telegram/format.js";
import {
  editMessageCaption,
  editMessageText,
  editTelegramReplyMarkup,
  sendTelegramPhoto,
  sendTelegramPhotoBinary,
} from "./telegram/api.js";
import { getTelegramPaymentNotifyChatIds } from "./telegram/env.js";
import { getWhitelistPurchasePriceRub } from "./whitelistPurchaseService.js";
import { getComboOffer, resolveComboOfferPricing } from "./comboSubscriptionService.js";

const SEP = "━━━━━━━━━━━━━━━━━━━━━━";
const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;

export type AdminPaymentReceiptMessage = {
  chat: { id: number };
  message_id: number;
  text?: string;
  caption?: string;
  photo?: unknown[];
};

export type AdminPaymentProof =
  | { type: "file_id"; fileId: string }
  | { type: "bytes"; bytes: Uint8Array; mime?: string };

function percentOff(priceRub: number, percent: number): number {
  return Math.max(0, Math.floor(priceRub - (priceRub * percent) / 100));
}

function formatTariffLine(totalGb: number, days: number): string {
  const gb = totalGb > 0 ? `${totalGb} ГБ` : "Безлимит";
  return `${gb} • ${days} дн.`;
}

function payerTelegramTag(sess: PaymentSessionRow): string {
  const u = (sess.tg_username ?? "").trim().replace(/^@/, "");
  if (u) return `@${escHtml(u)}`;
  const fn = (sess.tg_first_name ?? "").trim();
  if (fn) return escHtml(fn);
  return `<code>${sess.tg_chat_id}</code>`;
}

function sessionChannelLabel(sess: PaymentSessionRow): "WebApp" | "Чат" {
  return sess.proof_file_id === "webapp" ? "WebApp" : "Чат";
}

function formatReceiptTime(iso: string): string {
  const tz = getPanelSettings().ui.timezone?.trim() || "Asia/Yekaterinburg";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  }
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: tz });
}

function resolveDiscountInfo(
  sess: PaymentSessionRow,
  originalRub: number,
): { finalRub: number; reasonLine?: string } {
  const promoUsage = findPromoCodeUsageBySessionId(sess.id);
  if (promoUsage) {
    const promo = getPromoCodeById(promoUsage.promo_id);
    let finalRub = originalRub;
    let reason = `🏷️ Промокод <b>${escHtml(promoUsage.promo_code)}</b>`;
    if (promoUsage.final_price_rub != null && Number.isFinite(promoUsage.final_price_rub)) {
      finalRub = promoUsage.final_price_rub;
      if (finalRub < originalRub) {
        reason += ` (−${originalRub - finalRub} ₽)`;
      }
    } else if (promo?.type === "percent" && (promo.discount_percent ?? 0) > 0) {
      finalRub = percentOff(originalRub, promo.discount_percent);
      reason += ` (−${promo.discount_percent}%)`;
    } else if (promoUsage.discount_rub != null && promoUsage.discount_rub > 0) {
      finalRub = Math.max(0, originalRub - promoUsage.discount_rub);
      reason += ` (−${promoUsage.discount_rub} ₽)`;
    } else if (promo?.type === "rub" && (promo.discount_rub ?? 0) > 0) {
      finalRub = Math.max(0, originalRub - (promo.discount_rub ?? 0));
      reason += ` (−${promo.discount_rub} ₽)`;
    }
    return { finalRub, reasonLine: reason };
  }

  const roulettePercent = sess.roulette_discount_percent ?? 0;
  if (roulettePercent > 0) {
    return {
      finalRub: percentOff(originalRub, roulettePercent),
      reasonLine: `🎡 Автоскидка (−${roulettePercent}%)`,
    };
  }

  const referralPercent = sess.referral_discount_percent ?? 0;
  if (referralPercent > 0) {
    const inviter = sess.referral_inviter_user_id ? getUser(sess.referral_inviter_user_id) : undefined;
    const inviterTag =
      inviter?.name != null && String(inviter.name).trim()
        ? escHtml(String(inviter.name).trim())
        : inviter && String(inviter.tg_id ?? "").trim()
          ? `id ${escHtml(String(inviter.tg_id).trim())}`
          : "—";
    return {
      finalRub: percentOff(originalRub, referralPercent),
      reasonLine: `🤝 Реферальная ссылка (−${referralPercent}%)\nПригласивший: ${inviterTag}`,
    };
  }

  return { finalRub: originalRub };
}

function resolvePricing(sess: PaymentSessionRow): {
  originalRub: number;
  finalRub: number;
  tariffLine: string;
  planTitle: string;
  discountReasonLine?: string;
} {
  const isTest = sess.kind === "test";
  const isTopUp = sess.kind === "topup";
  const isWhiteLists = sess.kind === "white_lists";
  const isDeviceSlot = sess.kind === "device_slot";
  const isCombo = sess.kind === "combo";

  if (isCombo) {
    const offer = getComboOffer(String(sess.combo_offer_id ?? "").trim());
    const pricing = offer ? resolveComboOfferPricing(offer) : { original_rub: 0, final_rub: 0, discount_percent: 15, discount_rub: 0, parts: [] };
    const plan = getSubscriptionShop().plans.find((p) => p.id === (offer?.plan_id ?? sess.plan_id));
    const addonParts = pricing.parts.filter((p) => p.label !== (plan?.title ?? "")).map((p) => p.label);
    return {
      originalRub: pricing.original_rub,
      finalRub: pricing.final_rub,
      tariffLine: addonParts.length > 0 ? addonParts.join(" + ") : "Комбо",
      planTitle: offer?.title ?? "Комбо-подписка",
      discountReasonLine: pricing.discount_percent > 0 ? `🎁 Комбо-скидка (−${pricing.discount_percent}%)` : undefined,
    };
  }
  if (isWhiteLists) {
    const price = getWhitelistPurchasePriceRub();
    return { originalRub: price, finalRub: price, tariffLine: "Белые списки", planTitle: "Белые списки" };
  }
  if (isDeviceSlot) {
    const price = getDeviceLimitSettings().purchase_price_rub;
    return { originalRub: price, finalRub: price, tariffLine: "Доп. устройство", planTitle: "Доп. устройство" };
  }
  if (isTopUp) {
    const row = getSubscriptionShop().topup_plans.find((p) => p.id === sess.plan_id);
    const price = row?.price_rub ?? 0;
    const discount = resolveDiscountInfo(sess, price);
    return {
      originalRub: price,
      finalRub: discount.finalRub,
      tariffLine: row ? `+${row.add_gb} ГБ` : "Докупка ГБ",
      planTitle: row?.title ?? "Докупка ГБ",
      discountReasonLine: discount.reasonLine,
    };
  }
  if (isTest) {
    const meta = getTestPlanRuntimeMeta();
    return {
      originalRub: meta.priceRub,
      finalRub: meta.priceRub,
      tariffLine: formatTariffLine(meta.total_gb, meta.days),
      planTitle: meta.title,
    };
  }
  const row = getSubscriptionShop().plans.find((p) => p.id === sess.plan_id);
  const price = row?.price_rub ?? 0;
  const discount = resolveDiscountInfo(sess, price);
  return {
    originalRub: price,
    finalRub: discount.finalRub,
    tariffLine: row ? formatTariffLine(row.total_gb, row.days) : "Подписка",
    planTitle: row?.title ?? "Подписка",
    discountReasonLine: discount.reasonLine,
  };
}

function resolveClientStatus(sess: PaymentSessionRow, linked: UserRow[], target?: UserRow): {
  isNewClient: boolean;
  statusLine: string;
} {
  const isTopUp = sess.kind === "topup";
  const isWhiteLists = sess.kind === "white_lists";
  const isDeviceSlot = sess.kind === "device_slot";
  const isCombo = sess.kind === "combo";
  const newName = String(sess.new_subscription_name ?? "").trim();

  if (isTopUp || isWhiteLists || isDeviceSlot) {
    return { isNewClient: false, statusLine: "🔵 Существующий клиент" };
  }
  if (isCombo && linked.length > 0 && !newName) {
    return { isNewClient: false, statusLine: "🔵 Существующий клиент" };
  }
  if (sess.kind === "test" || linked.length === 0 || newName) {
    return { isNewClient: true, statusLine: "🟢 Новый клиент" };
  }
  return { isNewClient: false, statusLine: "🔵 Существующий клиент" };
}

function resolveAfterConfirmBlock(
  sess: PaymentSessionRow,
  linked: UserRow[],
  target: UserRow | undefined,
  pricing: ReturnType<typeof resolvePricing>,
): string {
  const isTopUp = sess.kind === "topup";
  const isTest = sess.kind === "test";
  const isWhiteLists = sess.kind === "white_lists";
  const isDeviceSlot = sess.kind === "device_slot";
  const isCombo = sess.kind === "combo";
  const newName = String(sess.new_subscription_name ?? "").trim();

  if (isCombo) {
    const offer = getComboOffer(String(sess.combo_offer_id ?? "").trim());
    const addons = offer
      ? [
          offer.include_white_lists ? "белые списки" : "",
          offer.include_topup ? "докупка ГБ" : "",
          offer.include_device_slot ? "доп. устройство" : "",
        ].filter(Boolean)
      : [];
    const addonLine = addons.length > 0 ? `\n+ ${addons.join(", ")}` : "";
    if (linked.length === 0 || newName) {
      return `✅ Будет создан клиент\nКомбо:\n${escHtml(offer?.title ?? pricing.planTitle)}${addonLine}`;
    }
    const u = target ?? linked[0];
    return u
      ? `✅ Будет применено комбо\nПодписка:\n${escHtml(subscriptionPublicName(u))}${addonLine}`
      : `✅ Будет применено комбо${addonLine}`;
  }
  if (isWhiteLists) {
    const sub = target ? escHtml(subscriptionPublicName(target)) : "подписка";
    return `✅ Будут подключены <b>белые списки</b>\nПодписка:\n${sub}`;
  }
  if (isDeviceSlot) {
    const sub = target ? escHtml(subscriptionPublicName(target)) : "подписка";
    return `✅ Будет добавлено <b>место для устройства</b>\nПодписка:\n${sub}`;
  }
  if (isTopUp) {
    const row = getSubscriptionShop().topup_plans.find((p) => p.id === sess.plan_id);
    const gb = row?.add_gb ?? 0;
    const sub = target ? escHtml(subscriptionPublicName(target)) : "подписка";
    return `✅ Будет начислено <b>+${gb} ГБ</b>\nПодписка:\n${sub}`;
  }
  if (isTest) {
    return `✅ Будет создан клиент\nТариф:\n${escHtml(pricing.planTitle)} / ${escHtml(pricing.tariffLine)}`;
  }
  if (linked.length === 0 || newName) {
    const subLabel = newName ? escHtml(newName) : `${escHtml(pricing.planTitle)} / ${escHtml(pricing.tariffLine)}`;
    return `✅ Будет создан клиент\nПодписка:\n${subLabel}`;
  }
  if (target || linked.length === 1) {
    const u = target ?? linked[0]!;
    return `✅ Будет продлена подписка\nПодписка:\n${escHtml(subscriptionPublicName(u))}`;
  }
  const names = linked.map((u) => escHtml(subscriptionPublicName(u))).join("\n");
  return `✅ Будет продлена подписка\nПодписки:\n${names}`;
}

export function buildAdminPaymentReceiptText(sess: PaymentSessionRow): string {
  const linked = findUsersByTelegramChatId(sess.tg_chat_id);
  const target = sess.target_user_id ? getUser(sess.target_user_id) : undefined;
  const pricing = resolvePricing(sess);
  const client = resolveClientStatus(sess, linked, target);
  const amountLine =
    pricing.finalRub < pricing.originalRub
      ? `💰 <s>${pricing.originalRub} ₽</s> <b>${pricing.finalRub} ₽</b>`
      : `💰 <b>${pricing.finalRub} ₽</b>`;
  const discountBlock = pricing.discountReasonLine ? `Скидка:\n${pricing.discountReasonLine}\n` : "";

  return (
    `💳 <b>Новый платёж</b>\n` +
    `${SEP}\n` +
    `${amountLine}\n` +
    discountBlock +
    `Тариф: ${escHtml(pricing.tariffLine)}\n` +
    `${SEP}\n` +
    `👤 <b>Клиент</b>\n` +
    `Telegram:\n${payerTelegramTag(sess)}\n` +
    `Статус:\n${client.statusLine}\n` +
    `${SEP}\n` +
    `Сессия:\n${sessionChannelLabel(sess)}\n\n` +
    `Время:\n${formatReceiptTime(sess.created_at)}\n` +
    `${SEP}\n` +
    `<b>После подтверждения</b>\n\n` +
    `${resolveAfterConfirmBlock(sess, linked, target, pricing)}\n` +
    `${SEP}`
  );
}

export function adminDecisionKeyboard(sessionId: string) {
  return {
    inline_keyboard: [
      [
        { text: "❌ Отклонить", callback_data: `pnx:${sessionId}` },
        { text: "✅ Подтвердить", callback_data: `pok:${sessionId}` },
      ],
    ],
  };
}

function truncateTelegramCaption(html: string, max = CAPTION_MAX): string {
  if (html.length <= max) return html;
  return `${html.slice(0, max - 1)}…`;
}

function fitWithFooter(base: string, footer: string, max: number): string {
  const combined = `${base}${footer}`;
  if (combined.length <= max) return combined;
  const budget = Math.max(0, max - footer.length - 1);
  const trimmed = base.slice(0, budget).trimEnd();
  return `${trimmed}…${footer}`;
}

export async function sendAdminPaymentReceiptToAdmins(
  sess: PaymentSessionRow,
  proof: AdminPaymentProof,
): Promise<boolean> {
  const caption = truncateTelegramCaption(buildAdminPaymentReceiptText(sess));
  const keyboard = adminDecisionKeyboard(sess.id);
  const admins = getTelegramPaymentNotifyChatIds();
  let anyOk = false;
  for (const adminChat of admins) {
    try {
      if (proof.type === "file_id") {
        await sendTelegramPhoto(adminChat, proof.fileId, caption, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      } else {
        const mime = (proof.mime ?? "image/jpeg").trim() || "image/jpeg";
        await sendTelegramPhotoBinary(adminChat, proof.bytes, {
          caption,
          parse_mode: "HTML",
          reply_markup: keyboard,
          filename: mime.includes("png") ? "check.png" : "check.jpg",
          mimeType: mime,
        });
      }
      anyOk = true;
    } catch (e) {
      console.error("[payment-receipt] send to admin", adminChat, e instanceof Error ? e.message : e);
    }
  }
  return anyOk;
}

export async function finalizeAdminPaymentReceipt(
  msg: AdminPaymentReceiptMessage | undefined,
  status: "confirmed" | "rejected",
  footerNote?: string,
): Promise<void> {
  if (!msg?.chat?.id || !msg.message_id) return;
  const note = String(footerNote ?? "").trim();
  const footer =
    status === "confirmed"
      ? note
        ? `\n\n${SEP}\n✅ <b>Подтверждено</b>\n${escHtml(note)}`
        : `\n\n${SEP}\n✅ <b>Подтверждено</b>\nСообщение отправлено пользователю`
      : note
        ? `\n\n${SEP}\n❌ <b>Отклонено</b>\n${escHtml(note)}`
        : `\n\n${SEP}\n❌ <b>Отклонено</b>\nСообщение отправлено пользователю`;

  const isPhoto =
    (Array.isArray(msg.photo) && msg.photo.length > 0) ||
    (typeof msg.caption === "string" && msg.text == null);
  const base = String(isPhoto ? (msg.caption ?? "") : (msg.text ?? msg.caption ?? "")).trim();
  const max = isPhoto ? CAPTION_MAX : TEXT_MAX;
  const next = base ? fitWithFooter(base, footer, max) : footer.trim();
  const emptyKeyboard = { inline_keyboard: [] as unknown[] };

  try {
    let edited = false;
    if (isPhoto) {
      edited = await editMessageCaption(msg.chat.id, msg.message_id, next, {
        reply_markup: emptyKeyboard,
      });
    } else {
      edited = await editMessageText(msg.chat.id, msg.message_id, next, {
        reply_markup: emptyKeyboard,
      });
    }
    // Если правка текста/подписи не прошла (лимит, HTML и т.п.) — хотя бы убрать кнопки.
    if (!edited) {
      await editTelegramReplyMarkup(msg.chat.id, msg.message_id, emptyKeyboard);
    }
  } catch (e) {
    console.error("[payment-receipt] finalizeAdminPaymentReceipt:", e);
    try {
      await editTelegramReplyMarkup(msg.chat.id, msg.message_id, emptyKeyboard);
    } catch (e2) {
      console.error("[payment-receipt] clear keyboard failed:", e2);
    }
  }
}

export function adminPaymentConfirmFeedback(opts: {
  kind: PaymentSessionRow["kind"];
  autoCreated: boolean;
  isTopUp: boolean;
  isTest: boolean;
  sentWithSubscriptionLink: boolean;
}): string {
  if (opts.kind === "white_lists") {
    return "✅ Клиенту отправлено уведомление о подключении белых списков.";
  }
  if (opts.kind === "device_slot") {
    return "✅ Клиенту отправлено уведомление о доп. устройстве.";
  }
  if (opts.kind === "combo") {
    return opts.sentWithSubscriptionLink || opts.autoCreated
      ? "✅ Клиенту отправлено сообщение с комбо-подпиской."
      : "✅ Клиенту отправлено уведомление о комбо-оплате.";
  }
  if (opts.isTopUp) {
    return "✅ Клиенту отправлено уведомление о начислении ГБ.";
  }
  if (opts.sentWithSubscriptionLink || opts.autoCreated) {
    return "✅ Клиенту отправлено сообщение с подпиской.";
  }
  if (opts.isTest && opts.autoCreated) {
    return "✅ Клиенту отправлено сообщение с тестовой подпиской.";
  }
  return "✅ Клиенту отправлено уведомление о продлении подписки.";
}

export function adminPaymentRejectFeedback(): string {
  return "❌ Клиенту отправлено уведомление об отклонении платежа.";
}

export function getPaymentSessionPricing(sess: PaymentSessionRow): ReturnType<typeof resolvePricing> {
  return resolvePricing(sess);
}
