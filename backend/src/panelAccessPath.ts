/** Secret URL segment for panel login (ASCII letters, digits, symbols; no leading slash). */

export const PANEL_ACCESS_PATH_MAX_LEN = 64;
export const PANEL_ACCESS_PATH_MIN_LEN = 2;

/** Letters, digits, and common URL-safe symbols. No spaces or non-ASCII. */
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
  "favicon.ico",
]);

export type PanelAccessPathError =
  | "panel_access_path_too_short"
  | "panel_access_path_too_long"
  | "panel_access_path_invalid_chars"
  | "panel_access_path_reserved";

export function normalizePanelAccessPath(raw: unknown): string {
  let s = String(raw ?? "").trim();
  while (s.startsWith("/")) s = s.slice(1);
  return s.slice(0, PANEL_ACCESS_PATH_MAX_LEN);
}

export function validatePanelAccessPath(path: string): PanelAccessPathError | null {
  if (!path) return null;
  if (path.length < PANEL_ACCESS_PATH_MIN_LEN) return "panel_access_path_too_short";
  if (path.length > PANEL_ACCESS_PATH_MAX_LEN) return "panel_access_path_too_long";
  if (!PANEL_ACCESS_PATH_RE.test(path)) return "panel_access_path_invalid_chars";
  if (RESERVED.has(path.toLowerCase())) return "panel_access_path_reserved";
  return null;
}
