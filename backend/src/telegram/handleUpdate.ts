import { findUsersByTelegramChatId, getUser, getSubscriptionShop } from "../db.js";
import { answerCallbackQuery, sendTelegramHtml } from "./api.js";
import { escHtml, formatStatsHtml } from "./format.js";
import {
  backHomeRow,
  mainMenuInline,
  newUserKeyboard,
  pickSubscriptionKeyboard,
  publicSubscriptionUrl,
} from "./keyboards.js";
import {
  onGbTopUpPlanChosen,
  onAdminPaymentConfirm,
  onAdminPaymentReject,
  onPaymentProofPhoto,
  onVpnPlanChosen,
  sendGbTopUpPlanPicker,
  sendVpnPlanPicker,
} from "./paymentFlow.js";
import type { PaymentPlanId } from "../db.js";

type TgUser = { id: number; username?: string; first_name?: string };
type Message = {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
  photo?: { file_id: string }[];
};
type CallbackQuery = {
  id: string;
  from: TgUser;
  message?: { chat: { id: number }; message_id: number };
  data?: string;
};
type Update = { update_id: number; message?: Message; callback_query?: CallbackQuery };

function displayName(from: TgUser): string {
  return from.username ? `@${from.username}` : from.first_name || "друг";
}

function linkedUsers(fromId: number) {
  return findUsersByTelegramChatId(fromId);
}

async function sendMainMenuLinked(chatId: number, from: TgUser): Promise<void> {
  const name = displayName(from);
  const text = `👋 <b>Привет, ${escHtml(name)}!</b>\n\n👇 <b>Выберите действие:</b>`;
  await sendTelegramHtml(chatId, text, mainMenuInline);
}

/** /start и «Меню»: без привязки — экран покупки; с привязкой — основное меню. */
async function sendWelcome(chatId: number, from: TgUser): Promise<void> {
  const linked = linkedUsers(from.id);
  if (linked.length > 0) {
    await sendMainMenuLinked(chatId, from);
    return;
  }
  const name = displayName(from);
  const sales = getSubscriptionShop().sales_disabled;
  const text =
    `👋 <b>Привет, ${escHtml(name)}!</b>\n\n` +
    `<b>У вас ещё нет подписки.</b>\n\n` +
    (sales
      ? "Оформление новых подписок сейчас <b>отключено</b>. Когда администратор привяжет ваш Telegram к аккаунту в панели, здесь появится меню с оплатой продления и ссылкой на VPN."
      : "Нажмите <b>«Купить подписку»</b> — выберите тариф, оплатите по ссылке и отправьте <b>фото чека</b> в этот чат. После проверки администратор подключит доступ.");
  await sendTelegramHtml(chatId, text, newUserKeyboard(sales));
}

export async function handleTelegramUpdate(body: unknown): Promise<void> {
  const u = body as Update;

  if (u.callback_query) {
    await handleCallback(u.callback_query);
    return;
  }

  const msg = u.message;
  if (!msg) return;
  if (!msg.from) {
    console.warn("[telegram] message without from, skipped update_id=", u.update_id);
    return;
  }

  const text = (msg.text ?? "").trim();
  const chatId = msg.chat.id;
  const from = msg.from;

  const t = text.toLowerCase();
  if (t === "/help" || t.startsWith("/start")) {
    await sendWelcome(chatId, from);
    return;
  }

  if (msg.photo?.length) {
    const handled = await onPaymentProofPhoto(msg);
    if (handled) return;
  }
}

async function handleCallback(q: CallbackQuery): Promise<void> {
  const data = (q.data ?? "").trim();
  const fromId = q.from.id;
  const chatId = q.message?.chat.id;
  if (chatId == null) {
    await answerCallbackQuery(q.id, { text: "Нет чата", show_alert: true });
    return;
  }

  const linked = linkedUsers(fromId);

  try {
    if (data === "home") {
      await answerCallbackQuery(q.id);
      await sendWelcome(chatId, q.from);
      return;
    }

    if (data === "stats") {
      await answerCallbackQuery(q.id);
      const html = formatStatsHtml(linked);
      await sendTelegramHtml(chatId, html, backHomeRow);
      return;
    }

    if (data === "pay") {
      await answerCallbackQuery(q.id);
      await sendVpnPlanPicker(chatId, fromId);
      return;
    }

    if (data === "buynew") {
      await answerCallbackQuery(q.id);
      await sendVpnPlanPicker(chatId, fromId);
      return;
    }

    if (data === "buygb") {
      await answerCallbackQuery(q.id);
      await sendGbTopUpPlanPicker(chatId, fromId);
      return;
    }

    if (data === "sub") {
      await answerCallbackQuery(q.id);
      if (linked.length === 0) {
        await sendTelegramHtml(
          chatId,
          "<b>Подписка не привязана.</b>\nПопросите администратора указать ваш <b>Telegram Chat ID</b> (это ваш числовой id) в карточке клиента.",
          backHomeRow,
        );
        return;
      }
      if (linked.length === 1) {
        const u = linked[0]!;
        const url = publicSubscriptionUrl(u.sub_token);
        await sendTelegramHtml(
          chatId,
          `<b>Subscription URL:</b>\n\n<code>${escUrlForCode(url)}</code>`,
          backHomeRow,
        );
        return;
      }
      await sendTelegramHtml(
        chatId,
        "<b>Выберите подписку:</b>",
        pickSubscriptionKeyboard(linked.map((x) => x.id)),
      );
      return;
    }

    const pp = /^pplan:([123])$/.exec(data);
    if (pp) {
      const planId = Number(pp[1]) as PaymentPlanId;
      await answerCallbackQuery(q.id);
      await onVpnPlanChosen(chatId, fromId, planId, q.from);
      return;
    }

    const gp = /^gplan:([123])$/.exec(data);
    if (gp) {
      const planId = Number(gp[1]) as PaymentPlanId;
      await answerCallbackQuery(q.id);
      await onGbTopUpPlanChosen(chatId, fromId, planId, q.from);
      return;
    }

    const pok = /^pok:([0-9a-f]+)$/.exec(data);
    if (pok) {
      await onAdminPaymentConfirm(q.id, fromId, pok[1]!);
      return;
    }

    const pnx = /^pnx:([0-9a-f]+)$/.exec(data);
    if (pnx) {
      await onAdminPaymentReject(q.id, fromId, pnx[1]!);
      return;
    }

    const m = /^lnk:(\d+)$/.exec(data);
    if (m) {
      const userId = Number(m[1]);
      const row = getUser(userId);
      const tgKey = String(fromId).trim();
      if (!row || String(row.tg_id ?? "").trim() !== tgKey) {
        await answerCallbackQuery(q.id, { text: "Нет доступа к этой подписке.", show_alert: true });
        return;
      }
      await answerCallbackQuery(q.id);
      const url = publicSubscriptionUrl(row.sub_token);
      await sendTelegramHtml(
        chatId,
        `<b>Subscription URL:</b>\n\n<code>${escUrlForCode(url)}</code>`,
        backHomeRow,
      );
      return;
    }

    await answerCallbackQuery(q.id);
  } catch (e) {
    console.error("[telegram] callback:", e);
    await answerCallbackQuery(q.id, { text: "Ошибка обработки", show_alert: true });
  }
}

function escUrlForCode(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
