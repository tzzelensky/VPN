import { findUsersByTelegramChatId, type UserRow } from "./db.js";
import { getDeviceLimitSettings } from "./deviceLimitStore.js";

export function isDeviceLimitGloballyEnabled(): boolean {
  return getDeviceLimitSettings().enabled;
}

/** Лимит активен, если включена функция и подписка попадает в выбранный охват. */
export function isDeviceLimitActiveForUser(user: {
  device_limit_enabled?: number;
  is_test_subscription?: number;
}): boolean {
  const settings = getDeviceLimitSettings();
  if (!settings.enabled) return false;
  if (user.is_test_subscription === 1) return false;
  if (settings.limit_scope === "all") return true;
  return user.device_limit_enabled === 1;
}

export function checkDeviceSlotPurchaseAllowed(user: UserRow): { ok: boolean; message: string } {
  const dl = getDeviceLimitSettings();
  if (!dl.enabled) {
    return { ok: false, message: "<b>Лимит устройств отключён</b> в настройках панели." };
  }
  if (!isDeviceLimitActiveForUser(user)) {
    return { ok: false, message: "<b>Лимит устройств не включён</b> для этой подписки." };
  }
  if (!dl.purchase_enabled) {
    return { ok: false, message: "<b>Докупка устройств сейчас недоступна.</b>" };
  }
  const extra = Math.max(0, Math.floor(Number(user.device_extra_slots) || 0));
  if (extra >= dl.purchase_max_extra) {
    return { ok: false, message: "<b>Достигнут максимум дополнительных устройств.</b>" };
  }
  if (user.enable !== 1) {
    return { ok: false, message: "<b>Подписка неактивна.</b>" };
  }
  return { ok: true, message: "" };
}

export function tgUserCanBuyDeviceSlot(tgUserId: number): boolean {
  const dl = getDeviceLimitSettings();
  if (!dl.purchase_enabled || !dl.enabled) return false;
  return findUsersByTelegramChatId(tgUserId).some((u) => checkDeviceSlotPurchaseAllowed(u).ok);
}

export function deviceLimitCalcSettingsForUser(
  user: Pick<UserRow, "device_limit_enabled"> & { is_test_subscription?: number },
): { enabled: true; default_slots: number } | undefined {
  if (!isDeviceLimitActiveForUser(user)) return undefined;
  const settings = getDeviceLimitSettings();
  return { enabled: true, default_slots: settings.default_slots };
}
