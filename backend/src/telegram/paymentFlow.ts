import {
  createUser,
  deletePaymentSession,
  findAwaitingProofSessionByChat,
  findPendingAdminSessionByChat,
  findUsersByTelegramChatId,
  getPaymentSession,
  getSubscriptionShop,
  markPaymentSessionPendingAdmin,
  snapExpiryTimeToNoonLocal,
  startPaymentAwaitingProof,
  updateUserRow,
  type PaymentPlanId,
  type PaymentSessionRow,
  type SubscriptionShopPlanRow,
  type TopUpShopPlanRow,
} from "../db.js";
import { pushClientListToAllDeployedServers } from "../userSync.js";
import { answerCallbackQuery, sendTelegramHtml, sendTelegramPhoto } from "./api.js";
import { escHtml } from "./format.js";
import { backHomeRow, mainMenuInline, newUserKeyboard, publicSubscriptionUrl } from "./keyboards.js";
import { getTelegramPaymentNotifyChatIds, getTelegramPaymentUrl } from "./env.js";

export type PlanRuntimeMeta = {
  title: string;
  total_gb: number;
  days: number;
  priceRub: number;
};

export type TopUpPlanRuntimeMeta = {
  title: string;
  add_gb: number;
  priceRub: number;
};

export function getPlanRuntimeMeta(planId: PaymentPlanId): PlanRuntimeMeta {
  const row = getSubscriptionShop().plans.find((p) => p.id === planId);
  if (!row) {
    return { title: "Тариф", total_gb: 0, days: 30, priceRub: 0 };
  }
  return {
    title: row.title,
    total_gb: row.total_gb,
    days: row.days,
    priceRub: row.price_rub,
  };
}

export function getTopUpPlanRuntimeMeta(planId: PaymentPlanId): TopUpPlanRuntimeMeta {
  const row = getSubscriptionShop().topup_plans.find((p) => p.id === planId);
  if (!row) {
    return { title: "Докупка", add_gb: 0, priceRub: 0 };
  }
  return {
    title: row.title,
    add_gb: row.add_gb,
    priceRub: row.price_rub,
  };
}

function effectivePaymentUrl(): string {
  const u = getSubscriptionShop().payment_url.trim();
  if (u) return u;
  return getTelegramPaymentUrl();
}

function planPickerButtonLabel(p: SubscriptionShopPlanRow): string {
  const gb = p.total_gb > 0 ? `${p.total_gb} ГБ` : "безлимит";
  let t = `${p.id} — ${gb} / ${p.days} дн. — ${p.price_rub} ₽`;
  if (t.length > 58) t = `${t.slice(0, 55)}…`;
  return t;
}

function topupPickerButtonLabel(p: TopUpShopPlanRow): string {
  let t = `${p.id} — +${p.add_gb} ГБ — ${p.price_rub} ₽`;
  if (t.length > 58) t = `${t.slice(0, 55)}…`;
  return t;
}

export function vpnPlansKeyboard() {
  const shop = getSubscriptionShop();
  const rows = shop.plans.map((p) => [{ text: planPickerButtonLabel(p), callback_data: `pplan:${p.id}` }]);
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export function gbTopUpPlansKeyboard() {
  const shop = getSubscriptionShop();
  const rows = shop.topup_plans.map((p) => [{ text: topupPickerButtonLabel(p), callback_data: `gplan:${p.id}` }]);
  rows.push([{ text: "« Главное меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

function adminDecisionKeyboard(sessionId: string) {
  return {
    inline_keyboard: [
      [
        { text: "Подтвердить", callback_data: `pok:${sessionId}` },
        { text: "Платёж не поступил", callback_data: `pnx:${sessionId}` },
      ],
    ],
  };
}

function isPaymentAdmin(fromId: number): boolean {
  return getTelegramPaymentNotifyChatIds().includes(fromId);
}

function replyKeyboardForPayer(tgUserId: number) {
  const linked = findUsersByTelegramChatId(tgUserId);
  if (linked.length > 0) return mainMenuInline;
  return newUserKeyboard(getSubscriptionShop().sales_disabled);
}

const DAY_MS = 86_400_000;

export async function sendVpnPlanPicker(chatId: number, tgUserId: number): Promise<void> {
  const linked = findUsersByTelegramChatId(tgUserId);
  const shop = getSubscriptionShop();
  if (linked.length === 0 && shop.sales_disabled) {
    await sendTelegramHtml(
      chatId,
      "<b>Новые подписки временно недоступны.</b>\n\nОформление для новых клиентов отключено в настройках. После того как администратор привяжет ваш Telegram к аккаунту в панели, здесь можно будет продлить подписку.",
      newUserKeyboard(true),
    );
    return;
  }
  await sendTelegramHtml(
    chatId,
    "<b>Выберите нужную подписку</b>\n\nТарифы из настроек магазина:",
    vpnPlansKeyboard(),
  );
}

export async function sendGbTopUpPlanPicker(chatId: number, tgUserId: number): Promise<void> {
  const linked = findUsersByTelegramChatId(tgUserId);
  if (linked.length === 0) {
    await sendTelegramHtml(
      chatId,
      "<b>Докупка ГБ недоступна.</b>\n\nСначала нужна привязанная подписка в панели. После привязки появится это действие.",
      newUserKeyboard(getSubscriptionShop().sales_disabled),
    );
    return;
  }
  await sendTelegramHtml(
    chatId,
    "<b>Выберите пакет докупки</b>\n\nГБ добавятся к текущему лимиту после подтверждения оплаты:",
    gbTopUpPlansKeyboard(),
  );
}

type TgFromLite = { id: number; username?: string; first_name?: string };

export async function onVpnPlanChosen(
  chatId: number,
  tgUserId: number,
  planId: PaymentPlanId,
  from?: TgFromLite,
): Promise<void> {
  const linked = findUsersByTelegramChatId(tgUserId);
  const shop = getSubscriptionShop();
  if (linked.length === 0 && shop.sales_disabled) {
    await sendTelegramHtml(
      chatId,
      "<b>Покупка недоступна.</b> Продажи новых подписок отключены.",
      newUserKeyboard(true),
    );
    return;
  }
  const meta = getPlanRuntimeMeta(planId);
  const payUrl = effectivePaymentUrl();
  startPaymentAwaitingProof(chatId, tgUserId, planId, "subscription", {
    username: from?.username,
    first_name: from?.first_name,
  });
  const linkEsc = escHtml(payUrl);
  const body =
    `<b>Выбрано:</b> ${escHtml(meta.title)}\n` +
    `<b>Сумма к оплате:</b> ${meta.priceRub} ₽\n\n` +
    `<b>Ссылка для оплаты:</b>\n<a href="${linkEsc}">${linkEsc}</a>\n\n` +
    `В комментарии к переводу укажите <b>только номер тарифа</b>: <code>1</code>, <code>2</code> или <code>3</code> ` +
    `(как выбрали выше).\n\n` +
    `После оплаты пришлите в этот чат <b>скриншот или фото подтверждения перевода</b> — мы проверим и подключим или продлим доступ.`;
  await sendTelegramHtml(chatId, body, backHomeRow);
}

export async function onGbTopUpPlanChosen(
  chatId: number,
  tgUserId: number,
  planId: PaymentPlanId,
  from?: TgFromLite,
): Promise<void> {
  const linked = findUsersByTelegramChatId(tgUserId);
  if (linked.length === 0) {
    await sendTelegramHtml(
      chatId,
      "<b>Докупка ГБ недоступна.</b> Нет привязанной подписки.",
      newUserKeyboard(getSubscriptionShop().sales_disabled),
    );
    return;
  }
  const meta = getTopUpPlanRuntimeMeta(planId);
  const payUrl = effectivePaymentUrl();
  startPaymentAwaitingProof(chatId, tgUserId, planId, "topup", {
    username: from?.username,
    first_name: from?.first_name,
  });
  const linkEsc = escHtml(payUrl);
  const body =
    `<b>Выбрано:</b> ${escHtml(meta.title)}\n` +
    `<b>Пополнение:</b> +${meta.add_gb} ГБ\n` +
    `<b>Сумма к оплате:</b> ${meta.priceRub} ₽\n\n` +
    `<b>Ссылка для оплаты:</b>\n<a href="${linkEsc}">${linkEsc}</a>\n\n` +
    `В комментарии к переводу укажите <b>номер пакета докупки</b>: <code>1</code>, <code>2</code> или <code>3</code>.\n\n` +
    `После оплаты пришлите в этот чат <b>скриншот или фото подтверждения перевода</b> — администратор проверит и начислит ГБ.`;
  await sendTelegramHtml(chatId, body, backHomeRow);
}

type PhotoMsg = {
  message_id: number;
  chat: { id: number };
  from?: { id: number };
  photo?: { file_id: string }[];
};

export async function onPaymentProofPhoto(msg: PhotoMsg): Promise<boolean> {
  const chatId = msg.chat.id;
  const fromId = msg.from?.id ?? chatId;
  if (findPendingAdminSessionByChat(chatId)) {
    await sendTelegramHtml(
      chatId,
      "<b>Заявка уже у администратора.</b> Дождитесь подтверждения или ответа.",
      replyKeyboardForPayer(fromId),
    );
    return true;
  }
  const sess = findAwaitingProofSessionByChat(chatId);
  if (!sess) return false;
  const photos = msg.photo;
  if (!photos?.length) return false;
  const fileId = photos[photos.length - 1]!.file_id;
  const subMeta = getPlanRuntimeMeta(sess.plan_id);
  const topupMeta = getTopUpPlanRuntimeMeta(sess.plan_id);
  const isTopUp = sess.kind === "topup";
  const admins = getTelegramPaymentNotifyChatIds();
  const linked = findUsersByTelegramChatId(chatId);
  const payerTag =
    sess.tg_username && String(sess.tg_username).trim()
      ? `@${escHtml(String(sess.tg_username).replace(/^@/, ""))}`
      : sess.tg_first_name && String(sess.tg_first_name).trim()
        ? escHtml(String(sess.tg_first_name).trim())
        : "";
  const linkedBrief = isTopUp
    ? linked.length === 0
      ? "<b>Внимание:</b> для докупки нужен привязанный клиент в панели. Эту заявку нужно отклонить."
      : `Привязано клиентов в панели: <b>${linked.length}</b> (id: ${linked.map((u) => u.id).join(", ")}).`
    : linked.length === 0
      ? "<b>Новый клиент:</b> в панели записи с этим Telegram id нет — при «Подтвердить» будет <b>создан</b> клиент с оплаченным тарифом."
      : `Привязано клиентов в панели: <b>${linked.length}</b> (id: ${linked.map((u) => u.id).join(", ")}).`;

  const caption =
    `<b>Чек на оплату VPN</b>\n` +
    `Сессия: <code>${escHtml(sess.id)}</code>\n` +
    (payerTag ? `Плательщик: <b>${payerTag}</b> (chat <code>${sess.tg_chat_id}</code>)\n` : `Чат: <code>${sess.tg_chat_id}</code>\n`) +
    (isTopUp
      ? `Пакет докупки: <b>${sess.plan_id}</b> — ${escHtml(topupMeta.title)} (+${topupMeta.add_gb} ГБ)\n`
      : `Тариф: <b>${sess.plan_id}</b> — ${escHtml(subMeta.title)}\n`) +
    `Сумма: <b>${isTopUp ? topupMeta.priceRub : subMeta.priceRub} ₽</b>\n\n` +
    `${linkedBrief}`;

  let anyOk = false;
  for (const adminChat of admins) {
    try {
      await sendTelegramPhoto(adminChat, fileId, caption, {
        reply_markup: adminDecisionKeyboard(sess.id),
      });
      anyOk = true;
    } catch (e) {
      console.error("[telegram] sendPhoto to admin", adminChat, e);
    }
  }
  if (!anyOk) {
    await sendTelegramHtml(
      chatId,
      "Не удалось передать чек администратору. Напишите администратору вручную или попробуйте позже.",
      backHomeRow,
    );
    return true;
  }
  markPaymentSessionPendingAdmin(sess.id, fileId);
  await sendTelegramHtml(
    chatId,
    "<b>Чек получен.</b> Администратор проверит оплату и примет решение. Обычно это занимает немного времени.",
    replyKeyboardForPayer(fromId),
  );
  return true;
}

export async function onAdminPaymentConfirm(
  callbackQueryId: string,
  adminFromId: number,
  sessionId: string,
): Promise<void> {
  if (!isPaymentAdmin(adminFromId)) {
    await answerCallbackQuery(callbackQueryId, { text: "Нет прав.", show_alert: true });
    return;
  }
  const sess = getPaymentSession(sessionId);
  if (!sess || sess.status !== "pending_admin") {
    await answerCallbackQuery(callbackQueryId, { text: "Заявка не найдена или уже обработана.", show_alert: true });
    return;
  }
  const isTopUp = sess.kind === "topup";
  const subMeta = getPlanRuntimeMeta(sess.plan_id);
  const topupMeta = getTopUpPlanRuntimeMeta(sess.plan_id);
  let linked = findUsersByTelegramChatId(sess.tg_chat_id);
  let autoCreated = false;
  if (!isTopUp && linked.length === 0) {
    const tgKey = String(sess.tg_chat_id).trim();
    const expiryMs = snapExpiryTimeToNoonLocal(Date.now() + subMeta.days * DAY_MS);
    const displayName = clientDisplayNameFromSession(sess);
    try {
      createUser({
        name: displayName,
        email: `${sess.tg_chat_id}@tg.vpn`,
        tg_id: tgKey,
        total_gb: subMeta.total_gb,
        expiry_time: expiryMs,
        enable: 1,
        comment: `Оплата в боте, тариф #${sess.plan_id}: ${subMeta.title}`,
      });
      autoCreated = true;
      linked = findUsersByTelegramChatId(sess.tg_chat_id);
    } catch (e) {
      console.error("[telegram] createUser after payment:", e);
      await answerCallbackQuery(callbackQueryId, {
        text: e instanceof Error ? e.message : "Не удалось создать клиента",
        show_alert: true,
      });
      deletePaymentSession(sessionId);
      return;
    }
  }
  if (isTopUp && linked.length === 0) {
    await answerCallbackQuery(callbackQueryId, {
      text: "Нет привязанной подписки для начисления.",
      show_alert: true,
    });
    deletePaymentSession(sessionId);
    return;
  }
  await answerCallbackQuery(callbackQueryId, {
    text: isTopUp ? "ГБ начислены." : autoCreated ? "Клиент создан, подписка активирована." : "Подписка продлена.",
  });
  if (isTopUp) {
    for (const row of linked) {
      if (row.total_gb <= 0) continue;
      updateUserRow(row.id, { total_gb: row.total_gb + topupMeta.add_gb });
    }
  } else if (!autoCreated) {
    const now = Date.now();
    for (const row of linked) {
      const base = Math.max(now, row.expiry_time > 0 ? row.expiry_time : 0);
      const newExpiry = snapExpiryTimeToNoonLocal(base + subMeta.days * DAY_MS);
      updateUserRow(row.id, { total_gb: subMeta.total_gb, expiry_time: newExpiry });
    }
  }
  try {
    await pushClientListToAllDeployedServers();
  } catch (e) {
    console.error("[telegram] push after payment confirm:", e);
  }
  deletePaymentSession(sessionId);
  const trafficNote = subMeta.total_gb > 0 ? `${subMeta.total_gb} ГБ/мес` : "безлимит по трафику";
  const primary = linked[0]!;
  const subUrl = publicSubscriptionUrl(primary.sub_token);
  const subCode = escUrlForCode(subUrl);
  const body = isTopUp
    ? `<b>Оплата подтверждена.</b>\n\n` +
      `Начислено: <b>+${topupMeta.add_gb} ГБ</b>\n` +
      `Пакет: ${escHtml(topupMeta.title)}\n\n` +
      `ГБ добавлены к вашему текущему балансу. Актуальные данные — в разделе «Статистика по подписке».`
    : autoCreated
    ? `<b>Оплата подтверждена — доступ открыт.</b>\n\n` +
      `Тариф: ${escHtml(subMeta.title)}\n` +
      `Лимит трафика: <b>${escHtml(trafficNote)}</b>\n` +
      `Срок: <b>${subMeta.days}</b> суток с момента активации (до полудня дня окончания).\n\n` +
      `<b>Ссылка на подписку (добавьте в клиент):</b>\n\n<code>${subCode}</code>\n\n` +
      `Позже её можно скопировать в меню «Подписка». Статистика — в «Статистика по подписке».`
    : `<b>Оплата подтверждена.</b>\n\n` +
      `Тариф: ${escHtml(subMeta.title)}\n` +
      `Лимит трафика: <b>${escHtml(trafficNote)}</b>\n` +
      `Срок продлён на <b>${subMeta.days}</b> суток от вашего текущего окончания (если подписка ещё действовала — срок суммируется).\n` +
      `Актуальные дата и трафик — в разделе «Статистика по подписке».`;
  await sendTelegramHtml(sess.tg_chat_id, body, replyKeyboardForPayer(sess.tg_chat_id));
}

function escUrlForCode(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clientDisplayNameFromSession(sess: PaymentSessionRow): string {
  const u = (sess.tg_username ?? "").trim().replace(/^@/, "");
  if (u) return `@${u}`;
  const fn = (sess.tg_first_name ?? "").trim();
  if (fn) return fn;
  return "Новый клиент";
}

export async function onAdminPaymentReject(
  callbackQueryId: string,
  adminFromId: number,
  sessionId: string,
): Promise<void> {
  if (!isPaymentAdmin(adminFromId)) {
    await answerCallbackQuery(callbackQueryId, { text: "Нет прав.", show_alert: true });
    return;
  }
  const sess = getPaymentSession(sessionId);
  if (!sess || sess.status !== "pending_admin") {
    await answerCallbackQuery(callbackQueryId, { text: "Заявка не найдена или уже обработана.", show_alert: true });
    return;
  }
  await answerCallbackQuery(callbackQueryId, { text: "Отклонено." });
  deletePaymentSession(sessionId);
  await sendTelegramHtml(
    sess.tg_chat_id,
    "<b>Платёж не подтверждён.</b>\n\nЕсли вы уже оплатили, напишите администратору и приложите чек ещё раз через «Оплата подписки», «Докупить ГБ» или «Купить подписку».",
    replyKeyboardForPayer(sess.tg_chat_id),
  );
}
