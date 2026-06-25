import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import authRouter from "./routes/auth.js";
import serversRouter from "./routes/servers.js";
import usersRouter from "./routes/users.js";
import communicationsRouter from "./routes/communications.js";
import subscriptionShopRouter from "./routes/subscriptionShop.js";
import referralProgramRouter from "./routes/referralProgram.js";
import promoCodesRouter from "./routes/promoCodes.js";
import purchaseDiscountsRouter from "./routes/purchaseDiscounts.js";
import configVaultRouter from "./routes/configVault.js";
import telegramProxiesRouter from "./routes/telegramProxies.js";
import whitelistVaultRouter from "./routes/whitelistVault.js";
import dropperGameRouter from "./routes/dropperGame.js";
import rouletteGameRouter from "./routes/rouletteGame.js";
import supportAppealsRouter from "./routes/supportAppeals.js";
import pushRouter from "./routes/push.js";
import mySubRouter from "./routes/mySub.js";
import subscriptionRouter from "./routes/subscription.js";
import deviceLimitRouter from "./routes/deviceLimit.js";
import dailyGiftRouter from "./routes/dailyGift.js";
import experimentsRouter from "./routes/experiments.js";
import experimentSubscriptionRouter from "./routes/experimentSubscription.js";
import telegramRouter from "./routes/telegram.js";
import { SUBSCRIPTION_DECOY_HTML } from "./subscriptionLanding.js";
import { initDb, syncAllUsersDeviceLimitFromGlobal } from "./db.js";
import { initSurveyDb } from "./surveyDb.js";
import { initPanelSettings } from "./panelSettings.js";
import { getDeviceLimitSettings, setDeviceLimitSettings } from "./deviceLimitStore.js";
import settingsRouter from "./routes/settings.js";
import {
  getTelegramBotToken,
  getTelegramWebhookSecret,
  isTelegramLongPollingEnabled,
  isTelegramWebhookEnabled,
} from "./telegram/env.js";
import { startTelegramLongPolling } from "./telegram/polling.js";
import { startAutoTrafficNotifyLoop } from "./telegram/trafficNotify.js";
import { startAutoExpiryNotifyLoop } from "./telegram/expiryNotify.js";
import { startConfigVaultAutoCheckLoop } from "./configVaultAutoCheck.js";
import { startTelegramProxyAutoCheckLoop } from "./telegramProxyAutoCheck.js";
import { startWhitelistVaultAutoCheckLoop } from "./whitelistVaultAutoCheck.js";
import { startXrayLogsAutoCleanLoop } from "./xrayLogsAutoClean.js";
import { initDailyGiftStore } from "./dailyGiftStore.js";
import { initAutoCommunicationsStore } from "./autoCommunicationsStore.js";
import { startDailyGiftNotifyLoop } from "./telegram/dailyGiftNotify.js";
import { mountAdminSwagger } from "./swaggerAdmin.js";

initDb();
initSurveyDb();
initPanelSettings();
initDailyGiftStore();
initAutoCommunicationsStore();

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

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
const FRONTEND_ORIGINS = new Set([
  FRONTEND_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

// За Nginx/Traefik secure-cookie без trust proxy не будет устанавливаться.
if (COOKIE_SECURE) {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || FRONTEND_ORIGINS.has(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "12mb" }));
app.use(cookieParser());
app.use(
  session({
    name: "tzadmin.sid",
    secret: process.env.SESSION_SECRET ?? "change-session-secret-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.get("/", (_req, res) => {
  res.type("text/plain; charset=utf-8").send(
    `Панель управления (API). Откройте в браузере фронтенд: ${FRONTEND_ORIGIN}\n` +
      "Либо http://127.0.0.1:5173 — порт 4000 только для API.\n",
  );
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/comfort", (_req, res) => {
  res.type("text/html; charset=utf-8").send(SUBSCRIPTION_DECOY_HTML);
});

app.use("/api/auth", authRouter);
app.use("/api/servers", serversRouter);
app.use("/api/users", usersRouter);
app.use("/api/communications", communicationsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/subscription-shop", subscriptionShopRouter);
app.use("/api/referral-program", referralProgramRouter);
app.use("/api/promo-codes", promoCodesRouter);
app.use("/api/purchase-discounts", purchaseDiscountsRouter);
app.use("/api/config-vault", configVaultRouter);
app.use("/api/telegram-proxies", telegramProxiesRouter);
app.use("/api/whitelist-vault", whitelistVaultRouter);
app.use("/api/dropper-game", dropperGameRouter);
app.use("/api/roulette-game", rouletteGameRouter);
app.use("/api/support-appeals", supportAppealsRouter);
app.use("/api/push", pushRouter);
app.use("/api/mysub", mySubRouter);
app.use("/sub", subscriptionRouter);
app.use("/api/sub", subscriptionRouter);
app.use("/api/subscription", subscriptionRouter);
app.use("/api/device-limit", deviceLimitRouter);
app.use("/api/daily-gift", dailyGiftRouter);
app.use("/api/experiments", experimentsRouter);
app.use("/exp-sub", experimentSubscriptionRouter);
app.use("/api/exp-sub", experimentSubscriptionRouter);
if (isTelegramWebhookEnabled()) {
  app.use("/api/telegram", telegramRouter);
}

mountAdminSwagger(app);

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
  }
  startConfigVaultAutoCheckLoop();
  startTelegramProxyAutoCheckLoop();
  startWhitelistVaultAutoCheckLoop();
  startXrayLogsAutoCleanLoop();
});
