import { getSubscriptionShop, setSubscriptionShop } from "./db.js";
import { getTelegramPaymentUrl } from "./telegram/env.js";

function panelHostnames(): Set<string> {
  const out = new Set<string>();
  for (const raw of [process.env.PUBLIC_API_URL, process.env.FRONTEND_ORIGIN]) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    try {
      out.add(new URL(s).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  return out;
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Корень панели / типичные SPA-маршруты — не страница оплаты. */
function isPanelSiteUrl(candidate: string, panelHosts: Set<string>): boolean {
  try {
    const u = new URL(candidate);
    if (!panelHosts.has(u.hostname.toLowerCase())) return false;
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    if (path === "/") return true;
    const panelPrefixes = [
      "/login",
      "/mysub",
      "/users",
      "/servers",
      "/subscription-shop",
      "/communications",
      "/settings",
      "/panel-updates",
    ];
    return panelPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
  } catch {
    return false;
  }
}

function pickClientPaymentUrl(candidate: string, panelHosts: Set<string>): string {
  if (!candidate || !isHttpUrl(candidate)) return "";
  if (isPanelSiteUrl(candidate, panelHosts)) return "";
  return candidate;
}

/** URL страницы оплаты для клиента (WebApp / бот). Не отдаём URL панели. */
export function resolveClientPaymentUrl(shopPaymentUrl?: string): string {
  const fromShop = String(shopPaymentUrl ?? getSubscriptionShop().payment_url ?? "").trim();
  const fromEnv = getTelegramPaymentUrl();
  const panelHosts = panelHostnames();
  return pickClientPaymentUrl(fromShop, panelHosts) || pickClientPaymentUrl(fromEnv, panelHosts);
}

/** Если в магазине пусто — подтянуть TELEGRAM_PAYMENT_URL в data.json (один раз при старте). */
export function syncSubscriptionShopPaymentUrlFromEnv(): void {
  const shop = getSubscriptionShop();
  if (shop.payment_url.trim()) return;
  const envUrl = getTelegramPaymentUrl();
  const panelHosts = panelHostnames();
  const picked = pickClientPaymentUrl(envUrl, panelHosts);
  if (!picked) return;
  setSubscriptionShop({ ...shop, payment_url: picked });
  console.log("[payment] subscription_shop.payment_url synced from TELEGRAM_PAYMENT_URL");
}
