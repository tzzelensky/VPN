import { generateX25519RealityKeyPair, randomRealityShortId } from "./realityKeygen.js";
import type { ExperimentDnsMode, ExperimentNetwork, ExperimentSecurity } from "./experimentTypes.js";
import { experimentInboundTag, randomExpPath, randomGrpcService } from "./experimentTypes.js";

export type BuiltExperimentSecrets = {
  publicKey: string;
  privateKey: string;
  shortId: string;
  wsPath: string;
  grpcService: string;
};

export type ExperimentInboundSpec = {
  experimentId: number;
  vlessUuid: string;
  port: number;
  network: ExperimentNetwork;
  security: ExperimentSecurity;
  flow: string;
  fingerprint: string;
  serverName: string;
  sniffQuic: boolean;
  dnsMode: ExperimentDnsMode;
  muxEnabled: boolean;
  logLevel: string;
};

export function buildExperimentSecrets(): BuiltExperimentSecrets {
  const kp = generateX25519RealityKeyPair();
  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    shortId: randomRealityShortId(),
    wsPath: randomExpPath(),
    grpcService: randomGrpcService(),
  };
}

function sniffingForInbound(sniffQuic: boolean): Record<string, unknown> {
  const dest = sniffQuic ? ["http", "tls", "quic"] : ["http", "tls"];
  return {
    enabled: true,
    destOverride: dest,
    routeOnly: false,
  };
}

export function buildExperimentInbound(
  spec: ExperimentInboundSpec,
  secrets: BuiltExperimentSecrets,
): Record<string, unknown> {
  const tag = experimentInboundTag(spec.experimentId);
  const client: Record<string, unknown> = {
    id: spec.vlessUuid,
    email: `exp-${spec.experimentId}`,
    level: 0,
  };
  const flow = (spec.flow ?? "").trim();
  if (flow) client.flow = flow;

  const streamSettings: Record<string, unknown> = {
    network: spec.network,
  };

  if (spec.security === "reality") {
    const sni = spec.serverName.trim() || "www.microsoft.com";
    streamSettings.security = "reality";
    streamSettings.realitySettings = {
      show: false,
      dest: `${sni}:443`,
      xver: 0,
      serverNames: [sni],
      privateKey: secrets.privateKey,
      publicKey: secrets.publicKey,
      shortIds: [secrets.shortId],
      fingerprint: spec.fingerprint || "chrome",
      spiderX: "/",
    };
  } else if (spec.security === "tls") {
    streamSettings.security = "tls";
    streamSettings.tlsSettings = {
      serverName: spec.serverName.trim() || "www.microsoft.com",
      fingerprint: spec.fingerprint || "chrome",
    };
  } else {
    streamSettings.security = "none";
  }

  if (spec.network === "ws") {
    streamSettings.wsSettings = { path: secrets.wsPath };
  } else if (spec.network === "grpc") {
    streamSettings.grpcSettings = { serviceName: secrets.grpcService };
  }

  const inbound: Record<string, unknown> = {
    listen: "0.0.0.0",
    port: spec.port,
    protocol: "vless",
    tag,
    settings: {
      clients: [client],
      decryption: "none",
    },
    streamSettings,
    sniffing: sniffingForInbound(spec.sniffQuic),
  };

  if (spec.muxEnabled) {
    inbound.mux = { enabled: true, concurrency: 8 };
  }

  return inbound;
}

/** DNS/routing только для трафика экспериментального inbound (не трогаем остальные). */
export function applyExperimentRoutingDns(
  config: Record<string, unknown>,
  inboundTag: string,
  opts: { queryStrategy: string; dnsMode: ExperimentDnsMode },
): void {
  const tag = inboundTag.trim();
  if (!tag) return;

  if (opts.dnsMode === "no_direct_dns" || opts.dnsMode === "proxy") {
    const dns = (config.dns as Record<string, unknown>) ?? {};
    const servers = Array.isArray(dns.servers) ? [...dns.servers] : [];
    const filtered = servers.filter((s) => {
      const line = typeof s === "string" ? s : JSON.stringify(s);
      return !/8\.8\.8\.8:53|8\.8\.4\.4:53/.test(line);
    });
    if (opts.dnsMode === "proxy") {
      filtered.push({ address: "1.1.1.1", port: 53, domains: ["geosite:category-ads-all"] });
    }
    config.dns = { ...dns, servers: filtered.length ? filtered : ["1.1.1.1"] };
    const routing = (config.routing as Record<string, unknown>) ?? { rules: [] };
    const rules = Array.isArray(routing.rules) ? [...routing.rules] : [];
    rules.push({
      type: "field",
      inboundTag: [tag],
      port: 53,
      outboundTag: "direct",
    });
    config.routing = { ...routing, rules };
  }

  void opts.queryStrategy;
}

/** Порт свободен — иначе ошибка port_busy (ничего не перезаписываем). */
export function resolvePortIfFree(
  inbounds: Record<string, unknown>[],
  preferred: number,
): { port: number } {
  if (!Number.isFinite(preferred) || preferred < 1 || preferred > 65535) {
    throw new Error("invalid_port");
  }
  for (const ib of inbounds) {
    if (Number(ib.port) !== preferred) continue;
    const tag = String(ib.tag ?? "(без тега)");
    throw new Error(`port_busy:${preferred}:${tag}`);
  }
  return { port: preferred };
}

export function collectOccupiedPorts(inbounds: Record<string, unknown>[]): Set<number> {
  const occupied = new Set<number>();
  for (const ib of inbounds) {
    const p = Number(ib.port);
    if (Number.isFinite(p) && p > 0) occupied.add(p);
  }
  return occupied;
}

/**
 * Порт для эксперимента: на experimental-only — только 443 или ошибка.
 * На прод-сервере — 443 если свободен, иначе ошибка (без случайных 2053/8443).
 */
export function resolveExperimentPortStrict(
  inbounds: Record<string, unknown>[],
  preferred: number,
  opts: { experimental_only: boolean; allow_non_443?: boolean },
): { port: number; warning: string | null } {
  const occupied = collectOccupiedPorts(inbounds);
  const blockers = (p: number) => {
    for (const ib of inbounds) {
      if (Number(ib.port) !== p) continue;
      const tag = String(ib.tag ?? "");
      if (tag.startsWith("EXP-")) continue;
      return tag;
    }
    return null;
  };

  if (preferred === 443) {
    const blocker = blockers(443);
    if (!blocker) return { port: 443, warning: null };
    if (opts.experimental_only) {
      throw new Error(`port_443_busy:${blocker}`);
    }
    if (!opts.allow_non_443) {
      throw new Error(`port_443_busy:${blocker}`);
    }
  }

  if (opts.allow_non_443 && preferred !== 443 && !occupied.has(preferred)) {
    return {
      port: preferred,
      warning:
        "Этот порт может блокироваться мобильными операторами. Для честного теста нужен 443.",
    };
  }

  if (opts.experimental_only) {
    throw new Error("experimental_server_requires_free_443");
  }
  throw new Error("honest_mobile_test_needs_443");
}
