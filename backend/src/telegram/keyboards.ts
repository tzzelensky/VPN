export function publicSubscriptionUrl(subToken: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${base}/sub/${encodeURIComponent(subToken)}`;
}

export const mainMenuInline = {
  inline_keyboard: [
    [{ text: "Статистика по подписке", callback_data: "stats" }],
    [{ text: "Подписка", callback_data: "sub" }],
    [{ text: "Оплата подписки", callback_data: "pay" }],
  ],
};

/** Напоминание из админки: кнопка «Оплатить» — пока тот же callback, что и в меню (заглушка). */
export const payReminderInline = {
  inline_keyboard: [[{ text: "Оплатить", callback_data: "pay" }]],
};

export function pickSubscriptionKeyboard(userIds: number[]) {
  const rows: { text: string; callback_data: string }[][] = [];
  for (const id of userIds) {
    rows.push([{ text: `Подписка #${id}`, callback_data: `lnk:${id}` }]);
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
