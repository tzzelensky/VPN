import type { UserRow } from "./db.js";
import { activeDeviceSlots, allowedDeviceSlots, reconcileUserDeviceSlots, userDeviceTotalLimit } from "./userDeviceSlots.js";
import { getDeviceLimitSettings } from "./deviceLimitStore.js";
import { isDeviceLimitActiveForUser, deviceLimitCalcSettingsForUser } from "./deviceLimitEffective.js";
import { deviceTypeIcon } from "./deviceNameFromUa.js";
import { publicSubUrl } from "./subscriptionUrl.js";

export function deviceLimitCalcSettings(
  settings: { enabled: boolean; default_slots: number },
  user: Pick<UserRow, "device_limit_enabled">,
): { enabled: true; default_slots: number } | undefined {
  if (!isDeviceLimitActiveForUser(user)) return undefined;
  return { enabled: true, default_slots: settings.default_slots };
}

export function subscriptionDeviceInfoForWebApp(u: UserRow) {
  const settings = getDeviceLimitSettings();
  const slots = reconcileUserDeviceSlots(u);
  const active = activeDeviceSlots(slots);
  const allowed = allowedDeviceSlots(slots);
  const extra = Math.max(0, Math.floor(Number(u.device_extra_slots) || 0));
  const userLimitOn = isDeviceLimitActiveForUser(u);
  const calcSettings = deviceLimitCalcSettingsForUser(u);
  const visible = userLimitOn;
  const limit = visible ? userDeviceTotalLimit(u, calcSettings) : 0;
  const overLimit = Math.max(0, active.length - allowed.length);
  const canBuy =
    visible &&
    settings.purchase_enabled &&
    extra < settings.purchase_max_extra &&
    u.enable === 1;
  return {
    enabled: visible,
    user_limit_enabled: userLimitOn,
    global_enabled: settings.enabled,
    used: allowed.length,
    limit,
    over_limit: overLimit,
    default_limit: settings.default_slots,
    extra_slots: extra,
    free_slots: Math.max(0, limit - allowed.length),
    can_buy_slot: canBuy,
    purchase_price_rub: settings.purchase_price_rub,
    purchase_max_extra: settings.purchase_max_extra,
    purchase_enabled: settings.purchase_enabled && userLimitOn,
    devices: visible
      ? active
          .sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
          .map((d) => ({
            id: d.id,
            device_name: d.device_name || d.label,
            device_type: d.device_type,
            device_icon: deviceTypeIcon(d.device_type),
            last_seen_at: d.last_seen_at,
            last_ip: d.last_ip,
            subscription_url: publicSubUrl(u.sub_token, d.id),
            status: d.blocked === 1 ? ("over_limit" as const) : ("active" as const),
          }))
      : [],
  };
}

export function deviceLimitSettingsForWebApp() {
  const s = getDeviceLimitSettings();
  return {
    enabled: s.enabled,
    purchase_enabled: s.purchase_enabled,
    purchase_price_rub: s.purchase_price_rub,
    purchase_max_extra: s.purchase_max_extra,
    default_slots: s.default_slots,
  };
}
