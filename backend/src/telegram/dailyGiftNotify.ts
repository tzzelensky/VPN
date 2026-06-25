import { logCommunicationMessage, recipientFromChatId, stripHtmlPreview } from "../communicationLog.js";
import {
  getGiftDayKey,
  isDailyGiftNotifyWindow,
  markDailyGiftNotified,
  listDailyGiftReminderTargets,
} from "../dailyGiftService.js";
import { appendDailyGiftEvent, getDailyGiftConfig } from "../dailyGiftStore.js";
import { getTelegramBotToken, getTelegramWebAppUrl } from "./env.js";
import { sendTelegramHtml } from "./api.js";

const CHECK_MS = 60_000;
let lastTickKey = "";

export const DAILY_GIFT_REMINDER_BODY =
  "<b>Ваш ежедневный подарок готов 🎁</b>\n\nЗайдите в приложение и заберите подарок дня.";

export function dailyGiftReminderKeyboard(): { inline_keyboard: Array<Array<{ text: string; web_app: { url: string } }>> } | undefined {
  const url = getTelegramWebAppUrl().trim();
  if (!url) return undefined;
  return {
    inline_keyboard: [[{ text: "Открыть приложение", web_app: { url } }]],
  };
}

export async function sendDailyGiftReminder(chatId: number, opts?: { manual?: boolean }): Promise<void> {
  if (!getTelegramBotToken()) throw new Error("telegram_not_configured");
  const reply_markup = dailyGiftReminderKeyboard();
  await sendTelegramHtml(chatId, DAILY_GIFT_REMINDER_BODY, reply_markup);
  const rec = recipientFromChatId(chatId);
  logCommunicationMessage({
    automatic: !opts?.manual,
    source_label: opts?.manual
      ? "Ежедневный подарок: ручное напоминание"
      : "Ежедневный подарок: напоминание",
    text: stripHtmlPreview(DAILY_GIFT_REMINDER_BODY),
    has_photo: false,
    recipients: rec ? [rec] : [{ user_id: 0, user_name: `tg:${chatId}` }],
    sent: 1,
    attempted: 1,
    failed: 0,
  });
}

export async function runDailyGiftNotificationsOnce(): Promise<void> {
  const cfg = getDailyGiftConfig();
  if (!cfg.enabled || !getTelegramBotToken()) return;
  if (!isDailyGiftNotifyWindow()) return;
  const dayKey = getGiftDayKey();
  const targets = listDailyGiftReminderTargets(dayKey);
  for (const tgId of targets) {
    try {
      await sendDailyGiftReminder(tgId);
      markDailyGiftNotified(tgId, dayKey);
      appendDailyGiftEvent({ tg_user_id: tgId, event: "notify_sent", detail: dayKey });
    } catch (e) {
      appendDailyGiftEvent({
        tg_user_id: tgId,
        event: "notify_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

export function startDailyGiftNotifyLoop(): void {
  setInterval(() => {
    const key = `${getGiftDayKey()}-${new Date().getHours()}:${new Date().getMinutes()}`;
    if (key === lastTickKey) return;
    lastTickKey = key;
    void runDailyGiftNotificationsOnce().catch((e) =>
      console.error("[daily-gift] notify loop:", e instanceof Error ? e.message : e),
    );
  }, CHECK_MS);
}
