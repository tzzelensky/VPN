import type { Response } from "express";
import type { UserRow } from "./db.js";
import type { DeviceLimitPressure } from "./deviceLimitHappPush.js";
import { isDeviceLimitActiveForUser } from "./deviceLimitEffective.js";
import { allowedDeviceSlots, reconcileUserDeviceSlots, userDeviceTotalLimit } from "./userDeviceSlots.js";
import { subscriptionBannerAnnounceHeader, getSubscriptionBannerSettings } from "./subscriptionBannerHapp.js";

type UnlimitedTotalMode = "zero" | "omit" | "maxsafe";
const unlimitedMode = (
  (process.env.SUBSCRIPTION_UNLIMITED_TOTAL_MODE ?? "zero").trim().toLowerCase() as UnlimitedTotalMode
);
const TOTAL_UNLIMITED_PLACEHOLDER = 9_007_199_254_740_991; // Number.MAX_SAFE_INTEGER
const monotonicUsageByToken = new Map<string, { up: number; down: number }>();

export function clearSubscriptionUsageMonotonic(user: Pick<UserRow, "id" | "sub_token">): void {
  const key = String(user.sub_token ?? "").trim() || String(user.id);
  monotonicUsageByToken.delete(key);
}

/**
 * Заголовки подписки (v2rayN, v2RayTun, Clash-семейство и др.):
 * - subscription-userinfo — `upload=…; download=…; total=…; expire=…` (пробел после `;`, expire в unix **секундах**).
 * - profile-title — подпись группы; при эмодзи — `base64:…`. Добавляем срок/лимит в заголовок — часть клиентов показывает только его.
 * - profile-update-interval — часы автообновления.
 *
 * @see https://docs.v2raytun.com/overview/supported-headers
 */
function profileTitleBase(user: UserRow): string {
  const base = (user.name || user.email || "VPN").trim();
  return base;
}

function ruExpirySnippet(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Базовое имя подписки + срок и лимит (чтобы в клиенте было видно даже при обрезании userinfo прокси). */
function profileTitleWithTrafficAndExpiry(user: UserRow): string {
  const base = profileTitleBase(user);
  const parts: string[] = [base];
  if (user.expiry_time > 0 && Number.isFinite(user.expiry_time)) {
    parts.push(`до ${ruExpirySnippet(user.expiry_time)}`);
  }
  if (user.total_gb > 0) {
    parts.push(`лимит ${user.total_gb} ГБ`);
  }
  const joined = parts.join(" · ");
  return joined.length <= 200 ? joined : joined.slice(0, 200);
}

export function setSubscriptionUserHeaders(
  res: Response,
  user: UserRow,
  opts?: { deviceLimitPressure?: DeviceLimitPressure | null },
): void {
  const rawUp = Math.max(0, Math.trunc(Number(user.traffic_up) || 0));
  const rawDown = Math.max(0, Math.trunc(Number(user.traffic_down) || 0));
  const key = String(user.sub_token ?? "").trim() || String(user.id);
  const prev = monotonicUsageByToken.get(key);
  const upload = prev ? Math.max(prev.up, rawUp) : rawUp;
  const download = prev ? Math.max(prev.down, rawDown) : rawDown;
  monotonicUsageByToken.set(key, { up: upload, down: download });

  let totalBytes: number | null = null;
  if (user.total_gb > 0) {
    totalBytes = Math.round(Number(user.total_gb) * 1073741824);
  } else {
    if (unlimitedMode === "maxsafe") totalBytes = TOTAL_UNLIMITED_PLACEHOLDER;
    else if (unlimitedMode === "zero") totalBytes = 0;
  }

  const expireSec =
    user.expiry_time > 0 && Number.isFinite(user.expiry_time)
      ? Math.floor(Number(user.expiry_time) / 1000)
      : 0;

  const parts = [`upload=${upload}`, `download=${download}`];
  if (totalBytes != null) parts.push(`total=${totalBytes}`);
  parts.push(`expire=${expireSec}`);
  const plain = parts.join("; ");
  res.setHeader("subscription-userinfo", plain);

  const rawTitle = profileTitleWithTrafficAndExpiry(user);
  const pressure = opts?.deviceLimitPressure;
  let titleWithLimit = rawTitle;
  if (isDeviceLimitActiveForUser(user)) {
    const slots = reconcileUserDeviceSlots(user);
    const used = allowedDeviceSlots(slots).length;
    const limit = userDeviceTotalLimit(user);
    titleWithLimit = `${rawTitle} · ${used}/${limit} устр.`;
  }
  if (pressure?.active) {
    titleWithLimit = `${rawTitle}${pressure.profileSuffix}`;
  }
  const nonAscii = [...titleWithLimit].some((c) => c.charCodeAt(0) > 127);
  if (nonAscii) {
    res.setHeader("profile-title", `base64:${Buffer.from(titleWithLimit, "utf8").toString("base64")}`);
  } else {
    res.setHeader("profile-title", titleWithLimit);
  }

  res.setHeader("profile-update-interval", pressure?.active ? "1" : "1");

  const deviceLimitActive = isDeviceLimitActiveForUser(user);
  const bannerActive = getSubscriptionBannerSettings()?.enabled === true;
  if (deviceLimitActive || bannerActive) {
    // Happ: автообновлять подписку при открытии приложения.
    res.setHeader("subscription-auto-update-open-enable", "1");
    // Чтобы клиент не зависел только от manual refresh, включаем обновления и по обычному расписанию.
    res.setHeader("subscription-auto-update-enable", "1");
  }

  if (pressure?.active) {
    res.setHeader("announce", `base64:${Buffer.from(pressure.message, "utf8").toString("base64")}`);
    res.setHeader("sub-info-color", "red");
    // NOTE: Node.js rejects non-latin1 chars in HTTP header values.
    // Pressure texts are UTF-8 (ru), so we pass them through Happ directives/announce only.
    // Keeping these headers unset prevents intermittent 500 on /sub/*:
    // "Invalid character in header content".
  } else {
    const bannerAnnounce = subscriptionBannerAnnounceHeader();
    if (bannerAnnounce) {
      res.setHeader("announce", bannerAnnounce);
    }
  }

  const exposed = [
    "subscription-userinfo",
    "profile-title",
    "profile-update-interval",
    "subscription-auto-update-enable",
    "subscription-auto-update-open-enable",
    "announce",
    "sub-info-color",
  ];
  res.setHeader("Access-Control-Expose-Headers", exposed.join(", "));
}
