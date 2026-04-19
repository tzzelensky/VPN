const DAY_MS = 86_400_000;
const THREE_DAYS_MS = 3 * DAY_MS;

/** Показ кнопки «уведомить»: осталось не больше 3 суток, срок задан, не просрочено, есть Telegram Chat ID. */
export function userExpiryNotifyEligible(u: { expiry_time: number; tg_id: string }): boolean {
  const chat = Number(String(u.tg_id ?? "").trim());
  if (!Number.isFinite(chat) || chat <= 0) return false;
  if (!u.expiry_time || u.expiry_time <= 0) return false;
  const left = u.expiry_time - Date.now();
  return left > 0 && left <= THREE_DAYS_MS;
}

export function formatNotifyExpiryError(raw: string): string {
  if (raw.includes("no_tg")) return "Нет Telegram Chat ID.";
  if (raw.includes("no_expiry")) return "Не задана дата окончания.";
  if (raw.includes("expired")) return "Подписка уже истекла.";
  if (raw.includes("too_early")) return "Доступно только в последние 3 суток до окончания.";
  if (raw.includes("telegram_not_configured")) return "Не задан TELEGRAM_BOT_TOKEN в .env на сервере.";
  return raw;
}
