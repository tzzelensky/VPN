import { getSubscriptionShop } from "./db.js";

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
  const panelHosts = panelHostnames();
  // Важно: бот/вебапп должны использовать ТОЛЬКО вставленную ссылку из магазина.
  // Если поле пустое — возвращаем пусто, чтобы кнопка оплаты была отключена.
  return pickClientPaymentUrl(fromShop, panelHosts);
}
