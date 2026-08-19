import { listConfigVaultKeys, configVaultLinksForUser, getConfigVaultKey } from "./configVaultDb.js";
import { listDeployedServers, listUsers, updateUserRow, type UserRow } from "./db.js";
import {
  getWhitelistVaultKey,
  listWhitelistVaultKeys,
  subscriptionWhitelistEntriesForUser,
} from "./whitelistVaultDb.js";
import {
  makeVpnEntryKey,
  normalizeVpnEntryOrder,
  parseVpnEntryKey,
  vlessIdsFromEntryOrder,
} from "./vpnDisplayOrder.js";
import { reorderIdsByTemplate } from "./panelSettingsTypes.js";
import { getPanelSettings } from "./panelSettings.js";

/** Каталог всех элементов «Отображение VPN». */
export function listGlobalVpnDisplayAvailableKeys(): string[] {
  const keys: string[] = [];
  for (const s of listDeployedServers()) {
    if (s.vless_in_subscriptions === 1) {
      keys.push(makeVpnEntryKey("vless", s.id));
    }
    if (s.hysteria2_deployed === 1 && s.hysteria2_in_subscriptions === 1) {
      keys.push(makeVpnEntryKey("hy2", s.id));
    }
    if (s.trojan_deployed === 1 && s.trojan_in_subscriptions === 1) {
      keys.push(makeVpnEntryKey("trojan", s.id));
    }
  }
  for (const k of listConfigVaultKeys()) {
    if (!k.active || !k.added_to_subscriptions) continue;
    keys.push(makeVpnEntryKey("vault", k.id));
  }
  for (const k of listWhitelistVaultKeys()) {
    if (!k.active || k.removed_from_subscriptions) continue;
    keys.push(makeVpnEntryKey("whitelist", k.id));
  }
  return keys;
}

export function listVpnDisplayAvailableKeysForUser(user: UserRow): string[] {
  const keys: string[] = [];
  const serverIds = new Set(user.subscription_server_ids ?? []);
  for (const s of listDeployedServers()) {
    if (!serverIds.has(s.id)) continue;
    if (s.vless_in_subscriptions === 1) {
      keys.push(makeVpnEntryKey("vless", s.id));
    }
    if (s.hysteria2_deployed === 1 && s.hysteria2_in_subscriptions === 1) {
      keys.push(makeVpnEntryKey("hy2", s.id));
    }
    if (s.trojan_deployed === 1 && s.trojan_in_subscriptions === 1) {
      keys.push(makeVpnEntryKey("trojan", s.id));
    }
  }
  for (const link of configVaultLinksForUser(user)) {
    keys.push(makeVpnEntryKey("vault", link.vault_key_id));
  }
  for (const e of subscriptionWhitelistEntriesForUser(user)) {
    keys.push(makeVpnEntryKey("whitelist", e.key_id));
  }
  return keys;
}

export function resolveVpnDisplayEntryOrderForUser(user: UserRow): string[] {
  const available = listVpnDisplayAvailableKeysForUser(user);
  const custom = Array.isArray(user.subscription_entry_order) ? user.subscription_entry_order : [];
  if (custom.length > 0) {
    return normalizeVpnEntryOrder(custom, available);
  }
  const global = getPanelSettings().vpnDisplay?.entryOrder ?? [];
  return normalizeVpnEntryOrder(global, available);
}

export function normalizeGlobalVpnDisplayEntryOrder(order: unknown): string[] {
  return normalizeVpnEntryOrder(order, listGlobalVpnDisplayAvailableKeys());
}

export function applyVpnDisplayOrderToAllUsers(templateOrder: string[]): { updated_users: number } {
  let updated = 0;
  const template = normalizeGlobalVpnDisplayEntryOrder(templateOrder);
  const vlessTemplate = vlessIdsFromEntryOrder(template);
  for (const u of listUsers()) {
    if (u.is_test_subscription === 1) continue;
    const available = listVpnDisplayAvailableKeysForUser(u);
    const nextEntry = normalizeVpnEntryOrder(template, available);
    const nextServers = reorderIdsByTemplate(u.subscription_server_ids ?? [], vlessTemplate);
    const prevEntry = u.subscription_entry_order ?? [];
    const sameEntry =
      prevEntry.length === nextEntry.length && prevEntry.every((k, i) => k === nextEntry[i]);
    const curServers = u.subscription_server_ids ?? [];
    const sameServers =
      nextServers.length === curServers.length && nextServers.every((id, i) => id === curServers[i]);
    if (sameEntry && sameServers) continue;
    updateUserRow(u.id, {
      subscription_entry_order: nextEntry,
      subscription_server_ids: nextServers,
    });
    updated += 1;
  }
  return { updated_users: updated };
}

export type VpnDisplayCatalogItem = {
  key: string;
  kind: "vless" | "hy2" | "trojan" | "vault" | "whitelist";
  id: number;
  title: string;
  subtitle: string;
  badge: string;
};

export function buildVpnDisplayCatalogItems(keys: string[]): VpnDisplayCatalogItem[] {
  const servers = new Map(listDeployedServers().map((s) => [s.id, s]));
  const out: VpnDisplayCatalogItem[] = [];
  for (const key of keys) {
    const p = parseVpnEntryKey(key);
    if (!p) continue;
    if (p.kind === "vless" || p.kind === "hy2" || p.kind === "trojan") {
      const s = servers.get(p.id);
      if (!s) continue;
      const port =
        p.kind === "hy2" ? s.hysteria2_port || 36712 : p.kind === "trojan" ? s.trojan_port || 8446 : s.vless_port || 443;
      out.push({
        key: p.key,
        kind: p.kind,
        id: p.id,
        title: s.name || `Сервер #${s.id}`,
        subtitle: `${s.host}:${port}`,
        badge: p.kind === "hy2" ? "HY2" : p.kind === "trojan" ? "Trojan" : "VLESS",
      });
      continue;
    }
    if (p.kind === "vault") {
      const k = getConfigVaultKey(p.id);
      if (!k) continue;
      out.push({
        key: p.key,
        kind: "vault",
        id: p.id,
        title: k.name,
        subtitle: k.masked_uri || "конфиг",
        badge: "Конфиг",
      });
      continue;
    }
    const k = getWhitelistVaultKey(p.id);
    if (!k) continue;
    out.push({
      key: p.key,
      kind: "whitelist",
      id: p.id,
      title: k.name,
      subtitle: k.masked_uri || "белый список",
      badge: "БС",
    });
  }
  return out;
}
