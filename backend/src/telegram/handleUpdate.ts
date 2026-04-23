import { createUser, deleteUser, findUsersByTelegramChatId, getUser, getSubscriptionShop, listUsers, updateUserRow } from "../db.js";
import { answerCallbackQuery, sendTelegramHtml, sendTelegramPhoto } from "./api.js";
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
import { getTelegramPaymentNotifyChatIds } from "./env.js";
import { pushClientListToAllDeployedServers, removeUserUuidFromAllServers } from "../userSync.js";

type TgUser = { id: number; username?: string; first_name?: string };
type Message = {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: { file_id: string }[];
};
type CallbackQuery = {
  id: string;
  from: TgUser;
  message?: { chat: { id: number }; message_id: number };
  data?: string;
};
type Update = { update_id: number; message?: Message; callback_query?: CallbackQuery };

const adminComposeTargetByChat = new Map<number, number>();
const newSubscriptionNameByChat = new Map<number, number>();

function isAdminTg(id: number): boolean {
  return getTelegramPaymentNotifyChatIds().includes(id);
}

function describeAdminForwardError(e: unknown): { text: string; clearCompose: boolean } {
  const raw = e instanceof Error ? e.message : String(e);
  const msg = raw.toLowerCase();
  if (msg.includes("bots can't send messages to bots")) {
    return {
      text:
        "Не удалось отправить: у клиента указан Telegram ID бота.\n\n" +
        "Укажите в карточке клиента обычный user chat id (числовой), затем повторите отправку.",
      clearCompose: true,
    };
  }
  if (msg.includes("bot was blocked by the user")) {
    return {
      text: "Не удалось отправить: пользователь заблокировал бота. Попросите его снова нажать /start в боте.",
      clearCompose: true,
    };
  }
  if (msg.includes("chat not found")) {
    return {
      text: "Не удалось отправить: chat id неверный или пользователь ещё не запускал бота (/start).",
      clearCompose: true,
    };
  }
  return {
    text: `Не удалось отправить сообщение: ${escHtml(raw)}`,
    clearCompose: false,
  };
}

function adminClientsKeyboard() {
  const rows: { text: string; callback_data: string }[][] = [];
  for (const u of listUsers()) {
    const state = u.enable === 1 ? "✅" : "⛔";
    const title = `${state} #${u.id} ${String(u.name || u.email || "user").trim()}`.slice(0, 56);
    rows.push([{ text: title, callback_data: `admu:${u.id}` }]);
  }
  rows.push([{ text: "« В меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

function adminUserActionsKeyboard(userId: number, enabled: boolean) {
  return {
    inline_keyboard: [
      [{ text: enabled ? "Выключить подписку" : "Включить подписку", callback_data: `admtoggle:${userId}` }],
      [{ text: "Написать СМС пользователю", callback_data: `admmsg:${userId}` }],
      [{ text: "🟥 Удалить клиента", callback_data: `admdelq:${userId}` }],
      [{ text: "« К списку клиентов", callback_data: "admin_clients" }],
    ],
  };
}

function adminDeleteConfirmKeyboard(userId: number) {
  return {
    inline_keyboard: [
      [
        { text: "🟥 Да, удалить", callback_data: `admdely:${userId}` },
        { text: "Отмена", callback_data: `admdeln:${userId}` },
      ],
    ],
  };
}

function paymentTargetKeyboard(
  users: ReturnType<typeof linkedUsers>,
  kind: "pay" | "gb",
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const rows = users.map((u) => [
    {
      text: `#${u.id} ${u.name}`.slice(0, 58),
      callback_data: kind === "pay" ? `psel:${u.id}` : `gsel:${u.id}`,
    },
  ]);
  rows.push([{ text: "« В меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

function paySubscriptionPickerKeyboard(users: ReturnType<typeof linkedUsers>) {
  const rows = users.map((u) => [
    {
      text: `#${u.id} ${u.name}`.slice(0, 58),
      callback_data: `psel:${u.id}`,
    },
  ]);
  rows.push([{ text: "➕ Создать новую подписку", callback_data: "pnew" }]);
  rows.push([{ text: "« В меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

async function sendAdminUserCard(chatId: number, userId: number): Promise<void> {
  const row = getUser(userId);
  if (!row) {
    await sendTelegramHtml(chatId, "Клиент не найден.", backHomeRow);
    return;
  }
  const text =
    `<b>Клиент #${row.id}</b>\n` +
    `Имя: <b>${escHtml(row.name)}</b>\n` +
    `Email: <b>${escHtml(row.email)}</b>\n` +
    `Статус: ${row.enable === 1 ? "✅ включен" : "⛔ выключен"}\n` +
    `TG: <code>${escHtml(String(row.tg_id || "—"))}</code>`;
  await sendTelegramHtml(chatId, text, adminUserActionsKeyboard(row.id, row.enable === 1));
}

function displayName(from: TgUser): string {
  return from.username ? `@${from.username}` : from.first_name || "друг";
}

function linkedUsers(fromId: number) {
  return findUsersByTelegramChatId(fromId);
}

async function sendMainMenuLinked(chatId: number, from: TgUser): Promise<void> {
  const name = displayName(from);
  const text = `👋 <b>Привет, ${escHtml(name)}!</b>\n\n👇 <b>Выберите действие:</b>`;
  await sendTelegramHtml(chatId, text, mainMenuInline(isAdminTg(from.id)));
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

  const pendingNewNameOwner = newSubscriptionNameByChat.get(chatId);
  if (pendingNewNameOwner && pendingNewNameOwner === from.id) {
    const name = text.trim();
    if (!name) {
      await sendTelegramHtml(chatId, "Введите название новой подписки (до 25 символов).", backHomeRow);
      return;
    }
    if (name.length > 25) {
      await sendTelegramHtml(
        chatId,
        "Слишком длинное название. Максимум <b>25</b> символов.\nПример: <b>Для мамы</b>",
        backHomeRow,
      );
      return;
    }
    try {
      const user = createUser({
        name,
        email: `${from.id}-${Date.now()}@tg.vpn`,
        tg_id: String(from.id),
        enable: 1,
        total_gb: 1,
        expiry_time: Date.now() - 60_000,
        comment: "Создано из бота: новая подписка",
      });
      newSubscriptionNameByChat.delete(chatId);
      await sendTelegramHtml(
        chatId,
        `<b>Новая подписка создана:</b> #${user.id} ${escHtml(user.name)}\n\nТеперь выберите тариф для оплаты.`,
        backHomeRow,
      );
      await sendVpnPlanPicker(chatId, from.id, user.id);
    } catch (e) {
      await sendTelegramHtml(
        chatId,
        `Не удалось создать подписку: ${escHtml(e instanceof Error ? e.message : String(e))}`,
        backHomeRow,
      );
    }
    return;
  }

  const pendingTarget = adminComposeTargetByChat.get(chatId);
  if (pendingTarget && isAdminTg(from.id)) {
    const target = getUser(pendingTarget);
    if (!target) {
      adminComposeTargetByChat.delete(chatId);
      await sendTelegramHtml(chatId, "Клиент не найден.", mainMenuInline(true));
      return;
    }
    const toChat = Number(String(target.tg_id ?? "").trim());
    if (!Number.isFinite(toChat) || toChat <= 0) {
      adminComposeTargetByChat.delete(chatId);
      await sendTelegramHtml(chatId, "У клиента не указан Telegram Chat ID.", adminUserActionsKeyboard(target.id, target.enable === 1));
      return;
    }
    const payloadText = (msg.caption ?? msg.text ?? "").trim();
    if (!payloadText) {
      await sendTelegramHtml(chatId, "Отправьте текст сообщения (и при желании фото).", backHomeRow);
      return;
    }
    try {
      if (msg.photo?.length) {
        const fileId = msg.photo[msg.photo.length - 1]!.file_id;
        const caption = `<b>Сообщение от администратора</b>\n\n${escHtml(payloadText)}`;
        await sendTelegramPhoto(toChat, fileId, caption, { parse_mode: "HTML" });
      } else {
        await sendTelegramHtml(toChat, `<b>Сообщение от администратора</b>\n\n${escHtml(payloadText)}`);
      }
      adminComposeTargetByChat.delete(chatId);
      await sendTelegramHtml(chatId, "Сообщение отправлено пользователю.", mainMenuInline(true));
    } catch (e) {
      const friendly = describeAdminForwardError(e);
      if (friendly.clearCompose) {
        adminComposeTargetByChat.delete(chatId);
      }
      await sendTelegramHtml(
        chatId,
        friendly.text,
        adminUserActionsKeyboard(target.id, target.enable === 1),
      );
    }
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
      if (linked.length > 0) {
        await sendTelegramHtml(
          chatId,
          "<b>Выберите подписку для оплаты/продления:</b>",
          paySubscriptionPickerKeyboard(linked),
        );
        return;
      }
      await sendVpnPlanPicker(chatId, fromId);
      return;
    }

    if (data === "buynew") {
      await answerCallbackQuery(q.id);
      if (linked.length > 0) {
        await sendTelegramHtml(
          chatId,
          "<b>Выберите подписку для оплаты/продления:</b>",
          paySubscriptionPickerKeyboard(linked),
        );
        return;
      }
      await sendVpnPlanPicker(chatId, fromId);
      return;
    }

    if (data === "buygb") {
      await answerCallbackQuery(q.id);
      if (linked.length > 1) {
        await sendTelegramHtml(
          chatId,
          "<b>Выберите подписку для докупки ГБ:</b>",
          paymentTargetKeyboard(linked, "gb"),
        );
        return;
      }
      await sendGbTopUpPlanPicker(chatId, fromId, linked[0]?.id);
      return;
    }

    const psel = /^psel:(\d+)$/.exec(data);
    if (psel) {
      const userId = Number(psel[1]);
      const row = getUser(userId);
      const tgKey = String(fromId).trim();
      if (!row || String(row.tg_id ?? "").trim() !== tgKey) {
        await answerCallbackQuery(q.id, { text: "Нет доступа к этой подписке.", show_alert: true });
        return;
      }
      await answerCallbackQuery(q.id);
      await sendVpnPlanPicker(chatId, fromId, userId);
      return;
    }

    if (data === "pnew") {
      await answerCallbackQuery(q.id);
      newSubscriptionNameByChat.set(chatId, fromId);
      await sendTelegramHtml(
        chatId,
        "Введите название для новой подписки (до <b>25</b> символов).\n\nПример: <b>Для мамы</b>",
        backHomeRow,
      );
      return;
    }

    const gsel = /^gsel:(\d+)$/.exec(data);
    if (gsel) {
      const userId = Number(gsel[1]);
      const row = getUser(userId);
      const tgKey = String(fromId).trim();
      if (!row || String(row.tg_id ?? "").trim() !== tgKey) {
        await answerCallbackQuery(q.id, { text: "Нет доступа к этой подписке.", show_alert: true });
        return;
      }
      await answerCallbackQuery(q.id);
      await sendGbTopUpPlanPicker(chatId, fromId, userId);
      return;
    }

    if (data === "admin_clients") {
      if (!isAdminTg(fromId)) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      await answerCallbackQuery(q.id);
      await sendTelegramHtml(chatId, "<b>Клиенты</b>\n\nВыберите клиента:", adminClientsKeyboard());
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

    const pp = /^pplan:([123])(?::(\d+))?$/.exec(data);
    if (pp) {
      const planId = Number(pp[1]) as PaymentPlanId;
      const targetUserId = pp[2] ? Number(pp[2]) : undefined;
      await answerCallbackQuery(q.id);
      await onVpnPlanChosen(chatId, fromId, planId, targetUserId, q.from);
      return;
    }

    const gp = /^gplan:([123])(?::(\d+))?$/.exec(data);
    if (gp) {
      const planId = Number(gp[1]) as PaymentPlanId;
      const targetUserId = gp[2] ? Number(gp[2]) : undefined;
      await answerCallbackQuery(q.id);
      await onGbTopUpPlanChosen(chatId, fromId, planId, targetUserId, q.from);
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

    const au = /^admu:(\d+)$/.exec(data);
    if (au) {
      if (!isAdminTg(fromId)) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      await answerCallbackQuery(q.id);
      await sendAdminUserCard(chatId, Number(au[1]));
      return;
    }

    const at = /^admtoggle:(\d+)$/.exec(data);
    if (at) {
      if (!isAdminTg(fromId)) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      const userId = Number(at[1]);
      const row = getUser(userId);
      if (!row) {
        await answerCallbackQuery(q.id, { text: "Клиент не найден.", show_alert: true });
        return;
      }
      const nextEnable = row.enable === 1 ? 0 : 1;
      updateUserRow(userId, { enable: nextEnable });
      try {
        await pushClientListToAllDeployedServers();
      } catch (e) {
        console.error("[telegram] admin toggle push:", e);
      }
      await answerCallbackQuery(q.id, { text: nextEnable === 1 ? "Подписка включена." : "Подписка выключена." });
      await sendAdminUserCard(chatId, userId);
      return;
    }

    const admMsg = /^admmsg:(\d+)$/.exec(data);
    if (admMsg) {
      if (!isAdminTg(fromId)) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      const userId = Number(admMsg[1]);
      const row = getUser(userId);
      if (!row) {
        await answerCallbackQuery(q.id, { text: "Клиент не найден.", show_alert: true });
        return;
      }
      adminComposeTargetByChat.set(chatId, userId);
      await answerCallbackQuery(q.id);
      await sendTelegramHtml(
        chatId,
        `Отправьте текст (и при желании фото) для клиента <b>${escHtml(row.name)}</b>.\n\n` +
          `Сообщение будет переслано пользователю и после этого откроется главное меню.`,
        backHomeRow,
      );
      return;
    }

    const delAsk = /^admdelq:(\d+)$/.exec(data);
    if (delAsk) {
      if (!isAdminTg(fromId)) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      const userId = Number(delAsk[1]);
      const row = getUser(userId);
      if (!row) {
        await answerCallbackQuery(q.id, { text: "Клиент не найден.", show_alert: true });
        return;
      }
      await answerCallbackQuery(q.id);
      await sendTelegramHtml(
        chatId,
        `Подтвердите удаление клиента <b>${escHtml(row.name)}</b> (#${row.id}).`,
        adminDeleteConfirmKeyboard(userId),
      );
      return;
    }

    const delNo = /^admdeln:(\d+)$/.exec(data);
    if (delNo) {
      if (!isAdminTg(fromId)) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      await answerCallbackQuery(q.id, { text: "Удаление отменено." });
      await sendAdminUserCard(chatId, Number(delNo[1]));
      return;
    }

    const delYes = /^admdely:(\d+)$/.exec(data);
    if (delYes) {
      if (!isAdminTg(fromId)) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      const userId = Number(delYes[1]);
      const row = getUser(userId);
      if (!row) {
        await answerCallbackQuery(q.id, { text: "Клиент уже удалён." });
        await sendTelegramHtml(chatId, "<b>Клиенты</b>\n\nВыберите клиента:", adminClientsKeyboard());
        return;
      }
      try {
        await removeUserUuidFromAllServers(row.vless_uuid);
      } catch (e) {
        console.error("[telegram] admin delete remove uuid:", e);
      }
      deleteUser(userId);
      await answerCallbackQuery(q.id, { text: "Клиент удалён." });
      await sendTelegramHtml(chatId, "<b>Клиенты</b>\n\nВыберите клиента:", adminClientsKeyboard());
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
