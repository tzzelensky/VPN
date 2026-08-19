import { buildHysteria2UriForUser } from "./hysteria2Link.js";
import { buildTrojanUriForUser } from "./trojanLink.js";
import { configVaultLinksForUser } from "./configVaultDb.js";
import {
  applyUserRemarkToProxyUri,
  defaultNameFromUri,
  isClientJsonProfileUri,
  parseProxyUri,
} from "./configVaultUri.js";
import {
  getWhitelistAccessState,
  subscriptionWhitelistEntriesForUser,
} from "./whitelistVaultDb.js";
import {
  getServerSubscriptionSettings,
  listDeployedServers,
  serversForUserSubscription,
  userHasActiveSubscription,
  type ServerRow,
  type UserRow,
} from "./db.js";
import { HAPP_WHITELIST_SUBSCRIPTION_LINE } from "./happWhitelistLine.js";
import { buildVlessUriFromSubscriptionSettings } from "./vlessLink.js";
import { resolveVpnDisplayEntryOrderForUser } from "./vpnDisplayCatalog.js";
import { parseVpnEntryKey } from "./vpnDisplayOrder.js";

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
 * Строки подписки в порядке vpnDisplay / subscription_entry_order:
 * vless, hy2, trojan, vault, whitelist + extras в конце + happ-хвост БС при необходимости.
 */
export function subscriptionVlessLinksForUser(user: UserRow): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const servers = new Map(listDeployedServers().map((s) => [s.id, s]));
  const vaultById = new Map(configVaultLinksForUser(user).map((x) => [x.vault_key_id, x]));
  const wlById = new Map(subscriptionWhitelistEntriesForUser(user).map((x) => [x.key_id, x]));
  const entryOrder = resolveVpnDisplayEntryOrderForUser(user);

  for (const key of entryOrder) {
    const p = parseVpnEntryKey(key);
    if (!p) continue;
    if (p.kind === "vless") {
      const row = servers.get(p.id);
      if (!row) continue;
      appendUniqueSubscriptionUris(out, seen, [vlessUriForRow(user, row)]);
      continue;
    }
    if (p.kind === "hy2") {
      const row = servers.get(p.id);
      if (!row || row.hysteria2_deployed !== 1 || row.hysteria2_in_subscriptions !== 1) continue;
      const uri = buildHysteria2UriForUser(row, user);
      if (uri) appendUniqueSubscriptionUris(out, seen, [uri]);
      continue;
    }
    if (p.kind === "trojan") {
      const row = servers.get(p.id);
      if (!row || row.trojan_deployed !== 1 || row.trojan_in_subscriptions !== 1) continue;
      const uri = buildTrojanUriForUser(row, user);
      if (uri) appendUniqueSubscriptionUris(out, seen, [uri]);
      continue;
    }
    if (p.kind === "vault") {
      const link = vaultById.get(p.id);
      if (link?.uri) appendUniqueSubscriptionUris(out, seen, [link.uri]);
      continue;
    }
    if (p.kind === "whitelist") {
      const e = wlById.get(p.id);
      if (!e?.uri || isClientJsonProfileUri(e.uri)) continue;
      appendUniqueSubscriptionUris(out, seen, [e.uri]);
    }
  }

  const extras = (user.extra_vless_links ?? [])
    .map((x) => {
      const uri = x.uri.trim();
      if (!uri) return "";
      const base = (x.label || defaultNameFromUri(uri)).trim();
      return applyUserRemarkToProxyUri(uri, base, user.name);
    })
    .filter(Boolean);
  appendUniqueSubscriptionUris(out, seen, extras);

  if (user.whitelist_happ_enabled !== 1) return out;
  if (!userHasActiveSubscription(user) || getWhitelistAccessState(user).status !== "active") return out;

  const rows = serversForUserSubscription(user);
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
