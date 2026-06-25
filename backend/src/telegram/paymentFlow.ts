import { isSupportAppealsEnabled } from "./supportAppealsFlow.js";
import {
  applyPromoCodeForUser,
  claimReferralReward,
  consumeReferralInviteByTgUser,
  createReferralReward,
  createUser,
  activateDeviceSlotPurchaseForUser,
  appendShopActivity,
  addUserToTestSubscriptionSegment,
  clearTestSubscriptionFlags,
  deletePaymentSession,
  findAwaitingProofSessionByChat,
  findPendingAdminSessionByChat,
  findUsersByTelegramChatId,
  getReferralInviteByTgUser,
  getReferralProgram,
  getReferralReward,
  getRoulettePurchaseDiscount,
  consumeRoulettePurchaseDiscount,
  getUser,
  getPaymentSession,
  getGameTicketsPerPurchase,
  getWebAppActiveGame,
  getSubscriptionShop,
  grantDropperTicketsForPurchaseChat,
  registerPromoCodeUsage,
  markPaymentSessionPendingAdmin,
  snapExpiryTimeToNoonLocal,
  startPaymentAwaitingProof,
  updateUserRow,
  userHasActiveSubscription,
  type PaymentPlanId,
  type PaymentSessionRow,
  type SubscriptionShopPlanRow,
  type TopUpShopPlanRow,
  type UserRow,
} from "../db.js";
import { logCommunicationMessage, recipientFromChatId, stripHtmlPreview } from "../communicationLog.js";
import { pushClientListToAllDeployedServers } from "../userSync.js";
import { resetUserTrafficCounters } from "../trafficReset.js";
import { answerCallbackQuery, editMessageCaption, sendTelegramHtml, sendTelegramPhoto } from "./api.js";
import { notifyDropperTicketsAfterPurchase } from "./dropperTickets.js";
import { escHtml, formatDaysRu, subscriptionPublicName } from "./format.js";
import { backHomeRow, mainMenuInline, newUserKeyboard, publicSubscriptionUrl } from "./keyboards.js";
import { getTelegramPaymentNotifyChatIds, getTelegramPaymentUrl } from "./env.js";
import {
  createDeviceSlotPurchaseRecord,
  getDeviceLimitSettings,
  updateDeviceSlotPurchase,
  findDeviceSlotPurchaseByPaymentId,
} from "../deviceLimitStore.js";
import { activeDeviceSlots, userDeviceTotalLimit } from "../userDeviceSlots.js";
import {
  checkDeviceSlotPurchaseAllowed,
  deviceLimitCalcSettingsForUser,
  tgUserCanBuyDeviceSlot,
} from "../deviceLimitEffective.js";

import {
  activateWhitelistPurchaseAfterPayment,
  checkWhitelistPurchaseAllowed,
  createPendingWhitelistPurchase,
  findActiveSubscriptionForTg,
  findWhitelistPurchaseTarget,
  getWhitelistPurchasePriceRub,
  getWhitelistPurchaseSettings,
  logWhitelistPurchaseOpened,
  sendWhitelistInstructionToChat,
} from "../whitelistPurchaseService.js";
import { isWhitelistPurchaseVisible } from "../whitelistVaultDb.js";
import {
  getTestPlanRuntimeMeta,
  isTestSubscriptionEligible,
  markTestSubscriptionUsed,
  tgUserCanBuyGb,
} from "../testSubscription.js";
import {
  formatAdminPaymentAmountLine,
  formatPurchasePriceUserLines,
  resolvePurchasePrice,
} from "../purchaseDiscount.js";

export type PlanRuntimeMeta = {
  title: string;
  total_gb: number;
  days: number;
  priceRub: number;
};

export type TopUpPlanRuntimeMeta = {
  title: string;
  add_gb: number;
  priceRub: number;
};

type PromoContext = {
  target_user_id?: number;
  new_subscription_name?: string;
  flow?: "subscription" | "topup";
  /** Промокод после ввода в чате (для докупки ГБ callback без длинной строки в callback_data). */
  pending_promo_code?: string;
};

const promoContextByChat = new Map<number, PromoContext>();

export function getPromoContext(chatId: number): PromoContext | undefined {
  return promoContextByChat.get(chatId);
}

export function setPromoPendingCodeForChat(chatId: number, code: string): void {
  const prev = promoContextByChat.get(chatId) ?? {};
  promoContextByChat.set(chatId, { ...prev, pending_promo_code: String(code ?? "").trim() });
}

export function clearPromoPendingCodeForChat(chatId: number): void {
  const p = promoContextByChat.get(chatId);
  if (!p?.pending_promo_code) return;
  const { pending_promo_code: _drop, ...rest } = p;
  if (Object.keys(rest).length > 0) promoContextByChat.set(chatId, rest);
  else promoContextByChat.delete(chatId);
}

export function getPlanRuntimeMeta(planId: PaymentPlanId): PlanRuntimeMeta {
  const row = getSubscriptionShop().plans.find((p) => p.id === planId);
  if (!row) {
    return { title: "Тариф", total_gb: 0, days: 30, priceRub: 0 };
  }
  return {
    title: row.title,
    total_gb: row.total_gb,
    days: row.days,
    priceRub: row.price_rub,
  };
}

export function getTopUpPlanRuntimeMeta(planId: PaymentPlanId): TopUpPlanRuntimeMeta {
  const row = getSubscriptionShop().topup_plans.find((p) => p.id === planId);
  if (!row) {
    return { title: "Докупка", add_gb: 0, priceRub: 0 };
  }
  return {
    title: row.title,
    add_gb: row.add_gb,
    priceRub: row.price_rub,
  };
}

function effectivePaymentUrl(): string {
  const u = getSubscriptionShop().payment_url.trim();
  if (u) return u;
  return getTelegramPaymentUrl();
}

function planPickerButtonLabel(p: SubscriptionShopPlanRow): string {
  const gb = p.total_gb > 0 ? `${p.total_gb} ГБ` : "безлимит";
  let t = `${p.id} — ${gb} / ${p.days} дн. — ${p.price_rub} ₽`;
  if (t.length > 58) t = `${t.slice(0, 55)}…`;
  return t;
}

function planPickerButtonLabelWithPrice(p: SubscriptionShopPlanRow, priceRub: number): string {
  const gb = p.total_gb > 0 ? `${p.total_gb} ГБ` : "безлимит";
  let t = `${p.id} — ${gb} / ${p.days} дн. — ${priceRub} ₽`;
  if (t.length > 58) t = `${t.slice(0, 55)}…`;
  return t;
}

function topupPickerButtonLabel(p: TopUpShopPlanRow): string {
  let t = `${p.id} — +${p.add_gb} ГБ — ${p.price_rub} ₽`;
  if (t.length > 58) t = `${t.slice(0, 55)}…`;
  return t;
}

function topupPickerButtonLabelWithPrice(p: TopUpShopPlanRow, priceRub: number): string {
  let t = `${p.id} — +${p.add_gb} ГБ — ${priceRub} ₽`;
  if (t.length > 58) t = `${t.slice(0, 55)}…`;
  return t;
}

function planSummary(meta: Pick<PlanRuntimeMeta, "total_gb" | "days">): string {
  const gb = meta.total_gb > 0 ? `${meta.total_gb} ГБ` : "безлимит";
  return `${gb} / ${meta.days} дн.`;
}

function topupSummary(meta: Pick<TopUpPlanRuntimeMeta, "add_gb">): string {
  return `+${meta.add_gb} ГБ`;
}

function expiryDateText(expiryMs: number): string {
  if (!expiryMs) return "без срока";
  return new Date(expiryMs).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function userTargetTitle(u: Pick<UserRow, "id" | "name" | "expiry_time">): string {
  return `${subscriptionPublicName(u)} (до ${expiryDateText(u.expiry_time)})`;
}

function resolveLinkedTarget(tgUserId: number, targetUserId?: number): UserRow | undefined {
  if (!targetUserId || targetUserId <= 0) return undefined;
  const row = getUser(targetUserId);
  if (!row) return undefined;
  const key = String(tgUserId).trim();
  return String(row.tg_id ?? "").trim() === key ? row : undefined;
}

export function vpnPlansKeyboard(targetUserId?: number) {
  const shop = getSubscriptionShop();
  const rows = shop.plans.map((p) => [
    { text: planPickerButtonLabel(p), callback_data: targetUserId ? `pplan:${p.id}:${targetUserId}` : `pplan:${p.id}` },
  ]);
  rows.push([{ text: "🎟 Применить промокод", callback_data: "promoask" }]);
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export function vpnPlansKeyboardDiscounted(
  discountPercent: number,
  opts?: { forNew?: boolean; targetUserId?: number },
) {
  const shop = getSubscriptionShop();
  const rows = shop.plans.map((p) => {
    const newPrice = Math.max(0, Math.floor(p.price_rub - (p.price_rub * discountPercent) / 100));
    const callback_data = opts?.forNew
      ? `pplannew:${p.id}`
      : opts?.targetUserId
        ? `pplan:${p.id}:${opts.targetUserId}`
        : `pplan:${p.id}`;
    return [{ text: planPickerButtonLabelWithPrice(p, newPrice), callback_data }];
  });
  rows.push([{ text: "🎟 Применить промокод", callback_data: "promoask" }]);
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

function referralRewardKeyboard(rewardId: string, gb: number, days: number) {
  return {
    inline_keyboard: [
      [{ text: `Получить +${gb} ГБ`, callback_data: `refreward:gb:${rewardId}` }],
      [{ text: `Получить +${days} дней`, callback_data: `refreward:days:${rewardId}` }],
      [{ text: "« В меню", callback_data: "home" }],
    ],
  };
}

export function vpnPlansKeyboardForNew() {
  const shop = getSubscriptionShop();
  const rows = shop.plans.map((p) => [{ text: planPickerButtonLabel(p), callback_data: `pplannew:${p.id}` }]);
  rows.push([{ text: "🎟 Применить промокод", callback_data: "promoask" }]);
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export function vpnPlansKeyboardPromo(code: string, tgUserId: number, targetUserId?: number) {
  const promo = String(code ?? "").trim().replace(/\s+/g, "");
  let promoRow;
  try {
    promoRow = applyPromoCodeForUser({ code: promo, tg_user_id: tgUserId, original_price_rub: 100 }).promo;
  } catch {
    return vpnPlansKeyboard(targetUserId);
  }
  const shop = getSubscriptionShop();
  const rows = shop.plans.map((p) => {
    const finalPrice = Math.max(0, Math.floor(p.price_rub - (p.price_rub * promoRow.discount_percent) / 100));
    const gb = p.total_gb > 0 ? `${p.total_gb} ГБ` : "безлимит";
    const text = `${p.id} — ${gb} / ${p.days} дн. — ${finalPrice} ₽`;
    return [
      {
        text: text.length > 58 ? `${text.slice(0, 55)}…` : text,
        callback_data: targetUserId ? `pplanpromo:${p.id}:${promo}:${targetUserId}` : `pplanpromo:${p.id}:${promo}`,
      },
    ];
  });
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export function gbTopUpPlansKeyboard(targetUserId?: number) {
  const shop = getSubscriptionShop();
  const rows = shop.topup_plans.map((p) => [
    { text: topupPickerButtonLabel(p), callback_data: targetUserId ? `gplan:${p.id}:${targetUserId}` : `gplan:${p.id}` },
  ]);
  rows.push([{ text: "🎟 Применить промокод", callback_data: "promoask" }]);
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export function gbTopUpPlansKeyboardDiscounted(discountPercent: number, targetUserId?: number) {
  const shop = getSubscriptionShop();
  const rows = shop.topup_plans.map((p) => {
    const newPrice = Math.max(0, Math.floor(p.price_rub - (p.price_rub * discountPercent) / 100));
    return [
      {
        text: topupPickerButtonLabelWithPrice(p, newPrice),
        callback_data: targetUserId ? `gplan:${p.id}:${targetUserId}` : `gplan:${p.id}`,
      },
    ];
  });
  rows.push([{ text: "🎟 Применить промокод", callback_data: "promoask" }]);
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

/** Клавиатура докупки со скидкой; промокод хранится в контексте чата (`pending_promo_code`). */
export function gbTopUpPlansKeyboardPromo(chatId: number, tgUserId: number, targetUserId?: number) {
  const code = getPromoContext(chatId)?.pending_promo_code?.trim();
  if (!code) return gbTopUpPlansKeyboard(targetUserId);
  const shop = getSubscriptionShop();
  const samplePrice = shop.topup_plans[0]?.price_rub ?? shop.plans[0]?.price_rub ?? 100;
  let discountPercent = 0;
  try {
    discountPercent = applyPromoCodeForUser({ code, tg_user_id: tgUserId, original_price_rub: samplePrice }).promo.discount_percent;
  } catch {
    return gbTopUpPlansKeyboard(targetUserId);
  }
  const rows = shop.topup_plans.map((p) => {
    const finalPrice = Math.max(0, Math.floor(p.price_rub - (p.price_rub * discountPercent) / 100));
    let t = `${p.id} — +${p.add_gb} ГБ — ${finalPrice} ₽`;
    if (t.length > 58) t = `${t.slice(0, 55)}…`;
    return [{ text: t, callback_data: targetUserId ? `gplanpromo:${p.id}:${targetUserId}` : `gplanpromo:${p.id}` }];
  });
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

function adminDecisionKeyboard(sessionId: string) {
  return {
    inline_keyboard: [
      [
        { text: "Подтвердить", callback_data: `pok:${sessionId}` },
        { text: "Платёж не поступил", callback_data: `pnx:${sessionId}` },
      ],
    ],
  };
}

export type AdminPaymentReceiptMessage = {
  chat: { id: number };
  message_id: number;
  caption?: string;
};

async function finalizeAdminPaymentReceipt(
  msg: AdminPaymentReceiptMessage | undefined,
  status: "confirmed" | "rejected",
): Promise<void> {
  if (!msg) return;
  const footer = status === "confirmed" ? "(Оплата подтверждена)" : "(Платёж не поступил)";
  const base = String(msg.caption ?? "").trim();
  const caption = base ? `${base}\n\n${footer}` : footer;
  try {
    await editMessageCaption(msg.chat.id, msg.message_id, caption, {
      reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {
    console.error("[telegram] finalizeAdminPaymentReceipt:", e);
  }
}

function isPaymentAdmin(fromId: number): boolean {
  return getTelegramPaymentNotifyChatIds().includes(fromId);
}

function replyKeyboardForPayer(tgUserId: number) {
  const linked = findUsersByTelegramChatId(tgUserId);
  if (linked.length > 0) {
    return mainMenuInline(
      false,
      getReferralProgram().enabled,
      isSupportAppealsEnabled(),
      tgUserCanBuyGb(tgUserId),
      isWhitelistPurchaseVisible() && linked.some((u) => userHasActiveSubscription(u)),
      tgUserCanBuyDeviceSlot(tgUserId),
    );
  }
  return newUserKeyboard(getSubscriptionShop().sales_disabled, isTestSubscriptionEligible(tgUserId));
}

const DAY_MS = 86_400_000;

export async function sendVpnPlanPicker(
  chatId: number,
  tgUserId: number,
  targetUserId?: number,
  newSubscriptionName?: string,
): Promise<void> {
  promoContextByChat.set(chatId, {
    ...(targetUserId && targetUserId > 0 ? { target_user_id: targetUserId } : {}),
    ...(newSubscriptionName && String(newSubscriptionName).trim()
      ? { new_subscription_name: String(newSubscriptionName).trim() }
      : {}),
    flow: "subscription",
  });
  const linked = findUsersByTelegramChatId(tgUserId);
  const shop = getSubscriptionShop();
  if (linked.length === 0 && shop.sales_disabled) {
    await sendTelegramHtml(
      chatId,
      "<b>Новые подписки временно недоступны.</b>\n\nОформление для новых клиентов отключено в настройках. После того как администратор привяжет ваш Telegram к аккаунту в панели, здесь можно будет продлить подписку.",
      newUserKeyboard(true, isTestSubscriptionEligible(tgUserId)),
    );
    return;
  }
  const newName = String(newSubscriptionName ?? "").trim();
  const target = resolveLinkedTarget(tgUserId, targetUserId);
  const pendingInvite = linked.length === 0 ? getReferralInviteByTgUser(tgUserId) : undefined;
  const pendingInviter = pendingInvite ? getUser(pendingInvite.inviter_user_id) : undefined;
  const refCfg = getReferralProgram();
  const shouldShowDiscount = !target && !newName && linked.length === 0 && pendingInvite && refCfg.enabled && pendingInviter;
  const rouletteDisc = getRoulettePurchaseDiscount(tgUserId);
  if (newName) {
    const newPrefix = `<b>Новая подписка:</b> ${escHtml(newName)}\n\n`;
    if (rouletteDisc) {
      const priceLines = shop.plans
        .map((p) => {
          const discounted = Math.max(
            0,
            Math.floor(p.price_rub - (p.price_rub * rouletteDisc.discount_percent) / 100),
          );
          return `Тариф ${p.id}: <s>${p.price_rub} ₽</s> <b>${discounted} ₽</b>`;
        })
        .join("\n");
      await sendTelegramHtml(
        chatId,
        `${newPrefix}<b>Применена автоскидка ${rouletteDisc.discount_percent}%</b>\n\n${priceLines}`,
        vpnPlansKeyboardDiscounted(rouletteDisc.discount_percent, { forNew: true }),
      );
      return;
    }
    await sendTelegramHtml(chatId, `${newPrefix}Тарифы магазина:`, vpnPlansKeyboardForNew());
    return;
  }
  const prefix = target
    ? `<b>Продление подписки:</b> ${escHtml(userTargetTitle(target))}\n\n`
    : "<b>Выберите нужную подписку</b>\n\n";
  if (shouldShowDiscount) {
    const inviterMention =
      pendingInviter.name && pendingInviter.name.trim().startsWith("@")
        ? pendingInviter.name.trim()
        : subscriptionPublicName(pendingInviter);
    const priceLines = shop.plans
      .map((p) => {
        const discounted = Math.max(0, Math.floor(p.price_rub - (p.price_rub * refCfg.invited_discount_percent) / 100));
        return `Тариф ${p.id}: <s>${p.price_rub} ₽</s> <b>${discounted} ₽</b>`;
      })
      .join("\n");
    await sendTelegramHtml(
      chatId,
      `${prefix}<b>Вам скидка ${refCfg.invited_discount_percent}% от ${escHtml(inviterMention)}, который пригласил.</b>\n\n${priceLines}`,
      vpnPlansKeyboardDiscounted(refCfg.invited_discount_percent),
    );
    return;
  }
  if (rouletteDisc) {
    const priceLines = shop.plans
      .map((p) => {
        const discounted = Math.max(
          0,
          Math.floor(p.price_rub - (p.price_rub * rouletteDisc.discount_percent) / 100),
        );
        return `Тариф ${p.id}: <s>${p.price_rub} ₽</s> <b>${discounted} ₽</b>`;
      })
      .join("\n");
    await sendTelegramHtml(
      chatId,
      `${prefix}<b>Применена автоскидка ${rouletteDisc.discount_percent}%</b>\n\n${priceLines}`,
      vpnPlansKeyboardDiscounted(rouletteDisc.discount_percent, { targetUserId: target?.id }),
    );
    return;
  }
  await sendTelegramHtml(chatId, `${prefix}Тарифы магазина:`, vpnPlansKeyboard(target?.id));
}

export async function sendGbTopUpPlanPicker(chatId: number, tgUserId: number, targetUserId?: number): Promise<void> {
  const linked = findUsersByTelegramChatId(tgUserId);
  if (linked.length === 0) {
    await sendTelegramHtml(
      chatId,
      "<b>Докупка ГБ недоступна.</b>\n\nСначала нужна привязанная подписка в панели. После привязки появится это действие.",
      newUserKeyboard(getSubscriptionShop().sales_disabled, isTestSubscriptionEligible(tgUserId)),
    );
    return;
  }
  if (!tgUserCanBuyGb(tgUserId)) {
    await sendTelegramHtml(
      chatId,
      "<b>Докупка ГБ недоступна для тестовой подписки.</b>\n\nОформите полный тариф в разделе «Оплата подписки».",
      replyKeyboardForPayer(tgUserId),
    );
    return;
  }
  const target = resolveLinkedTarget(tgUserId, targetUserId);
  if (linked.length > 1 && !target) {
    await sendTelegramHtml(chatId, "<b>Сначала выберите подписку для докупки ГБ.</b>", backHomeRow);
    return;
  }
  const planTargetId = target?.id ?? (linked.length === 1 ? linked[0]!.id : undefined);
  promoContextByChat.set(chatId, {
    ...(planTargetId ? { target_user_id: planTargetId } : {}),
    flow: "topup",
  });
  const prefix = target
    ? `<b>Докупка для подписки:</b> ${escHtml(userTargetTitle(target))}\n\n`
    : "<b>Выберите пакет докупки</b>\n\n";
  const rouletteDisc = getRoulettePurchaseDiscount(tgUserId);
  if (rouletteDisc) {
    const shop = getSubscriptionShop();
    const priceLines = shop.topup_plans
      .map((p) => {
        const discounted = Math.max(
          0,
          Math.floor(p.price_rub - (p.price_rub * rouletteDisc.discount_percent) / 100),
        );
        return `Пакет ${p.id}: <s>${p.price_rub} ₽</s> <b>${discounted} ₽</b>`;
      })
      .join("\n");
    await sendTelegramHtml(
      chatId,
      `${prefix}<b>Применена автоскидка ${rouletteDisc.discount_percent}%</b>\n\n${priceLines}\n\nГБ добавятся к текущему лимиту после подтверждения оплаты:`,
      gbTopUpPlansKeyboardDiscounted(rouletteDisc.discount_percent, planTargetId),
    );
    return;
  }
  await sendTelegramHtml(
    chatId,
    `${prefix}ГБ добавятся к текущему лимиту после подтверждения оплаты:`,
    gbTopUpPlansKeyboard(planTargetId),
  );
}

type TgFromLite = { id: number; username?: string; first_name?: string };

export async function onVpnPlanChosen(
  chatId: number,
  tgUserId: number,
  planId: PaymentPlanId,
  targetUserId?: number,
  newSubscriptionName?: string,
  from?: TgFromLite,
  promoCode?: string,
): Promise<void> {
  const linked = findUsersByTelegramChatId(tgUserId);
  const shop = getSubscriptionShop();
  if (linked.length === 0 && shop.sales_disabled) {
    await sendTelegramHtml(
      chatId,
      "<b>Покупка недоступна.</b> Продажи новых подписок отключены.",
      newUserKeyboard(true, isTestSubscriptionEligible(tgUserId)),
    );
    return;
  }
  const target = resolveLinkedTarget(tgUserId, targetUserId);
  const newName = String(newSubscriptionName ?? "").trim();
  if (!newName && linked.length > 1 && !target) {
    await sendTelegramHtml(chatId, "<b>Выберите подписку, которую нужно продлить.</b>", backHomeRow);
    return;
  }
  const meta = getPlanRuntimeMeta(planId);
  const cleanPromo = String(promoCode ?? "").trim().replace(/\s+/g, "");
  let priceRes = resolvePurchasePrice({
    tg_user_id: tgUserId,
    original_price_rub: meta.priceRub,
    promo_code: cleanPromo || undefined,
    target_user_id: target?.id,
    new_subscription_name: newName || undefined,
  });
  if (cleanPromo && !priceRes.promo_calc) priceRes = resolvePurchasePrice({
    tg_user_id: tgUserId,
    original_price_rub: meta.priceRub,
    target_user_id: target?.id,
    new_subscription_name: newName || undefined,
  });
  const payUrl = effectivePaymentUrl();
  const sessionId = startPaymentAwaitingProof(chatId, tgUserId, planId, "subscription", target?.id, newName || undefined, {
    username: from?.username,
    first_name: from?.first_name,
  }, {
    inviter_user_id: priceRes.referral_inviter_user_id,
    discount_percent: priceRes.referral_discount_percent,
    roulette_discount_percent: priceRes.roulette_discount?.percent,
    roulette_discount_spin_id: priceRes.roulette_discount?.spin_id,
  });
  if (priceRes.promo_calc) {
    registerPromoCodeUsage({
      code: priceRes.promo_calc.promo.code,
      tg_user_id: tgUserId,
      tg_username: from?.username,
      tg_first_name: from?.first_name,
      session_id: sessionId,
    });
  }
  const linkEsc = escHtml(payUrl);
  const body =
    `<b>Выбрано:</b> ${escHtml(planSummary(meta))}\n` +
    (newName
      ? `<b>Новая подписка:</b> ${escHtml(newName)}\n`
      : target
        ? `<b>Подписка:</b> ${escHtml(userTargetTitle(target))}\n`
        : "") +
    formatPurchasePriceUserLines(priceRes, { promoCode: cleanPromo }) +
    `<b>Ссылка для оплаты:</b>\n<a href="${linkEsc}">${linkEsc}</a>\n\n` +
    `В комментарии к переводу укажите <b>только номер тарифа</b>: <code>1</code>, <code>2</code> или <code>3</code> ` +
    `(как выбрали выше).\n\n` +
    `После оплаты пришлите в этот чат <b>скриншот или фото подтверждения перевода</b> — мы проверим и подключим или продлим доступ.`;
  await sendTelegramHtml(chatId, body, backHomeRow);
}

export async function sendTestSubscriptionIntro(chatId: number, tgUserId: number): Promise<void> {
  const shop = getSubscriptionShop();
  const testAvailable = isTestSubscriptionEligible(tgUserId);
  if (!testAvailable) {
    await sendTelegramHtml(
      chatId,
      "<b>Тестовая подписка недоступна.</b>\n\nВозможно, она отключена в настройках, у вас уже есть подписка или вы уже оформляли тест ранее.",
      newUserKeyboard(shop.sales_disabled, false),
    );
    return;
  }
  const meta = getTestPlanRuntimeMeta();
  const gb = meta.total_gb > 0 ? `${meta.total_gb} ГБ` : "безлимит";
  const daysPhrase = formatDaysRu(meta.days);
  const text =
    `<b>Тестовая подписка</b>\n\n` +
    `Стоит <b>${meta.priceRub} ₽</b> и даёт <b>${daysPhrase}</b> доступа к VPN (${gb}) — ` +
    `попробуйте сервис без обязательств и оцените скорость и стабильность подключения.\n\n` +
    `Нажмите кнопку ниже — пришлём инструкцию по оплате.`;
  await sendTelegramHtml(chatId, text, {
    inline_keyboard: [
      [{ text: "Получить тестовую подписку", callback_data: "test_get" }],
      [{ text: "« Меню", callback_data: "home" }],
    ],
  });
}

export async function onTestSubscriptionGet(
  chatId: number,
  tgUserId: number,
  from?: TgFromLite,
): Promise<void> {
  const shop = getSubscriptionShop();
  if (!isTestSubscriptionEligible(tgUserId)) {
    await sendTelegramHtml(
      chatId,
      "<b>Тестовая подписка недоступна.</b>",
      newUserKeyboard(shop.sales_disabled, false),
    );
    return;
  }
  const meta = getTestPlanRuntimeMeta();
  const payUrl = effectivePaymentUrl();
  startPaymentAwaitingProof(chatId, tgUserId, 1, "test", undefined, undefined, {
    username: from?.username,
    first_name: from?.first_name,
  });
  const linkEsc = escHtml(payUrl);
  const gb = meta.total_gb > 0 ? `${meta.total_gb} ГБ` : "безлимит";
  const body =
    `<b>Выбрано:</b> ${escHtml(meta.title)} — ${escHtml(planSummary(meta))}\n` +
    `<b>Сумма к оплате:</b> ${meta.priceRub} ₽\n\n` +
    `<b>Ссылка для оплаты:</b>\n<a href="${linkEsc}">${linkEsc}</a>\n\n` +
    `В комментарии к переводу укажите слово <b>тест</b>.\n\n` +
    `Промокоды к тестовой подписке не применяются.\n\n` +
    `После оплаты пришлите в этот чат <b>скриншот или фото подтверждения перевода</b> — мы проверим и подключим доступ.`;
  await sendTelegramHtml(chatId, body, backHomeRow);
}

export async function onGbTopUpPlanChosen(
  chatId: number,
  tgUserId: number,
  planId: PaymentPlanId,
  targetUserId?: number,
  from?: TgFromLite,
  promoCode?: string,
): Promise<void> {
  const linked = findUsersByTelegramChatId(tgUserId);
  if (linked.length === 0) {
    await sendTelegramHtml(
      chatId,
      "<b>Докупка ГБ недоступна.</b> Нет привязанной подписки.",
      newUserKeyboard(getSubscriptionShop().sales_disabled, isTestSubscriptionEligible(tgUserId)),
    );
    return;
  }
  const target = resolveLinkedTarget(tgUserId, targetUserId) ?? (linked.length === 1 ? linked[0] : undefined);
  if (target?.is_test_subscription === 1) {
    await sendTelegramHtml(
      chatId,
      "<b>Докупка ГБ недоступна для тестовой подписки.</b>\n\nОформите полный тариф в разделе «Оплата подписки».",
      replyKeyboardForPayer(tgUserId),
    );
    return;
  }
  if (linked.length > 1 && !target) {
    await sendTelegramHtml(chatId, "<b>Выберите подписку, к которой нужно докупить ГБ.</b>", backHomeRow);
    return;
  }
  const meta = getTopUpPlanRuntimeMeta(planId);
  const payUrl = effectivePaymentUrl();
  const cleanPromo = String(promoCode ?? "").trim();
  if (!cleanPromo) clearPromoPendingCodeForChat(chatId);
  let priceRes = resolvePurchasePrice({
    tg_user_id: tgUserId,
    original_price_rub: meta.priceRub,
    promo_code: cleanPromo || undefined,
    allow_referral: false,
  });
  if (cleanPromo && !priceRes.promo_calc) {
    priceRes = resolvePurchasePrice({
      tg_user_id: tgUserId,
      original_price_rub: meta.priceRub,
      allow_referral: false,
    });
  }
  const sessionId = startPaymentAwaitingProof(chatId, tgUserId, planId, "topup", target?.id, undefined, {
    username: from?.username,
    first_name: from?.first_name,
  }, {
    roulette_discount_percent: priceRes.roulette_discount?.percent,
    roulette_discount_spin_id: priceRes.roulette_discount?.spin_id,
  });
  if (priceRes.promo_calc) {
    registerPromoCodeUsage({
      code: priceRes.promo_calc.promo.code,
      tg_user_id: tgUserId,
      tg_username: from?.username,
      tg_first_name: from?.first_name,
      session_id: sessionId,
    });
  }
  clearPromoPendingCodeForChat(chatId);
  const linkEsc = escHtml(payUrl);
  const body =
    `<b>Выбрано:</b> ${escHtml(topupSummary(meta))}\n` +
    (target ? `<b>Подписка:</b> ${escHtml(userTargetTitle(target))}\n` : "") +
    `<b>Пополнение:</b> +${meta.add_gb} ГБ\n` +
    formatPurchasePriceUserLines(priceRes, { promoCode: cleanPromo }) +
    `<b>Ссылка для оплаты:</b>\n<a href="${linkEsc}">${linkEsc}</a>\n\n` +
    `В комментарии к переводу укажите <b>номер пакета докупки</b>: <code>1</code>, <code>2</code> или <code>3</code>.\n\n` +
    `После оплаты пришлите в этот чат <b>скриншот или фото подтверждения перевода</b> — администратор проверит и начислит ГБ.`;
  await sendTelegramHtml(chatId, body, backHomeRow);
}

export async function sendWhitelistPurchaseMenu(chatId: number, tgUserId: number): Promise<void> {
  logWhitelistPurchaseOpened("bot", tgUserId);
  if (!isWhitelistPurchaseVisible()) {
    await sendTelegramHtml(chatId, "Белые списки сейчас недоступны.", backHomeRow);
    return;
  }
  const linked = findUsersByTelegramChatId(tgUserId);
  const target = findWhitelistPurchaseTarget(tgUserId, linked);
  const settings = getWhitelistPurchaseSettings();
  const price = getWhitelistPurchasePriceRub();
  if (!target) {
    await sendTelegramHtml(
      chatId,
      "Белые списки можно подключить только к активной подписке. Сначала оформите основную подписку.",
      {
        inline_keyboard: [
          [{ text: "Купить подписку", callback_data: "pay" }],
          [{ text: "« В меню", callback_data: "home" }],
        ],
      },
    );
    return;
  }
  const check = checkWhitelistPurchaseAllowed(target);
  if (!check.ok) {
    await sendTelegramHtml(chatId, check.message, backHomeRow);
    return;
  }
  const desc = settings.bot_description.trim() || "Дополнительные VLESS-ключи для белого списка.";
  await sendTelegramHtml(
    chatId,
    `<b>Белые списки</b>\n\n${escHtml(desc)}\n\n` +
      `<b>Стоимость:</b> ${price} ₽\n\n` +
      `После оплаты ключи будут добавлены в вашу подписку. Вам нужно будет обновить подписку в приложении.`,
    {
      inline_keyboard: [
        [{ text: "Купить белые списки", callback_data: `wlbuy:${target.id}` }],
        [{ text: "Инструкция по обновлению", callback_data: "wlinstr" }],
        [{ text: "« Назад", callback_data: "home" }],
      ],
    },
  );
}

export async function onWhitelistPurchaseStart(
  chatId: number,
  tgUserId: number,
  targetUserId: number,
  from?: TgFromLite,
): Promise<void> {
  const target = getUser(targetUserId);
  if (!target || String(target.tg_id ?? "").trim() !== String(tgUserId).trim()) {
    await sendTelegramHtml(chatId, "Подписка не найдена.", backHomeRow);
    return;
  }
  const check = checkWhitelistPurchaseAllowed(target);
  if (!check.ok) {
    await sendTelegramHtml(chatId, check.message, backHomeRow);
    return;
  }
  const price = getWhitelistPurchasePriceRub();
  const payUrl = effectivePaymentUrl();
  const sessionId = startPaymentAwaitingProof(chatId, tgUserId, 1, "white_lists", target.id, undefined, {
    username: from?.username,
    first_name: from?.first_name,
  });
  createPendingWhitelistPurchase({ user: target, payment_id: sessionId, amount: price });
  const linkEsc = escHtml(payUrl);
  const body =
    `<b>Покупка белых списков</b>\n\n` +
    `<b>Подписка:</b> ${escHtml(userTargetTitle(target))}\n` +
    `<b>Сумма к оплате:</b> ${price} ₽\n\n` +
    `<b>Ссылка для оплаты:</b>\n<a href="${linkEsc}">${linkEsc}</a>\n\n` +
    `В комментарии к переводу укажите: <code>white_lists</code>\n\n` +
    `После оплаты пришлите в этот чат <b>скриншот или фото подтверждения перевода</b>.`;
  await sendTelegramHtml(chatId, body, backHomeRow);
}

export async function onDeviceSlotPurchaseStart(
  chatId: number,
  tgUserId: number,
  targetUserId: number,
  from?: TgFromLite,
): Promise<void> {
  const target = getUser(targetUserId);
  if (!target || String(target.tg_id ?? "").trim() !== String(tgUserId).trim()) {
    await sendTelegramHtml(chatId, "Подписка не найдена.", backHomeRow);
    return;
  }
  const check = checkDeviceSlotPurchaseAllowed(target);
  if (!check.ok) {
    await sendTelegramHtml(chatId, check.message, backHomeRow);
    return;
  }
  const dl = getDeviceLimitSettings();
  const price = dl.purchase_price_rub;
  const payUrl = effectivePaymentUrl();
  const sessionId = startPaymentAwaitingProof(chatId, tgUserId, 1, "device_slot", target.id, undefined, {
    username: from?.username,
    first_name: from?.first_name,
  });
  createDeviceSlotPurchaseRecord({
    user_id: target.id,
    subscription_id: target.id,
    payment_id: sessionId,
    slots_count: 1,
    price_per_slot: price,
    amount_total: price,
    status: "pending",
    expires_at: target.expiry_time > 0 ? target.expiry_time : 0,
    admin_comment: "",
  });
  const linkEsc = escHtml(payUrl);
  const calc = deviceLimitCalcSettingsForUser(target);
  const active = activeDeviceSlots(target.device_slots ?? []).length;
  const limit = userDeviceTotalLimit(target, calc);
  const body =
    `<b>Дополнительное место для устройства</b>\n\n` +
    `<b>Подписка:</b> ${escHtml(userTargetTitle(target))}\n` +
    `<b>Сейчас:</b> ${active}/${limit} устройств\n` +
    `<b>Сумма к оплате:</b> ${price} ₽\n\n` +
    `<b>Ссылка для оплаты:</b>\n<a href="${linkEsc}">${linkEsc}</a>\n\n` +
    `В комментарии к переводу укажите: <code>device_slot</code>\n\n` +
    `После оплаты пришлите в этот чат <b>скриншот или фото подтверждения перевода</b>.`;
  await sendTelegramHtml(chatId, body, backHomeRow);
}

export async function sendWhitelistInstructionMenu(chatId: number): Promise<void> {
  await sendWhitelistInstructionToChat(chatId);
}

type PhotoMsg = {
  message_id: number;
  chat: { id: number };
  from?: { id: number };
  photo?: { file_id: string }[];
};

export async function onPaymentProofPhoto(msg: PhotoMsg): Promise<boolean> {
  const chatId = msg.chat.id;
  const fromId = msg.from?.id ?? chatId;
  if (findPendingAdminSessionByChat(chatId)) {
    await sendTelegramHtml(
      chatId,
      "<b>Заявка уже у администратора.</b> Дождитесь подтверждения или ответа.",
      replyKeyboardForPayer(fromId),
    );
    return true;
  }
  const sess = findAwaitingProofSessionByChat(chatId);
  if (!sess) return false;
  const photos = msg.photo;
  if (!photos?.length) return false;
  const fileId = photos[photos.length - 1]!.file_id;
  const isTest = sess.kind === "test";
  const isTopUp = sess.kind === "topup";
  const isWhiteLists = sess.kind === "white_lists";
  const subMeta = isTest ? getTestPlanRuntimeMeta() : getPlanRuntimeMeta(sess.plan_id);
  const topupMeta = getTopUpPlanRuntimeMeta(sess.plan_id);
  const wlPrice = getWhitelistPurchasePriceRub();
  const admins = getTelegramPaymentNotifyChatIds();
  const linked = findUsersByTelegramChatId(chatId);
  const target = sess.target_user_id ? getUser(sess.target_user_id) : undefined;
  const newName = String(sess.new_subscription_name ?? "").trim();
  const payerTag =
    sess.tg_username && String(sess.tg_username).trim()
      ? `@${escHtml(String(sess.tg_username).replace(/^@/, ""))}`
      : sess.tg_first_name && String(sess.tg_first_name).trim()
        ? escHtml(String(sess.tg_first_name).trim())
        : "";
  const linkedBrief = isWhiteLists
    ? target
      ? `Белые списки для подписки: <b>${escHtml(userTargetTitle(target))}</b>.`
      : "<b>Внимание:</b> подписка не выбрана — отклоните заявку."
    : isTopUp
    ? linked.length === 0
      ? "<b>Внимание:</b> для докупки нужен привязанный клиент в панели. Эту заявку нужно отклонить."
      : target
        ? `Выбрана подписка: <b>${escHtml(userTargetTitle(target))}</b>.`
        : `Привязано клиентов в панели: <b>${linked.length}</b> (id: ${linked.map((u) => u.id).join(", ")}).`
    : isTest
      ? "<b>Тестовая подписка:</b> при «Подтвердить» будет <b>создан</b> клиент с тестовым тарифом (1 раз на пользователя)."
    : linked.length === 0
      ? "<b>Новый клиент:</b> в панели записи с этим Telegram id нет — при «Подтвердить» будет <b>создан</b> клиент с оплаченным тарифом."
      : newName
        ? `Будет создана новая подписка: <b>${escHtml(newName)}</b>.`
      : target
        ? `Выбрана подписка: <b>${escHtml(userTargetTitle(target))}</b>.`
        : `Привязано клиентов в панели: <b>${linked.length}</b> (id: ${linked.map((u) => u.id).join(", ")}).`;

  const caption =
    `<b>Чек на оплату VPN</b>\n` +
    `Сессия: <code>${escHtml(sess.id)}</code>\n` +
    (payerTag ? `Плательщик: <b>${payerTag}</b> (chat <code>${sess.tg_chat_id}</code>)\n` : `Чат: <code>${sess.tg_chat_id}</code>\n`) +
    (isWhiteLists
      ? `<b>Покупка белых списков</b>\n`
      : isTopUp
      ? `Пакет докупки: <b>${sess.plan_id}</b> — ${escHtml(topupSummary(topupMeta))}\n`
      : isTest
        ? `Тестовая подписка — ${escHtml(planSummary(subMeta))}\n`
      : `Тариф: <b>${sess.plan_id}</b> — ${escHtml(planSummary(subMeta))}\n`) +
    formatAdminPaymentAmountLine(
      isWhiteLists ? wlPrice : isTopUp ? topupMeta.priceRub : subMeta.priceRub,
      sess,
    ) +
    `\n${linkedBrief}`;

  let anyOk = false;
  for (const adminChat of admins) {
    try {
      await sendTelegramPhoto(adminChat, fileId, caption, {
        reply_markup: adminDecisionKeyboard(sess.id),
      });
      anyOk = true;
    } catch (e) {
      console.error("[telegram] sendPhoto to admin", adminChat, e);
    }
  }
  if (!anyOk) {
    await sendTelegramHtml(
      chatId,
      "Не удалось передать чек администратору. Напишите администратору вручную или попробуйте позже.",
      backHomeRow,
    );
    return true;
  }
  markPaymentSessionPendingAdmin(sess.id, fileId);
  await sendTelegramHtml(
    chatId,
    "<b>Чек получен.</b> Администратор проверит оплату и примет решение. Обычно это занимает немного времени.",
    replyKeyboardForPayer(fromId),
  );
  return true;
}

export async function onAdminPaymentConfirm(
  callbackQueryId: string,
  adminFromId: number,
  sessionId: string,
  adminMessage?: AdminPaymentReceiptMessage,
): Promise<void> {
  if (!isPaymentAdmin(adminFromId)) {
    await answerCallbackQuery(callbackQueryId, { text: "Нет прав.", show_alert: true });
    return;
  }
  const sess = getPaymentSession(sessionId);
  if (!sess || sess.status !== "pending_admin") {
    await answerCallbackQuery(callbackQueryId, { text: "Заявка не найдена или уже обработана.", show_alert: true });
    return;
  }
  const isTopUp = sess.kind === "topup";
  const isTest = sess.kind === "test";
  const isWhiteLists = sess.kind === "white_lists";
  const isDeviceSlot = sess.kind === "device_slot";
  if (isDeviceSlot) {
    const target = sess.target_user_id ? getUser(sess.target_user_id) : undefined;
    if (!target) {
      await answerCallbackQuery(callbackQueryId, { text: "Подписка не найдена.", show_alert: true });
      deletePaymentSession(sessionId);
      return;
    }
    const settings = getDeviceLimitSettings();
    const price = settings.purchase_price_rub;
    const purchase = findDeviceSlotPurchaseByPaymentId(sessionId);
    activateDeviceSlotPurchaseForUser(target.id, purchase?.slots_count ?? 1, sessionId);
    if (purchase) {
      updateDeviceSlotPurchase(purchase.id, {
        status: "paid",
        activated_at: new Date().toISOString(),
      });
    }
    const fresh = getUser(target.id) ?? target;
    const used = activeDeviceSlots(fresh.device_slots ?? []).length;
    const limit = userDeviceTotalLimit(fresh, deviceLimitCalcSettingsForUser(fresh));
    appendShopActivity({
      kind: "device_slot",
      user_id: fresh.id,
      user_name: fresh.name,
      plan_id: 1,
      plan_title: "Доп. место для устройства",
    });
    await answerCallbackQuery(callbackQueryId, { text: "Место для устройства добавлено." });
    deletePaymentSession(sessionId);
    await finalizeAdminPaymentReceipt(adminMessage, "confirmed");
    await sendTelegramHtml(
      sess.tg_chat_id,
      `<b>✅ Дополнительное устройство подключено</b>\n\n` +
        `Вы купили ещё 1 место для подписки «${escHtml(subscriptionPublicName(fresh))}».\n\n` +
        `Теперь доступно устройств: <b>${used}/${limit}</b>.\n\n` +
        `Чтобы подключить новое устройство, откройте приложение и скопируйте ссылку VPN для нового устройства.`,
      backHomeRow,
    );
    return;
  }
  if (isWhiteLists) {
    const target = sess.target_user_id ? getUser(sess.target_user_id) : undefined;
    if (!target) {
      await answerCallbackQuery(callbackQueryId, { text: "Подписка не найдена.", show_alert: true });
      deletePaymentSession(sessionId);
      return;
    }
    const amount = getWhitelistPurchasePriceRub();
    const result = await activateWhitelistPurchaseAfterPayment({
      user: target,
      payment_id: sessionId,
      amount,
      tg_chat_id: sess.tg_chat_id,
    });
    if (!result.ok) {
      await answerCallbackQuery(callbackQueryId, {
        text: result.error ?? "Не удалось подключить белые списки",
        show_alert: true,
      });
      deletePaymentSession(sessionId);
      return;
    }
    appendShopActivity({
      kind: "white_lists",
      user_id: target.id,
      user_name: target.name,
      plan_id: 1,
      plan_title: "Покупка белых списков",
    });
    await answerCallbackQuery(callbackQueryId, { text: "Белые списки подключены." });
    deletePaymentSession(sessionId);
    await finalizeAdminPaymentReceipt(adminMessage, "confirmed");
    return;
  }
  const subMeta = isTest ? getTestPlanRuntimeMeta() : getPlanRuntimeMeta(sess.plan_id);
  const topupMeta = getTopUpPlanRuntimeMeta(sess.plan_id);
  let linked = findUsersByTelegramChatId(sess.tg_chat_id);
  if (isTest) {
    if (linked.length > 0 || !isTestSubscriptionEligible(sess.tg_user_id)) {
      await answerCallbackQuery(callbackQueryId, {
        text: "Тестовая подписка недоступна для этого пользователя.",
        show_alert: true,
      });
      deletePaymentSession(sessionId);
      return;
    }
  }
  let autoCreated = false;
  let autoCreatedUser: UserRow | undefined;
  if (!isTopUp && (linked.length === 0 || String(sess.new_subscription_name ?? "").trim() || isTest)) {
    const tgKey = String(sess.tg_chat_id).trim();
    const expiryMs = snapExpiryTimeToNoonLocal(Date.now() + subMeta.days * DAY_MS);
    const displayName = isTest
      ? clientDisplayNameFromSession(sess)
      : String(sess.new_subscription_name ?? "").trim() || clientDisplayNameFromSession(sess);
    try {
      autoCreatedUser = createUser({
        name: displayName,
        email: `${sess.tg_chat_id}@tg.vpn`,
        tg_id: tgKey,
        total_gb: subMeta.total_gb,
        expiry_time: expiryMs,
        enable: 1,
        is_test_subscription: isTest ? 1 : 0,
        comment: isTest
          ? `Тестовая подписка: ${planSummary(subMeta)}`
          : `Оплата в боте, тариф #${sess.plan_id}: ${planSummary(subMeta)}`,
      });
      autoCreated = true;
      linked = autoCreatedUser ? [autoCreatedUser] : findUsersByTelegramChatId(sess.tg_chat_id);
    } catch (e) {
      console.error("[telegram] createUser after payment:", e);
      await answerCallbackQuery(callbackQueryId, {
        text: e instanceof Error ? e.message : "Не удалось создать клиента",
        show_alert: true,
      });
      deletePaymentSession(sessionId);
      return;
    }
  }
  if (isTopUp && linked.length === 0) {
    await answerCallbackQuery(callbackQueryId, {
      text: "Нет привязанной подписки для начисления.",
      show_alert: true,
    });
    deletePaymentSession(sessionId);
    return;
  }
  const explicitTarget = sess.target_user_id ? linked.find((u) => u.id === sess.target_user_id) : undefined;
  if (sess.target_user_id && !explicitTarget && linked.length > 0) {
    await answerCallbackQuery(callbackQueryId, {
      text: "Выбранная подписка не найдена или уже отвязана.",
      show_alert: true,
    });
    deletePaymentSession(sessionId);
    return;
  }
  const targets: UserRow[] = isTopUp
    ? explicitTarget
      ? [explicitTarget]
      : linked
    : explicitTarget
      ? [explicitTarget]
      : autoCreatedUser
        ? [autoCreatedUser]
        : linked;

  if (!isTopUp && autoCreated && sess.referral_inviter_user_id && (sess.referral_discount_percent ?? 0) > 0 && !isTest) {
    const refCfg = getReferralProgram();
    const inviter = getUser(sess.referral_inviter_user_id);
    if (inviter) {
      const reward = createReferralReward({
        inviter_user_id: inviter.id,
        invitee_tg_user_id: sess.tg_user_id,
        invitee_name: clientDisplayNameFromSession(sess),
        reward_gb: refCfg.inviter_reward_gb,
        reward_days: refCfg.inviter_reward_days,
      });
      try {
        const invitee = clientDisplayNameFromSession(sess);
        await sendTelegramHtml(
          Number(String(inviter.tg_id || "").trim()),
          `🎉 <b>${escHtml(invitee)}</b> присоединился по вашей реферальной ссылке.\n\nВыберите свою награду:`,
          referralRewardKeyboard(reward.id, reward.reward_gb, reward.reward_days),
        );
      } catch {
        // silent
      }
    }
    consumeReferralInviteByTgUser(sess.tg_user_id);
  }

  if (!isTest && (sess.roulette_discount_percent ?? 0) > 0) {
    consumeRoulettePurchaseDiscount(sess.tg_user_id, sess.roulette_discount_spin_id);
  }

  if (isTest && autoCreated) {
    markTestSubscriptionUsed(sess.tg_user_id);
    if (autoCreatedUser) addUserToTestSubscriptionSegment(autoCreatedUser.id);
  }

  const affected: UserRow[] = [];
  const skippedUnlimited: UserRow[] = [];
  if (isTopUp) {
    for (const row of targets) {
      if (row.total_gb <= 0) {
        skippedUnlimited.push(row);
        continue;
      }
      const next = updateUserRow(row.id, { total_gb: row.total_gb + topupMeta.add_gb });
      if (next) affected.push(next);
    }
  } else if (!autoCreated) {
    for (const row of targets) {
      const newExpiry = snapExpiryTimeToNoonLocal(Date.now() + subMeta.days * DAY_MS);
      const patch: { total_gb: number; expiry_time: number; comment?: string } = {
        total_gb: subMeta.total_gb,
        expiry_time: newExpiry,
      };
      if (
        !isTest &&
        (row.is_test_subscription === 1 || /^Тестовая подписка:/i.test(String(row.comment ?? "").trim()))
      ) {
        patch.comment = `Оплата в боте, тариф #${sess.plan_id}: ${planSummary(subMeta)}`;
      }
      const patched = updateUserRow(row.id, patch);
      if (!patched) continue;
      const next = await resetUserTrafficCounters(patched);
      if (next) affected.push(next);
    }
  } else if (autoCreatedUser) {
    affected.push(autoCreatedUser);
  }

  if (!isTopUp && !isTest && affected.length > 0) {
    clearTestSubscriptionFlags(affected.map((u) => u.id));
  }

  for (const row of affected) {
    if (isTopUp) {
      appendShopActivity({
        kind: "topup",
        user_id: row.id,
        user_name: row.name,
        plan_id: sess.plan_id,
        plan_title: topupMeta.title,
        add_gb: topupMeta.add_gb,
      });
    } else if (isTest) {
      appendShopActivity({
        kind: "test",
        user_id: row.id,
        user_name: row.name,
        plan_id: sess.plan_id,
        plan_title: subMeta.title,
        total_gb: subMeta.total_gb,
        days: subMeta.days,
      });
    } else {
      appendShopActivity({
        kind: "subscription",
        user_id: row.id,
        user_name: row.name,
        plan_id: sess.plan_id,
        plan_title: subMeta.title,
        total_gb: subMeta.total_gb,
        days: subMeta.days,
      });
    }
  }

  await answerCallbackQuery(callbackQueryId, {
    text: isTopUp
      ? affected.length > 0
        ? "ГБ начислены."
        : "Изменений нет (безлимитные подписки)."
      : isTest && autoCreated
        ? "Тестовая подписка активирована."
      : autoCreated
        ? "Клиент создан, подписка активирована."
        : "Подписка продлена.",
  });
  try {
    await pushClientListToAllDeployedServers();
  } catch (e) {
    console.error("[telegram] push after payment confirm:", e);
  }
  deletePaymentSession(sessionId);
  const trafficNote = subMeta.total_gb > 0 ? `${subMeta.total_gb} ГБ/мес` : "безлимит по трафику";
  const primary = affected[0] ?? linked[0];
  if (!primary) return;
  const subUrl = publicSubscriptionUrl(primary.sub_token);
  const subCode = escUrlForCode(subUrl);
  const affectedList =
    affected.length > 0
      ? affected.map((u) => `• ${escHtml(subscriptionPublicName(u))} — до <b>${escHtml(expiryDateText(u.expiry_time))}</b>`).join("\n")
      : "";
  const topupList =
    affected.length > 0
      ? affected
          .map((u) => `• ${escHtml(subscriptionPublicName(u))} — новый лимит <b>${u.total_gb > 0 ? `${u.total_gb} ГБ` : "∞"}</b>`)
          .join("\n")
      : "";
  const skippedUnlimitedText =
    skippedUnlimited.length > 0
      ? `\n\nНе изменены (безлимит): ${skippedUnlimited.map((u) => subscriptionPublicName(u)).join(", ")}.`
      : "";
  const body = isTopUp
    ? `<b>Оплата подтверждена.</b>\n\n` +
      `Начислено: <b>+${topupMeta.add_gb} ГБ</b>\n` +
      `Пакет: ${escHtml(topupSummary(topupMeta))}\n\n` +
      (topupList ? `<b>Подписки, к которым применена докупка:</b>\n${topupList}` : "Начисление не применено.") +
      `${skippedUnlimitedText}\n\n` +
      `Актуальные данные — в разделе «Статистика по подписке».`
    : autoCreated && isTest
    ? `<b>Тестовая подписка активирована.</b>\n\n` +
      `Тариф: ${escHtml(subMeta.title)} — ${escHtml(planSummary(subMeta))}\n` +
      `Лимит трафика: <b>${escHtml(trafficNote)}</b>\n` +
      `Срок: <b>${subMeta.days}</b> суток с момента активации (до полудня дня окончания).\n\n` +
      `<b>Ссылка на подписку (добавьте в клиент):</b>\n\n<code>${subCode}</code>\n\n` +
      `Позже её можно скопировать в меню «Подписка». Статистика — в «Статистика по подписке».`
    : autoCreated
    ? `<b>Оплата подтверждена — доступ открыт.</b>\n\n` +
      `Тариф: ${escHtml(planSummary(subMeta))}\n` +
      `Лимит трафика: <b>${escHtml(trafficNote)}</b>\n` +
      `Срок: <b>${subMeta.days}</b> суток с момента активации (до полудня дня окончания).\n\n` +
      `<b>Ссылка на подписку (добавьте в клиент):</b>\n\n<code>${subCode}</code>\n\n` +
      `Позже её можно скопировать в меню «Подписка». Статистика — в «Статистика по подписке».`
    : `<b>Оплата подтверждена.</b>\n\n` +
      `Тариф: ${escHtml(planSummary(subMeta))}\n` +
      `Лимит трафика: <b>${escHtml(trafficNote)}</b>\n` +
      (subMeta.total_gb > 0 ? `Использованный трафик <b>обнулён</b>.\n` : "") +
      `Срок: <b>${subMeta.days}</b> суток с момента активации (до полудня дня окончания).\n` +
      (affectedList ? `\n<b>Обновлённые подписки:</b>\n${affectedList}\n` : "") +
      `Актуальные дата и трафик — в разделе «Статистика по подписке».`;
  await sendTelegramHtml(sess.tg_chat_id, body, replyKeyboardForPayer(sess.tg_chat_id));

  const perPurchase = Math.max(0, Math.floor(getGameTicketsPerPurchase() || 0));
  const activeGame = getWebAppActiveGame();
  if (activeGame !== "none" && perPurchase > 0 && !isTest) {
    const grantTarget =
      sess.target_user_id && sess.target_user_id > 0
        ? sess.target_user_id
        : autoCreatedUser?.id ?? (linked.length === 1 ? linked[0]?.id : affected[0]?.id);
    const grantedPool = grantDropperTicketsForPurchaseChat(sess.tg_chat_id, perPurchase, grantTarget);
    if (grantedPool > 0) {
      try {
        await notifyDropperTicketsAfterPurchase(sess.tg_chat_id, perPurchase);
      } catch (e) {
        console.error("[telegram] dropper tickets notify:", e);
      }
    }
  }

  await finalizeAdminPaymentReceipt(adminMessage, "confirmed");

  const targetUser =
    sess.target_user_id != null && sess.target_user_id > 0 ? getUser(sess.target_user_id) : findUsersByTelegramChatId(sess.tg_chat_id)[0];
  const rec = targetUser
    ? { user_id: targetUser.id, user_name: targetUser.name }
    : recipientFromChatId(sess.tg_chat_id);
  if (rec) {
    logCommunicationMessage({
      automatic: true,
      source_label: "Авто: оплата подтверждена",
      text: stripHtmlPreview(body),
      has_photo: false,
      recipients: [rec],
      sent: 1,
      attempted: 1,
      failed: 0,
    });
  }
}

function escUrlForCode(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clientDisplayNameFromSession(sess: PaymentSessionRow): string {
  const u = (sess.tg_username ?? "").trim().replace(/^@/, "");
  if (u) return `@${u}`;
  const fn = (sess.tg_first_name ?? "").trim();
  if (fn) return fn;
  return "Новый клиент";
}

export async function onReferralRewardChosen(
  callbackQueryId: string,
  tgFromId: number,
  rewardId: string,
  kind: "gb" | "days",
): Promise<void> {
  const reward = getReferralReward(rewardId);
  if (!reward || reward.status !== "pending") {
    await answerCallbackQuery(callbackQueryId, { text: "Награда уже выбрана или недоступна.", show_alert: true });
    return;
  }
  const inviter = getUser(reward.inviter_user_id);
  if (!inviter || String(inviter.tg_id || "").trim() !== String(tgFromId).trim()) {
    await answerCallbackQuery(callbackQueryId, { text: "Нет доступа к этой награде.", show_alert: true });
    return;
  }
  if (kind === "gb") {
    if (inviter.total_gb <= 0) {
      await answerCallbackQuery(callbackQueryId, { text: "У вас безлимит. Выберите награду в днях.", show_alert: true });
      return;
    }
    updateUserRow(inviter.id, { total_gb: inviter.total_gb + reward.reward_gb });
    claimReferralReward(reward.id, "gb");
    await answerCallbackQuery(callbackQueryId, { text: `Начислено +${reward.reward_gb} ГБ` });
    const refBody = `🎁 Начислено <b>+${reward.reward_gb} ГБ</b> на вашу текущую подписку.`;
    await sendTelegramHtml(tgFromId, refBody, backHomeRow);
    logCommunicationMessage({
      automatic: true,
      source_label: "Авто: реферальная награда (ГБ)",
      text: stripHtmlPreview(refBody),
      has_photo: false,
      recipients: [{ user_id: inviter.id, user_name: inviter.name }],
      sent: 1,
      attempted: 1,
      failed: 0,
    });
  } else {
    const base = Math.max(Date.now(), inviter.expiry_time > 0 ? inviter.expiry_time : 0);
    updateUserRow(inviter.id, { expiry_time: snapExpiryTimeToNoonLocal(base + reward.reward_days * DAY_MS) });
    claimReferralReward(reward.id, "days");
    await answerCallbackQuery(callbackQueryId, { text: `Добавлено +${reward.reward_days} дней` });
    const refBody = `🎁 Срок вашей подписки продлен на <b>${reward.reward_days} дней</b>.`;
    await sendTelegramHtml(tgFromId, refBody, backHomeRow);
    logCommunicationMessage({
      automatic: true,
      source_label: "Авто: реферальная награда (дни)",
      text: stripHtmlPreview(refBody),
      has_photo: false,
      recipients: [{ user_id: inviter.id, user_name: inviter.name }],
      sent: 1,
      attempted: 1,
      failed: 0,
    });
  }
  try {
    await pushClientListToAllDeployedServers();
  } catch (e) {
    console.error("[telegram] push after referral reward:", e);
  }
}

export async function onAdminPaymentReject(
  callbackQueryId: string,
  adminFromId: number,
  sessionId: string,
  adminMessage?: AdminPaymentReceiptMessage,
): Promise<void> {
  if (!isPaymentAdmin(adminFromId)) {
    await answerCallbackQuery(callbackQueryId, { text: "Нет прав.", show_alert: true });
    return;
  }
  const sess = getPaymentSession(sessionId);
  if (!sess || sess.status !== "pending_admin") {
    await answerCallbackQuery(callbackQueryId, { text: "Заявка не найдена или уже обработана.", show_alert: true });
    return;
  }
  await answerCallbackQuery(callbackQueryId, { text: "Отклонено." });
  deletePaymentSession(sessionId);
  await finalizeAdminPaymentReceipt(adminMessage, "rejected");
  const rejectBody =
    "<b>Платёж не подтверждён.</b>\n\nЕсли вы уже оплатили, напишите администратору и приложите чек ещё раз через «Оплата подписки», «Докупить ГБ» или «Купить подписку».";
  await sendTelegramHtml(sess.tg_chat_id, rejectBody, replyKeyboardForPayer(sess.tg_chat_id));
  const targetUser =
    sess.target_user_id != null && sess.target_user_id > 0 ? getUser(sess.target_user_id) : findUsersByTelegramChatId(sess.tg_chat_id)[0];
  const rec = targetUser
    ? { user_id: targetUser.id, user_name: targetUser.name }
    : recipientFromChatId(sess.tg_chat_id);
  if (rec) {
    logCommunicationMessage({
      automatic: true,
      source_label: "Авто: платёж отклонён",
      text: stripHtmlPreview(rejectBody),
      has_photo: false,
      recipients: [rec],
      sent: 1,
      attempted: 1,
      failed: 0,
    });
  }
}
