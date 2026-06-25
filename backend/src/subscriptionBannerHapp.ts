import { getPanelSettings } from "./panelSettings.js";
import type { PanelSubscriptionBanner } from "./panelSettingsTypes.js";
import type { UserRow } from "./db.js";
import { happDeviceUsageSubInfoLine } from "./deviceLimitHappPush.js";

function normalizeTelegramUrl(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("@")) return `https://t.me/${s.slice(1)}`;
  if (/^t\.me\//i.test(s)) return `https://${s}`;
  return s;
}

export function getSubscriptionBannerSettings(): PanelSubscriptionBanner {
  return getPanelSettings().panel.subscriptionBanner;
}

/** Happ / v2rayTun: #announce и кнопка под текстом подписки. */
export function happDirectivesForSubscriptionBanner(user?: UserRow): string[] {
  const b = getSubscriptionBannerSettings();
  if (!b?.enabled) return [];

  const text = String(b.text ?? "").trim();
  const tgUrl = normalizeTelegramUrl(b.telegramUrl);
  const linkLabel = String(b.telegramLinkText ?? "").trim() || "тех. поддержку";
  const deviceLine = user ? happDeviceUsageSubInfoLine(user) : null;
  const bannerLine = text.replace(/\s+/g, " ").trim();

  if (!bannerLine && !tgUrl && !deviceLine) return [];

  const lines: string[] = [];
  const subInfoParts = [deviceLine, bannerLine].filter(Boolean);
  const subInfoText = subInfoParts.join("\n").slice(0, 200);
  if (subInfoText) {
    if (bannerLine) {
      lines.push(`#announce: base64:${Buffer.from(text, "utf8").toString("base64")}`);
    }
    lines.push("#sub-info-color: blue");
    lines.push(`#sub-info-text: ${subInfoText}`);
  }
  if (tgUrl) {
    lines.push(`#sub-info-button-text: ${linkLabel.slice(0, 25)}`);
    lines.push(`#sub-info-button-link: ${tgUrl}`);
  }
  return lines;
}

/** Подписка на телефонах часто не обновляется вручную — форсируем refresh при открытии Happ. */
export function happBaseDirectivesForSubscriptionBanner(): string[] {
  if (!getSubscriptionBannerSettings()?.enabled) return [];
  return [
    "#profile-update-interval: 1",
    "#subscription-auto-update-enable: 1",
    "#subscription-auto-update-open-enable: 1",
  ];
}

export function subscriptionBannerAnnounceHeader(): string | null {
  const b = getSubscriptionBannerSettings();
  if (!b?.enabled) return null;
  const text = String(b.text ?? "").trim();
  if (!text) return null;
  return `base64:${Buffer.from(text, "utf8").toString("base64")}`;
}
