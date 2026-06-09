import type { ServerSubscriptionSettings, DnsQueryStrategy } from "./serverSubscriptionSettings.js";
import { deriveRealityPublicKeyFromPrivateLocal } from "./vlessLinkHints.js";
import { generateX25519RealityKeyPair } from "./realityKeygen.js";
import { streamSettingsOfInbound } from "./vlessLinkHints.js";

export const DEFAULT_SNIFF_DEST_OVERRIDE = ["http", "tls", "quic"] as const;

export function dnsServersBlock(servers: string[]): unknown[] {
  const out: unknown[] = [];
  for (const s of servers) {
    const addr = String(s ?? "").trim();
    if (!addr) continue;
    if (out.length === 0) {
      out.push(addr);
    } else {
      out.push({ address: addr, port: 53, domains: [] as string[] });
    }
  }
  if (out.length === 0) {
    return ["1.1.1.1", { address: "1.1.1.1", port: 53, domains: [] }, { address: "8.8.8.8", port: 53, domains: [] }];
  }
  return out;
}

export function buildServerDnsBlock(settings: ServerSubscriptionSettings): Record<string, unknown> {
  return {
    hosts: { "domain:googleapis.cn": "googleapis.com" },
    queryStrategy: settings.dns.query_strategy,
    servers: dnsServersBlock(settings.dns.servers),
  };
}

export function buildClientStreamSettings(settings: ServerSubscriptionSettings): Record<string, unknown> {
  const network = settings.network;
  const security = settings.security;
  const stream: Record<string, unknown> = { network, security };

  if (network === "tcp") {
    stream.tcpSettings = { header: { type: settings.tcp.header_type || "none" } };
  } else if (network === "grpc") {
    stream.grpcSettings = {
      serviceName: settings.grpc.service_name,
      authority: settings.grpc.authority,
      mode: settings.grpc.mode,
    };
  } else if (network === "ws") {
    stream.wsSettings = {
      path: settings.ws.path,
      headers: settings.ws.host ? { Host: settings.ws.host } : {},
    };
  }

  if (security === "reality") {
    stream.realitySettings = {
      show: settings.reality.show,
      fingerprint: settings.reality.fingerprint,
      serverName: settings.reality.server_name,
      publicKey: settings.reality.public_key,
      shortId: settings.reality.short_id,
      spiderX: settings.reality.spider_x.trim() || "/",
      allowInsecure: settings.reality.allow_insecure,
    };
  } else if (security === "tls") {
    stream.tlsSettings = {
      serverName: settings.reality.server_name,
      fingerprint: settings.reality.fingerprint,
      allowInsecure: settings.reality.allow_insecure,
    };
  }

  return stream;
}

export function resolveRealityKeysForApply(
  settings: ServerSubscriptionSettings,
  existingIb: Record<string, unknown> | null,
): { privateKey: string; publicKey: string } {
  const rs = existingIb
    ? (((streamSettingsOfInbound(existingIb).realitySettings as Record<string, unknown> | undefined) ?? {}) as Record<
        string,
        unknown
      >)
    : {};
  const existingPriv = typeof rs.privateKey === "string" ? rs.privateKey.trim() : "";
  const existingPub = typeof rs.publicKey === "string" ? rs.publicKey.trim() : "";
  const settingsPriv = settings.reality.private_key.trim();
  const settingsPub = settings.reality.public_key.trim();

  if (settingsPriv) {
    const derived = deriveRealityPublicKeyFromPrivateLocal(settingsPriv);
    const pub = settingsPub || derived;
    if (settingsPub && derived && settingsPub !== derived) {
      throw new Error("REALITY publicKey не соответствует private key");
    }
    return { privateKey: settingsPriv, publicKey: pub || derived };
  }

  if (existingPriv) {
    const derived = deriveRealityPublicKeyFromPrivateLocal(existingPriv);
    if (settingsPub && derived && settingsPub !== derived) {
      return { privateKey: existingPriv, publicKey: derived || existingPub };
    }
    return { privateKey: existingPriv, publicKey: settingsPub || derived || existingPub };
  }

  if (settingsPub) {
    throw new Error("Укажите REALITY private key в настройках или нажмите «Сгенерировать» для новой пары ключей");
  }

  return generateX25519RealityKeyPair();
}

export function buildInboundStreamFromSubscription(
  settings: ServerSubscriptionSettings,
  keys: { privateKey: string; publicKey: string },
): Record<string, unknown> {
  const network = settings.network;
  const security = settings.security;
  const stream: Record<string, unknown> = { network, security };

  if (network === "tcp") {
    stream.tcpSettings = { header: { type: settings.tcp.header_type || "none" } };
  } else if (network === "grpc") {
    stream.grpcSettings = {
      serviceName: settings.grpc.service_name,
      authority: settings.grpc.authority,
      mode: settings.grpc.mode,
    };
  } else if (network === "ws") {
    stream.wsSettings = {
      path: settings.ws.path,
      headers: settings.ws.host ? { Host: settings.ws.host } : {},
    };
  }

  if (security === "reality") {
    const sni = settings.reality.server_name.trim();
    const sid = settings.reality.short_id.trim();
    stream.realitySettings = {
      show: settings.reality.show,
      dest: `${sni}:443`,
      xver: 0,
      serverNames: [sni],
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      shortIds: [sid],
      fingerprint: settings.reality.fingerprint,
      spiderX: settings.reality.spider_x.trim() || "/",
    };
  } else if (security === "tls") {
    stream.tlsSettings = {
      serverName: settings.reality.server_name,
      fingerprint: settings.reality.fingerprint,
      allowInsecure: settings.reality.allow_insecure,
    };
  }

  return stream;
}

export function buildInboundSniffing(settings: ServerSubscriptionSettings): Record<string, unknown> | null {
  if (!settings.sniffing.enabled) return null;
  const dest = settings.sniffing.dest_override.length
    ? settings.sniffing.dest_override
    : [...DEFAULT_SNIFF_DEST_OVERRIDE];
  return { enabled: true, destOverride: dest };
}

export function parseDnsFromXrayConfig(config: Record<string, unknown>): {
  query_strategy: DnsQueryStrategy;
  servers: string[];
} {
  const dns = (config.dns as Record<string, unknown> | undefined) ?? {};
  const qsRaw = String(dns.queryStrategy ?? "UseIPv4").trim();
  const query_strategy: DnsQueryStrategy =
    qsRaw === "UseIP" || qsRaw === "UseIPv6" || qsRaw === "UseIPv4v6" ? qsRaw : "UseIPv4";
  const servers: string[] = [];
  const raw = dns.servers;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        const t = item.trim();
        if (t) servers.push(t);
      } else if (item && typeof item === "object") {
        const addr = String((item as Record<string, unknown>).address ?? "").trim();
        if (addr) servers.push(addr);
      }
    }
  }
  return { query_strategy, servers: servers.length ? servers : ["1.1.1.1", "8.8.8.8"] };
}

export function parseSniffingFromInbound(ib: Record<string, unknown>): {
  enabled: boolean;
  dest_override: ("http" | "tls" | "quic")[];
} {
  const sn = (ib.sniffing as Record<string, unknown> | undefined) ?? {};
  const enabled = sn.enabled === true || sn.enabled === 1;
  const dest: ("http" | "tls" | "quic")[] = [];
  if (Array.isArray(sn.destOverride)) {
    for (const d of sn.destOverride) {
      const t = String(d ?? "").trim();
      if (t === "http" || t === "tls" || t === "quic") dest.push(t);
    }
  }
  return {
    enabled,
    dest_override: dest.length ? dest : [...DEFAULT_SNIFF_DEST_OVERRIDE],
  };
}
