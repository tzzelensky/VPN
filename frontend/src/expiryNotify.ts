const DAY_MS = 86_400_000;
const THREE_DAYS_MS = 3 * DAY_MS;

function hasTelegramChat(u: { tg_id: string }): boolean {
  const chat = Number(String(u.tg_id ?? "").trim());
  return Number.isFinite(chat) && chat > 0;
}

/** Напоминание до окончания: осталось ≤3 суток, подписка ещё активна. */
export function userExpiryNotifyEligible(u: { expiry_time: number; tg_id: string }): boolean {
  if (!hasTelegramChat(u)) return false;
  if (!u.expiry_time || u.expiry_time <= 0) return false;
  const left = u.expiry_time - Date.now();
  return left > 0 && left <= THREE_DAYS_MS;
}

/** Уведомление об истечении: срок прошёл. */
export function userExpiredNotifyEligible(u: { expiry_time: number; tg_id: string }): boolean {
  if (!hasTelegramChat(u)) return false;
  if (!u.expiry_time || u.expiry_time <= 0) return false;
  return u.expiry_time <= Date.now();
}

export function userExpiryBellEligible(u: { expiry_time: number; tg_id: string }): boolean {
  return userExpiryNotifyEligible(u) || userExpiredNotifyEligible(u);
}

export function formatNotifyExpiryError(raw: string): string {
  if (raw.includes("no_tg")) return "Нет Telegram Chat ID.";
  if (raw.includes("no_expiry")) return "Не задана дата окончания.";
  if (raw.includes("not_expired")) return "Подписка ещё не истекла.";
  if (raw.includes("expired")) return "Подписка уже истекла — используйте уведомление об истечении.";
  if (raw.includes("too_early")) return "Доступно только в последние 3 суток до окончания.";
  if (raw.includes("telegram_not_configured")) return "Telegram-бот не настроен на сервере.";
  return raw;
}

export function formatNotifyExpiredError(raw: string): string {
  if (raw.includes("no_tg")) return "Нет Telegram Chat ID.";
  if (raw.includes("no_expiry")) return "Не задана дата окончания.";
  if (raw.includes("not_expired")) return "Подписка ещё не истекла.";
  if (raw.includes("telegram_not_configured")) return "Telegram-бот не настроен на сервере.";
  return raw;
}
