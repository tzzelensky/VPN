import {
  deletePaymentSession,
  findUsersByTelegramChatId,
  getPaymentSession,
  getSubscriptionShop,
  getUser,
  listPaymentSessions,
  listPanelSubscriptionRenewalMessages,
  type PaymentSessionRow,
  type UserRow,
} from "./db.js";
import { getPaymentSessionPricing } from "./adminPaymentReceipt.js";
import {
  appendPaymentSessionMessage,
  cancelActivePaymentSessionLogsForChat,
  deletePaymentSessionLogsMatching,
  findActivePaymentSessionLogByChat,
  getPaymentSessionLog,
  listPaymentSessionLogs,
  updatePaymentSessionLogAmount,
  type PaymentSessionLogChannel,
  type PaymentSessionLogRow,
  type PaymentSessionLogStatus,
  updatePaymentSessionLogStatus,
  upsertPaymentSessionLog,
} from "./paymentSessionLogStore.js";
import { subscriptionPublicName } from "./telegram/format.js";

export function stripPaymentMessageHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>[^<]*<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function discountLabelFromPricing(pricing: ReturnType<typeof getPaymentSessionPricing>): string | undefined {
  const line = pricing.discountReasonLine?.trim();
  if (!line) return undefined;
  return stripPaymentMessageHtml(line);
}

function buildLogRowFromSession(
  sess: PaymentSessionRow,
  channel: PaymentSessionLogChannel,
  status: PaymentSessionLogStatus,
): PaymentSessionLogRow {
  const pricing = getPaymentSessionPricing(sess);
  const target =
    sess.target_user_id != null && sess.target_user_id > 0 ? getUser(sess.target_user_id) : undefined;
  const now = new Date().toISOString();
  return {
    id: sess.id,
    tg_chat_id: sess.tg_chat_id,
    tg_user_id: sess.tg_user_id,
    kind: sess.kind,
    plan_id: sess.plan_id,
    status,
    channel,
    amount_rub: pricing.finalRub,
    amount_original_rub: pricing.originalRub !== pricing.finalRub ? pricing.originalRub : undefined,
    tariff_line: pricing.tariffLine,
    plan_title: pricing.planTitle,
    discount_label: discountLabelFromPricing(pricing),
    created_at: sess.created_at,
    updated_at: now,
    messages: [],
    ...(sess.tg_username ? { tg_username: sess.tg_username } : {}),
    ...(sess.tg_first_name ? { tg_first_name: sess.tg_first_name } : {}),
    ...(target ? { target_user_id: target.id, target_user_name: subscriptionPublicName(target) } : {}),
    ...(sess.new_subscription_name ? { new_subscription_name: sess.new_subscription_name } : {}),
  };
}

export function trackPaymentSessionStart(sessionId: string, channel: PaymentSessionLogChannel = "chat"): void {
  const sess = getPaymentSession(sessionId);
  if (!sess) return;
  cancelActivePaymentSessionLogsForChat(sess.tg_chat_id, sessionId);
  const existing = getPaymentSessionLog(sessionId);
  if (existing) {
    updatePaymentSessionLogStatus(sessionId, "awaiting_proof", { channel });
    return;
  }
  upsertPaymentSessionLog(buildLogRowFromSession(sess, channel, "awaiting_proof"));
}

export function trackPaymentSessionPendingAdmin(
  sessionId: string,
  channel?: PaymentSessionLogChannel,
  userMessage?: { text: string; hasPhoto?: boolean },
): void {
  const sess = getPaymentSession(sessionId);
  if (!sess) return;
  const resolvedChannel =
    channel ?? (sess.proof_file_id === "webapp" ? "webapp" : getPaymentSessionLog(sessionId)?.channel ?? "chat");
  const existing = getPaymentSessionLog(sessionId);
  if (!existing) {
    upsertPaymentSessionLog(buildLogRowFromSession(sess, resolvedChannel, "pending_admin"));
  } else {
    updatePaymentSessionLogStatus(sessionId, "pending_admin", { channel: resolvedChannel });
  }
  if (userMessage) {
    appendPaymentSessionMessage(sessionId, {
      at: new Date().toISOString(),
      direction: "user",
      text: userMessage.text,
      ...(userMessage.hasPhoto ? { has_photo: true } : {}),
    });
  }
}

export function trackPaymentSessionFinished(sessionId: string, status: PaymentSessionLogStatus): void {
  const sess = getPaymentSession(sessionId);
  const existing = getPaymentSessionLog(sessionId);
  if (!existing && sess) {
    const channel: PaymentSessionLogChannel = sess.proof_file_id === "webapp" ? "webapp" : "chat";
    upsertPaymentSessionLog(buildLogRowFromSession(sess, channel, status));
  }
  updatePaymentSessionLogStatus(sessionId, status);
}

export function archiveAndDeletePaymentSession(sessionId: string, status: PaymentSessionLogStatus): void {
  trackPaymentSessionFinished(sessionId, status);
  deletePaymentSession(sessionId);
}

export function logPaymentBotMessage(chatId: number, html: string): void {
  const text = stripPaymentMessageHtml(html);
  if (!text) return;
  const active = findActivePaymentSessionLogByChat(chatId);
  if (!active) return;
  appendPaymentSessionMessage(active.id, {
    at: new Date().toISOString(),
    direction: "bot",
    text,
  });
}

export function logPaymentUserMessage(
  chatId: number,
  text: string,
  opts?: { hasPhoto?: boolean },
): void {
  const trimmed = text.trim();
  if (!trimmed && !opts?.hasPhoto) return;
  const active = findActivePaymentSessionLogByChat(chatId);
  if (!active) return;
  appendPaymentSessionMessage(active.id, {
    at: new Date().toISOString(),
    direction: "user",
    text: trimmed || (opts?.hasPhoto ? "Фото чека" : ""),
    ...(opts?.hasPhoto ? { has_photo: true } : {}),
  });
}

export function syncActivePaymentSessionsToLog(): void {
  for (const sess of listPaymentSessions()) {
    const existing = getPaymentSessionLog(sess.id);
    const channel: PaymentSessionLogChannel = sess.proof_file_id === "webapp" ? "webapp" : "chat";
    if (!existing) {
      upsertPaymentSessionLog(buildLogRowFromSession(sess, channel, sess.status));
      continue;
    }
    if (existing.status !== sess.status) {
      updatePaymentSessionLogStatus(sess.id, sess.status, { channel });
    }
  }
}

export function listPaymentSessionReport(opts?: {
  from?: string;
  to?: string;
  status?: string;
  limit?: number;
}): PaymentSessionLogRow[] {
  syncActivePaymentSessionsToLog();
  return listPaymentSessionLogs(opts);
}

export function payerDisplayName(row: PaymentSessionLogRow): string {
  const u = (row.tg_username ?? "").trim().replace(/^@/, "");
  if (u) return `@${u}`;
  const fn = (row.tg_first_name ?? "").trim();
  if (fn) return fn;
  const linked = findUsersByTelegramChatId(row.tg_user_id);
  if (linked[0]) return subscriptionPublicName(linked[0]);
  return `chat ${row.tg_chat_id}`;
}

export function clearPaymentSessionsReport(opts?: {
  from?: string;
  to?: string;
  status?: string;
}): { removed: number; bot_sessions_cancelled: number } {
  syncActivePaymentSessionsToLog();
  const removed = deletePaymentSessionLogsMatching(opts);
  let botSessionsCancelled = 0;
  for (const row of removed) {
    if (row.status !== "awaiting_proof" && row.status !== "pending_admin") continue;
    if (!getPaymentSession(row.id)) continue;
    deletePaymentSession(row.id);
    botSessionsCancelled++;
  }
  return { removed: removed.length, bot_sessions_cancelled: botSessionsCancelled };
}

/** Ручное продление админом → confirmed-строка в ledger выручки. */
export function appendAdminRenewalRevenue(opts: {
  user: UserRow;
  amount_rub: number;
  plan_title: string;
  tariff_line: string;
  plan_id?: number;
  id?: string;
  completed_at?: string;
}): PaymentSessionLogRow | null {
  const id = String(opts.id ?? `admin-renew-${opts.user.id}-${Date.now()}`).trim();
  if (!id || getPaymentSessionLog(id)) return null;
  const completedAt = String(opts.completed_at ?? "").trim() || new Date().toISOString();
  const now = new Date().toISOString();
  const tgChatId = Math.floor(Number(String(opts.user.tg_id ?? "").trim()));
  const chatId = Number.isFinite(tgChatId) && tgChatId > 0 ? tgChatId : 0;
  const row: PaymentSessionLogRow = {
    id,
    tg_chat_id: chatId,
    tg_user_id: chatId,
    kind: "subscription",
    plan_id: opts.plan_id ?? 0,
    status: "confirmed",
    channel: "admin",
    amount_rub: Math.max(0, Math.round(Number(opts.amount_rub) || 0)),
    tariff_line: opts.tariff_line,
    plan_title: opts.plan_title,
    created_at: completedAt,
    updated_at: now,
    completed_at: completedAt,
    messages: [],
    target_user_id: opts.user.id,
    target_user_name: subscriptionPublicName(opts.user),
  };
  upsertPaymentSessionLog(row);
  return row;
}

/** Тариф по total_gb: точное совпадение, иначе ближайший (безлимит только к безлимиту). */
export function resolveShopPlanForUserGb(totalGb: number): {
  id: number;
  title: string;
  price_rub: number;
  total_gb: number;
} | null {
  const plans = getSubscriptionShop().plans ?? [];
  if (plans.length === 0) return null;
  const gb = Number(totalGb);
  const exact = plans.find((p) => p.total_gb === gb);
  if (exact) return exact;
  if (gb === 0) return plans.find((p) => p.total_gb === 0) ?? null;
  const finite = plans.filter((p) => p.total_gb > 0);
  if (finite.length === 0) return null;
  return finite.reduce((best, p) =>
    Math.abs(p.total_gb - gb) < Math.abs(best.total_gb - gb) ? p : best,
  );
}

export function adminRenewalPricingForUser(user: UserRow): {
  amount_rub: number;
  plan_title: string;
  tariff_line: string;
  plan_id?: number;
} {
  const plan = resolveShopPlanForUserGb(user.total_gb);
  const planTitle = plan?.title?.trim() || "Продление админом (без тарифа)";
  return {
    amount_rub: plan ? Math.max(0, Math.round(Number(plan.price_rub) || 0)) : 0,
    plan_title: planTitle,
    tariff_line: planTitle,
    ...(plan ? { plan_id: plan.id } : {}),
  };
}

/** Исторические «Продлить» из журнала сообщений → ledger (идемпотентно). */
export function backfillAdminRenewalsFromCommunicationLog(): { added: number } {
  let added = 0;
  for (const msg of listPanelSubscriptionRenewalMessages()) {
    for (const rec of msg.recipients) {
      const userId = Math.floor(Number(rec.user_id) || 0);
      if (userId <= 0) continue;
      const user = getUser(userId);
      if (!user || user.exclude_from_revenue === 1) continue;
      const id = `admin-renew-comm-${msg.id}-${userId}`;
      if (getPaymentSessionLog(id)) continue;
      const pricing = adminRenewalPricingForUser(user);
      const row = appendAdminRenewalRevenue({
        user,
        ...pricing,
        id,
        completed_at: msg.sent_at,
      });
      if (row) added += 1;
    }
  }
  return { added };
}

export function createManualRevenueEntry(opts: {
  user: UserRow;
  amount_rub: number;
  completed_at?: string;
  plan_title?: string;
}): PaymentSessionLogRow | null {
  if (opts.user.exclude_from_revenue === 1) return null;
  const pricing = adminRenewalPricingForUser(opts.user);
  const title = String(opts.plan_title ?? "").trim() || pricing.plan_title;
  const completedAt = String(opts.completed_at ?? "").trim() || new Date().toISOString();
  return appendAdminRenewalRevenue({
    user: opts.user,
    amount_rub: opts.amount_rub,
    plan_title: title,
    tariff_line: title,
    plan_id: pricing.plan_id,
    id: `admin-manual-${opts.user.id}-${Date.now()}`,
    completed_at: completedAt,
  });
}

export function patchRevenueAmount(id: string, amountRub: number): PaymentSessionLogRow | undefined {
  return updatePaymentSessionLogAmount(id, amountRub);
}
