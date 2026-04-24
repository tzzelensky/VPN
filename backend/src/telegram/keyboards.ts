export function publicSubscriptionUrl(subToken: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${base}/sub/${encodeURIComponent(subToken)}`;
}

export function mainMenuInline(isAdmin = false, referralEnabled = false) {
  const rows: { text: string; callback_data: string }[][] = [
    [{ text: "Статистика по подписке", callback_data: "stats" }],
    [{ text: "Подписка", callback_data: "sub" }],
    [{ text: "Оплата подписки", callback_data: "pay" }],
    [{ text: "Докупить ГБ", callback_data: "buygb" }],
  ];
  if (referralEnabled) rows.push([{ text: "Пригласи друга", callback_data: "ref_menu" }]);
  if (isAdmin) rows.push([{ text: "Клиенты", callback_data: "admin_clients" }]);
  return { inline_keyboard: rows };
}

/** Напоминание из админки: кнопка «Оплатить» — пока тот же callback, что и в меню (заглушка). */
export const payReminderInline = {
  inline_keyboard: [[{ text: "Оплатить", callback_data: "pay" }]],
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
    const label = `#${u.id} ${String(u.name || "").trim()}`.trim();
    rows.push([{ text: label.slice(0, 58), callback_data: `lnk:${u.id}` }]);
  }
  rows.push([{ text: "« В меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}

export const backHomeRow = {
  inline_keyboard: [[{ text: "« В меню", callback_data: "home" }]],
};

/** Меню гостя без привязанной подписки: покупка (если продажи включены) и «Меню». */
export function newUserKeyboard(salesDisabled: boolean) {
  const rows: { text: string; callback_data: string }[][] = [];
  if (!salesDisabled) {
    rows.push([{ text: "Купить подписку", callback_data: "buynew" }]);
  }
  rows.push([{ text: "« Меню", callback_data: "home" }]);
  return { inline_keyboard: rows };
}
