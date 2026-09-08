import "dotenv/config";
import { initDb, syncAllUsersDeviceLimitFromGlobal } from "./db.js";
import { initSurveyDb } from "./surveyDb.js";
import { initPanelSettings } from "./panelSettings.js";
import { getDeviceLimitSettings, setDeviceLimitSettings } from "./deviceLimitStore.js";
import {
  getTelegramBotToken,
  getTelegramWebhookSecret,
  isTelegramLongPollingEnabled,
  isTelegramWebhookEnabled,
} from "./telegram/env.js";
import { startTelegramLongPolling } from "./telegram/polling.js";
import { startAutoTrafficNotifyLoop } from "./telegram/trafficNotify.js";
import { startAutoExpiryNotifyLoop } from "./telegram/expiryNotify.js";
import { startExpiredSubscriptionAccessLoop } from "./expiryAccessEnforce.js";
import { startConfigVaultAutoCheckLoop } from "./configVaultAutoCheck.js";
import { startTelegramProxyAutoCheckLoop } from "./telegramProxyAutoCheck.js";
import { startWhitelistVaultAutoCheckLoop } from "./whitelistVaultAutoCheck.js";
import { startXrayLogsAutoCleanLoop } from "./xrayLogsAutoClean.js";
import { initDailyGiftStore } from "./dailyGiftStore.js";
import { initAutoCommunicationsStore } from "./autoCommunicationsStore.js";
import { initTriggerMailingsStore } from "./triggerMailingsStore.js";
import { initTriggerMailingsHistoryStore } from "./triggerMailingsHistoryStore.js";
import { startTriggerMailingsLoop } from "./triggerMailingsService.js";
import { startDailyGiftNotifyLoop } from "./telegram/dailyGiftNotify.js";
import { createApp } from "./createApp.js";

initDb();
initSurveyDb();
initPanelSettings();
initDailyGiftStore();
initAutoCommunicationsStore();
initTriggerMailingsStore();
initTriggerMailingsHistoryStore();

{
  let dl = getDeviceLimitSettings();
  if (!dl.enabled && dl.default_slots > 1) {
    dl = setDeviceLimitSettings({ enabled: true });
    console.log(`[device-limit] auto-enabled (default_slots=${dl.default_slots})`);
  }
  if (dl.enabled && dl.limit_scope === "all") {
    const n = syncAllUsersDeviceLimitFromGlobal(dl.default_slots);
    if (n > 0) console.log(`[device-limit] synced ${n} subscriptions to default_slots=${dl.default_slots}`);
  }
}

{
  const tgToken = getTelegramBotToken();
  const tgSecret = getTelegramWebhookSecret();
  const poll = isTelegramLongPollingEnabled();
  if (tgToken && poll) {
    console.log(
      "[telegram] Long polling: домен не нужен. Убедитесь, что в BotFather нет активного вебхука на чужой URL — при старте выполняется deleteWebhook.",
    );
  } else if (tgToken && !tgSecret) {
    console.warn(
      "[telegram] Задан TELEGRAM_BOT_TOKEN, но нет TELEGRAM_WEBHOOK_SECRET. Либо добавьте секрет и вебхук, либо для теста без домена: TELEGRAM_POLLING=1 в .env",
    );
  }
  if (!tgToken && tgSecret) {
    console.warn(
      "[telegram] Задан TELEGRAM_WEBHOOK_SECRET без TELEGRAM_BOT_TOKEN — вебхук не подключён.",
    );
  }
}

const app = createApp();
const PORT = Number(process.env.PORT) || 4000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API http://127.0.0.1:${PORT}  (и http://localhost:${PORT})`);
  console.log(`[swagger] Admin API docs: /panel/swagger/admin (Basic: ADMIN_USER / ADMIN_PASSWORD)`);
  if (isTelegramWebhookEnabled()) {
    const hint = process.env.PUBLIC_API_URL ?? `http://127.0.0.1:${PORT}`;
    console.log(
      `[telegram] Вебхук: POST ${hint.replace(/\/$/, "")}/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`,
    );
  }
  if (isTelegramLongPollingEnabled() && getTelegramBotToken()) {
    void startTelegramLongPolling().catch((e) =>
      console.error("[telegram] polling crashed:", e instanceof Error ? e.message : e),
    );
  }
  if (getTelegramBotToken()) {
    startAutoTrafficNotifyLoop();
    startAutoExpiryNotifyLoop();
    startDailyGiftNotifyLoop();
    startTriggerMailingsLoop();
  }
  // Всегда: снимать истёкших с узлов (не зависит от Telegram).
  startExpiredSubscriptionAccessLoop();
  startConfigVaultAutoCheckLoop();
  startTelegramProxyAutoCheckLoop();
  startWhitelistVaultAutoCheckLoop();
  startXrayLogsAutoCleanLoop();
});

export { app, createApp };
