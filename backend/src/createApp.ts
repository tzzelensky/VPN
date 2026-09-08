import express, { type Express } from "express";
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
import mySubRouter from "./routes/mySub.js";
import subscriptionRouter from "./routes/subscription.js";
import deviceLimitRouter from "./routes/deviceLimit.js";
import dailyGiftRouter from "./routes/dailyGift.js";
import telegramRouter from "./routes/telegram.js";
import { buildSubscriptionDecoyHtml } from "./subscriptionLanding.js";
import { getPanelSettings } from "./panelSettings.js";
import settingsRouter from "./routes/settings.js";
import panelUpdatesRouter from "./routes/panelUpdates.js";
import panelHttpsRouter from "./routes/panelHttps.js";
import { isTelegramWebhookEnabled } from "./telegram/env.js";
import { mountAdminSwagger } from "./swaggerAdmin.js";

export type CreateAppOptions = {
  /** When false, skip Swagger UI mount (faster tests). Default true. */
  mountSwagger?: boolean;
  /** Override frontend origin(s) for CORS. */
  frontendOrigin?: string;
};

function expandFrontendOrigins(origin: string): string[] {
  const o = String(origin ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!o) return [];
  const out = new Set<string>([o]);
  if (o.startsWith("https://")) out.add(`http://${o.slice("https://".length)}`);
  if (o.startsWith("http://")) out.add(`https://${o.slice("http://".length)}`);
  return [...out];
}

/**
 * Build the Express app without listen() and without background loops.
 * Callers must init DB/stores before createApp (or rely on index.ts bootstrap).
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const FRONTEND_ORIGIN = options.frontendOrigin ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  const FRONTEND_ORIGINS = new Set([
    ...expandFrontendOrigins(FRONTEND_ORIGIN),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);

  const cookieSecureEnv = (process.env.COOKIE_SECURE ?? "").trim().toLowerCase();
  const cookieSecure: boolean | "auto" =
    cookieSecureEnv === "1" || cookieSecureEnv === "true" || cookieSecureEnv === "yes"
      ? true
      : cookieSecureEnv === "0" || cookieSecureEnv === "false" || cookieSecureEnv === "no"
        ? false
        : "auto";

  app.set("trust proxy", 1);

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
        secure: cookieSecure,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.get("/", (_req, res) => {
    res.type("text/html; charset=utf-8").send(buildSubscriptionDecoyHtml());
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/public/shop-review", (req, res) => {
    const text = String((req.body as { text?: unknown } | undefined)?.text ?? "").trim();
    const keyword = getPanelSettings().panel.shopReviewKeyword.trim();
    if (!keyword || text !== keyword) {
      res.status(400).json({ ok: false, error: "Отзывы еще не работают" });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/public/decoy-shop", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ shop: getPanelSettings().panel.decoyShop });
  });

  app.get("/api/public/site-meta", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const path = String(getPanelSettings().security.panelAccessPath ?? "").trim();
    res.json({ panelAccessPath: path || null });
  });

  app.get("/comfort", (_req, res) => {
    res.type("text/html; charset=utf-8").send(buildSubscriptionDecoyHtml());
  });

  app.use("/api/auth", authRouter);
  app.use("/api/servers", serversRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/communications", communicationsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/settings/updates", panelUpdatesRouter);
  app.use("/api/settings/https", panelHttpsRouter);
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
  app.use("/api/mysub", mySubRouter);
  app.use("/sub", subscriptionRouter);
  app.use("/goods", subscriptionRouter);
  app.use("/api/sub", subscriptionRouter);
  app.use("/api/subscription", subscriptionRouter);
  app.use("/api/device-limit", deviceLimitRouter);
  app.use("/api/daily-gift", dailyGiftRouter);
  if (isTelegramWebhookEnabled()) {
    app.use("/api/telegram", telegramRouter);
  }

  if (options.mountSwagger !== false) {
    mountAdminSwagger(app);
  }

  return app;
}
