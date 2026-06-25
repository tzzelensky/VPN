import { subscriptionPublicName } from "./format.js";

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
) {
  const rows: { text: string; callback_data: string }[][] = [
    [{ text: "Подписка", callback_data: "sub" }],
    [{ text: "Оплата подписки", callback_data: "pay" }],
  ];
  if (whitelistEnabled) rows.push([{ text: "Белые списки", callback_data: "wlmenu" }]);
  if (buyGbEnabled) rows.push([{ text: "Докупить ГБ", callback_data: "buygb" }]);
  if (buyDeviceEnabled) rows.push([{ text: "Купить устройство", callback_data: "buydevice" }]);
  if (supportAppealsEnabled) rows.push([{ text: "Сообщить о проблеме", callback_data: "appeal_start" }]);
  if (referralEnabled) rows.push([{ text: "Пригласи друга", callback_data: "ref_menu" }]);
  if (isAdmin && adminClientsButtonEnabled) rows.push([{ text: "Клиенты", callback_data: "admin_clients" }]);
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
) {
  const rows: string[][] = [["Подписка"], ["Оплата подписки"]];
  if (whitelistEnabled) rows.push(["Белые списки"]);
  if (buyGbEnabled) rows[1]!.push("Докупить ГБ");
  if (buyDeviceEnabled) rows.push(["Купить устройство"]);
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
  inline_keyboard: [[{ text: "Оплата подписки", callback_data: "pay" }]],
};

export const buyGbReminderInline = {
  inline_keyboard: [
    [{ text: "Докупить ГБ", callback_data: "buygb" }],
    [{ text: "« В меню", callback_data: "home" }],
  ],
};

export function pickSubscriptionKeyboard(users: Array<{ id: number; name: string }>) {
  const rows: { text: string; callback_data: string }[][] = [];
  for (const u of users) {
    const label = subscriptionPublicName(u);
    rows.push([{ text: label.slice(0, 58), callback_data: `lnk:${u.id}` }]);
  }
  rows.push([{ text: "« В меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export const backHomeRow = {
  inline_keyboard: [[{ text: "« В меню", callback_data: "home" }]],
};

/** Меню гостя без привязанной подписки: покупка (если продажи включены) и «Меню». */
export function newUserKeyboard(salesDisabled: boolean, testAvailable = false) {
  const rows: { text: string; callback_data: string }[][] = [];
  if (!salesDisabled) {
    rows.push([{ text: "Купить подписку", callback_data: "buynew" }]);
  }
  if (testAvailable) {
    rows.push([{ text: "Оформить тестовую подписку", callback_data: "test_intro" }]);
  }
  rows.push([{ text: "« Меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export function newUserReply(salesDisabled: boolean, testAvailable = false) {
  const rows: string[][] = [];
  if (!salesDisabled) rows.push(["Купить подписку"]);
  if (testAvailable) rows.push(["Оформить тестовую подписку"]);
  return {
    keyboard: rows.map((r) => r.map((text) => ({ text }))),
    resize_keyboard: true,
  };
}
