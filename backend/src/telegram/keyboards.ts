import { subscriptionPublicName } from "./format.js";
import { inlineBtn, inlineBtnPlain } from "./inlineButtonStyles.js";

export function publicSubscriptionUrl(subToken: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${base}/sub/${encodeURIComponent(subToken)}`;
}

export function mainMenuInline(
  isAdmin = false,
  referralEnabled = false,
  supportAppealsEnabled = false,
  buyGbEnabled = true,
  whitelistEnabled = false,
  buyDeviceEnabled = false,
  adminClientsButtonEnabled = false,
  askAiEnabled = false,
) {
  const rows: Array<ReturnType<typeof inlineBtn> | ReturnType<typeof inlineBtnPlain>>[] = [
    [inlineBtn("Подписка", "sub", "menuSubscription")],
  ];
  const payRow = [inlineBtnPlain("Оплата подписки", "pay")];
  if (buyGbEnabled) payRow.push(inlineBtnPlain("Докупить ГБ", "buygb"));
  rows.push(payRow);
  if (whitelistEnabled) rows.push([inlineBtn("Белые списки", "wlmenu", "buyWhitelist")]);
  if (buyDeviceEnabled) rows.push([inlineBtnPlain("Купить устройство", "buydevice")]);
  if (askAiEnabled) rows.push([inlineBtn("Спросить AI", "ai_start", "askAi")]);
  if (referralEnabled) rows.push([inlineBtnPlain("Пригласи друга", "ref_menu")]);
  if (supportAppealsEnabled) rows.push([inlineBtnPlain("Сообщить о проблеме", "appeal_start")]);
  if (isAdmin && adminClientsButtonEnabled) rows.push([inlineBtn("Клиенты", "admin_clients", "menuAdminClients")]);
  return { inline_keyboard: rows };
}

export function mainMenuReply(
  isAdmin = false,
  referralEnabled = false,
  supportAppealsEnabled = false,
  buyGbEnabled = true,
  whitelistEnabled = false,
  buyDeviceEnabled = false,
  adminClientsButtonEnabled = false,
  askAiEnabled = false,
) {
  const rows: string[][] = [["Подписка"], ["Оплата подписки"]];
  if (whitelistEnabled) rows.push(["Белые списки"]);
  if (buyGbEnabled) rows[1]!.push("Докупить ГБ");
  if (buyDeviceEnabled) rows.push(["Купить устройство"]);
  if (askAiEnabled) rows.push(["Спросить AI"]);
  if (supportAppealsEnabled) rows.push(["Сообщить о проблеме"]);
  if (referralEnabled) rows.push(["Пригласи друга"]);
  if (isAdmin && adminClientsButtonEnabled) rows.push(["Клиенты"]);
  return {
    keyboard: rows.map((r) => r.map((text) => ({ text }))),
    resize_keyboard: true,
  };
}

/** Напоминание из админки: кнопка «Оплатить» — пока тот же callback, что и в меню (заглушка). */
export const payReminderInline = {
  inline_keyboard: [[inlineBtn("Оплата подписки", "pay", "menuPay")]],
};

export function buyGbReminderInline() {
  return {
    inline_keyboard: [
      [inlineBtn("Докупить ГБ", "buygb", "menuBuyGb")],
      [inlineBtn("« В меню", "home", "menuHome")],
    ],
  };
}

export function pickSubscriptionKeyboard(users: Array<{ id: number; name: string }>) {
  const rows: ReturnType<typeof inlineBtn>[][] = [];
  for (const u of users) {
    const label = subscriptionPublicName(u);
    rows.push([inlineBtn(label.slice(0, 58), `lnk:${u.id}`, "pickSubscription")]);
  }
  rows.push([inlineBtn("« В меню", "home", "menuHome")]);
  return { inline_keyboard: rows };
}

export function backHomeRow() {
  return { inline_keyboard: [[inlineBtn("« В меню", "home", "menuHome")]] };
}

/** Меню гостя без привязанной подписки: покупка (если продажи включены) и «Меню». */
export function newUserKeyboard(salesDisabled: boolean, testAvailable = false, askAiEnabled = false) {
  const rows: ReturnType<typeof inlineBtn>[][] = [];
  if (!salesDisabled) {
    rows.push([inlineBtn("Купить подписку", "buynew", "createNewSubscription")]);
  }
  if (testAvailable) {
    rows.push([{ text: "Оформить тестовую подписку", callback_data: "test_intro" }]);
  }
  if (askAiEnabled) {
    rows.push([inlineBtn("Спросить AI", "ai_start", "askAi")]);
  }
  rows.push([inlineBtn("« Меню", "home", "menuHome")]);
  return { inline_keyboard: rows };
}

export function newUserReply(salesDisabled: boolean, testAvailable = false, askAiEnabled = false) {
  const rows: string[][] = [];
  if (!salesDisabled) rows.push(["Купить подписку"]);
  if (testAvailable) rows.push(["Оформить тестовую подписку"]);
  if (askAiEnabled) rows.push(["Спросить AI"]);
  return {
    keyboard: rows.map((r) => r.map((text) => ({ text }))),
    resize_keyboard: true,
  };
}
