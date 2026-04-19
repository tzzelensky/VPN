import type { Response } from "express";
import type { UserRow } from "./db.js";

/** Лимит «как безлимит» для клиентов, где total=0 ломает отображение или считается исчерпанием. */
const TOTAL_UNLIMITED_PLACEHOLDER = 9_007_199_254_740_991; // Number.MAX_SAFE_INTEGER

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
  const note = (user.comment || "").trim();
  if (!note || note === base) return base;
  const combined = `${base} · ${note}`;
  return combined.length <= 200 ? combined : combined.slice(0, 200);
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

export function setSubscriptionUserHeaders(res: Response, user: UserRow): void {
  const upload = Math.max(0, Math.trunc(Number(user.traffic_up) || 0));
  const download = Math.max(0, Math.trunc(Number(user.traffic_down) || 0));

  let totalBytes: number;
  if (user.total_gb > 0) {
    totalBytes = Math.round(Number(user.total_gb) * 1073741824);
  } else {
    totalBytes = TOTAL_UNLIMITED_PLACEHOLDER;
  }

  const expireSec =
    user.expiry_time > 0 && Number.isFinite(user.expiry_time)
      ? Math.floor(Number(user.expiry_time) / 1000)
      : 0;

  const plain = `upload=${upload}; download=${download}; total=${totalBytes}; expire=${expireSec}`;
  res.setHeader("subscription-userinfo", plain);

  const rawTitle = profileTitleWithTrafficAndExpiry(user);
  const nonAscii = [...rawTitle].some((c) => c.charCodeAt(0) > 127);
  if (nonAscii) {
    res.setHeader("profile-title", `base64:${Buffer.from(rawTitle, "utf8").toString("base64")}`);
  } else {
    res.setHeader("profile-title", rawTitle);
  }

  res.setHeader("profile-update-interval", "24");

  res.setHeader(
    "Access-Control-Expose-Headers",
    "subscription-userinfo, profile-title, profile-update-interval",
  );
}
