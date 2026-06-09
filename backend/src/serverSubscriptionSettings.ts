import { randomBytes } from "node:crypto";
import type { ServerRow, UserRow } from "./db.js";
import { countryFlagEmoji } from "./serverDisplay.js";
import {
  extractRealityPrivateKeyFromConfig,
  extractVlessLinkHintsFromConfig,
} from "./vlessLinkHints.js";
import { DEFAULT_SNIFF_DEST_OVERRIDE, parseDnsFromXrayConfig, parseSniffingFromInbound } from "./subscriptionXrayShared.js";

export const SUBSCRIPTION_FINGERPRINTS = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
  "randomized",
  "randomizednoalpn",
  "unsafe",
] as const;

export type SubscriptionFingerprint = (typeof SUBSCRIPTION_FINGERPRINTS)[number];

export const SUBSCRIPTION_SNI_PRESETS = [
  "www.oracle.com",
  "www.microsoft.com",
  "www.apple.com",
  "www.nvidia.com",
  "www.cloudflare.com",
  "custom",
] as const;

export const SUBSCRIPTION_FLOWS = ["", "xtls-rprx-vision"] as const;
export type SubscriptionFlow = (typeof SUBSCRIPTION_FLOWS)[number];

export const VLESS_AUTH_MODES = ["", "x25519", "ml-kem-768"] as const;
export type VlessAuthMode = (typeof VLESS_AUTH_MODES)[number];

export type ServerSubscriptionSettingsVless = {
  flow: SubscriptionFlow;
  encryption: string;
  auth_mode: VlessAuthMode;
  decrypt_value: string;
  encrypt_value: string;
};

export type SubscriptionNetwork = "tcp" | "grpc" | "ws" | "xhttp";
export type SubscriptionSecurity = "reality" | "tls" | "none";
export type DnsQueryStrategy = "UseIP" | "UseIPv4" | "UseIPv6" | "UseIPv4v6";

export type ServerSubscriptionSettings = {
  address_mode: "host" | "custom";
  address_override: string;
  vless_port: number;
  remarks: string;
  /** VLESS flow для подписки (пусто = без flow в JSON/URI). */
  flow: SubscriptionFlow;
  network: SubscriptionNetwork;
  security: SubscriptionSecurity;
  /** Итоговое users[].encryption. Синхронизируется с vless.encryption. */
  encryption: string;
  vless: ServerSubscriptionSettingsVless;
  reality: {
    public_key: string;
    /** Только для inbound на сервере; в клиентскую подписку не попадает. */
    private_key: string;
    server_name: string;
    short_id: string;
    spider_x: string;
    fingerprint: string;
    allow_insecure: boolean;
    show: boolean;
  };
  tcp: { header_type: string };
  grpc: { service_name: string; authority: string; mode: boolean };
  ws: { path: string; host: string };
  mux: {
    enabled: boolean;
    concurrency: number;
    xudp_concurrency: number;
    xudp_proxy_udp443: string;
  };
  dns: {
    query_strategy: DnsQueryStrategy;
    servers: string[];
  };
  /** Sniffing на VLESS inbound сервера (как в 3x-ui). */
  sniffing: {
    enabled: boolean;
    dest_override: ("http" | "tls" | "quic")[];
  };
};

export type SubscriptionSettingsValidationError = { field: string; message: string };

const DEFAULT_DNS_SERVERS = ["1.1.1.1", "1.0.0.1", "8.8.8.8"];

export function defaultVlessBlock(flow: SubscriptionFlow = ""): ServerSubscriptionSettingsVless {
  return {
    flow,
    encryption: "none",
    auth_mode: "",
    decrypt_value: "",
    encrypt_value: "",
  };
}

export function normalizeVlessAuthMode(raw: unknown): VlessAuthMode {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "x25519") return "x25519";
  if (t === "ml-kem-768" || t === "mlkem768" || t === "ml-kem768") return "ml-kem-768";
  return "";
}

export function resolveSubscriptionEncryption(settings: ServerSubscriptionSettings): string {
  const vlessEnc = (settings.vless?.encryption ?? "").trim();
  if (vlessEnc && vlessEnc !== "none") return vlessEnc;
  const encryptValue = (settings.vless?.encrypt_value ?? "").trim();
  if (encryptValue) return encryptValue;
  const top = (settings.encryption ?? "").trim();
  if (top && top !== "none") return top;
  return "none";
}

/** Flow для users[].flow — совпадает с inbound TZADMIN (reality+tcp → vision). PQ/mlkem → без flow. */
export function resolveSubscriptionFlow(settings: ServerSubscriptionSettings): string {
  const enc = resolveSubscriptionEncryption(settings);
  if (enc !== "none" && enc.startsWith("mlkem")) return "";
  const explicit = (settings.flow ?? settings.vless?.flow ?? "").trim();
  if (explicit) return explicit;
  if (settings.security === "reality" && settings.network === "tcp" && enc === "none") {
    return "xtls-rprx-vision";
  }
  return "";
}

/** decryption на inbound сервера (пара к users[].encryption в подписке). */
export function resolveInboundDecryption(settings: ServerSubscriptionSettings): string {
  const enc = resolveSubscriptionEncryption(settings);
  if (enc === "none" || !enc.startsWith("mlkem")) return "none";
  const dec = (settings.vless?.decrypt_value ?? "").trim();
  if (dec.startsWith("mlkem")) return dec;
  return enc;
}

export function subscriptionUsesPqClientEncryption(settings: ServerSubscriptionSettings): boolean {
  const enc = resolveSubscriptionEncryption(settings);
  return enc !== "none" && enc.startsWith("mlkem");
}

export function syncSubscriptionVlessFields(settings: ServerSubscriptionSettings): ServerSubscriptionSettings {
  let flow = settings.flow ?? settings.vless?.flow ?? "";
  const auth_mode = normalizeVlessAuthMode(settings.vless?.auth_mode);
  const decrypt_value = String(settings.vless?.decrypt_value ?? "").trim();
  const encrypt_value = String(settings.vless?.encrypt_value ?? "").trim();
  const encryption = resolveSubscriptionEncryption({
    ...settings,
    flow,
    vless: {
      ...defaultVlessBlock(flow),
      ...settings.vless,
      flow,
      auth_mode,
      decrypt_value,
      encrypt_value,
    },
  });
  if (encryption !== "none" && encryption.startsWith("mlkem")) {
    flow = "";
  } else if (!flow && settings.security === "reality") {
    flow = defaultSubscriptionFlow(settings.security);
  }
  return {
    ...settings,
    flow,
    encryption,
    vless: {
      flow,
      encryption,
      auth_mode,
      decrypt_value,
      encrypt_value,
    },
  };
}

export function defaultSubscriptionFlow(security: SubscriptionSecurity): SubscriptionFlow {
  return security === "reality" ? "xtls-rprx-vision" : "";
}

export function normalizeSubscriptionFlow(raw: string | undefined | null, security: SubscriptionSecurity): SubscriptionFlow {
  if (raw === undefined || raw === null) return defaultSubscriptionFlow(security);
  const t = String(raw).trim();
  if (!t) return defaultSubscriptionFlow(security);
  if (t === "xtls-rprx-vision-udp443" || t === "xtls-rprx-vision") return "xtls-rprx-vision";
  return "";
}

export function defaultSubscriptionSettings(server: Pick<ServerRow, "host" | "name" | "country_code" | "vless_port">): ServerSubscriptionSettings {
  const flag = countryFlagEmoji(server.country_code);
  const nm = (server.name || "").trim() || (server.host || "").trim() || "node";
  const remarks = flag ? `${flag} ${nm}` : nm;
  const flow = "xtls-rprx-vision" as SubscriptionFlow;
  return {
    address_mode: "host",
    address_override: "",
    vless_port: Number(server.vless_port) > 0 ? Number(server.vless_port) : 443,
    remarks,
    flow,
    network: "tcp",
    security: "reality",
    encryption: "none",
    vless: defaultVlessBlock(flow),
    reality: {
      public_key: "",
      private_key: "",
      server_name: "www.microsoft.com",
      short_id: "",
      spider_x: "/",
      fingerprint: "chrome",
      allow_insecure: false,
      show: false,
    },
    tcp: { header_type: "none" },
    grpc: { service_name: "", authority: "", mode: false },
    ws: { path: "", host: "" },
    mux: {
      enabled: false,
      concurrency: -1,
      xudp_concurrency: 8,
      xudp_proxy_udp443: "",
    },
    dns: {
      query_strategy: "UseIPv4",
      servers: [...DEFAULT_DNS_SERVERS],
    },
    sniffing: {
      enabled: true,
      dest_override: [...DEFAULT_SNIFF_DEST_OVERRIDE],
    },
  };
}

/** Снимок из sub_* после деплоя / hints refresh. */
export function subscriptionSettingsFromLegacyServer(server: ServerRow): ServerSubscriptionSettings {
  const base = defaultSubscriptionSettings(server);
  const port = Number(server.sub_port) > 0 ? Number(server.sub_port) : Number(server.vless_port) || base.vless_port;
  const sec = (server.sub_security ?? "").trim().toLowerCase();
  const security: SubscriptionSecurity =
    sec === "tls" ? "tls" : sec === "none" ? "none" : sec === "reality" ? "reality" : base.security;
  const net = (server.sub_network ?? "").trim().toLowerCase();
  const network: SubscriptionNetwork =
    net === "grpc" || net === "ws" || net === "xhttp" ? net : base.network;
  const fp = (server.sub_fp ?? "").trim();
  return syncSubscriptionVlessFields({
    ...base,
    vless_port: port,
    network,
    security,
    flow: defaultSubscriptionFlow(security),
    encryption: "none",
    reality: {
      public_key: (server.sub_reality_pbk ?? "").trim(),
      private_key: "",
      server_name: (server.sub_sni ?? "").trim() || base.reality.server_name,
      short_id: (server.sub_reality_sid ?? "").trim(),
      spider_x: (server.sub_reality_spx ?? "").trim() || "/",
      fingerprint: fp || "chrome",
      allow_insecure: server.sub_allow_insecure === 1,
      show: false,
    },
    grpc: {
      service_name: network === "grpc" ? (server.sub_path ?? "").trim() : "",
      authority: network === "grpc" ? (server.sub_host ?? "").trim() : "",
      mode: false,
    },
    ws: {
      path: network === "ws" ? (server.sub_path ?? "").trim() : "",
      host: network === "ws" ? (server.sub_host ?? "").trim() : "",
    },
  });
}

/** Снимок inbound Xray с сервера (SSH) → настройки подписки для панели. */
export function subscriptionSettingsFromRemoteConfig(
  server: ServerRow,
  config: Record<string, unknown>,
  preferredPort?: number,
): ServerSubscriptionSettings {
  const hints = extractVlessLinkHintsFromConfig(config, preferredPort ?? server.vless_port);
  const priv = extractRealityPrivateKeyFromConfig(config, preferredPort ?? server.vless_port);
  const port = Number(hints.sub_port) > 0 ? Number(hints.sub_port) : Number(server.vless_port) || 8433;
  const secRaw = (hints.sub_security ?? "").trim().toLowerCase();
  const security: SubscriptionSecurity =
    secRaw === "tls" ? "tls" : secRaw === "none" ? "none" : secRaw === "reality" ? "reality" : "reality";
  const netRaw = (hints.sub_network ?? "").trim().toLowerCase();
  const network: SubscriptionNetwork =
    netRaw === "grpc" || netRaw === "ws" || netRaw === "xhttp" ? netRaw : "tcp";
  const fp = (hints.sub_fp ?? "").trim();
  const dnsFromConfig = parseDnsFromXrayConfig(config);
  const inbounds = Array.isArray(config.inbounds) ? (config.inbounds as Record<string, unknown>[]) : [];
  const tagged = inbounds.find((ib) => String(ib.tag ?? "") === "tzadmin-vless") ?? inbounds[0];
  const sniffing = tagged ? parseSniffingFromInbound(tagged) : defaultSubscriptionSettings(server).sniffing;
  const inboundSettings = (tagged?.settings as Record<string, unknown> | undefined) ?? {};
  const inboundDec = String(inboundSettings.decryption ?? "none").trim() || "none";
  const clients = Array.isArray(inboundSettings.clients)
    ? (inboundSettings.clients as Record<string, unknown>[])
    : [];
  const clientFlowRaw = clients.map((c) => String(c.flow ?? "").trim()).find(Boolean) ?? "";
  const pq = inboundDec.startsWith("mlkem");
  const flow = pq ? ("" as SubscriptionFlow) : normalizeSubscriptionFlow(clientFlowRaw || undefined, security);
  return syncSubscriptionVlessFields({
    ...defaultSubscriptionSettings(server),
    vless_port: port,
    network,
    security,
    flow,
    encryption: pq ? inboundDec : "none",
    vless: {
      ...defaultVlessBlock(flow),
      flow,
      encryption: pq ? inboundDec : "none",
      auth_mode: pq ? "ml-kem-768" : "",
      encrypt_value: pq ? inboundDec : "",
      decrypt_value: pq ? inboundDec : "",
    },
    reality: {
      public_key: (hints.sub_reality_pbk ?? "").trim(),
      private_key: priv,
      server_name: (hints.sub_sni ?? "").trim() || defaultSubscriptionSettings(server).reality.server_name,
      short_id: (hints.sub_reality_sid ?? "").trim(),
      spider_x: (hints.sub_reality_spx ?? "").trim() || "/",
      fingerprint: fp || "chrome",
      allow_insecure: hints.sub_allow_insecure === 1,
      show: false,
    },
    grpc: {
      service_name: network === "grpc" ? (hints.sub_path ?? "").trim() : "",
      authority: network === "grpc" ? (hints.sub_host ?? "").trim() : "",
      mode: false,
    },
    ws: {
      path: network === "ws" ? (hints.sub_path ?? "").trim() : "",
      host: network === "ws" ? (hints.sub_host ?? "").trim() : "",
    },
    dns: dnsFromConfig,
    sniffing,
  });
}

export function normalizeSubscriptionSettings(raw: unknown, server: ServerRow): ServerSubscriptionSettings {
  const base = subscriptionSettingsFromLegacyServer(server);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const realityRaw = o.reality && typeof o.reality === "object" ? (o.reality as Record<string, unknown>) : {};
  const tcpRaw = o.tcp && typeof o.tcp === "object" ? (o.tcp as Record<string, unknown>) : {};
  const grpcRaw = o.grpc && typeof o.grpc === "object" ? (o.grpc as Record<string, unknown>) : {};
  const wsRaw = o.ws && typeof o.ws === "object" ? (o.ws as Record<string, unknown>) : {};
  const muxRaw = o.mux && typeof o.mux === "object" ? (o.mux as Record<string, unknown>) : {};
  const dnsRaw = o.dns && typeof o.dns === "object" ? (o.dns as Record<string, unknown>) : {};
  const sniffRaw = o.sniffing && typeof o.sniffing === "object" ? (o.sniffing as Record<string, unknown>) : {};

  const address_mode = o.address_mode === "custom" ? "custom" : "host";
  const netRaw = String(o.network ?? base.network).trim().toLowerCase();
  const network: SubscriptionNetwork =
    netRaw === "grpc" || netRaw === "ws" || netRaw === "xhttp" ? netRaw : "tcp";
  const secRaw = String(o.security ?? base.security).trim().toLowerCase();
  const security: SubscriptionSecurity =
    secRaw === "tls" ? "tls" : secRaw === "none" ? "none" : "reality";

  const port = Math.floor(Number(o.vless_port) || base.vless_port);
  const fp = String(realityRaw.fingerprint ?? base.reality.fingerprint).trim() || "chrome";

  const qsRaw = String(dnsRaw.query_strategy ?? base.dns.query_strategy).trim();
  const query_strategy: DnsQueryStrategy =
    qsRaw === "UseIP" || qsRaw === "UseIPv6" || qsRaw === "UseIPv4v6" ? qsRaw : "UseIPv4";

  const servers: string[] = Array.isArray(dnsRaw.servers)
    ? dnsRaw.servers.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 8)
    : base.dns.servers;

  const vlessRaw = o.vless && typeof o.vless === "object" ? (o.vless as Record<string, unknown>) : {};
  const flow = normalizeSubscriptionFlow(
    o.flow !== undefined ? String(o.flow) : vlessRaw.flow !== undefined ? String(vlessRaw.flow) : base.flow,
    security,
  );

  return syncSubscriptionVlessFields({
    address_mode,
    address_override: String(o.address_override ?? "").trim().slice(0, 253),
    vless_port: Math.min(65535, Math.max(1, port)),
    remarks: String(o.remarks ?? base.remarks).trim().slice(0, 120),
    flow,
    network,
    security,
    encryption: String(o.encryption ?? vlessRaw.encryption ?? base.encryption).trim().slice(0, 512) || "none",
    vless: {
      flow,
      auth_mode: normalizeVlessAuthMode(vlessRaw.auth_mode),
      decrypt_value: String(vlessRaw.decrypt_value ?? "").trim().slice(0, 512),
      encrypt_value: String(vlessRaw.encrypt_value ?? "").trim().slice(0, 512),
      encryption: String(vlessRaw.encryption ?? o.encryption ?? base.encryption).trim().slice(0, 512) || "none",
    },
    reality: {
      public_key: String(realityRaw.public_key ?? base.reality.public_key).trim().slice(0, 512),
      private_key: String(realityRaw.private_key ?? base.reality.private_key).trim().slice(0, 512),
      server_name: String(realityRaw.server_name ?? base.reality.server_name).trim().slice(0, 253),
      short_id: String(realityRaw.short_id ?? base.reality.short_id).trim().slice(0, 32),
      spider_x: String(realityRaw.spider_x ?? base.reality.spider_x).trim().slice(0, 512) || "/",
      fingerprint: SUBSCRIPTION_FINGERPRINTS.includes(fp as SubscriptionFingerprint) ? fp : "chrome",
      allow_insecure: realityRaw.allow_insecure === true || realityRaw.allow_insecure === 1,
      show: realityRaw.show === true || realityRaw.show === 1,
    },
    tcp: {
      header_type: String(tcpRaw.header_type ?? "none").trim() || "none",
    },
    grpc: {
      service_name: String(grpcRaw.service_name ?? "").trim().slice(0, 120),
      authority: String(grpcRaw.authority ?? "").trim().slice(0, 253),
      mode: grpcRaw.mode === true || grpcRaw.mode === 1,
    },
    ws: {
      path: String(wsRaw.path ?? "").trim().slice(0, 512),
      host: String(wsRaw.host ?? "").trim().slice(0, 253),
    },
    mux: {
      enabled: muxRaw.enabled === true || muxRaw.enabled === 1,
      concurrency: Math.floor(Number(muxRaw.concurrency ?? -1)) || -1,
      xudp_concurrency: Math.max(0, Math.floor(Number(muxRaw.xudp_concurrency ?? 8)) || 8),
      xudp_proxy_udp443: String(muxRaw.xudp_proxy_udp443 ?? "").trim().slice(0, 64),
    },
    dns: {
      query_strategy,
      servers: servers.length > 0 ? servers : [...DEFAULT_DNS_SERVERS],
    },
    sniffing: {
      enabled: sniffRaw.enabled !== false && sniffRaw.enabled !== 0,
      dest_override: (() => {
        const dest: ("http" | "tls" | "quic")[] = [];
        if (Array.isArray(sniffRaw.dest_override)) {
          for (const d of sniffRaw.dest_override) {
            const t = String(d ?? "").trim();
            if (t === "http" || t === "tls" || t === "quic") dest.push(t);
          }
        }
        return dest.length ? dest : [...DEFAULT_SNIFF_DEST_OVERRIDE];
      })(),
    },
  });
}

export function ensureSubscriptionSettingsVless(settings: ServerSubscriptionSettings): ServerSubscriptionSettings {
  return syncSubscriptionVlessFields({
    ...settings,
    vless: settings.vless ?? defaultVlessBlock(settings.flow),
  });
}

export function resolveSubscriptionAddress(server: ServerRow, settings: ServerSubscriptionSettings): string {
  if (settings.address_mode === "custom") {
    const custom = settings.address_override.trim();
    if (custom) return custom;
  }
  return (server.host ?? "").trim() || "0.0.0.0";
}

export function resolveSubscriptionRemarks(
  server: ServerRow,
  settings: ServerSubscriptionSettings,
  user?: Pick<UserRow, "name">,
): string {
  const base = settings.remarks.trim() || defaultSubscriptionSettings(server).remarks;
  if (user?.name?.trim()) return `${base} (${user.name.trim()})`;
  return base;
}

export function generateRealityShortId(): string {
  return randomBytes(4).toString("hex").slice(0, 8);
}

export function generateRealitySpiderX(): string {
  const seg = randomBytes(6).toString("hex");
  return `/${seg}`;
}

export function validateSubscriptionSettings(settings: ServerSubscriptionSettings): SubscriptionSettingsValidationError[] {
  const errors: SubscriptionSettingsValidationError[] = [];
  if (!settings.remarks.trim()) errors.push({ field: "remarks", message: "Укажите название в подписке" });
  if (!Number.isFinite(settings.vless_port) || settings.vless_port < 1 || settings.vless_port > 65535) {
    errors.push({ field: "vless_port", message: "Порт должен быть от 1 до 65535" });
  }
  if (settings.address_mode === "custom" && !settings.address_override.trim()) {
    errors.push({ field: "address_override", message: "Укажите адрес или выберите «из поля сервера»" });
  }
  const authMode = settings.vless?.auth_mode ?? "";
  const encryptValue = (settings.vless?.encrypt_value ?? "").trim();
  if (authMode === "x25519" || authMode === "ml-kem-768") {
    if (!encryptValue || encryptValue === "none") {
      errors.push({
        field: "vless.encrypt_value",
        message: "Введите значение шифрования или сгенерируйте его",
      });
    }
    const dec = (settings.vless?.decrypt_value ?? "").trim();
    if (subscriptionUsesPqClientEncryption(settings) && !dec.startsWith("mlkem")) {
      errors.push({
        field: "vless.decrypt_value",
        message: "Для PQ-шифрования укажите decryption для inbound (или сгенерируйте пару)",
      });
    }
  }
  if (subscriptionUsesPqClientEncryption(settings)) {
    const dec = (settings.vless?.decrypt_value ?? "").trim();
    if (dec.includes(".0rtt.")) {
      errors.push({
        field: "vless.decrypt_value",
        message: "decryption для сервера должен быть с 600s (не 0rtt). Нажмите ML-KEM-768 для новой пары.",
      });
    }
    const enc = resolveSubscriptionEncryption(settings);
    if (!enc.includes(".0rtt.")) {
      errors.push({
        field: "vless.encrypt_value",
        message: "encryption клиента должен быть с 0rtt. Сгенерируйте пару заново.",
      });
    }
  }
  if (!VLESS_AUTH_MODES.includes(authMode)) {
    errors.push({ field: "vless.auth_mode", message: "Недопустимый authMode" });
  }
  if (!SUBSCRIPTION_FLOWS.includes(settings.flow)) {
    errors.push({ field: "flow", message: "Недопустимый flow" });
  }
  if (settings.flow === "xtls-rprx-vision" && settings.network !== "tcp") {
    errors.push({
      field: "network",
      message: "flow xtls-rprx-vision требует network tcp",
    });
  }
  if (!settings.network) errors.push({ field: "network", message: "Выберите network" });
  if (!settings.security) errors.push({ field: "security", message: "Выберите security" });
  if (!SUBSCRIPTION_FINGERPRINTS.includes(settings.reality.fingerprint as SubscriptionFingerprint)) {
    errors.push({ field: "reality.fingerprint", message: "Недопустимый fingerprint" });
  }
  const qs = settings.dns.query_strategy;
  if (!["UseIP", "UseIPv4", "UseIPv6", "UseIPv4v6"].includes(qs)) {
    errors.push({ field: "dns.query_strategy", message: "Недопустимый queryStrategy" });
  }
  if (settings.security === "reality") {
    if (!settings.reality.public_key.trim()) errors.push({ field: "reality.public_key", message: "Укажите Reality pbk" });
    if (!settings.reality.server_name.trim()) errors.push({ field: "reality.server_name", message: "Укажите Reality SNI" });
    if (!settings.reality.short_id.trim()) errors.push({ field: "reality.short_id", message: "Укажите Reality shortId" });
  }
  const spx = settings.reality.spider_x.trim() || "/";
  if (!spx.startsWith("/")) errors.push({ field: "reality.spider_x", message: "spiderX должен начинаться с /" });
  return errors;
}

export function subscriptionSettingsToApi(settings: ServerSubscriptionSettings) {
  return settings;
}
