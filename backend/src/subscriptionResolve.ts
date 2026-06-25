import { userAllowedOnServers, type UserRow } from "./db.js";
import { getDeviceLimitSettings } from "./deviceLimitStore.js";
import { isDeviceLimitActiveForUser } from "./deviceLimitEffective.js";
import {
  allowedDeviceSlots,
  deviceLimitNoticeLines,
  reconcileUserDeviceSlots,
} from "./userDeviceSlots.js";
import { subscriptionVlessLinksForUser } from "./subscriptionLinks.js";
import { buildSubscriptionNoticePayload, buildSubscriptionPayload } from "./vlessLink.js";
import {
  getDeviceLimitSubscriptionPressure,
  happDirectivesForDeviceLimitPressure,
  happBaseDirectivesForDeviceLimit,
  happUsageDirectivesForDeviceLimit,
  type DeviceLimitPressure,
} from "./deviceLimitHappPush.js";
import { happDirectivesForSubscriptionBanner, happBaseDirectivesForSubscriptionBanner } from "./subscriptionBannerHapp.js";

export type SubscriptionResolveContext = {
  /** false = превью в панели, лимит устройств не применяем */
  apply_device_limit?: boolean;
  /** true = это устройство не в списке разрешённых / слоты заняты */
  device_limit_denied?: boolean;
  device_limit_registered?: number;
  device_limit_reason?: string;
  device_limit_pressure?: DeviceLimitPressure | null;
};

export function resolveSubscriptionBase64(user: UserRow, ctx?: SubscriptionResolveContext): string {
  if (!userAllowedOnServers(user)) {
    return buildSubscriptionPayload([]);
  }
  const deviceLimitActive = isDeviceLimitActiveForUser(user);
  const applyLimit = ctx?.apply_device_limit !== false && isDeviceLimitActiveForUser(user);
  const pressure =
    ctx?.device_limit_pressure ??
    getDeviceLimitSubscriptionPressure(user, {
      denied: ctx?.device_limit_denied,
      reason: ctx?.device_limit_reason,
    });
  const bannerDirectives = happDirectivesForSubscriptionBanner(user);
  const bannerBaseDirectives = happBaseDirectivesForSubscriptionBanner();
  const baseDirectives = deviceLimitActive
    ? [...happBaseDirectivesForDeviceLimit(), ...bannerBaseDirectives]
    : bannerBaseDirectives.length
      ? bannerBaseDirectives
      : undefined;
  const usageDirectives =
    deviceLimitActive && bannerDirectives.length === 0
      ? happUsageDirectivesForDeviceLimit(user)
      : undefined;
  let happDirectives: string[] | undefined;
  if (pressure?.active && baseDirectives) {
    happDirectives = [
      ...baseDirectives,
      ...(usageDirectives ?? []),
      ...bannerDirectives,
      ...happDirectivesForDeviceLimitPressure(pressure),
    ];
  } else if (pressure?.active) {
    happDirectives = [...bannerDirectives, ...happDirectivesForDeviceLimitPressure(pressure)];
  } else if (baseDirectives) {
    happDirectives = [...baseDirectives, ...(usageDirectives ?? []), ...bannerDirectives];
  } else if (bannerDirectives.length) {
    happDirectives = bannerDirectives;
  } else if (usageDirectives?.length) {
    happDirectives = usageDirectives;
  }

  if (applyLimit && ctx?.device_limit_denied) {
    const settings = getDeviceLimitSettings();
    const registered =
      ctx.device_limit_registered ?? allowedDeviceSlots(reconcileUserDeviceSlots(user)).length;
    if (settings.on_limit_exceeded === "empty") {
      return buildSubscriptionPayload([], { happDirectives });
    }
    return buildSubscriptionNoticePayload(deviceLimitNoticeLines(user, registered, settings), { happDirectives });
  }
  const links = subscriptionVlessLinksForUser(user);
  return buildSubscriptionPayload(links, { happDirectives });
}

export function resolveSubscriptionLinks(user: UserRow, ctx?: SubscriptionResolveContext): string[] {
  if (!userAllowedOnServers(user)) return [];
  const applyLimit = ctx?.apply_device_limit !== false && isDeviceLimitActiveForUser(user);
  if (applyLimit && ctx?.device_limit_denied) return [];
  return subscriptionVlessLinksForUser(user);
}
