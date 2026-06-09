import { getEffectiveTelegramAdminIds, getPanelBotToken } from "../panelSettings.js";

/**
 * Токен: panel_secrets.json (настройки панели) или TELEGRAM_BOT_TOKEN в .env.
 */
export function getTelegramBotToken(): string {
  return getPanelBotToken();
}

/** Числовые Telegram user id админов: настройки панели или .env. */
export function getTelegramAdminIds(): number[] {
  return getEffectiveTelegramAdminIds();
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

/** HTTPS URL мини-приложения (как в @BotFather). Для кнопки «Открыть приложение» в рассылках. */
export function getTelegramWebAppUrl(): string {
  return (process.env.TELEGRAM_WEBAPP_URL ?? "").trim();
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
