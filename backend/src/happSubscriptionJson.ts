import { parseProxyUri, type ParsedVlessParams } from "./configVaultUri.js";
import { configVaultLinksForUser } from "./configVaultDb.js";
import { subscriptionWhitelistEntriesForUser } from "./whitelistVaultDb.js";
import { getServerSubscriptionSettings, listDeployedServers, userAllowedOnServers, type UserRow } from "./db.js";
import { resolveVpnDisplayEntryOrderForUser } from "./vpnDisplayCatalog.js";
import { parseVpnEntryKey } from "./vpnDisplayOrder.js";
import { buildHysteria2UriForUser } from "./hysteria2Link.js";
import { buildTrojanUriForUser } from "./trojanLink.js";
import { buildVlessUriFromSubscriptionSettings } from "./vlessLink.js";

export function isHappUserAgent(ua: string | undefined | null): boolean {
  return /happ/i.test(String(ua ?? ""));
}

/** Happ и Incy — Xray-клиенты; им нужен JSON с pinnedPeerCertSha256, без allowInsecure. */
export function isXrayJsonSubscriptionClient(
  ua: string | undefined | null,
  xClient?: string | undefined | null,
): boolean {
  if (/happ/i.test(String(ua ?? ""))) return true;
  if (/incy/i.test(String(ua ?? ""))) return true;
  if (/incy/i.test(String(xClient ?? ""))) return true;
  return false;
}

function defaultInbounds(): unknown[] {
  return [
    {
      listen: "127.0.0.1",
      port: 10808,
      protocol: "socks",
      settings: { auth: "noauth", udp: true },
      sniffing: { destOverride: ["http", "tls", "quic"], enabled: true, routeOnly: true },
      tag: "socks",
    },
    {
      listen: "127.0.0.1",
      port: 10809,
      protocol: "http",
      settings: { allowTransparent: false },
      sniffing: { destOverride: ["http", "tls", "quic"], enabled: true, routeOnly: true },
      tag: "http",
    },
  ];
}

function parseExtraObject(raw: string): Record<string, unknown> | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  try {
    const o = JSON.parse(s);
    if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return undefined;
}

function buildVlessOutbound(p: ParsedVlessParams): Record<string, unknown> {
  const stream: Record<string, unknown> = {
    network: p.network || "tcp",
    security: p.security || "none",
  };

  if (p.security === "reality") {
    stream.realitySettings = {
      serverName: p.sni || undefined,
      fingerprint: p.fingerprint || undefined,
      publicKey: p.publicKey || undefined,
      shortId: p.shortId || undefined,
    };
  } else if (p.security === "tls") {
    const tls: Record<string, unknown> = {
      serverName: p.sni || undefined,
    };
    if (p.fingerprint) tls.fingerprint = p.fingerprint;
    if (p.alpn) tls.alpn = p.alpn.split(",").map((x) => x.trim()).filter(Boolean);
    const pin = String(p.pinnedPeerCertSha256 ?? "")
      .trim()
      .replace(/:/g, "")
      .toLowerCase();
    if (pin) tls.pinnedPeerCertSha256 = pin;
    // allowInsecure удалён в новых ядрах Xray/Happ — не эмитим
    stream.tlsSettings = tls;
  }

  const net = (p.network || "tcp").toLowerCase();
  if (net === "ws") {
    stream.wsSettings = {
      path: p.path || "/",
      headers: p.host ? { Host: p.host } : {},
    };
  } else if (net === "grpc") {
    stream.grpcSettings = { serviceName: p.path || "" };
  } else if (net === "xhttp" || net === "splithttp" || net === "httpupgrade") {
    const xhttp: Record<string, unknown> = {
      host: p.host || "",
      mode: p.mode || "auto",
      path: p.path || "",
    };
    const extra = parseExtraObject(p.extra);
    if (extra) xhttp.extra = extra;
    stream.xhttpSettings = xhttp;
  } else if (net === "tcp" && p.path) {
    stream.tcpSettings = {
      header: { type: "http", request: { path: [p.path] } },
    };
  }

  return {
    protocol: "vless",
    settings: {
      vnext: [
        {
          address: p.address,
          port: p.port,
          users: [
            {
              encryption: p.encryption || "none",
              flow: p.flow || "",
              id: p.uuid,
            },
          ],
        },
      ],
    },
    streamSettings: stream,
    tag: "proxy",
  };
}

/** Outbound Hysteria2 для Happ/Xray (protocol hysteria, version 2). */
function buildHysteria2Outbound(p: ParsedVlessParams): Record<string, unknown> {
  const tls: Record<string, unknown> = {
    serverName: p.sni || undefined,
    alpn: ["h3"],
  };
  if (p.fingerprint) tls.fingerprint = p.fingerprint;
  // allowInsecure удалён в Xray (2026-06-01) — только pin сертификата
  const pin = String(p.pinnedPeerCertSha256 ?? "")
    .trim()
    .replace(/:/g, "")
    .toLowerCase();
  if (pin) tls.pinnedPeerCertSha256 = pin;
  return {
    protocol: "hysteria",
    settings: {
      version: 2,
      address: p.address,
      port: p.port,
    },
    streamSettings: {
      network: "hysteria",
      security: "tls",
      hysteriaSettings: {
        version: 2,
        auth: p.uuid,
      },
      tlsSettings: tls,
    },
    tag: "proxy",
  };
}

function buildTrojanOutbound(p: ParsedVlessParams): Record<string, unknown> {
  const tls: Record<string, unknown> = {
    serverName: p.sni || undefined,
    fingerprint: p.fingerprint || "chrome",
  };
  const pin = String(p.pinnedPeerCertSha256 ?? "")
    .trim()
    .replace(/:/g, "")
    .toLowerCase();
  if (pin) tls.pinnedPeerCertSha256 = pin;
  return {
    protocol: "trojan",
    settings: {
      servers: [
        {
          address: p.address,
          port: p.port,
          password: p.uuid,
        },
      ],
    },
    streamSettings: {
      network: p.network || "tcp",
      security: p.security || "tls",
      tlsSettings: tls,
    },
    tag: "proxy",
  };
}

/** Профиль Happ из vless://, trojan:// или hysteria2:// (без полного routing — как обычный узел). */
export function shareLinkToHappProfile(uri: string): Record<string, unknown> | null {
  const trimmed = uri.trim();
  if (!trimmed || /^happ:\/\//i.test(trimmed)) return null;
  const isHy = /^hysteria2:\/\//i.test(trimmed) || /^hysteria:\/\//i.test(trimmed);
  const isVless = /^vless:\/\//i.test(trimmed);
  const isTrojan = /^trojan:\/\//i.test(trimmed);
  if (!isHy && !isVless && !isTrojan) return null;
  const p = parseProxyUri(trimmed);
  if (!p) return null;
  const remarks = (p.remark || `${p.address}:${p.port}`).slice(0, 120);
  const outbound = isHy ? buildHysteria2Outbound(p) : isTrojan ? buildTrojanOutbound(p) : buildVlessOutbound(p);
  return {
    dns: { queryStrategy: "AsIs", servers: ["1.1.1.1", "1.0.0.1", "8.8.8.8"] },
    inbounds: defaultInbounds(),
    outbounds: [
      outbound,
      { protocol: "freedom", tag: "direct" },
      { protocol: "blackhole", tag: "block" },
    ],
    remarks,
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: [{ type: "field", network: "tcp,udp", outboundTag: "proxy" }],
    },
  };
}

/**
 * Тело подписки для Happ/Incy: JSON-массив профилей Xray в порядке vpnDisplay.
 * Ключи БС с client_json идут as-is (routing + xhttp.extra сохраняются).
 *
 * Важно: если `shareLinks` пустой (истечение / лимит устройств / отключение),
 * не пересобираем узлы из каталога — иначе клиент снова получит рабочие конфиги.
 */
export function buildHappJsonSubscriptionBody(
  user: UserRow,
  shareLinks: string[],
): { contentType: string; body: string } | null {
  if (!userAllowedOnServers(user) || shareLinks.length === 0) {
    return null;
  }

  const profiles: Record<string, unknown>[] = [];
  const used = new Set<string>();
  const pushProfile = (profile: Record<string, unknown> | null, dedupeKey?: string) => {
    if (!profile) return;
    const key = (dedupeKey || String(profile.remarks ?? "")).toLowerCase();
    if (key && used.has(key)) return;
    if (key) used.add(key);
    profiles.push(profile);
  };

  const entryOrder = resolveVpnDisplayEntryOrderForUser(user);
  if (entryOrder.length > 0) {
    const servers = new Map(listDeployedServers().map((s) => [s.id, s]));
    const vaultById = new Map(configVaultLinksForUser(user).map((x) => [x.vault_key_id, x]));
    const wlById = new Map(subscriptionWhitelistEntriesForUser(user).map((x) => [x.key_id, x]));

    for (const key of entryOrder) {
      const p = parseVpnEntryKey(key);
      if (!p) continue;
      if (p.kind === "vless") {
        const row = servers.get(p.id);
        if (!row) continue;
        const settings = getServerSubscriptionSettings(row);
        const uri = buildVlessUriFromSubscriptionSettings(row, user, settings);
        pushProfile(shareLinkToHappProfile(uri), uri);
        continue;
      }
      if (p.kind === "hy2") {
        const row = servers.get(p.id);
        if (!row || row.hysteria2_deployed !== 1 || row.hysteria2_in_subscriptions !== 1) continue;
        const uri = buildHysteria2UriForUser(row, user);
        if (uri) pushProfile(shareLinkToHappProfile(uri), uri);
        continue;
      }
      if (p.kind === "trojan") {
        const row = servers.get(p.id);
        if (!row || row.trojan_deployed !== 1 || row.trojan_in_subscriptions !== 1) continue;
        const uri = buildTrojanUriForUser(row, user);
        if (uri) pushProfile(shareLinkToHappProfile(uri), uri);
        continue;
      }
      if (p.kind === "vault") {
        const link = vaultById.get(p.id);
        if (!link?.uri) continue;
        const profile = shareLinkToHappProfile(link.uri);
        if (profile && link.name) profile.remarks = link.name;
        pushProfile(profile, link.uri);
        continue;
      }
      if (p.kind === "whitelist") {
        const e = wlById.get(p.id);
        if (!e) continue;
        if (e.client_json) {
          const clone = { ...e.client_json };
          clone.remarks = e.name || clone.remarks;
          pushProfile(clone, `wl:${e.key_id}`);
        } else {
          const profile = shareLinkToHappProfile(e.uri);
          if (profile && e.name) profile.remarks = e.name;
          pushProfile(profile, e.uri);
        }
      }
    }
  } else {
    const wl = subscriptionWhitelistEntriesForUser(user);
    const usedUri = new Set(wl.map((e) => e.uri.trim().toLowerCase()).filter(Boolean));

    for (const link of shareLinks) {
      const t = link.trim();
      if (!t || t.startsWith("#") || /^happ:\/\//i.test(t)) continue;
      if (usedUri.has(t.toLowerCase())) continue;
      pushProfile(shareLinkToHappProfile(t), t);
    }

    for (const e of wl) {
      if (e.client_json) {
        const clone = { ...e.client_json };
        clone.remarks = e.name || clone.remarks;
        pushProfile(clone, `wl:${e.key_id}`);
      } else {
        const profile = shareLinkToHappProfile(e.uri);
        if (profile) {
          if (e.name) profile.remarks = e.name;
          pushProfile(profile, e.uri);
        }
      }
    }
  }

  if (!profiles.length) return null;
  return {
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(profiles),
  };
}

export function shouldServeHappJsonSubscription(
  _user: UserRow,
  userAgent: string,
  xClient?: string | null,
): boolean {
  // Happ/Incy на Xray: JSON с pinnedPeerCertSha256 (URI insecure→allowInsecure ломает ядро)
  return isXrayJsonSubscriptionClient(userAgent, xClient);
}
