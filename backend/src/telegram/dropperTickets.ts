import { logCommunicationMessage, recipientFromChatId, stripHtmlPreview } from "../communicationLog.js";
import { sendTelegramHtml } from "./api.js";
import { getTelegramBotToken, getTelegramWebAppUrl } from "./env.js";
import { escHtml, subscriptionPublicName } from "./format.js";
import { getWebAppActiveGame } from "../db.js";

function ticketsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "билет";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "билета";
  return "билетов";
}

/** Уведомление о начислении билетов (покупка или ручная выдача в админке). */
export async function notifyDropperTicketsAfterPurchase(
  chatId: number,
  ticketsAdded: number,
  opts?: { adminGrant?: boolean },
): Promise<void> {
  if (ticketsAdded <= 0) return;
  const activeGame = getWebAppActiveGame();
  if (activeGame === "none" && !opts?.adminGrant) return;
  const url = getTelegramWebAppUrl().trim();
  const reply_markup = url
    ? {
        inline_keyboard: [[{ text: "Открыть приложение", web_app: { url } }]],
      }
    : undefined;
  const word = ticketsWord(ticketsAdded);
  const game = activeGame === "none" ? "dropper" : activeGame;
  const body =
    game === "roulette"
      ? `<b>+${ticketsAdded} ${word} на рулетку!</b>\n\n` +
        `Откройте Mini App и крутите рулетку — 1 билет = 1 прокрут.`
      : `<b>+${ticketsAdded} ${word} на игру «Дроппер»!</b>\n\n` +
        `Управляйте полётом пальцем, избегайте препятствий и приземлитесь на финиш — затем выберите подарок.`;
  await sendTelegramHtml(chatId, body, reply_markup);
  const rec = recipientFromChatId(chatId);
  if (rec) {
    logCommunicationMessage({
      automatic: true,
      source_label:
        opts?.adminGrant
          ? "Авто: выдача билетов (админ)"
          : game === "roulette"
            ? "Авто: билеты рулетки"
            : "Авто: билеты «Дроппер»",
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
    ? `подписку <b>${escHtml(name)}</b>`
    : `подписку <b>${escHtml(subscriptionPublicName({ name: payload.userName }))}</b>`;
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
