import type { UserRow } from "../db.js";
import { userHasActiveSubscription } from "../db.js";
import { subscriptionDeviceInfoForWebApp } from "../deviceLimitWebApp.js";
import { escHtml, formatDaysRu, subscriptionPublicName } from "./format.js";
import { getWhitelistAccessState } from "../whitelistVaultDb.js";

function escUrlForCode(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatMainSubscriptionUntil(u: UserRow): string {
  if (!u.expiry_time) return "без срока";
  return new Date(u.expiry_time).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatWhitelistUntil(expiresAtMs: number | null): string {
  if (expiresAtMs == null) return "без срока";
  return new Date(expiresAtMs).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function remainingDays(user: UserRow): number | null {
  if (!user.expiry_time || user.expiry_time <= 0) return null;
  const leftMs = Number(user.expiry_time) - Date.now();
  if (leftMs <= 0) return 0;
  return Math.max(1, Math.ceil(leftMs / 86400000));
}

function remainingGb(user: UserRow): number | null {
  if (Number(user.total_gb) <= 0) return null;
  const usedBytes = Math.max(0, Number(user.traffic_up) + Number(user.traffic_down));
  const usedGb = usedBytes / (1024 * 1024 * 1024);
  return Math.max(0, Math.round((Number(user.total_gb) - usedGb) * 100) / 100);
}

/** Сообщение бота: ссылка, срок основной подписки и белые списки. */
export function formatBotSubscriptionInfoHtml(user: UserRow, subscriptionUrl: string): string {
  const title = escHtml(subscriptionPublicName(user));
  const mainActive = userHasActiveSubscription(user);
  const leftDays = remainingDays(user);
  const leftGb = remainingGb(user);
  const wl = getWhitelistAccessState(user);

  const lines: string[] = [
    `<b>${title}</b>`,
    "",
    "<b>🔗 Ссылка на подписку:</b>",
    `<code>${escUrlForCode(subscriptionUrl)}</code>`,
    "",
    "<b>📅 Основная подписка</b>",
  ];

  if (mainActive) {
    const daysText = leftDays == null ? "безлимит" : formatDaysRu(leftDays);
    const gbText = leftGb == null ? "∞ ГБ" : `${leftGb.toFixed(2)} ГБ`;
    lines.push(`✅ Активна`);
    lines.push(`Осталось по сроку: <b>${escHtml(daysText)}</b>`);
    lines.push(`Осталось трафика: <b>${escHtml(gbText)}</b>`);
  } else if (user.expiry_time > 0) {
    lines.push("⛔ Неактивна");
    lines.push("Осталось по сроку: <b>0 дней</b>");
    if (leftGb != null) {
      lines.push(`Осталось трафика: <b>${escHtml(leftGb.toFixed(2))} ГБ</b>`);
    } else {
      lines.push("Осталось трафика: <b>∞ ГБ</b>");
    }
  } else {
    lines.push("⛔ Неактивна · отключена");
  }

  const devices = subscriptionDeviceInfoForWebApp(user);
  if (devices.enabled) {
    lines.push(`📱 Устройства: <b>${devices.used} из ${devices.limit}</b>`);
    if (devices.over_limit > 0) {
      lines.push(`⚠️ Отключено сверх лимита: <b>${devices.over_limit}</b>`);
    }
  }

  if (wl.status !== "none") {
    lines.push("", "<b>⬜ Белые списки</b>");
    if (wl.status === "active") {
      lines.push(`✅ Активны · до <b>${escHtml(formatWhitelistUntil(wl.expires_at_ms))}</b>`);
      if (wl.remaining_days != null) {
        lines.push(`Осталось: <b>${escHtml(formatDaysRu(wl.remaining_days))}</b>`);
      }
    } else if (wl.status === "suspended") {
      lines.push("⏸ <b>Приостановлены</b>");
      if (wl.expires_at_ms != null) {
        lines.push(`Оплаченный период до <b>${escHtml(formatWhitelistUntil(wl.expires_at_ms))}</b>`);
      }
      if (wl.remaining_days != null && wl.remaining_days > 0) {
        lines.push(`Осталось: <b>${escHtml(formatDaysRu(wl.remaining_days))}</b>`);
      }
      lines.push(
        "Для продолжения белых списков нужна <b>активная основная подписка</b> — продлите VPN, затем обновите подписку в приложении.",
      );
    } else {
      lines.push(`⛔ Истекли${wl.expires_at_ms ? ` · ${escHtml(formatWhitelistUntil(wl.expires_at_ms))}` : ""}`);
    }
  }

  return lines.join("\n");
}
