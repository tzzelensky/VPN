import type { UserRow } from "../db.js";
import { userHasActiveSubscription } from "../db.js";
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

/** Сообщение бота: ссылка, срок основной подписки и белые списки. */
export function formatBotSubscriptionInfoHtml(user: UserRow, subscriptionUrl: string): string {
  const title = escHtml(subscriptionPublicName(user));
  const mainActive = userHasActiveSubscription(user);
  const mainUntil = formatMainSubscriptionUntil(user);
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
    lines.push(`✅ Активна · до <b>${escHtml(mainUntil)}</b>`);
  } else if (user.expiry_time > 0) {
    lines.push(`⛔ Неактивна · истекла <b>${escHtml(mainUntil)}</b>`);
  } else {
    lines.push("⛔ Неактивна · отключена");
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
