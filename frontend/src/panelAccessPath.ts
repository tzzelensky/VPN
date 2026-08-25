export const PANEL_ACCESS_PATH_MAX_LEN = 64;
export const PANEL_ACCESS_PATH_MIN_LEN = 2;

export const PANEL_ACCESS_PATH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-!@#$%^&*+=~]*$/;

const RESERVED = new Set([
  "login",
  "servers",
  "users",
  "logs",
  "subscription-shop",
  "communications",
  "support-appeals",
  "referral-program",
  "promo-codes",
  "config-vault",
  "whitelist-vault",
  "telegram-proxies",
  "roulette-game",
  "dropper-game",
  "device-limit",
  "daily-gift",
  "mysub",
  "goods",
  "sub",
  "comfort",
  "api",
  "panel",
  "assets",
]);

export function normalizePanelAccessPath(raw: string): string {
  let s = raw.trim();
  while (s.startsWith("/")) s = s.slice(1);
  return s.slice(0, PANEL_ACCESS_PATH_MAX_LEN);
}

export function panelAccessPathError(path: string): string | null {
  if (!path) return null;
  if (path.length < PANEL_ACCESS_PATH_MIN_LEN) {
    return "Не короче 2 символов. Пустое поле — секретный вход выключен.";
  }
  if (path.length > PANEL_ACCESS_PATH_MAX_LEN) return `Не длиннее ${PANEL_ACCESS_PATH_MAX_LEN} символов.`;
  if (!PANEL_ACCESS_PATH_RE.test(path)) {
    return "Только латиница, цифры и символы (. _ - ! @ # $ % ^ & * + = ~). Без пробелов и кириллицы.";
  }
  if (RESERVED.has(path.toLowerCase())) return "Это слово занято системным путём — выберите другое.";
  return null;
}
