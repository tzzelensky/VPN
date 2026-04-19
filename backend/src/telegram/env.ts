/**
 * Секреты только из окружения (.env). Токен бота никогда не хранить в коде репозитория.
 */
export function getTelegramBotToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

/** Числовые Telegram user id админов, через запятую. */
export function getTelegramAdminIds(): number[] {
  const raw = process.env.TELEGRAM_ADMIN_IDS ?? process.env.TELEGRAM_ADMIN_ID ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Куда слать чеки на оплату (если TELEGRAM_ADMIN_IDS пуст — 404740026). */
export function getTelegramPaymentNotifyChatIds(): number[] {
  const ids = getTelegramAdminIds();
  if (ids.length > 0) return ids;
  return [404740026];
}

export function getTelegramPaymentUrl(): string {
  const u = (process.env.TELEGRAM_PAYMENT_URL ?? "https://www.tbank.ru/cf/81hWUzyhiQB").trim();
  return u || "https://www.tbank.ru/cf/81hWUzyhiQB";
}

/** Секретный сегмент URL вебхука (случайная строка). */
export function getTelegramWebhookSecret(): string {
  return (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
}

function envFlag(name: string): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Локальная разработка без домена: long polling вместо вебхука. */
export function isTelegramLongPollingEnabled(): boolean {
  return envFlag("TELEGRAM_POLLING") || envFlag("TELEGRAM_USE_POLLING");
}

/** Вебхук: токен + секрет и не включён режим polling. */
export function isTelegramWebhookEnabled(): boolean {
  return Boolean(
    getTelegramBotToken() && getTelegramWebhookSecret() && !isTelegramLongPollingEnabled(),
  );
}

/** Совместимость: «настроен вебхук» (как раньше). */
export function isTelegramConfigured(): boolean {
  return isTelegramWebhookEnabled();
}
