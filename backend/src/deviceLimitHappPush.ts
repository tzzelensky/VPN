import type { UserRow } from "./db.js";
import { deviceLimitCalcSettingsForUser, isDeviceLimitActiveForUser } from "./deviceLimitEffective.js";
import {
  activeDeviceSlots,
  allowedDeviceSlots,
  reconcileUserDeviceSlots,
  userDeviceTotalLimit,
} from "./userDeviceSlots.js";

export type DeviceLimitPressure = {
  active: boolean;
  used: number;
  limit: number;
  overLimit: number;
  denied: boolean;
  message: string;
  buttonText: string;
  buttonLink: string;
  profileSuffix: string;
};

function botDeepLink(): string {
  const bot = (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  if (bot) return `https://t.me/${bot}`;
  const webapp = (process.env.TELEGRAM_WEBAPP_URL ?? "").trim();
  return webapp || "";
}

export function getDeviceLimitSubscriptionPressure(
  user: UserRow,
  ctx?: { denied?: boolean; reason?: string },
): DeviceLimitPressure | null {
  if (!isDeviceLimitActiveForUser(user)) return null;

  const slots = reconcileUserDeviceSlots(user);
  const active = activeDeviceSlots(slots);
  const allowed = allowedDeviceSlots(slots);
  const calc = deviceLimitCalcSettingsForUser(user);
  const limit = userDeviceTotalLimit(user, calc);
  const used = allowed.length;
  const overLimit = Math.max(0, active.length - allowed.length);
  const denied = ctx?.denied === true;

  if (!denied && overLimit === 0) return null;

  const buttonLink = botDeepLink();
  let message = "";
  if (denied || ctx?.reason === "limit_reached" || ctx?.reason === "over_limit") {
    message = `Лимит устройств исчерпан: ${used} из ${limit}. Откройте HSN VPN и докупите место.`;
  } else if (overLimit > 0) {
    message = `Лимит снижен до ${limit}. Отключено устройств: ${overLimit}. Удалите лишние или докупите место.`;
  } else {
    // Защитный fallback: без denied/over_limit сюда почти не попадаем.
    message = `Лимит устройств: ${used}/${limit}.`;
  }

  return {
    active: true,
    used,
    limit,
    overLimit,
    denied,
    message: message.slice(0, 200),
    buttonText: "Добавить место",
    buttonLink,
    profileSuffix: denied || overLimit > 0 ? ` · лимит ${used}/${limit}` : ` · ${used}/${limit} устр.`,
  };
}

export function happDirectivesForDeviceLimitPressure(pressure: DeviceLimitPressure): string[] {
  const lines = [
    `#announce: base64:${Buffer.from(pressure.message, "utf8").toString("base64")}`,
    `#sub-info-color: red`,
    `#sub-info-text: ${pressure.message}`,
  ];
  if (pressure.buttonLink) {
    lines.push(`#sub-info-button-text: ${pressure.buttonText}`);
    lines.push(`#sub-info-button-link: ${pressure.buttonLink}`);
  }
  return lines;
}

/** Always-on directives for Happ: force subscription refresh on app open. */
export function happBaseDirectivesForDeviceLimit(): string[] {
  return [
    "#profile-update-interval: 1",
    "#subscription-auto-update-enable: 1",
    "#subscription-auto-update-open-enable: 1",
  ];
}

/** Строка «Устройства: X/Y» для Happ sub-info. */
export function happDeviceUsageSubInfoLine(user: UserRow): string | null {
  if (!isDeviceLimitActiveForUser(user)) return null;
  const slots = reconcileUserDeviceSlots(user);
  const used = allowedDeviceSlots(slots).length;
  const calc = deviceLimitCalcSettingsForUser(user);
  const limit = userDeviceTotalLimit(user, calc);
  return `Устройства: ${used}/${limit}`;
}

/** Neutral usage hint for Happ when limit is active. */
export function happUsageDirectivesForDeviceLimit(user: UserRow): string[] {
  const line = happDeviceUsageSubInfoLine(user);
  if (!line) return [];
  return ["#sub-info-color: blue", `#sub-info-text: ${line}`];
}
