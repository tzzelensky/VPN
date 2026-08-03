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

export const DEFAULT_TELEGRAM_BUTTON_COLORS: Record<TelegramColoredButtonKey, string> = {
  menuHome: "#3390EC",
  menuSubscription: "#3390EC",
  menuPay: "#43A047",
  menuBuyGb: "#3390EC",
  menuBuyDevice: "#3390EC",
  menuAdminClients: "#3390EC",
  deleteSubscription: "#E53935",
  createNewSubscription: "#43A047",
  pickSubscription: "#3390EC",
  comboOffer: "#E91E8C",
  applyPromo: "#3390EC",
  buyWhitelist: "#43A047",
  sendAppeal: "#43A047",
  askAi: "#7B61FF",
  inviteFriend: "#3390EC",
};

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

export function normalizeTelegramButtonHex(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").trim();
  const withHash = s.startsWith("#") ? s : s ? `#${s}` : "";
  if (HEX_RE.test(withHash)) return withHash.toLowerCase();
  return fallback.toLowerCase();
}

export function normalizeTelegramButtonColors(
  raw: Partial<Record<TelegramColoredButtonKey, unknown>> | null | undefined,
): Record<TelegramColoredButtonKey, string> {
  const out = { ...DEFAULT_TELEGRAM_BUTTON_COLORS };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULT_TELEGRAM_BUTTON_COLORS) as TelegramColoredButtonKey[]) {
    if (raw[key] != null) out[key] = normalizeTelegramButtonHex(raw[key], out[key]);
  }
  return out;
}

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = normalizeTelegramButtonHex(hex, "#000000").slice(1);
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Telegram Bot API: только primary (синий), success (зелёный), danger (красный). */
export function telegramStyleFromHex(hex: string): TelegramInlineButtonStyle {
  const rgb = parseRgb(hex);
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

function colorForKey(key: TelegramColoredButtonKey): string {
  const settings = getPanelSettings().telegram.buttonColors;
  return settings[key] ?? DEFAULT_TELEGRAM_BUTTON_COLORS[key];
}

export function inlineBtn(text: string, callback_data: string, colorKey: TelegramColoredButtonKey): StyledInlineButton {
  const hex = colorForKey(colorKey);
  return { text, callback_data, style: telegramStyleFromHex(hex) };
}

/** Inline-кнопка без Telegram style (нейтральный цвет клиента). */
export function inlineBtnPlain(text: string, callback_data: string): StyledInlineButton {
  return { text, callback_data };
}
