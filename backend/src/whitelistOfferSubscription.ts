import type { UserRow } from "./db.js";
import { getPanelSettings } from "./panelSettings.js";
import { DEFAULT_WHITELIST_OFFER_TEXT } from "./panelSettingsTypes.js";
import { countryFlagEmoji } from "./serverDisplay.js";
import { buildNoticeVlessUri } from "./vlessLink.js";
import { getWhitelistPurchasePriceRub } from "./whitelistPurchaseService.js";
import { getWhitelistAccessState } from "./whitelistVaultDb.js";

export function formatWhitelistOfferText(template: string, priceRub: number): string {
  const price = String(Math.max(0, Math.floor(Number(priceRub) || 0)));
  const raw = String(template ?? "").trim() || DEFAULT_WHITELIST_OFFER_TEXT;
  return raw.replaceAll("{price}", price).replaceAll("{n}", price);
}

export function buildWhitelistOfferRemark(text: string): string {
  const flag = countryFlagEmoji("RU");
  const body = String(text ?? "").trim() || DEFAULT_WHITELIST_OFFER_TEXT;
  const remark = flag ? `${flag} ${body}` : body;
  return [...remark].slice(0, 120).join("");
}

export function shouldShowWhitelistOffer(enabled: boolean, accessStatus: string): boolean {
  return enabled === true && accessStatus !== "active";
}

export function buildWhitelistOfferNoticeUri(template: string, priceRub: number): string {
  const text = formatWhitelistOfferText(template, priceRub);
  return buildNoticeVlessUri(buildWhitelistOfferRemark(text));
}

/** Фейковый узел-реклама БС; null если свитч выкл или у пользователя уже активные белые списки. */
export function whitelistOfferNoticeUriForUser(user: UserRow): string | null {
  const offer = getPanelSettings().panel.whitelistOffer;
  if (!shouldShowWhitelistOffer(offer?.enabled === true, getWhitelistAccessState(user).status)) {
    return null;
  }
  return buildWhitelistOfferNoticeUri(offer?.text || DEFAULT_WHITELIST_OFFER_TEXT, getWhitelistPurchasePriceRub());
}
