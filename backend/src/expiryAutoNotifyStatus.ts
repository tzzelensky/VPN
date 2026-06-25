import { getAutoCommunicationsConfig } from "./autoCommunicationsStore.js";
import { calendarDaysUntilExpiry, localHmInTz, localYmdInTz, projectTimezone } from "./projectTime.js";
import type { UserRow } from "./db.js";

export type ExpiryAutoNotifyStatus = "sent" | "waiting" | "error";

function targetChatId(u: UserRow): number | null {
  const chat = Number(String(u.tg_id ?? "").trim());
  if (!Number.isFinite(chat) || chat <= 0) return null;
  return chat;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function expiryAutoNotifyStatusForUser(
  u: UserRow,
  now = Date.now(),
): { status: ExpiryAutoNotifyStatus | null; hint: string } {
  const cfg = getAutoCommunicationsConfig().expiry;
  if (!cfg.enabled || u.enable === 0) return { status: null, hint: "" };
  if (!u.expiry_time || u.expiry_time <= 0) return { status: null, hint: "" };

  const tz = projectTimezone();
  const todayKey = localYmdInTz(now, tz);

  if (u.expiry_time <= now) {
    if (u.expiry_notify_state === "expired") {
      return { status: "sent", hint: "Уведомление об истечении отправлено" };
    }
    if (!targetChatId(u)) return { status: "error", hint: "Нет Telegram Chat ID" };
    return { status: "waiting", hint: `Истечение — в ${pad2(cfg.notify_hour)}:${pad2(cfg.notify_minute)}` };
  }

  const daysLeft = calendarDaysUntilExpiry(u.expiry_time, now, tz);
  if (daysLeft > cfg.days_before) return { status: null, hint: "" };

  if (!targetChatId(u)) return { status: "error", hint: "Нет Telegram Chat ID" };

  if (u.expiry_warn_sent_day === todayKey) {
    return { status: "sent", hint: "Напоминание отправлено сегодня" };
  }

  if (u.expiry_warn_error_day === todayKey && u.expiry_warn_last_error) {
    return { status: "error", hint: u.expiry_warn_last_error };
  }

  const hm = localHmInTz(now, tz);
  const slotMinutes = cfg.notify_hour * 60 + cfg.notify_minute;
  const nowMinutes = hm.hour * 60 + hm.minute;
  if (nowMinutes > slotMinutes) {
    return { status: "error", hint: "Не доставлено сегодня" };
  }

  return { status: "waiting", hint: `Отправка в ${pad2(cfg.notify_hour)}:${pad2(cfg.notify_minute)}` };
}
