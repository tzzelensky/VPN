import { subscriptionVaultUrisForUser } from "./configVaultDb.js";
import { parseProxyUri } from "./configVaultUri.js";
import { getWhitelistAccessState, subscriptionWhitelistUrisForUser } from "./whitelistVaultDb.js";
import { getServerSubscriptionSettings, serversForUserSubscription, userHasActiveSubscription, type ServerRow, type UserRow } from "./db.js";
import { HAPP_WHITELIST_SUBSCRIPTION_LINE } from "./happWhitelistLine.js";
import { buildVlessUriFromSubscriptionSettings } from "./vlessLink.js";

function vlessUriForRow(user: UserRow, r: ServerRow): string {
  const settings = getServerSubscriptionSettings(r);
  return buildVlessUriFromSubscriptionSettings(r, user, settings);
}

/** Ключ для дедупликации: один host+port+uuid = одна строка (фрагмент #… не учитываем). */
function subscriptionUriIdentityKey(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("happ://")) return lower;
  const parsed = parseProxyUri(trimmed);
  if (parsed) {
    const net = (parsed.network || "tcp").toLowerCase();
    return `${net}:${parsed.uuid.toLowerCase()}@${parsed.address.toLowerCase()}:${parsed.port}`;
  }
  return lower;
}

function appendUniqueSubscriptionUris(out: string[], seen: Set<string>, uris: string[]): void {
  for (const raw of uris) {
    const uri = raw.trim();
    const key = subscriptionUriIdentityKey(uri);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(uri);
  }
}

/**
 * Одна строка VLESS на каждый выбранный развёрнутый узел (subscription_server_ids).
 * При whitelist_happ_enabled в конец добавляется строка happ://… (конфиг белых списков для Happ).
 * Дубликаты по одному endpoint (в т.ч. tail и ключи vault) отбрасываются.
 */
export function subscriptionVlessLinksForUser(user: UserRow): string[] {
  const rows = serversForUserSubscription(user);
  const seen = new Set<string>();
  const out: string[] = [];

  appendUniqueSubscriptionUris(
    out,
    seen,
    rows.map((r) => vlessUriForRow(user, r)),
  );

  const extras = (user.extra_vless_links ?? []).map((x) => x.uri.trim()).filter(Boolean);
  const vault = subscriptionVaultUrisForUser(user);
  const whitelist = subscriptionWhitelistUrisForUser(user);
  appendUniqueSubscriptionUris(out, seen, [...extras, ...vault, ...whitelist]);

  if (user.whitelist_happ_enabled !== 1) return out;
  if (!userHasActiveSubscription(user) || getWhitelistAccessState(user).status !== "active") return out;

  const tail = rows.length ? rows.slice(-4) : [];
  appendUniqueSubscriptionUris(
    out,
    seen,
    tail.map((r) => vlessUriForRow(user, r)),
  );

  const happ = HAPP_WHITELIST_SUBSCRIPTION_LINE.trim();
  if (happ) appendUniqueSubscriptionUris(out, seen, [happ]);

  return out;
}
