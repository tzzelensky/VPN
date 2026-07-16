import type { UserRow } from "./db.js";
import { findUsersByTelegramChatId, getUser, updateUserRow, userHasActiveSubscription } from "./db.js";
import { pushClientListToAllDeployedServers } from "./userSync.js";
import { sendTelegramHtml, sendTelegramPhotoBinary } from "./telegram/api.js";
import { escHtml, plainTextForTelegramHtml } from "./telegram/format.js";
import { getTelegramPaymentNotifyChatIds } from "./telegram/env.js";
import { readWhitelistInstructionPhoto } from "./whitelistInstructionFiles.js";
import {
  countSaleWhitelistKeys,
  createWhitelistPurchase,
  getLatestPaidWhitelistPurchase,
  getWhitelistAccessState,
  getWhitelistVaultSettings,
  isWhitelistPurchaseVisible,
  isWhitelistVaultEnabled,
  listWhitelistPurchases,
  markWhitelistPurchaseActivated,
  markWhitelistPurchaseInstruction,
  patchWhitelistPurchase,
  resolveWhitelistExpiryMs,
  userHasPaidWhitelistProduct,
  userHasWhitelistEntitlement,
} from "./whitelistVaultDb.js";
import type { WhiteListPurchaseRow, WhitelistPurchaseSettings } from "./whitelistVaultTypes.js";

export type WhitelistPurchaseCheck =
  | { ok: true }
  | { ok: false; code: string; message: string };

export function getWhitelistPurchaseSettings(): WhitelistPurchaseSettings {
  return getWhitelistVaultSettings().purchase;
}

export function getWhitelistPurchasePriceRub(): number {
  return Math.max(0, Math.floor(getWhitelistPurchaseSettings().price_rub || 0));
}

export function computeWhitelistExpiresAt(user: UserRow): string | null {
  const duration = getWhitelistPurchaseSettings().duration;
  if (duration === "forever") return null;
  if (duration === "30_days") {
    return new Date(Date.now() + 30 * 86400000).toISOString();
  }
  if (user.expiry_time > 0 && user.expiry_time > Date.now()) {
    return new Date(user.expiry_time).toISOString();
  }
  if (user.expiry_time === 0) return null;
  return new Date().toISOString();
}

export function checkWhitelistPurchaseAllowed(
  user: UserRow,
  opts?: { from_combo?: boolean },
): WhitelistPurchaseCheck {
  if (!isWhitelistVaultEnabled()) {
    return { ok: false, code: "disabled", message: "Белые списки сейчас недоступны." };
  }
  const settings = getWhitelistVaultSettings();
  if (!settings.purchase.sale_enabled) {
    return { ok: false, code: "sale_off", message: "Белые списки сейчас недоступны." };
  }
  if (getWhitelistPurchasePriceRub() <= 0) {
    return { ok: false, code: "no_price", message: "Белые списки временно недоступны. Попробуйте позже." };
  }
  if (countSaleWhitelistKeys() <= 0) {
    return { ok: false, code: "no_keys", message: "Белые списки временно недоступны. Попробуйте позже." };
  }
  if (!userHasActiveSubscription(user)) {
    return {
      ok: false,
      code: "no_subscription",
      message: "Белые списки можно подключить только к активной подписке.",
    };
  }
  if (user.whitelist_happ_enabled === 1) {
    return {
      ok: false,
      code: "already_active",
      message: "Белые списки уже подключены к вашей подписке.",
    };
  }
  const wlAccess = getWhitelistAccessState(user);
  if (wlAccess.status === "active" || wlAccess.status === "suspended") {
    return {
      ok: false,
      code: "already_active",
      message: "Белые списки уже подключены к вашей подписке.",
    };
  }
  if (userHasPaidWhitelistProduct(user)) {
    return {
      ok: false,
      code: "already_active",
      message: "Белые списки уже подключены к вашей подписке.",
    };
  }
  if (!opts?.from_combo && user.total_gb <= 0) {
    return {
      ok: false,
      code: "unlimited_traffic",
      message: "На безлимитном тарифе покупка белых списков недоступна.",
    };
  }
  return { ok: true };
}

export function describeWhitelistPurchaseBlock(user: UserRow | undefined): string | null {
  if (!isWhitelistPurchaseVisible()) {
    const settings = getWhitelistVaultSettings();
    if (!isWhitelistVaultEnabled() || !settings.purchase.sale_enabled) {
      return "Продажа белых списков сейчас выключена.";
    }
    if (getWhitelistPurchasePriceRub() <= 0) return "Не указана цена белых списков.";
    if (countSaleWhitelistKeys() <= 0) {
      return "Нет ключей с галочкой «Включать в продажу».";
    }
    return "Покупка белых списков временно недоступна.";
  }
  if (!user) return "Нужна активная подписка, привязанная к вашему Telegram.";
  const check = checkWhitelistPurchaseAllowed(user);
  return check.ok ? null : check.message;
}

export function findActiveSubscriptionForTg(tgId: number, users: UserRow[]): UserRow | undefined {
  const key = String(tgId).trim();
  return users.find((u) => String(u.tg_id ?? "").trim() === key && userHasActiveSubscription(u));
}

export function findWhitelistPurchaseTarget(tgId: number, users: UserRow[]): UserRow | undefined {
  const canBuy = listWhitelistPurchaseTargets(users);
  if (canBuy.length > 0) return canBuy[0];
  return findActiveSubscriptionForTg(tgId, users);
}

export function listWhitelistPurchaseTargets(users: UserRow[]): UserRow[] {
  return users.filter((u) => checkWhitelistPurchaseAllowed(u).ok);
}

export function tgUserCanBuyWhitelist(tgUserId: number): boolean {
  if (!isWhitelistPurchaseVisible()) return false;
  const linked = findUsersByTelegramChatId(tgUserId);
  return linked.some((u) => checkWhitelistPurchaseAllowed(u).ok);
}

export function buildWhitelistStateForSubscription(user: UserRow): {
  can_buy: boolean;
  status: "none" | "active" | "suspended" | "expired";
  block_reason: string | null;
  active_until: string | null;
  remaining_days: number | null;
} {
  if (!isWhitelistVaultEnabled()) {
    return { can_buy: false, status: "none", block_reason: null, active_until: null, remaining_days: null };
  }
  const check = checkWhitelistPurchaseAllowed(user);
  const wlState = getWhitelistAccessState(user);
  let status: "none" | "active" | "suspended" | "expired" = "none";
  if (userHasWhitelistEntitlement(user)) {
    if (wlState.status === "active") status = "active";
    else if (wlState.status === "suspended") status = "suspended";
    else if (wlState.status === "expired") status = "expired";
  }
  let activeUntil: string | null = null;
  if (status === "active") {
    const expiresMs = resolveWhitelistExpiryMs(user);
    if (expiresMs != null && expiresMs > 0) activeUntil = new Date(expiresMs).toISOString();
  }
  return {
    can_buy: check.ok && status !== "active" && status !== "suspended",
    status,
    block_reason:
      status === "active" || status === "suspended"
        ? "Белые списки уже подключены к этой подписке."
        : check.ok
          ? null
          : check.message,
    active_until: activeUntil,
    remaining_days: wlState.remaining_days,
  };
}

export function buildWhitelistOfferForMiniApp(linked: UserRow[], tgId?: number) {
  const visible = isWhitelistPurchaseVisible();
  const settings = getWhitelistVaultSettings();
  const price = getWhitelistPurchasePriceRub();
  const eligible = listWhitelistPurchaseTargets(linked);
  const purchaseTarget = eligible[0] ?? (tgId != null ? findActiveSubscriptionForTg(tgId, linked) : linked[0]);
  const wlUser = linked.find((u) => userHasWhitelistEntitlement(u));
  const wlState = wlUser ? getWhitelistAccessState(wlUser) : null;
  let status: "hidden" | "not_connected" | "connected" | "suspended" | "expired" = "hidden";
  if (!visible) status = "hidden";
  else if (wlUser && wlState?.status === "active") status = "connected";
  else if (wlUser && wlState?.status === "suspended") status = "suspended";
  else if (wlUser && wlState?.status === "expired") status = "expired";
  else if (eligible.length > 0 || !wlUser || !wlState || wlState.status === "none") status = "not_connected";
  else status = "not_connected";

  let activeUntil: string | null = null;
  if (wlUser && wlState && wlState.status !== "none" && wlState.status !== "expired") {
    const expiresMs = resolveWhitelistExpiryMs(wlUser);
    if (expiresMs != null && expiresMs > 0) {
      activeUntil = new Date(expiresMs).toISOString();
    } else if (expiresMs === null) {
      activeUntil = null;
    }
  }
  const canBuy = visible && eligible.length > 0;
  return {
    visible,
    status,
    price_rub: price,
    description: settings.purchase.miniapp_description,
    active_until: activeUntil,
    remaining_days: wlState?.remaining_days ?? null,
    access_status: wlState?.status ?? "none",
    can_buy: canBuy,
    block_reason: canBuy
      ? null
      : describeWhitelistPurchaseBlock(purchaseTarget ?? findActiveSubscriptionForTg(tgId ?? 0, linked)),
    purchase_user_id: purchaseTarget?.id ?? null,
    eligible_subscription_ids: eligible.map((u) => u.id),
    instruction: {
      title: settings.instruction.title,
      text: settings.instruction.text,
      has_photo: !!settings.instruction.photo_path,
    },
  };
}

export function createPendingWhitelistPurchase(input: {
  user: UserRow;
  payment_id: string;
  amount: number;
}): WhiteListPurchaseRow {
  console.log("[whitelist-purchase] payment created", {
    user_id: input.user.id,
    payment_id: input.payment_id,
    amount: input.amount,
  });
  return createWhitelistPurchase({
    user_id: input.user.id,
    user_name: input.user.name,
    tg_id: String(input.user.tg_id ?? "").trim(),
    payment_id: input.payment_id,
    amount: input.amount,
    status: "pending",
  });
}

export async function activateWhitelistPurchaseAfterPayment(input: {
  user: UserRow;
  payment_id: string;
  amount: number;
  tg_chat_id: number;
  /** false = уведомление клиенту отправит вызывающий код (paymentFlow) */
  notify_user?: boolean;
  from_combo?: boolean;
}): Promise<{ ok: boolean; error?: string; purchase?: WhiteListPurchaseRow; instruction_sent?: boolean }> {
  const pending = listWhitelistPurchases().find((p) => p.payment_id === input.payment_id);
  const check = checkWhitelistPurchaseAllowed(input.user, { from_combo: input.from_combo });
  if (!check.ok) {
    // Повторная/идемпотентная оплата: если есть pending по этому платежу — всё равно активируем.
    if (check.code !== "already_active" || !pending || pending.status === "paid") {
      if (check.code === "already_active") {
        return { ok: true, purchase: getLatestPaidWhitelistPurchase(input.user.id), instruction_sent: false };
      }
      console.error("[whitelist-purchase] activation blocked", check);
      return { ok: false, error: check.message };
    }
  }

  const expiresAt = computeWhitelistExpiresAt(input.user);
  const expiresMs = expiresAt ? Date.parse(expiresAt) : 0;
  let purchase = pending;
  if (!purchase) {
    purchase = createWhitelistPurchase({
      user_id: input.user.id,
      user_name: input.user.name,
      tg_id: String(input.user.tg_id ?? "").trim(),
      payment_id: input.payment_id,
      amount: input.amount,
      status: "paid",
      activated_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
  } else {
    patchWhitelistPurchase(purchase.id, {
      status: "paid",
      activated_at: new Date().toISOString(),
      expires_at: expiresAt,
      amount: input.amount,
    });
    purchase = listWhitelistPurchases().find((p) => p.id === purchase!.id)!;
  }

  try {
    updateUserRow(input.user.id, {
      whitelist_happ_enabled: 1,
      whitelist_active_until: expiresMs > 0 ? expiresMs : 0,
      whitelist_purchase_id: purchase.id,
    });
    markWhitelistPurchaseActivated(purchase.id);
    console.log("[whitelist-purchase] added to subscription", { user_id: input.user.id, purchase_id: purchase.id });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    patchWhitelistPurchase(purchase.id, { activation_error: err });
    console.error("[whitelist-purchase] activation error", err);
    await notifyAdminWhitelistActivationError(input.user, input.payment_id, err);
    return { ok: false, error: err, purchase };
  }

  try {
    await pushClientListToAllDeployedServers();
  } catch (e) {
    console.error("[whitelist-purchase] push after activation:", e);
  }

  let instruction_sent = false;
  if (input.notify_user !== false) {
    try {
      await sendWhitelistSuccessInstruction(input.tg_chat_id);
      markWhitelistPurchaseInstruction(purchase.id, true, null);
      instruction_sent = true;
      console.log("[whitelist-purchase] instruction sent", { user_id: input.user.id });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      markWhitelistPurchaseInstruction(purchase.id, false, err);
      console.error("[whitelist-purchase] instruction send error", err);
    }
  }

  return { ok: true, purchase, instruction_sent };
}

export async function sendWhitelistInstructionToChat(chatId: number): Promise<void> {
  const settings = getWhitelistVaultSettings();
  const title = settings.instruction.title.trim() || "Как обновить подписку";
  const text = plainTextForTelegramHtml(settings.instruction.text);
  let body = text ? `<b>${escHtml(title)}</b>\n\n${escHtml(text)}` : `<b>${escHtml(title)}</b>`;
  if (body.length > 1024) body = `${body.slice(0, 1023)}…`;
  const photo = readWhitelistInstructionPhoto(settings.instruction.photo_path);
  if (photo) {
    try {
      await sendTelegramPhotoBinary(chatId, photo.bytes, {
        caption: body,
        filename: "instruction.jpg",
        mimeType: photo.mime,
        parse_mode: "HTML",
      });
      return;
    } catch (e) {
      console.error(
        "[whitelist-purchase] instruction photo failed, fallback to text:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  await sendTelegramHtml(chatId, body);
}

export async function sendWhitelistSuccessInstruction(chatId: number): Promise<void> {
  const intro =
    "✅ <b>Белые списки подключены!</b>\n\n" +
    "Мы добавили дополнительные ключи в вашу подписку.\n\n" +
    "Чтобы изменения появились в приложении, обновите подписку по инструкции ниже.";
  await sendTelegramHtml(chatId, intro);
  try {
    await sendWhitelistInstructionToChat(chatId);
  } catch (e) {
    console.error("[whitelist-purchase] instruction details failed:", e instanceof Error ? e.message : e);
  }
}

async function notifyAdminWhitelistActivationError(user: UserRow, paymentId: string, error: string): Promise<void> {
  const admins = getTelegramPaymentNotifyChatIds();
  if (!admins.length) return;
  const body =
    `⚠️ <b>Ошибка подключения белых списков после оплаты</b>\n\n` +
    `Пользователь: ${escHtml(user.name)}\n` +
    `Telegram ID: <code>${escHtml(String(user.tg_id ?? "").trim() || "—")}</code>\n` +
    `Платеж: <code>${escHtml(paymentId)}</code>\n` +
    `Ошибка: ${escHtml(error)}\n\n` +
    `Проверьте вручную.`;
  for (const chatId of admins) {
    try {
      await sendTelegramHtml(chatId, body);
    } catch {
      /* ignore */
    }
  }
}

export async function sendWhitelistInstructionTestToAdmin(adminChatId: number): Promise<void> {
  await sendWhitelistSuccessInstruction(adminChatId);
}

export function logWhitelistPurchaseOpened(source: "bot" | "webapp", tgId: number): void {
  console.log("[whitelist-purchase] opened", { source, tg_id: tgId });
}
