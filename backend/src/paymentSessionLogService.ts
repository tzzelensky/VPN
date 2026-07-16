import {
  deletePaymentSession,
  findUsersByTelegramChatId,
  getPaymentSession,
  getUser,
  listPaymentSessions,
  type PaymentSessionRow,
} from "./db.js";
import { getPaymentSessionPricing } from "./adminPaymentReceipt.js";
import {
  appendPaymentSessionMessage,
  cancelActivePaymentSessionLogsForChat,
  deletePaymentSessionLogsMatching,
  findActivePaymentSessionLogByChat,
  getPaymentSessionLog,
  listPaymentSessionLogs,
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
