import {
  applyPromoCodeForUser,
  deleteUser,
  findUsersByTelegramChatId,
  getReferralProgram,
  getUser,
  getSubscriptionShop,
  listUsers,
  setReferralInvite,
  updateUserRow,
} from "../db.js";
import { inlineBtn } from "./inlineButtonStyles.js";
import { logCommunicationMessage, stripHtmlPreview } from "../communicationLog.js";
import {
  clearAiChatSession,
  hasAiChatSession,
  onAiChatMessage,
  startAiChat,
} from "./geminiChatFlow.js";
import { isAiAssistantEnabled } from "./geminiAi.js";
import { getPanelSettings } from "../panelSettings.js";
import { applyReferralInviteVars } from "../referralInviteText.js";
import {
  answerCallbackQuery,
  deleteTelegramMessage,
  editTelegramReplyMarkup,
  forgetBotScreenMessage,
  getLastBotMessageId,
  sendTelegramHtml,
  sendTelegramPhoto,
  type TelegramScreenRef,
} from "./api.js";
import { escHtml, subscriptionPublicName } from "./format.js";
import { formatBotSubscriptionInfoHtml } from "./subscriptionInfo.js";
import {
  backHomeRow,
  mainMenuInline,
  pickSubscriptionKeyboard,
  publicSubscriptionUrl,
} from "./keyboards.js";
import { guestMenuMarkup, linkedMenuMarkup, sendBotMenuMessage } from "./mainMenuSend.js";
import {
  onGbTopUpPlanChosen,
  onAdminPaymentConfirm,
  onAdminPaymentReject,
  onPaymentProofPhoto,
  onPaymentProofText,
  onReferralRewardChosen,
  onTestSubscriptionGet,
  onVpnPlanChosen,
  sendGbTopUpPlanPicker,
  getPromoContext,
  sendTestSubscriptionIntro,
  sendVpnPlanPicker,
  sendWhitelistInstructionMenu,
  sendWhitelistPurchaseMenu,
  sendWhitelistPurchaseMenuForTarget,
  onWhitelistPurchaseStart,
  onDeviceSlotPurchaseStart,
  onComboChosen,
  vpnPlansKeyboardPromo,
  gbTopUpPlansKeyboardPromo,
  setPromoPendingCodeForChat,
} from "./paymentFlow.js";
import { tgUserCanBuyDeviceSlot, isDeviceLimitActiveForUser } from "../deviceLimitEffective.js";
import { isTestSubscriptionEligible, tgUserCanBuyGb, userCanBuyGbTopup } from "../testSubscription.js";
import { checkWhitelistPurchaseAllowed, tgUserCanBuyWhitelist } from "../whitelistPurchaseService.js";
import {
  isWelcomeSeriesTriggerActive,
  parseTriggerClickCallback,
  recordTriggerButtonClick,
  recordUserActivity,
  triggerOnGuestStart,
} from "../triggerMailingsService.js";
import {
  cancelSupportAppealCompose,
  clearSupportAppealDraft,
  hasAppealDraft,
  isSupportAppealsEnabled,
  onSupportAppealDraftMessage,
  startSupportAppealCompose,
  submitSupportAppealFromDraft,
} from "./supportAppealsFlow.js";
import { handleSurveyFeedbackText, handleSurveyRateCallback, handleSurveySkipFeedbackCallback, parseSurveyRateCallback, parseSurveySkipFeedbackCallback } from "../surveyTelegram.js";
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
  message?: { chat: { id: number }; message_id: number; message_thread_id?: number; caption?: string };
  data?: string;
};

function resolveCallbackScreen(q: CallbackQuery, raw?: unknown): TelegramScreenRef | undefined {
  const m = q.message;
  if (m && typeof m.message_id === "number") {
    return { messageId: m.message_id, threadId: m.message_thread_id };
  }
  if (raw && typeof raw === "object" && raw !== null && "callback_query" in raw) {
    const cq = (raw as { callback_query?: { message?: { message_id?: number; message_thread_id?: number } } })
      .callback_query;
    const msg = cq?.message;
    if (msg && typeof msg.message_id === "number") {
      return { messageId: msg.message_id, threadId: msg.message_thread_id };
    }
  }
  return undefined;
}

/** Удаляет сообщение бота, с которого нажали inline-кнопку (главное меню → следующий экран). */
async function dismissCallbackScreen(q: CallbackQuery, raw?: unknown): Promise<void> {
  const chatId = q.message?.chat.id;
  const screen = resolveCallbackScreen(q, raw);
  if (chatId == null || screen?.messageId == null) return;
  const ok = await deleteTelegramMessage(chatId, screen.messageId, screen.threadId);
  if (ok) forgetBotScreenMessage(chatId, screen.messageId);
}

/** Удаляет последний экран бота (для текстовых команд меню). */
async function dismissLastBotScreen(chatId: number): Promise<void> {
  const mid = getLastBotMessageId(chatId);
  if (mid == null) return;
  const ok = await deleteTelegramMessage(chatId, mid);
  if (ok) forgetBotScreenMessage(chatId, mid);
}

async function answerAndDismiss(q: CallbackQuery, raw?: unknown): Promise<void> {
  await answerCallbackQuery(q.id);
  await dismissCallbackScreen(q, raw);
}
type Update = { update_id: number; message?: Message; callback_query?: CallbackQuery };

const adminComposeTargetByChat = new Map<number, number>();
const newSubscriptionDraftByChat = new Map<number, { ownerId: number; name?: string }>();
const promoAwaitByChat = new Map<number, { ownerId: number }>();

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
    const title = `${state} ${subscriptionPublicName(u)}`.slice(0, 56);
    rows.push([{ text: title, callback_data: `admu:${u.id}` }]);
  }
  rows.push([inlineBtn("« В меню", "home", "menuHome")]);
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

function paymentTargetKeyboard(users: ReturnType<typeof linkedUsers>, kind: "pay" | "gb" | "device") {
  const rows = users.map((u) => [
    inlineBtn(
      subscriptionPublicName(u).slice(0, 58),
      kind === "pay" ? `psel:${u.id}` : kind === "gb" ? `gsel:${u.id}` : `dsel:${u.id}`,
      "pickSubscription",
    ),
  ]);
  rows.push([inlineBtn("« В меню", "home", "menuHome")]);
  return { inline_keyboard: rows };
}

function paySubscriptionPickerKeyboard(users: ReturnType<typeof linkedUsers>) {
  const rows = users.map((u) => [
    inlineBtn(subscriptionPublicName(u).slice(0, 58), `psel:${u.id}`, "pickSubscription"),
  ]);
  rows.push([inlineBtn("🗑 Удалить подписку", "pdel_menu", "deleteSubscription")]);
  rows.push([inlineBtn("➕ Создать новую подписку", "pnew", "createNewSubscription")]);
  rows.push([inlineBtn("« В меню", "home", "menuHome")]);
  return { inline_keyboard: rows };
}

function payDeletePickerKeyboard(users: ReturnType<typeof linkedUsers>) {
  const rows = users.map((u) => [
    inlineBtn(`🗑 ${subscriptionPublicName(u)}`.slice(0, 58), `pdelq:${u.id}`, "deleteSubscription"),
  ]);
  rows.push([{ text: "« Назад", callback_data: "pay" }]);
  return { inline_keyboard: rows };
}

function payDeleteConfirmKeyboard(userId: number) {
  return {
    inline_keyboard: [
      [
        inlineBtn("🟥 Да, удалить", `pdely:${userId}`, "deleteSubscription"),
        { text: "Отмена", callback_data: "pdel_menu" },
      ],
    ],
  };
}

function cancelNewSubscriptionNameInline() {
  return {
    inline_keyboard: [
      [{ text: "Отмена", callback_data: "pnew_cancel" }],
      [inlineBtn("« В меню", "home", "menuHome")],
    ],
  };
}

function referralMenuInline() {
  return {
    inline_keyboard: [
      [inlineBtn("Пригласить друга⚡", "ref_send", "inviteFriend")],
      [inlineBtn("« В меню", "home", "menuHome")],
    ],
  };
}

async function sendAdminUserCard(chatId: number, userId: number): Promise<void> {
  const row = getUser(userId);
  if (!row) {
    await sendTelegramHtml(chatId, "Клиент не найден.", backHomeRow());
    return;
  }
  const text =
    `<b>Клиент ${escHtml(subscriptionPublicName(row))}</b>\n` +
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

function menuFlags(fromId: number) {
  const panelSettings = getPanelSettings();
  const linked = linkedUsers(fromId);
  return {
    referral: getReferralProgram().enabled,
    support: isSupportAppealsEnabled(),
    admin: isAdminTg(fromId),
    adminClientsButton: panelSettings.telegram.adminClientsButtonEnabled !== false,
    buyGb: tgUserCanBuyGb(fromId),
    buyDevice: tgUserCanBuyDeviceSlot(fromId),
    whitelist: tgUserCanBuyWhitelist(fromId),
    askAi: isAiAssistantEnabled(),
  };
}

function inlineMenuFor(fromId: number) {
  const f = menuFlags(fromId);
  return mainMenuInline(
    f.admin,
    f.referral,
    f.support,
    f.buyGb,
    f.whitelist,
    f.buyDevice,
    f.adminClientsButton,
    f.askAi,
  );
}

function linkedWelcomeHtml(from: TgUser): string {
  const name = displayName(from);
  return `👋 <b>Привет, ${escHtml(name)}!</b>\n\n👇 <b>Выберите действие:</b>`;
}

function guestWelcomeHtml(from: TgUser): string {
  const name = displayName(from);
  const sales = getSubscriptionShop().sales_disabled;
  return (
    `👋 <b>Привет, ${escHtml(name)}!</b>\n\n` +
    `<b>У вас ещё нет подписки.</b>\n\n` +
    (sales
      ? "Оформление новых подписок сейчас <b>отключено</b>. Когда администратор привяжет ваш Telegram к аккаунту в панели, здесь появится меню с оплатой продления и ссылкой на VPN."
      : isTestSubscriptionEligible(from.id)
        ? "Нажмите <b>«Купить подписку»</b> или <b>«Оформить тестовую подписку»</b> — оплатите по ссылке и отправьте <b>фото чека</b> в этот чат. После проверки администратор подключит доступ."
        : "Нажмите <b>«Купить подписку»</b> — выберите тариф, оплатите по ссылке и отправьте <b>фото чека</b> в этот чат. После проверки администратор подключит доступ.")
  );
}

async function sendMainMenuLinked(chatId: number, from: TgUser): Promise<void> {
  const f = menuFlags(from.id);
  await sendBotMenuMessage(chatId, linkedWelcomeHtml(from), linkedMenuMarkup(f));
}

/** /start и «Меню»: без привязки — экран покупки; с привязкой — основное меню. */
/** «В меню» / home: удалить экран с кнопкой и отправить приветствие. */
async function goHomeMenu(chatId: number, from: TgUser, screen?: TelegramScreenRef): Promise<void> {
  clearAiChatSession(chatId);
  const screenId = screen?.messageId ?? getLastBotMessageId(chatId);
  const threadId = screen?.threadId;

  if (screenId != null) {
    const deleted = await deleteTelegramMessage(chatId, screenId, threadId);
    if (deleted) {
      forgetBotScreenMessage(chatId, screenId);
    } else {
      // Не смогли удалить (фото/права) — хотя бы снимем кнопки со старого сообщения.
      await editTelegramReplyMarkup(chatId, screenId, { inline_keyboard: [] }, threadId);
    }
  }

  await sendWelcome(chatId, from);
}

async function sendWelcome(chatId: number, from: TgUser): Promise<void> {
  const linked = linkedUsers(from.id);
  if (linked.length > 0) {
    await sendMainMenuLinked(chatId, from);
    return;
  }
  if (isWelcomeSeriesTriggerActive()) {
    triggerOnGuestStart(chatId, from.id, from.username);
    return;
  }
  const sales = getSubscriptionShop().sales_disabled;
  await sendBotMenuMessage(
    chatId,
    guestWelcomeHtml(from),
    guestMenuMarkup(sales, isTestSubscriptionEligible(from.id)),
  );
}

function parseStartArg(text: string): string {
  const m = /^\/start(?:@\w+)?(?:\s+(.+))?$/i.exec(text.trim());
  return (m?.[1] ?? "").trim();
}

export async function handleTelegramUpdate(body: unknown): Promise<void> {
  const u = body as Update;

  if (u.callback_query) {
    await handleCallback(u.callback_query, body);
    return;
  }

  const msg = u.message;
  if (!msg) return;
  if (!msg.from) {
    console.warn("[telegram] message without from, skipped update_id=", u.update_id);
    return;
  }

  recordUserActivity(msg.chat.id, msg.from.username);

  const text = (msg.text ?? "").trim();
  const chatId = msg.chat.id;
  const from = msg.from;

  const t = text.toLowerCase();
  if (t === "/help" || t.startsWith("/start")) {
    clearAiChatSession(chatId);
    const arg = parseStartArg(text);
    const ref = /^ref_(\d+)$/i.exec(arg);
    if (ref) {
      const inviterId = Number(ref[1]);
      const inviter = getUser(inviterId);
      if (inviter && inviter.tg_id && String(inviter.tg_id).trim() !== String(from.id).trim() && linkedUsers(from.id).length === 0) {
        setReferralInvite(from.id, inviterId);
      }
    }
    await sendWelcome(chatId, from);
    return;
  }

  const draft = newSubscriptionDraftByChat.get(chatId);
  if (draft && draft.ownerId === from.id) {
    const name = text.trim();
    if (name.toLowerCase() === "отмена" || name.toLowerCase() === "/cancel") {
      newSubscriptionDraftByChat.delete(chatId);
      await sendTelegramHtml(
        chatId,
        "Создание новой подписки отменено.",
        inlineMenuFor(from.id),
      );
      return;
    }
    if (!name) {
      await sendTelegramHtml(
        chatId,
        "Введите название новой подписки (до 25 символов) или нажмите «Отмена».",
        cancelNewSubscriptionNameInline(),
      );
      return;
    }
    if (name.length > 25) {
      await sendTelegramHtml(
        chatId,
        "Слишком длинное название. Максимум <b>25</b> символов.\nПример: <b>Для мамы</b>",
        cancelNewSubscriptionNameInline(),
      );
      return;
    }
    newSubscriptionDraftByChat.set(chatId, { ownerId: from.id, name });
    await sendVpnPlanPicker(chatId, from.id, undefined, name);
    return;
  }

  const promoAwait = promoAwaitByChat.get(chatId);
  if (promoAwait && promoAwait.ownerId === from.id) {
    const promoCodeRaw = String(text).trim().replace(/\s+/g, "");
    const cancel = promoCodeRaw.toLowerCase() === "/cancel" || promoCodeRaw.toLowerCase() === "отмена";
    if (!promoCodeRaw || cancel) {
      promoAwaitByChat.delete(chatId);
      const f = menuFlags(from.id);
      await sendTelegramHtml(
        chatId,
        "Применение промокода отменено.",
        mainMenuInline(f.admin, f.referral, f.support, f.buyGb, f.whitelist, f.buyDevice, f.adminClientsButton, f.askAi),
      );
      return;
    }
    const ctx = getPromoContext(chatId);
    const shop = getSubscriptionShop();
    const samplePrice =
      ctx?.flow === "topup"
        ? (shop.topup_plans[0]?.price_rub ?? shop.plans[0]?.price_rub ?? 0)
        : (shop.plans[0]?.price_rub ?? 0);
    try {
      const calc = applyPromoCodeForUser({
        code: promoCodeRaw,
        tg_user_id: from.id,
        original_price_rub: samplePrice,
      });
      promoAwaitByChat.delete(chatId);
      const canonical = calc.promo.code;
      if (ctx?.flow === "topup") {
        setPromoPendingCodeForChat(chatId, canonical);
        await sendTelegramHtml(
          chatId,
          "Скидка применилась! Стоимость пакетов докупки пересчитана.",
          gbTopUpPlansKeyboardPromo(chatId, from.id, ctx.target_user_id),
        );
      } else {
        await sendTelegramHtml(
          chatId,
          "Скидка применилась! Стоимость тарифа пересчитана.",
          vpnPlansKeyboardPromo(canonical, from.id, ctx?.target_user_id),
        );
      }
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "promo_not_found") {
        await sendTelegramHtml(chatId, "Промокод не найден. Проверьте и отправьте ещё раз.", backHomeRow());
        return;
      }
      if (msg === "promo_already_used") {
        await sendTelegramHtml(chatId, "Этот промокод вы уже использовали.", backHomeRow());
        promoAwaitByChat.delete(chatId);
        return;
      }
      if (msg === "promo_inactive") {
        await sendTelegramHtml(chatId, "Этот промокод сейчас неактивен.", backHomeRow());
        promoAwaitByChat.delete(chatId);
        return;
      }
      if (msg === "promo_expired") {
        await sendTelegramHtml(chatId, "Срок действия этого промокода истек.", backHomeRow());
        promoAwaitByChat.delete(chatId);
        return;
      }
      if (msg === "promo_new_users_only") {
        await sendTelegramHtml(
          chatId,
          "Этот промокод только для новых пользователей без подписки (тестовая подписка не считается).",
          backHomeRow(),
        );
        promoAwaitByChat.delete(chatId);
        return;
      }
      await sendTelegramHtml(chatId, "Не удалось применить промокод.", backHomeRow());
      return;
    }
  }

  const pendingTarget = adminComposeTargetByChat.get(chatId);
  if (pendingTarget && isAdminTg(from.id)) {
    const target = getUser(pendingTarget);
    if (!target) {
      adminComposeTargetByChat.delete(chatId);
      const f = menuFlags(from.id);
      await sendTelegramHtml(
        chatId,
        "Клиент не найден.",
        mainMenuInline(f.admin, f.referral, f.support, f.buyGb, f.whitelist, f.buyDevice, f.adminClientsButton, f.askAi),
      );
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
      await sendTelegramHtml(chatId, "Отправьте текст сообщения (и при желании фото).", backHomeRow());
      return;
    }
    try {
      const outbound =
        msg.photo?.length
          ? `<b>Сообщение от администратора</b>\n\n${escHtml(payloadText)}`
          : `<b>Сообщение от администратора</b>\n\n${escHtml(payloadText)}`;
      if (msg.photo?.length) {
        const fileId = msg.photo[msg.photo.length - 1]!.file_id;
        await sendTelegramPhoto(toChat, fileId, outbound, { parse_mode: "HTML" });
      } else {
        await sendTelegramHtml(toChat, outbound);
      }
      logCommunicationMessage({
        automatic: false,
        source_label: "Сообщение из Telegram-бота",
        text: stripHtmlPreview(outbound),
        has_photo: Boolean(msg.photo?.length),
        recipients: [{ user_id: target.id, user_name: target.name }],
        sent: 1,
        attempted: 1,
        failed: 0,
      });
      adminComposeTargetByChat.delete(chatId);
      const f = menuFlags(from.id);
      await sendTelegramHtml(
        chatId,
        "Сообщение отправлено пользователю.",
        mainMenuInline(f.admin, f.referral, f.support, f.buyGb, f.whitelist, f.buyDevice, f.adminClientsButton, f.askAi),
      );
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

  if (hasAppealDraft(chatId)) {
    const handledAppeal = await onSupportAppealDraftMessage(msg);
    if (handledAppeal) return;
  }

  if (hasAiChatSession(chatId) && text) {
    const handledAi = await onAiChatMessage(chatId, from, text);
    if (handledAi) return;
  }

  if (text) {
    const handledSurveyFb = await handleSurveyFeedbackText(chatId, text);
    if (handledSurveyFb) return;

    const handledPaymentText = await onPaymentProofText(chatId, text);
    if (handledPaymentText) return;
  }

  if (msg.photo?.length) {
    const handled = await onPaymentProofPhoto(msg);
    if (handled) return;
  }

  const normalized = t
    .replace(/[^\p{L}\p{N}\s/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const textOpensScreen =
    normalized === "подписка" ||
    normalized === "статистика по подписке" ||
    normalized === "оплата подписки" ||
    normalized === "купить подписку" ||
    normalized === "оформить тестовую подписку" ||
    normalized === "купить устройство" ||
    normalized === "докупить устройство" ||
    normalized === "докупить гб" ||
    normalized === "белые списки" ||
    normalized === "пригласи друга" ||
    normalized === "клиенты" ||
    normalized === "сообщить о проблеме" ||
    normalized === "спросить ai" ||
    normalized === "спросить ии" ||
    normalized === "ai";
  if (textOpensScreen) {
    await dismissLastBotScreen(chatId);
  }

  if (normalized === "подписка") {
    const linked = linkedUsers(from.id);
    if (linked.length === 0) {
      await sendTelegramHtml(
        chatId,
        "<b>Подписка не привязана.</b>\nПопросите администратора указать ваш <b>Telegram Chat ID</b> в карточке клиента.",
        backHomeRow(),
      );
      return;
    }
    if (linked.length === 1) {
      const u = linked[0]!;
      const url = publicSubscriptionUrl(u.sub_token);
      await sendTelegramHtml(chatId, formatBotSubscriptionInfoHtml(u, url), backHomeRow());
      return;
    }
    await sendTelegramHtml(
      chatId,
      "<b>Выберите подписку:</b>",
      pickSubscriptionKeyboard(linked.map((x) => ({ id: x.id, name: x.name }))),
    );
    return;
  }
  if (normalized === "статистика по подписке") {
    const linked = linkedUsers(from.id);
    if (linked.length === 0) {
      await sendTelegramHtml(
        chatId,
        "<b>Подписка не привязана.</b>\nПопросите администратора указать ваш <b>Telegram Chat ID</b> в карточке клиента.",
        backHomeRow(),
      );
      return;
    }
    if (linked.length === 1) {
      const u = linked[0]!;
      const url = publicSubscriptionUrl(u.sub_token);
      await sendTelegramHtml(chatId, formatBotSubscriptionInfoHtml(u, url), backHomeRow());
      return;
    }
    await sendTelegramHtml(
      chatId,
      "<b>Выберите подписку:</b>",
      pickSubscriptionKeyboard(linked.map((x) => ({ id: x.id, name: x.name }))),
    );
    return;
  }
  if (normalized === "оплата подписки" || normalized === "купить подписку") {
    const linked = linkedUsers(from.id);
    if (linked.length > 0) {
      await sendTelegramHtml(chatId, "<b>Выберите подписку для оплаты/продления:</b>", paySubscriptionPickerKeyboard(linked));
      return;
    }
    await sendVpnPlanPicker(chatId, from.id);
    return;
  }
  if (normalized === "оформить тестовую подписку") {
    await sendTestSubscriptionIntro(chatId, from.id);
    return;
  }
  if (normalized === "купить устройство" || normalized === "докупить устройство") {
    const deviceTargets = linkedUsers(from.id).filter((u) => isDeviceLimitActiveForUser(u));
    if (deviceTargets.length === 0) {
      await sendTelegramHtml(chatId, "<b>Лимит устройств не включён</b> для ваших подписок.", inlineMenuFor(from.id));
      return;
    }
    if (deviceTargets.length > 1) {
      await sendTelegramHtml(
        chatId,
        "<b>Выберите подписку для покупки места под устройство:</b>",
        paymentTargetKeyboard(deviceTargets, "device"),
      );
      return;
    }
    await onDeviceSlotPurchaseStart(chatId, from.id, deviceTargets[0]!.id, from);
    return;
  }
  if (normalized === "докупить гб") {
    const gbTargets = linkedUsers(from.id).filter(userCanBuyGbTopup);
    if (gbTargets.length === 0) {
      await sendGbTopUpPlanPicker(chatId, from.id);
      return;
    }
    if (gbTargets.length > 1) {
      await sendTelegramHtml(chatId, "<b>Выберите подписку для докупки ГБ:</b>", paymentTargetKeyboard(gbTargets, "gb"));
      return;
    }
    await sendGbTopUpPlanPicker(chatId, from.id, gbTargets[0]!.id);
    return;
  }
  if (normalized === "белые списки" || normalized === "белые списки для покупки") {
    await sendWhitelistPurchaseMenu(chatId, from.id);
    return;
  }
  if (normalized === "пригласи друга") {
    const refCfg = getReferralProgram();
    if (!refCfg.enabled) {
      await sendTelegramHtml(chatId, "Реферальная программа сейчас отключена.", backHomeRow());
      return;
    }
    const text =
      `Посоветуй VPN другу и получи награду на выбор!\n` +
      `А друг получит скидку на первую подписку <b>${refCfg.invited_discount_percent}%</b>.`;
    await sendTelegramHtml(chatId, text, referralMenuInline());
    return;
  }
  if (normalized === "клиенты" && isAdminTg(from.id) && getPanelSettings().telegram.adminClientsButtonEnabled !== false) {
    await sendTelegramHtml(chatId, "<b>Клиенты</b>\n\nВыберите клиента:", adminClientsKeyboard());
    return;
  }
  if (normalized === "сообщить о проблеме") {
    await startSupportAppealCompose(chatId, from);
    return;
  }
  if (normalized === "спросить ai" || normalized === "спросить ии" || normalized === "ai") {
    await startAiChat(chatId, from);
    return;
  }
  if (
    normalized === "в меню" ||
    normalized === "меню" ||
    normalized === "главное меню" ||
    normalized === "главная" ||
    normalized.startsWith("в меню ")
  ) {
    await goHomeMenu(chatId, from);
    return;
  }

  // Любой другой текст -> возвращаем панель действий, чтобы бот был "живым" без /start.
  await sendWelcome(chatId, from);
}

async function handleCallback(q: CallbackQuery, rawUpdate?: unknown): Promise<void> {
  let data = (q.data ?? "").trim();
  const fromId = q.from.id;
  const chatId = q.message?.chat.id;
  if (chatId == null) {
    await answerCallbackQuery(q.id, { text: "Нет чата", show_alert: true });
    return;
  }

  recordUserActivity(chatId, q.from.username);

  const tmClick = parseTriggerClickCallback(data);
  if (tmClick) {
    recordTriggerButtonClick(tmClick.campaignId, tmClick.stepId);
    data = tmClick.action;
  }

  const linked = linkedUsers(fromId);

  try {
    const surveyRate = parseSurveyRateCallback(data);
    if (surveyRate) {
      await handleSurveyRateCallback(q, surveyRate.surveyId, surveyRate.rating);
      return;
    }

    const surveySkipFb = parseSurveySkipFeedbackCallback(data);
    if (surveySkipFb) {
      await handleSurveySkipFeedbackCallback(q, surveySkipFb.surveyId);
      return;
    }

    if (data === "home") {
      newSubscriptionDraftByChat.delete(chatId);
      clearSupportAppealDraft(chatId);
      clearAiChatSession(chatId);
      await answerCallbackQuery(q.id);
      const screen = resolveCallbackScreen(q, rawUpdate);
      console.log("[telegram] home", { chatId, screenId: screen?.messageId, fallback: getLastBotMessageId(chatId) });
      await goHomeMenu(chatId, q.from, screen);
      return;
    }

    if (data === "ai_start") {
      await answerAndDismiss(q, rawUpdate);
      await startAiChat(chatId, q.from);
      return;
    }

    if (data === "ai_exit") {
      await answerCallbackQuery(q.id);
      clearAiChatSession(chatId);
      await goHomeMenu(chatId, q.from, resolveCallbackScreen(q, rawUpdate));
      return;
    }

    if (data === "appeal_start") {
      await answerAndDismiss(q, rawUpdate);
      await startSupportAppealCompose(chatId, q.from);
      return;
    }

    if (data === "appeal_send") {
      await answerCallbackQuery(q.id, { text: "Отправляем…" });
      await submitSupportAppealFromDraft(chatId, fromId);
      return;
    }

    if (data === "appeal_cancel") {
      await answerAndDismiss(q, rawUpdate);
      await cancelSupportAppealCompose(chatId);
      return;
    }

    if (data === "stats") data = "sub";

    if (data === "pay") {
      await answerAndDismiss(q, rawUpdate);
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
      await answerAndDismiss(q, rawUpdate);
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

    if (data === "test_intro") {
      await answerAndDismiss(q, rawUpdate);
      await sendTestSubscriptionIntro(chatId, fromId);
      return;
    }

    if (data === "test_get") {
      await answerAndDismiss(q, rawUpdate);
      await onTestSubscriptionGet(chatId, fromId, q.from);
      return;
    }

    if (data === "promoask") {
      await answerAndDismiss(q, rawUpdate);
      promoAwaitByChat.set(chatId, { ownerId: fromId });
      await sendTelegramHtml(
        chatId,
        "Введите текст промокода одним сообщением.\n\nДля отмены отправьте «Отмена».",
        backHomeRow(),
      );
      return;
    }

    if (data === "buydevice") {
      await answerAndDismiss(q, rawUpdate);
      const deviceTargets = linked.filter((u) => isDeviceLimitActiveForUser(u));
      if (deviceTargets.length === 0) {
        await sendTelegramHtml(chatId, "<b>Лимит устройств не включён</b> для ваших подписок.", inlineMenuFor(fromId));
        return;
      }
      if (deviceTargets.length > 1) {
        await sendTelegramHtml(
          chatId,
          "<b>Выберите подписку для покупки места под устройство:</b>",
          paymentTargetKeyboard(deviceTargets, "device"),
        );
        return;
      }
      await onDeviceSlotPurchaseStart(chatId, fromId, deviceTargets[0]!.id, q.from);
      return;
    }

    if (data === "buygb") {
      await answerAndDismiss(q, rawUpdate);
      const gbTargets = linked.filter(userCanBuyGbTopup);
      if (gbTargets.length === 0) {
        await sendGbTopUpPlanPicker(chatId, fromId);
        return;
      }
      if (gbTargets.length > 1) {
        await sendTelegramHtml(
          chatId,
          "<b>Выберите подписку для докупки ГБ:</b>",
          paymentTargetKeyboard(gbTargets, "gb"),
        );
        return;
      }
      await sendGbTopUpPlanPicker(chatId, fromId, gbTargets[0]!.id);
      return;
    }

    if (data === "wlmenu") {
      await answerAndDismiss(q, rawUpdate);
      await sendWhitelistPurchaseMenu(chatId, fromId);
      return;
    }
    if (data === "wlinstr") {
      await answerAndDismiss(q, rawUpdate);
      await sendWhitelistInstructionMenu(chatId);
      return;
    }
    const wlsel = /^wlsel:(\d+)$/.exec(data);
    if (wlsel) {
      const userId = Number(wlsel[1]);
      const row = getUser(userId);
      const tgKey = String(fromId).trim();
      if (!row || String(row.tg_id ?? "").trim() !== tgKey) {
        await answerCallbackQuery(q.id, { text: "Нет доступа к этой подписке.", show_alert: true });
        return;
      }
      const check = checkWhitelistPurchaseAllowed(row);
      if (!check.ok) {
        await answerCallbackQuery(q.id, { text: check.message, show_alert: true });
        return;
      }
      await answerAndDismiss(q, rawUpdate);
      await sendWhitelistPurchaseMenuForTarget(chatId, fromId, userId);
      return;
    }
    const wlb = /^wlbuy:(\d+)$/.exec(data);
    if (wlb) {
      await answerAndDismiss(q, rawUpdate);
      await onWhitelistPurchaseStart(chatId, fromId, Number(wlb[1]), q.from);
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
      await answerAndDismiss(q, rawUpdate);
      await sendVpnPlanPicker(chatId, fromId, userId);
      return;
    }

    if (data === "pnew") {
      await answerAndDismiss(q, rawUpdate);
      newSubscriptionDraftByChat.set(chatId, { ownerId: fromId });
      await sendTelegramHtml(
        chatId,
        "Введите название для новой подписки (до <b>25</b> символов).\n\nПример: <b>Для мамы</b>",
        cancelNewSubscriptionNameInline(),
      );
      return;
    }

    if (data === "pnew_cancel") {
      await answerAndDismiss(q, rawUpdate);
      newSubscriptionDraftByChat.delete(chatId);
      await sendTelegramHtml(
        chatId,
        "Создание новой подписки отменено.",
        inlineMenuFor(fromId),
      );
      return;
    }

    if (data === "pdel_menu") {
      await answerAndDismiss(q, rawUpdate);
      if (linked.length === 0) {
        await sendTelegramHtml(chatId, "У вас нет подписок для удаления.", inlineMenuFor(fromId));
        return;
      }
      await sendTelegramHtml(chatId, "<b>Выберите подписку для удаления:</b>", payDeletePickerKeyboard(linked));
      return;
    }

    const pdelq = /^pdelq:(\d+)$/.exec(data);
    if (pdelq) {
      const userId = Number(pdelq[1]);
      const row = getUser(userId);
      const tgKey = String(fromId).trim();
      if (!row || String(row.tg_id ?? "").trim() !== tgKey) {
        await answerCallbackQuery(q.id, { text: "Нет доступа к этой подписке.", show_alert: true });
        return;
      }
      await answerAndDismiss(q, rawUpdate);
      await sendTelegramHtml(
        chatId,
        `Удалить подписку <b>${escHtml(subscriptionPublicName(row))}</b>?`,
        payDeleteConfirmKeyboard(row.id),
      );
      return;
    }

    const pdely = /^pdely:(\d+)$/.exec(data);
    if (pdely) {
      const userId = Number(pdely[1]);
      const row = getUser(userId);
      const tgKey = String(fromId).trim();
      if (!row || String(row.tg_id ?? "").trim() !== tgKey) {
        await answerCallbackQuery(q.id, { text: "Нет доступа к этой подписке.", show_alert: true });
        return;
      }
      const own = linkedUsers(fromId);
      if (own.length <= 1) {
        await answerCallbackQuery(q.id, { text: "Нельзя удалить последнюю подписку.", show_alert: true });
        return;
      }
      try {
        await removeUserUuidFromAllServers(row.vless_uuid);
      } catch (e) {
        console.error("[telegram] self delete remove uuid:", e);
      }
      deleteUser(userId);
      await answerCallbackQuery(q.id, { text: "Подписка удалена." });
      await dismissCallbackScreen(q, rawUpdate);
      await sendTelegramHtml(chatId, "Подписка удалена.", inlineMenuFor(fromId));
      return;
    }

    if (data === "ref_menu") {
      await answerAndDismiss(q, rawUpdate);
      const refCfg = getReferralProgram();
      if (!refCfg.enabled) {
        await sendTelegramHtml(chatId, "Реферальная программа сейчас отключена.", backHomeRow());
        return;
      }
      const text =
        `Посоветуй VPN другу и получи награду на выбор!\n` +
        `А друг получит скидку на первую подписку <b>${refCfg.invited_discount_percent}%</b>.`;
      await sendTelegramHtml(chatId, text, referralMenuInline());
      return;
    }

    if (data === "ref_send") {
      await answerAndDismiss(q, rawUpdate);
      const linkedUser = linked[0];
      const refCfg = getReferralProgram();
      if (!refCfg.enabled) {
        await sendTelegramHtml(chatId, "Реферальная программа сейчас отключена.", backHomeRow());
        return;
      }
      if (!linkedUser) {
        await sendTelegramHtml(chatId, "Сначала активируйте свою подписку, затем сможете приглашать друзей.", backHomeRow());
        return;
      }
      const botName = (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
      const link = botName ? `https://t.me/${botName}?start=ref_${linkedUser.id}` : `ref_${linkedUser.id}`;
      const brand = getPanelSettings().panel.brandName.trim() || "HSN VPN";
      const inviteBody = applyReferralInviteVars(refCfg.invite_copy_text, {
        ref_link: link,
        discount: `${refCfg.invited_discount_percent}%`,
        brand,
      });
      await sendTelegramHtml(chatId, `${escHtml(inviteBody)}\n\n${escHtml(link)}`, backHomeRow());
      return;
    }

    const dsel = /^dsel:(\d+)$/.exec(data);
    if (dsel) {
      const userId = Number(dsel[1]);
      const row = getUser(userId);
      const tgKey = String(fromId).trim();
      if (!row || String(row.tg_id ?? "").trim() !== tgKey) {
        await answerCallbackQuery(q.id, { text: "Нет доступа к этой подписке.", show_alert: true });
        return;
      }
      await answerAndDismiss(q, rawUpdate);
      await onDeviceSlotPurchaseStart(chatId, fromId, userId, q.from);
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
      if (!userCanBuyGbTopup(row)) {
        await answerCallbackQuery(q.id, {
          text: row.total_gb <= 0 ? "Безлимит — докупка ГБ недоступна." : "Докупка ГБ недоступна для этой подписки.",
          show_alert: true,
        });
        return;
      }
      await answerAndDismiss(q, rawUpdate);
      await sendGbTopUpPlanPicker(chatId, fromId, userId);
      return;
    }

    if (data === "admin_clients") {
      if (!isAdminTg(fromId) || getPanelSettings().telegram.adminClientsButtonEnabled === false) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      await answerAndDismiss(q, rawUpdate);
      await sendTelegramHtml(chatId, "<b>Клиенты</b>\n\nВыберите клиента:", adminClientsKeyboard());
      return;
    }

    if (data === "sub") {
      await answerAndDismiss(q, rawUpdate);
      if (linked.length === 0) {
        await sendTelegramHtml(
          chatId,
          "<b>Подписка не привязана.</b>\nПопросите администратора указать ваш <b>Telegram Chat ID</b> (это ваш числовой id) в карточке клиента.",
          backHomeRow(),
        );
        return;
      }
      if (linked.length === 1) {
        const u = linked[0]!;
        const url = publicSubscriptionUrl(u.sub_token);
        await sendTelegramHtml(chatId, formatBotSubscriptionInfoHtml(u, url), backHomeRow());
        return;
      }
      await sendTelegramHtml(
        chatId,
        "<b>Выберите подписку:</b>",
        pickSubscriptionKeyboard(linked.map((x) => ({ id: x.id, name: x.name }))),
      );
      return;
    }

    const pcombo = /^pcombo:([^:]+)(?::(\d+|new))?$/.exec(data);
    if (pcombo) {
      const offerId = String(pcombo[1] ?? "").trim();
      const suffix = pcombo[2];
      const isNewFlow = suffix === "new";
      const targetUserId = suffix && suffix !== "new" ? Number(suffix) : undefined;
      await answerAndDismiss(q, rawUpdate);
      await onComboChosen(chatId, fromId, offerId, targetUserId, q.from, isNewFlow);
      return;
    }

    const pp = /^pplan:([123])(?::(\d+))?$/.exec(data);
    if (pp) {
      const planId = Number(pp[1]) as PaymentPlanId;
      const targetUserId = pp[2] ? Number(pp[2]) : undefined;
      await answerAndDismiss(q, rawUpdate);
      await onVpnPlanChosen(chatId, fromId, planId, targetUserId, undefined, q.from);
      return;
    }

    const ppp = /^pplanpromo:([123]):([\p{L}\p{N}_-]{3,40})(?::(\d+))?$/u.exec(data);
    if (ppp) {
      const planId = Number(ppp[1]) as PaymentPlanId;
      const promoCode = String(ppp[2] ?? "").trim();
      const targetUserId = ppp[3] ? Number(ppp[3]) : undefined;
      const ctx = getPromoContext(chatId);
      await answerAndDismiss(q, rawUpdate);
      await onVpnPlanChosen(chatId, fromId, planId, targetUserId, ctx?.new_subscription_name, q.from, promoCode);
      return;
    }

    const ppn = /^pplannew:([123])$/.exec(data);
    if (ppn) {
      const planId = Number(ppn[1]) as PaymentPlanId;
      const draftName = newSubscriptionDraftByChat.get(chatId);
      if (!draftName || draftName.ownerId !== fromId || !String(draftName.name ?? "").trim()) {
        await answerCallbackQuery(q.id, { text: "Сначала задайте название новой подписки.", show_alert: true });
        return;
      }
      await answerAndDismiss(q, rawUpdate);
      await onVpnPlanChosen(chatId, fromId, planId, undefined, String(draftName.name).trim(), q.from);
      newSubscriptionDraftByChat.delete(chatId);
      return;
    }

    const gpp = /^gplanpromo:([123])(?::(\d+))?$/.exec(data);
    if (gpp) {
      const planId = Number(gpp[1]) as PaymentPlanId;
      const targetUserId = gpp[2] ? Number(gpp[2]) : undefined;
      const ctx = getPromoContext(chatId);
      const promoCode = ctx?.pending_promo_code;
      await answerAndDismiss(q, rawUpdate);
      await onGbTopUpPlanChosen(chatId, fromId, planId, targetUserId, q.from, promoCode);
      return;
    }

    const gp = /^gplan:([123])(?::(\d+))?$/.exec(data);
    if (gp) {
      const planId = Number(gp[1]) as PaymentPlanId;
      const targetUserId = gp[2] ? Number(gp[2]) : undefined;
      await answerAndDismiss(q, rawUpdate);
      await onGbTopUpPlanChosen(chatId, fromId, planId, targetUserId, q.from);
      return;
    }

    const pok = /^pok:([0-9a-f]+)$/.exec(data);
    if (pok) {
      await onAdminPaymentConfirm(q.id, fromId, pok[1]!, q.message);
      return;
    }

    const pnx = /^pnx:([0-9a-f]+)$/.exec(data);
    if (pnx) {
      await onAdminPaymentReject(q.id, fromId, pnx[1]!, q.message);
      return;
    }

    const rr = /^refreward:(gb|days):([0-9a-f]+)$/.exec(data);
    if (rr) {
      await onReferralRewardChosen(q.id, fromId, rr[2]!, rr[1] as "gb" | "days");
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
      await answerAndDismiss(q, rawUpdate);
      const url = publicSubscriptionUrl(row.sub_token);
      await sendTelegramHtml(chatId, formatBotSubscriptionInfoHtml(row, url), backHomeRow());
      return;
    }

    const au = /^admu:(\d+)$/.exec(data);
    if (au) {
      if (!isAdminTg(fromId)) {
        await answerCallbackQuery(q.id, { text: "Нет прав.", show_alert: true });
        return;
      }
      await answerAndDismiss(q, rawUpdate);
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
      await dismissCallbackScreen(q, rawUpdate);
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
      await answerAndDismiss(q, rawUpdate);
      await sendTelegramHtml(
        chatId,
        `Отправьте текст (и при желании фото) для клиента <b>${escHtml(row.name)}</b>.\n\n` +
          `Сообщение будет переслано пользователю и после этого откроется главное меню.`,
        backHomeRow(),
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
      await answerAndDismiss(q, rawUpdate);
      await sendTelegramHtml(
        chatId,
        `Подтвердите удаление клиента <b>${escHtml(row.name)}</b>.`,
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
      await dismissCallbackScreen(q, rawUpdate);
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
