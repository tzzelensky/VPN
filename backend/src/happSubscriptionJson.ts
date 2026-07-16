import { parseProxyUri, type ParsedVlessParams } from "./configVaultUri.js";
import {
  subscriptionWhitelistEntriesForUser,
  userHasWhitelistClientJsonProfiles,
} from "./whitelistVaultDb.js";
import type { UserRow } from "./db.js";

export function isHappUserAgent(ua: string | undefined | null): boolean {
  return /happ/i.test(String(ua ?? ""));
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
      allowInsecure: p.allowInsecure || false,
    };
    if (p.fingerprint) tls.fingerprint = p.fingerprint;
    if (p.alpn) tls.alpn = p.alpn.split(",").map((x) => x.trim()).filter(Boolean);
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

/** Профиль Happ из vless:// (без полного routing — как обычный узел). */
export function shareLinkToHappProfile(uri: string): Record<string, unknown> | null {
  const trimmed = uri.trim();
  if (!trimmed || /^happ:\/\//i.test(trimmed)) return null;
  if (!/^vless:\/\//i.test(trimmed)) return null;
  const p = parseProxyUri(trimmed);
  if (!p) return null;
  const remarks = (p.remark || `${p.address}:${p.port}`).slice(0, 120);
  return {
    dns: { queryStrategy: "AsIs", servers: ["1.1.1.1", "1.0.0.1", "8.8.8.8"] },
    inbounds: defaultInbounds(),
    outbounds: [
      buildVlessOutbound(p),
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
 * Тело подписки для Happ: JSON-массив профилей.
 * Ключи БС с client_json идут as-is (routing + xhttp.extra сохраняются).
 */
export function buildHappJsonSubscriptionBody(
  user: UserRow,
  shareLinks: string[],
): { contentType: string; body: string } | null {
  const wl = subscriptionWhitelistEntriesForUser(user);
  const hasFullJson = wl.some((e) => e.client_json != null);
  if (!hasFullJson) return null;

  const profiles: Record<string, unknown>[] = [];
  const usedUri = new Set(wl.map((e) => e.uri.trim().toLowerCase()).filter(Boolean));

  for (const link of shareLinks) {
    const t = link.trim();
    if (!t || t.startsWith("#") || /^happ:\/\//i.test(t)) continue;
    if (usedUri.has(t.toLowerCase())) continue;
    const profile = shareLinkToHappProfile(t);
    if (profile) profiles.push(profile);
  }

  for (const e of wl) {
    if (e.client_json) {
      const clone = { ...e.client_json };
      clone.remarks = e.name || clone.remarks;
      profiles.push(clone);
    } else {
      const profile = shareLinkToHappProfile(e.uri);
      if (profile) {
        if (e.name) profile.remarks = e.name;
        profiles.push(profile);
      }
    }
  }

  if (!profiles.length) return null;
  return {
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(profiles),
  };
}

export function shouldServeHappJsonSubscription(user: UserRow, userAgent: string): boolean {
  return isHappUserAgent(userAgent) && userHasWhitelistClientJsonProfiles(user);
}
