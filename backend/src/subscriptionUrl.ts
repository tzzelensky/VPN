/** Публичная ссылка подписки; при лимите устройств — с параметром did (UUID устройства). */
import { isDeviceLimitActiveForUser } from "./deviceLimitEffective.js";

export function publicSubUrl(subToken: string, deviceId?: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const token = encodeURIComponent(String(subToken ?? "").trim());
  const path = `${base}/sub/${token}`;
  const did = String(deviceId ?? "").trim();
  if (!did) return path;
  return `${path}?did=${encodeURIComponent(did)}`;
}

export function primaryDeviceId(user: {
  device_limit_enabled?: number;
  device_slots?: Array<{ id?: string }>;
}): string | undefined {
  if (!isDeviceLimitActiveForUser(user)) return undefined;
  const id = String(user.device_slots?.[0]?.id ?? "").trim();
  return id || undefined;
}

export function primarySubscriptionUrl(user: {
  sub_token: string;
  device_limit_enabled?: number;
  device_slots?: Array<{ id?: string }>;
}): string {
  return publicSubUrl(user.sub_token, primaryDeviceId(user));
}
