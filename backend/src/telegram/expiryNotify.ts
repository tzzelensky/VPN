import { logCommunicationMessage, stripHtmlPreview } from "../communicationLog.js";
import { listUsers, updateUserRow, type UserRow } from "../db.js";
import { sendTelegramHtml } from "./api.js";
import { getTelegramBotToken } from "./env.js";
import { escHtml } from "./format.js";
import { payReminderInline } from "./keyboards.js";

const DAY_MS = 86_400_000;
const THREE_DAYS_MS = 3 * DAY_MS;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function targetChatId(u: UserRow): number | null {
  const chat = Number(String(u.tg_id ?? "").trim());
  if (!Number.isFinite(chat) || chat <= 0) return null;
  return chat;
}

export type ExpiryNotifyGate =
  | { ok: true; chatId: number; daysShown: number }
  | { ok: false; error: "no_tg" | "no_expiry" | "expired" | "too_early" };

/** Последние 3 суток до окончания, есть срок и chat id. */
export function expiryNotifyGate(u: UserRow): ExpiryNotifyGate {
  const chat = targetChatId(u);
  if (!chat) return { ok: false, error: "no_tg" };
  if (!u.expiry_time || u.expiry_time <= 0) return { ok: false, error: "no_expiry" };
  const now = Date.now();
  const msLeft = u.expiry_time - now;
  if (msLeft <= 0) return { ok: false, error: "expired" };
  if (msLeft > THREE_DAYS_MS) return { ok: false, error: "too_early" };
  const daysShown = Math.min(3, Math.max(1, Math.ceil(msLeft / DAY_MS)));
  return { ok: true, chatId: chat, daysShown };
}

export function expiredNotifyGate(u: UserRow): { ok: true; chatId: number } | { ok: false; error: "no_tg" | "no_expiry" | "not_expired" } {
  const chat = targetChatId(u);
  if (!chat) return { ok: false, error: "no_tg" };
  if (!u.expiry_time || u.expiry_time <= 0) return { ok: false, error: "no_expiry" };
  if (u.expiry_time > Date.now()) return { ok: false, error: "not_expired" };
  return { ok: true, chatId: chat };
}

function throughDaysHtml(n: number): string {
  if (n === 1) return "через <b>1 день</b>";
  if (n >= 2 && n <= 4) return `через <b>${n} дня</b>`;
  return `через <b>${n} дней</b>`;
}

export async function sendExpiryRenewalReminder(u: UserRow, opts?: { manual?: boolean }): Promise<void> {
  if (!getTelegramBotToken()) {
    throw new Error("telegram_not_configured");
  }
  const g = expiryNotifyGate(u);
  if (!g.ok) {
    throw new Error(g.error);
  }
  const sameDay = startOfLocalDay(u.expiry_time) === startOfLocalDay(Date.now());
  const body = sameDay
    ? `<b>Подписка «${escHtml(String(u.name ?? "Без названия"))}» заканчивается уже сегодня!</b>\n\nДля продолжения пользования подпиской оплатите её.`
    : `<b>Подписка «${escHtml(String(u.name ?? "Без названия"))}» заканчивается</b> ${throughDaysHtml(g.daysShown)}.\n\n` +
      `Для продолжения пользования подпиской <b>оплатите</b> её.`;
  await sendTelegramHtml(g.chatId, body, payReminderInline);
  logCommunicationMessage({
    automatic: !opts?.manual,
    source_label: opts?.manual ? "Напоминание о сроке (карточка клиента)" : "Авто: срок подписки (≤3 дня)",
    text: stripHtmlPreview(body),
    has_photo: false,
    recipients: [{ user_id: u.id, user_name: u.name }],
    sent: 1,
    attempted: 1,
    failed: 0,
  });
  if (!opts?.manual) {
    updateUserRow(u.id, { expiry_notify_state: "warn" });
  }
}

export async function sendExpiredSubscriptionReminder(u: UserRow, opts?: { manual?: boolean }): Promise<void> {
  if (!getTelegramBotToken()) {
    throw new Error("telegram_not_configured");
  }
  const g = expiredNotifyGate(u);
  if (!g.ok) {
    throw new Error(g.error);
  }
  const body =
    `<b>Подписка «${escHtml(String(u.name ?? "Без названия"))}» истекла.</b>\n\n` +
    `Продлите подписку, чтобы продолжить пользоваться сервисом.`;
  await sendTelegramHtml(g.chatId, body, payReminderInline);
  logCommunicationMessage({
    automatic: !opts?.manual,
    source_label: opts?.manual ? "Уведомление об истечении (карточка клиента)" : "Авто: подписка истекла",
    text: stripHtmlPreview(body),
    has_photo: false,
    recipients: [{ user_id: u.id, user_name: u.name }],
    sent: 1,
    attempted: 1,
    failed: 0,
  });
  updateUserRow(u.id, { expiry_notify_state: "expired" });
}

export async function runAutoExpiryNotificationsOnce(): Promise<void> {
  if (!getTelegramBotToken()) return;
  const now = Date.now();
  for (const u of listUsers()) {
    if (u.enable === 0) continue;
    if (u.is_test_subscription === 1) continue;
    if (!u.expiry_time || u.expiry_time <= 0) continue;
    if (!targetChatId(u)) continue;

    const msLeft = u.expiry_time - now;

    if (msLeft > THREE_DAYS_MS) {
      if (u.expiry_notify_state) {
        updateUserRow(u.id, { expiry_notify_state: "" });
      }
      continue;
    }

    if (msLeft <= 0) {
      if (u.expiry_notify_state === "expired") continue;
      try {
        await sendExpiredSubscriptionReminder(u, { manual: false });
      } catch (e) {
        console.error("[telegram] expired notify:", u.id, e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (u.expiry_notify_state === "warn" || u.expiry_notify_state === "expired") continue;
    try {
      await sendExpiryRenewalReminder(u, { manual: false });
    } catch (e) {
      console.error("[telegram] expiry warn notify:", u.id, e instanceof Error ? e.message : e);
    }
  }
}

export function startAutoExpiryNotifyLoop(): void {
  const intervalMsRaw = Number(process.env.TELEGRAM_EXPIRY_NOTIFY_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(intervalMsRaw) && intervalMsRaw >= 60_000 ? Math.floor(intervalMsRaw) : 15 * 60 * 1000;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runAutoExpiryNotificationsOnce();
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(() => {
    void tick();
  }, intervalMs);
  console.log(`[telegram] expiry notify loop started (every ${Math.round(intervalMs / 60000)} min)`);
}
