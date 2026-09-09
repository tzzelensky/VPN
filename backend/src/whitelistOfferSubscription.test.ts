/**
 * Запуск: npx tsx src/whitelistOfferSubscription.test.ts
 */
import { countryFlagEmoji } from "./serverDisplay.js";
import { shareLinkToHappProfile } from "./happSubscriptionJson.js";
import {
  buildWhitelistOfferNoticeUri,
  buildWhitelistOfferRemark,
  formatWhitelistOfferText,
  shouldShowWhitelistOffer,
} from "./whitelistOfferSubscription.js";
import { DEFAULT_WHITELIST_OFFER_TEXT } from "./panelSettingsTypes.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  formatWhitelistOfferText(DEFAULT_WHITELIST_OFFER_TEXT, 199) ===
    "Подключи обход глушилок всего за 199 рублей!",
  "default template substitutes {price}",
);
assert(
  formatWhitelistOfferText("Обход глушилок за {n} ₽", 80) === "Обход глушилок за 80 ₽",
  "{n} substitutes price",
);

const ru = countryFlagEmoji("RU");
assert(ru === "🇷🇺", "RU flag emoji");
assert(
  buildWhitelistOfferRemark("Подключи обход глушилок всего за 199 рублей!").startsWith(`${ru} `),
  "remark starts with RU flag",
);
assert(
  buildWhitelistOfferRemark("Подключи обход глушилок всего за 199 рублей!").includes("199"),
  "remark keeps price",
);

const uri = buildWhitelistOfferNoticeUri(DEFAULT_WHITELIST_OFFER_TEXT, 250);
assert(uri.startsWith("vless://"), "notice is vless stub");
assert(uri.includes("127.0.0.1"), "notice is local stub");
const decoded = decodeURIComponent(uri.split("#")[1] ?? "");
assert(decoded.startsWith(`${ru} `), "URI fragment has RU flag");
assert(decoded.includes("250"), "URI fragment has current BS price");
assert(!decoded.includes("{price}"), "placeholder is replaced");

const happ = shareLinkToHappProfile(uri);
assert(happ != null, "Happ profile from notice URI");
assert(String(happ?.remarks ?? "").startsWith(`${ru} `), "Happ remarks have RU flag");
assert(String(happ?.remarks ?? "").includes("250"), "Happ remarks have price");

assert(shouldShowWhitelistOffer(true, "none") === true, "show when enabled and no BS");
assert(shouldShowWhitelistOffer(true, "expired") === true, "show when BS expired");
assert(shouldShowWhitelistOffer(true, "active") === false, "hide when BS already active");
assert(shouldShowWhitelistOffer(false, "none") === false, "hide when switch off");

console.log("whitelistOfferSubscription.test.ts: ok");
