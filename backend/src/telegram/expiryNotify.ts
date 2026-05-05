import type { UserRow } from "../db.js";
import { sendTelegramHtml } from "./api.js";
import { getTelegramBotToken } from "./env.js";
import { escHtml } from "./format.js";
import { payReminderInline } from "./keyboards.js";

const DAY_MS = 86_400_000;
const THREE_DAYS_MS = 3 * DAY_MS;

export type ExpiryNotifyGate =
  | { ok: true; chatId: number; daysShown: number }
  | { ok: false; error: "no_tg" | "no_expiry" | "expired" | "too_early" };

/** Та же логика, что на фронте: последние 3 суток до окончания, есть срок и chat id. */
export function expiryNotifyGate(u: UserRow): ExpiryNotifyGate {
  const chat = Number(String(u.tg_id ?? "").trim());
  if (!Number.isFinite(chat) || chat <= 0) return { ok: false, error: "no_tg" };
  if (!u.expiry_time || u.expiry_time <= 0) return { ok: false, error: "no_expiry" };
  const now = Date.now();
  const msLeft = u.expiry_time - now;
  if (msLeft <= 0) return { ok: false, error: "expired" };
  if (msLeft > THREE_DAYS_MS) return { ok: false, error: "too_early" };
  const daysShown = Math.min(3, Math.max(1, Math.ceil(msLeft / DAY_MS)));
  return { ok: true, chatId: chat, daysShown };
}

function throughDaysHtml(n: number): string {
  if (n === 1) return "через <b>1 день</b>";
  if (n >= 2 && n <= 4) return `через <b>${n} дня</b>`;
  return `через <b>${n} дней</b>`;
}

export async function sendExpiryRenewalReminder(u: UserRow): Promise<void> {
  if (!getTelegramBotToken()) {
    const e = new Error("telegram_not_configured");
    throw e;
  }
  const g = expiryNotifyGate(u);
  if (!g.ok) {
    throw new Error(g.error);
  }
  const body =
    `<b>Подписка «${escHtml(String(u.name ?? "Без названия"))}» заканчивается</b> ${throughDaysHtml(g.daysShown)}.\n\n` +
    `Для продолжения пользования подпиской <b>оплатите</b> её.`;
  await sendTelegramHtml(g.chatId, body, payReminderInline);
}
