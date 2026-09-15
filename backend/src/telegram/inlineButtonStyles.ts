import { getPanelSettings } from "../panelSettings.js";

export type TelegramColoredButtonKey =
  | "menuHome"
  | "menuSubscription"
  | "menuPay"
  | "menuBuyGb"
  | "menuBuyDevice"
  | "menuAdminClients"
  | "deleteSubscription"
  | "createNewSubscription"
  | "pickSubscription"
  | "comboOffer"
  | "applyPromo"
  | "buyWhitelist"
  | "sendAppeal"
  | "askAi"
  | "inviteFriend";

export type TelegramInlineButtonStyle = "primary" | "success" | "danger";

export type StyledInlineButton = {
  text: string;
  callback_data: string;
  style?: TelegramInlineButtonStyle;
};

export const TELEGRAM_COLORED_BUTTON_LABELS: Record<TelegramColoredButtonKey, string> = {
  menuHome: "« В меню",
  menuSubscription: "Подписка",
  menuPay: "Оплата подписки",
  menuBuyGb: "Докупить ГБ",
  menuBuyDevice: "Купить устройство",
  menuAdminClients: "Клиенты",
  deleteSubscription: "Удалить подписку",
  createNewSubscription: "Создать новую подписку",
  pickSubscription: "Выбор готовой подписки",
  comboOffer: "Спец-предложение (комбо)",
  applyPromo: "Применить промокод",
  buyWhitelist: "Купить белые списки",
  sendAppeal: "Отправить обращение",
  askAi: "Спросить AI",
  inviteFriend: "Пригласить друга",
};

/** Defaults as Bot API styles (was HEX; migrated on read). */
export const DEFAULT_TELEGRAM_BUTTON_COLORS: Record<TelegramColoredButtonKey, TelegramInlineButtonStyle> = {
  menuHome: "primary",
  menuSubscription: "primary",
  menuPay: "success",
  menuBuyGb: "primary",
  menuBuyDevice: "primary",
  menuAdminClients: "primary",
  deleteSubscription: "danger",
  createNewSubscription: "success",
  pickSubscription: "primary",
  comboOffer: "primary",
  applyPromo: "primary",
  buyWhitelist: "success",
  sendAppeal: "success",
  askAi: "primary",
  inviteFriend: "primary",
};

export type TelegramButtonColors = Record<TelegramColoredButtonKey, TelegramInlineButtonStyle>;

const STYLE_SET = new Set<string>(["primary", "success", "danger"]);

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = (hex.startsWith("#") ? hex.slice(1) : hex).toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Map legacy HEX (or any string) to Telegram Bot API style. */
export function telegramStyleFromHex(hex: string): TelegramInlineButtonStyle {
  const raw = String(hex ?? "").trim();
  if (STYLE_SET.has(raw)) return raw as TelegramInlineButtonStyle;
  const withHash = raw.startsWith("#") ? raw : raw ? `#${raw}` : "";
  if (!HEX_RE.test(withHash)) return "primary";
  const rgb = parseRgb(withHash);
  if (!rgb) return "primary";
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 18) return "primary";
  if (g >= r * 1.08 && g >= b * 1.08) return "success";
  if (r >= g * 1.05 && r >= b * 0.85) return "danger";
  if (b >= r * 1.05 && b >= g * 1.05) return "primary";
  return "primary";
}

export function normalizeTelegramButtonStyle(
  raw: unknown,
  fallback: TelegramInlineButtonStyle,
): TelegramInlineButtonStyle {
  const s = String(raw ?? "").trim().toLowerCase();
  if (STYLE_SET.has(s)) return s as TelegramInlineButtonStyle;
  if (HEX_RE.test(s.startsWith("#") ? s : s ? `#${s}` : "")) return telegramStyleFromHex(s);
  return fallback;
}

export function normalizeTelegramButtonColors(
  raw: Partial<Record<TelegramColoredButtonKey, unknown>> | null | undefined,
): TelegramButtonColors {
  const out = { ...DEFAULT_TELEGRAM_BUTTON_COLORS };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULT_TELEGRAM_BUTTON_COLORS) as TelegramColoredButtonKey[]) {
    if (raw[key] != null) out[key] = normalizeTelegramButtonStyle(raw[key], out[key]);
  }
  return out;
}

function styleForKey(key: TelegramColoredButtonKey): TelegramInlineButtonStyle {
  const settings = getPanelSettings().telegram.buttonColors;
  return settings[key] ?? DEFAULT_TELEGRAM_BUTTON_COLORS[key];
}

export function inlineBtn(text: string, callback_data: string, colorKey: TelegramColoredButtonKey): StyledInlineButton {
  return { text, callback_data, style: styleForKey(colorKey) };
}

/** Inline-кнопка без Telegram style (нейтральный цвет клиента). */
export function inlineBtnPlain(text: string, callback_data: string): StyledInlineButton {
  return { text, callback_data };
}
