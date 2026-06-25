import { getAutoCommunicationsConfig } from "../autoCommunicationsStore.js";
import { fillAutoMessageTemplate } from "../autoCommunicationsTypes.js";
import { logCommunicationMessage, stripHtmlPreview } from "../communicationLog.js";
import { getUser, listUsers, updateUserRow, type UserRow } from "../db.js";
import {
  calendarDaysUntilExpiry,
  isNotifySlot,
  isSameLocalDay,
  localYmdInTz,
  projectTimezone,
} from "../projectTime.js";
import { sendTelegramHtml } from "./api.js";
import { getTelegramBotToken } from "./env.js";
import { escHtml, subscriptionPublicName } from "./format.js";
import { payReminderInline } from "./keyboards.js";

function targetChatId(u: UserRow): number | null {
  const chat = Number(String(u.tg_id ?? "").trim());
  if (!Number.isFinite(chat) || chat <= 0) return null;
  return chat;
}

export function isExpiryAutoNotifyWindow(ts = Date.now()): boolean {
  const cfg = getAutoCommunicationsConfig().expiry;
  return isNotifySlot(cfg.notify_hour, cfg.notify_minute, ts);
}

export type ExpiryNotifyGate =
  | { ok: true; chatId: number; daysShown: number }
  | { ok: false; error: "no_tg" | "no_expiry" | "expired" | "too_early" };

/** Последние N календарных суток до окончания, есть срок и chat id. */
export function expiryNotifyGate(u: UserRow): ExpiryNotifyGate {
  const chat = targetChatId(u);
  if (!chat) return { ok: false, error: "no_tg" };
  if (!u.expiry_time || u.expiry_time <= 0) return { ok: false, error: "no_expiry" };
  const now = Date.now();
  if (u.expiry_time <= now) return { ok: false, error: "expired" };
  const daysLeft = calendarDaysUntilExpiry(u.expiry_time, now);
  const daysBefore = getAutoCommunicationsConfig().expiry.days_before;
  if (daysLeft > daysBefore) return { ok: false, error: "too_early" };
  const daysShown = Math.min(daysBefore, Math.max(1, daysLeft || 1));
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

function subscriptionLabelHtml(u: UserRow): string {
  return escHtml(subscriptionPublicName(u));
}

export async function sendExpiryRenewalReminder(u: UserRow, opts?: { manual?: boolean }): Promise<void> {
  if (!getTelegramBotToken()) {
    throw new Error("telegram_not_configured");
  }
  const cfg = getAutoCommunicationsConfig().expiry;
  const g = expiryNotifyGate(u);
  if (!g.ok) {
    throw new Error(g.error);
  }
  const tz = projectTimezone();
  const todayKey = localYmdInTz(Date.now(), tz);
  if (!opts?.manual) {
    const fresh = getUser(u.id) ?? u;
    if (fresh.expiry_warn_sent_day === todayKey) return;
  }
  const sub = subscriptionLabelHtml(u);
  const sameDay = isSameLocalDay(u.expiry_time, Date.now(), tz);
  const vars = {
    subscription: sub,
    days_phrase: throughDaysHtml(g.daysShown),
    days_before: String(cfg.days_before),
  };
  const body = sameDay
    ? fillAutoMessageTemplate(cfg.warn_same_day_message, vars)
    : fillAutoMessageTemplate(cfg.warn_days_message, vars);
  await sendTelegramHtml(g.chatId, body, payReminderInline);
  logCommunicationMessage({
    automatic: !opts?.manual,
    source_label: opts?.manual
      ? "Напоминание о сроке (карточка клиента)"
      : fillAutoMessageTemplate(cfg.source_label_warn, vars),
    text: stripHtmlPreview(body),
    has_photo: false,
    recipients: [{ user_id: u.id, user_name: u.name }],
    sent: 1,
    attempted: 1,
    failed: 0,
  });
  if (!opts?.manual) {
    updateUserRow(u.id, {
      expiry_warn_sent_day: todayKey,
      expiry_warn_last_error: "",
      expiry_warn_error_day: "",
      expiry_notify_state: "",
    });
  }
}

export async function sendExpiredSubscriptionReminder(u: UserRow, opts?: { manual?: boolean }): Promise<void> {
  if (!getTelegramBotToken()) {
    throw new Error("telegram_not_configured");
  }
  const cfg = getAutoCommunicationsConfig().expiry;
  const g = expiredNotifyGate(u);
  if (!g.ok) {
    throw new Error(g.error);
  }
  const vars = {
    subscription: subscriptionLabelHtml(u),
    days_before: String(cfg.days_before),
    days_phrase: "",
  };
  const body = fillAutoMessageTemplate(cfg.expired_message, vars);
  await sendTelegramHtml(g.chatId, body, payReminderInline);
  logCommunicationMessage({
    automatic: !opts?.manual,
    source_label: opts?.manual ? "Уведомление об истечении (карточка клиента)" : cfg.source_label_expired,
    text: stripHtmlPreview(body),
    has_photo: false,
    recipients: [{ user_id: u.id, user_name: u.name }],
    sent: 1,
    attempted: 1,
    failed: 0,
  });
  updateUserRow(u.id, { expiry_notify_state: "expired", expiry_warn_sent_day: "" });
}

export async function runAutoExpiryNotificationsOnce(opts?: { force?: boolean }): Promise<void> {
  const cfg = getAutoCommunicationsConfig().expiry;
  if (!cfg.enabled || !getTelegramBotToken()) return;
  if (!opts?.force && !isExpiryAutoNotifyWindow()) return;

  const now = Date.now();
  const tz = projectTimezone();
  const todayKey = localYmdInTz(now, tz);

  for (const u of listUsers()) {
    if (u.enable === 0) continue;
    if (cfg.skip_test_subscriptions && u.is_test_subscription === 1) continue;
    if (!u.expiry_time || u.expiry_time <= 0) continue;
    if (!targetChatId(u)) continue;

    const daysLeft = calendarDaysUntilExpiry(u.expiry_time, now, tz);

    if (u.expiry_time > now && daysLeft > cfg.days_before) {
      if (u.expiry_warn_sent_day || u.expiry_notify_state || u.expiry_warn_error_day) {
        updateUserRow(u.id, {
          expiry_warn_sent_day: "",
          expiry_warn_last_error: "",
          expiry_warn_error_day: "",
          expiry_notify_state: "",
        });
      }
      continue;
    }

    if (u.expiry_time <= now) {
      if (u.expiry_notify_state === "expired") continue;
      try {
        await sendExpiredSubscriptionReminder(u, { manual: false });
      } catch (e) {
        console.error("[telegram] expired notify:", u.id, e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (u.expiry_warn_sent_day === todayKey) continue;
    try {
      await sendExpiryRenewalReminder(u, { manual: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[telegram] expiry warn notify:", u.id, msg);
      updateUserRow(u.id, {
        expiry_warn_last_error: msg.slice(0, 200),
        expiry_warn_error_day: todayKey,
      });
    }
  }
}

export function startAutoExpiryNotifyLoop(): void {
  const CHECK_MS = 60_000;
  let lastTickKey = "";
  let busy = false;
  const tick = async () => {
    if (busy) return;
    if (!isExpiryAutoNotifyWindow()) return;
    const cfg = getAutoCommunicationsConfig().expiry;
    const tz = projectTimezone();
    const key = `${localYmdInTz(Date.now(), tz)}-${cfg.notify_hour}:${cfg.notify_minute}`;
    if (key === lastTickKey) return;
    lastTickKey = key;
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
  }, CHECK_MS);
  const cfg = getAutoCommunicationsConfig().expiry;
  console.log(
    `[telegram] expiry notify loop started (daily ${String(cfg.notify_hour).padStart(2, "0")}:${String(cfg.notify_minute).padStart(2, "0")} ${projectTimezone()})`,
  );
}
