/**
 * Сканирует backend/src/routes и index.ts, генерирует OpenAPI 3.0 для админ-панели.
 * Запуск: node scripts/generate-openapi-spec.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const routesDir = path.join(root, "src", "routes");
const outFile = path.join(root, "src", "openapi", "adminOpenApi.json");
const descriptionsFile = path.join(root, "src", "openapi", "endpointDescriptions.json");

/** @type {Record<string, string>} */
const descriptions = JSON.parse(fs.readFileSync(descriptionsFile, "utf8"));

function lookupDescription(method, routePath) {
  const m = method.toUpperCase();
  const candidates = [
    `${m} ${routePath}`,
    routePath.endsWith("/") ? `${m} ${routePath.slice(0, -1)}` : `${m} ${routePath}/`,
    `${m} ${routePath.replace(/^\/sub\//, "/api/subscription/")}`,
    `${m} ${routePath.replace(/^\/api\/sub\//, "/api/subscription/")}`,
    `${m} ${routePath.replace(/^\/sub-shop\//, "/api/subscription-shop/")}`,
    `${m} ${routePath.replace(/^\/api\/sub-shop\//, "/api/subscription-shop/")}`,
    `${m} ${routePath.replace(/^\/exp-sub\//, "/api/exp-sub/")}`,
  ];
  for (const key of candidates) {
    if (descriptions[key]) return descriptions[key];
  }
  return null;
}

/** @type {Record<string, { mount: string; tag: string; auth?: boolean }>} */
const ROUTE_FILES = {
  "auth.ts": { mount: "/api/auth", tag: "Auth", auth: false },
  "servers.ts": { mount: "/api/servers", tag: "Servers" },
  "users.ts": { mount: "/api/users", tag: "Users" },
  "communications.ts": { mount: "/api/communications", tag: "Communications" },
  "surveys.ts": { mount: "/api/communications/surveys", tag: "Surveys" },
  "settings.ts": { mount: "/api/settings", tag: "Settings" },
  "subscriptionShop.ts": { mount: "/api/subscription-shop", tag: "Subscription shop" },
  "referralProgram.ts": { mount: "/api/referral-program", tag: "Referral program" },
  "promoCodes.ts": { mount: "/api/promo-codes", tag: "Promo codes" },
  "purchaseDiscounts.ts": { mount: "/api/purchase-discounts", tag: "Purchase discounts" },
  "configVault.ts": { mount: "/api/config-vault", tag: "Config vault" },
  "telegramProxies.ts": { mount: "/api/telegram-proxies", tag: "Telegram proxies" },
  "whitelistVault.ts": { mount: "/api/whitelist-vault", tag: "Whitelist vault" },
  "dropperGame.ts": { mount: "/api/dropper-game", tag: "Dropper game" },
  "rouletteGame.ts": { mount: "/api/roulette-game", tag: "Roulette game" },
  "supportAppeals.ts": { mount: "/api/support-appeals", tag: "Support appeals" },
  "push.ts": { mount: "/api/push", tag: "Push" },
  "mySub.ts": { mount: "/api/mysub", tag: "MySub (WebApp)", auth: false },
  "subscription.ts": { mount: "/api/subscription", tag: "Subscription", auth: false },
  "deviceLimit.ts": { mount: "/api/device-limit", tag: "Device limit" },
  "dailyGift.ts": { mount: "/api/daily-gift", tag: "Daily gift" },
  "experiments.ts": { mount: "/api/experiments", tag: "Experiments" },
  "experimentSubscription.ts": { mount: "/api/exp-sub", tag: "Experiment subscription", auth: false },
  "telegram.ts": { mount: "/api/telegram", tag: "Telegram webhook", auth: false },
};

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
const REQUIRE_AUTH_RE = /router\.use\s*\(\s*requireAuth\s*\)/;

/** @type {Array<{ method: string; path: string; tag: string; auth: boolean; file: string }>} */
const endpoints = [];

/** @type {Array<{ method: string; path: string; tag: string; auth: boolean }>} */
const rootEndpoints = [
  { method: "get", path: "/", tag: "System", auth: false },
  { method: "get", path: "/api/health", tag: "System", auth: false },
  { method: "get", path: "/comfort", tag: "System", auth: false },
  { method: "get", path: "/sub/{token}", tag: "Subscription", auth: false },
  { method: "get", path: "/exp-sub/{token}", tag: "Experiment subscription", auth: false },
];

for (const ep of rootEndpoints) {
  endpoints.push({ ...ep, file: "index.ts" });
}

for (const [file, meta] of Object.entries(ROUTE_FILES)) {
  const full = path.join(routesDir, file);
  if (!fs.existsSync(full)) {
    console.warn(`skip missing ${file}`);
    continue;
  }
  const src = fs.readFileSync(full, "utf8");
  const requiresAuth = meta.auth !== false && REQUIRE_AUTH_RE.test(src);
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(src)) !== null) {
    const method = m[1].toLowerCase();
    let routePath = m[2];
    routePath = routePath
      .replace(/:(\w+)\([^)]*\)/g, "{$1}")
      .replace(/:(\w+)/g, "{$1}");
    const fullPath = `${meta.mount}${routePath.startsWith("/") ? routePath : `/${routePath}`}`.replace(/\/+/g, "/");
    endpoints.push({
      method,
      path: fullPath,
      tag: meta.tag,
      auth: requiresAuth,
      file,
    });
  }
}

// Дубли mount subscription
for (const ep of endpoints.filter((e) => e.path.startsWith("/api/subscription"))) {
  endpoints.push({
    ...ep,
    path: ep.path.replace("/api/subscription", "/sub"),
    file: ep.file + " (alias)",
  });
  endpoints.push({
    ...ep,
    path: ep.path.replace("/api/subscription", "/api/sub"),
    file: ep.file + " (alias)",
  });
}

for (const ep of endpoints.filter((e) => e.path.startsWith("/api/subscription-shop"))) {
  endpoints.push({
    ...ep,
    path: ep.path.replace("/api/subscription-shop", "/api/sub-shop"),
    file: ep.file + " (alias)",
  });
  endpoints.push({
    ...ep,
    path: ep.path.replace("/api/subscription-shop", "/sub-shop"),
    file: ep.file + " (alias)",
  });
}

for (const ep of endpoints.filter((e) => e.path.startsWith("/api/exp-sub"))) {
  endpoints.push({
    ...ep,
    path: ep.path.replace("/api/exp-sub", "/exp-sub"),
    file: ep.file + " (alias)",
  });
}

const unique = new Map();
for (const ep of endpoints) {
  const key = `${ep.method.toUpperCase()} ${ep.path}`;
  if (!unique.has(key)) unique.set(key, ep);
}
const sorted = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

/** @type {import('openapi-types').OpenAPIV3.Document} */
const spec = {
  openapi: "3.0.3",
  info: {
    title: "VPN Admin Panel API",
    description:
      "Документация HTTP API панели управления VPN. Большинство эндпоинтов требуют сессию после POST /api/auth/login (cookie `tzadmin.sid`). " +
      "MySub WebApp и публичные подписки используют свою авторизацию (Telegram initData / токен подписки).",
    version: "1.0.0",
  },
  servers: [{ url: "/", description: "Текущий хост" }],
  tags: [...new Set(sorted.map((e) => e.tag))].sort().map((name) => ({ name })),
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "tzadmin.sid",
        description: "Сессия после успешного входа через /api/auth/login",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          detail: { type: "string" },
        },
      },
      OkResponse: {
        type: "object",
        properties: { ok: { type: "boolean" } },
      },
    },
  },
  paths: {},
};

for (const ep of sorted) {
  if (!spec.paths[ep.path]) spec.paths[ep.path] = {};
  const text = lookupDescription(ep.method, ep.path);
  const methodPath = `\`${ep.method.toUpperCase()} ${ep.path}\``;
  const op = {
    tags: [ep.tag],
    summary: text ?? methodPath,
    description: text
      ? `${text}\n\n**HTTP:** ${methodPath}\n\n**Файл:** \`${ep.file}\`${ep.auth ? "\n\n**Требуется сессия** (cookie `tzadmin.sid`)" : ""}`
      : `**HTTP:** ${methodPath}\n\n**Файл:** \`${ep.file}\`${ep.auth ? "\n\n**Требуется сессия**" : ""}`,
    responses: {
      "200": { description: "Успех" },
      "400": { description: "Неверный запрос", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "401": { description: "Не авторизован", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "404": { description: "Не найдено" },
      "500": { description: "Ошибка сервера" },
    },
    ...(ep.auth ? { security: [{ sessionCookie: [] }] } : {}),
  };
  if (["post", "put", "patch"].includes(ep.method)) {
    op.requestBody = {
      content: {
        "application/json": { schema: { type: "object", additionalProperties: true } },
      },
    };
  }
  spec.paths[ep.path][ep.method] = op;
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(spec, null, 2), "utf8");

const missing = sorted.filter((ep) => !lookupDescription(ep.method, ep.path));
if (missing.length > 0) {
  console.warn(`Missing descriptions (${missing.length}):`);
  for (const ep of missing.slice(0, 10)) {
    console.warn(`  ${ep.method.toUpperCase()} ${ep.path}`);
  }
  if (missing.length > 10) console.warn(`  ... and ${missing.length - 10} more`);
}

console.log(`Wrote ${sorted.length} operations to ${outFile}`);
