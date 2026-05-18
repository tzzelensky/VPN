import { logCommunicationMessage, recipientFromChatId, stripHtmlPreview } from "../communicationLog.js";
import { sendTelegramHtml } from "./api.js";
import { getTelegramBotToken, getTelegramWebAppUrl } from "./env.js";
import { escHtml } from "./format.js";
import { getDropperGameConfig } from "../db.js";

/** Уведомление после покупки: начислены билеты на «Дроппер» + кнопка WebApp. */
export async function notifyDropperTicketsAfterPurchase(chatId: number, ticketsAdded: number): Promise<void> {
  const cfg = getDropperGameConfig();
  if (!cfg.enabled || ticketsAdded <= 0) return;
  const url = getTelegramWebAppUrl().trim();
  const reply_markup = url
    ? {
        inline_keyboard: [[{ text: "Открыть приложение", web_app: { url } }]],
      }
    : undefined;
  const word =
    ticketsAdded % 10 === 1 && ticketsAdded % 100 !== 11
      ? "билет"
      : ticketsAdded % 10 >= 2 && ticketsAdded % 10 <= 4 && (ticketsAdded % 100 < 10 || ticketsAdded % 100 >= 20)
        ? "билета"
        : "билетов";
  const body =
    `<b>+${ticketsAdded} ${word} на игру «Дроппер»!</b>\n\n` +
    `Управляйте полётом пальцем, избегайте препятствий и приземлитесь на финиш — затем выберите подарок.`;
  await sendTelegramHtml(chatId, body, reply_markup);
  const rec = recipientFromChatId(chatId);
  if (rec) {
    logCommunicationMessage({
      automatic: true,
      source_label: "Авто: билеты «Дроппер»",
      text: stripHtmlPreview(body),
      has_photo: false,
      recipients: [rec],
      sent: 1,
      attempted: 1,
      failed: 0,
    });
  }
}

/** Сообщение в чат после выбора приза в WebApp: на какую подписку начислено. */
export async function notifyDropperPrizeApplied(
  chatId: number,
  payload: { kind: "gb" | "days"; amount: number; userId: number; userName: string },
): Promise<void> {
  if (!getTelegramBotToken()) return;
  const name = String(payload.userName ?? "").trim();
  const subLine = name
    ? `подписку <b>#${payload.userId}</b> «${escHtml(name)}»`
    : `подписку <b>#${payload.userId}</b>`;
  const gift =
    payload.kind === "gb"
      ? `+<b>${payload.amount}</b> ГБ трафика`
      : `+<b>${payload.amount}</b> дн. к сроку`;
  const body = `🎮 <b>Приз «Дроппер» начислен</b>\n\n` + `${gift} на ${subLine}.`;
  await sendTelegramHtml(chatId, body);
  const rec = recipientFromChatId(chatId);
  if (rec) {
    logCommunicationMessage({
      automatic: true,
      source_label: "Авто: приз «Дроппер»",
      text: stripHtmlPreview(body),
      has_photo: false,
      recipients: [rec],
      sent: 1,
      attempted: 1,
      failed: 0,
    });
  }
}
