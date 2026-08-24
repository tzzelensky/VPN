/**
 * Запуск: npx tsx src/subscriptionMask.test.ts
 */
import { referralBrandLabel } from "./referralInviteText.js";
import { normalizeDecoyShop, DEFAULT_DECOY_SHOP } from "./panelSettingsTypes.js";
import { buildSubscriptionNoticePayload } from "./vlessLink.js";
import { buildSubscriptionDecoyHtml } from "./subscriptionLanding.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(referralBrandLabel("") === "Сервис", "empty brand → Сервис");
assert(referralBrandLabel("HSN") === "Сервис", "HSN → Сервис");
assert(referralBrandLabel("hsn") === "Сервис", "hsn → Сервис");
assert(referralBrandLabel("MyBrand") === "MyBrand", "custom brand kept");

const shop = normalizeDecoyShop(null);
assert(shop.brand === DEFAULT_DECOY_SHOP.brand, "default decoy brand");
assert(shop.items.length >= 1, "default decoy items");

const custom = normalizeDecoyShop({
  brand: "TestShop",
  title: "T",
  tagline: "tag",
  intro: ["a", "b"],
  items: [{ name: "X", description: "Y", price: "1" }],
  note: "n",
  footer: "f",
});
assert(custom.brand === "TestShop", "custom decoy brand");
assert(custom.items[0]?.name === "X", "custom decoy item");

const b64 = buildSubscriptionNoticePayload(["Лимит устройств"]);
const decoded = Buffer.from(b64, "base64").toString("utf8");
assert(!/#VPN\b/i.test(decoded), "notice payload must not use #VPN");
assert(decoded.includes("vless://"), "notice still vless stub");

const html = buildSubscriptionDecoyHtml();
assert(html.includes('href="/domcomfort-tab.png?v=200"'), "decoy html has uncached tab icon");
assert(html.includes('src="/domcomfort-icon.png"'), "decoy html has round brand avatar");
assert(html.includes('class="brand-mark"'), "decoy html has round avatar class");

console.log("subscriptionMask.test.ts: ok");
