import { x25519 } from "@noble/curves/ed25519.js";
import { TZADMIN_VLESS_TAG } from "./ssh.js";

export type ServerLinkHints = {
  sub_network: string;
  sub_security: string;
  sub_type: string;
  sub_host: string;
  sub_path: string;
  sub_sni: string;
  sub_fp: string;
  sub_alpn: string;
  sub_allow_insecure: number;
  sub_reality_pbk: string;
  sub_reality_sid: string;
  sub_reality_spx: string;
};

const emptyHints = (): ServerLinkHints => ({
  sub_network: "",
  sub_security: "",
  sub_type: "",
  sub_host: "",
  sub_path: "",
  sub_sni: "",
  sub_fp: "",
  sub_alpn: "",
  sub_allow_insecure: 0,
  sub_reality_pbk: "",
  sub_reality_sid: "",
  sub_reality_spx: "",
});

function pickVlessInbound(
  inbounds: unknown[],
  preferredPort?: number,
): Record<string, unknown> | undefined {
  const byTag =
    (inbounds.find((x) => (x as { tag?: string }).tag === TZADMIN_VLESS_TAG) as
      | Record<string, unknown>
      | undefined);
  const byPort =
    preferredPort && Number.isFinite(preferredPort) && preferredPort > 0
      ? (inbounds.find(
          (x) =>
            String((x as { protocol?: string }).protocol ?? "").toLowerCase() === "vless" &&
            Number((x as { port?: unknown }).port) === preferredPort,
        ) as Record<string, unknown> | undefined)
      : undefined;
  const vlessList = inbounds.filter(
    (x) => String((x as { protocol?: string }).protocol ?? "").toLowerCase() === "vless",
  ) as Record<string, unknown>[];
  /** Иначе берём первый VLESS (часто «none»), а Reality на другом порту — pbk никогда не подтянется. */
  const realityIb = vlessList.find((ib) => streamSecurityOfInbound(ib) === "reality");
  const firstVless = vlessList[0];
  return byTag ?? byPort ?? realityIb ?? firstVless;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** x-ui / 3x-ui часто кладут `streamSettings` и вложенные блоки строками JSON. */
function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const o = JSON.parse(v) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
}

/** Разобранные streamSettings inbound (объект независимо от того, как записано в файле). */
export function streamSettingsOfInbound(ib: Record<string, unknown>): Record<string, unknown> {
  return asRecord(ib.streamSettings);
}

function streamSecurityOfInbound(ib: Record<string, unknown>): string {
  return str(streamSettingsOfInbound(ib).security).toLowerCase();
}

function firstStr(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0].trim();
  return "";
}

/** Вытащить параметры для VLESS URI из inbound после деплоя (x-ui Reality/TLS/WS и т.д.). */
export function extractVlessLinkHintsFromConfig(
  config: Record<string, unknown>,
  preferredPort?: number,
): ServerLinkHints {
  const out = emptyHints();
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) return out;

  const ib = pickVlessInbound(inbounds, preferredPort);
  if (!ib) return out;

  const ss = streamSettingsOfInbound(ib);
  const net = str(ss.network).toLowerCase() || "tcp";
  out.sub_network = net;
  out.sub_type = net === "tcp" ? "tcp" : net;

  const secRaw = str(ss.security).toLowerCase();
  out.sub_security = secRaw;

  if (net === "tcp") {
    const tcp = (ss.tcpSettings as Record<string, unknown>) || {};
    const hdr = (tcp.header as Record<string, unknown>) || {};
    const typ = str(hdr.type).toLowerCase();
    if (typ === "http") {
      const req = (hdr.request as Record<string, unknown>) || {};
      const headers = (req.headers as Array<Record<string, unknown>>) || [];
      const hostHdr = headers.find((h) => String(h?.name ?? "").toLowerCase() === "host");
      out.sub_host = str(hostHdr?.value);
      out.sub_path = str(req.path);
      out.sub_type = "http";
    }
  } else if (net === "ws") {
    const ws = (ss.wsSettings as Record<string, unknown>) || {};
    const wh = (ws.headers as Record<string, unknown> | undefined) ?? {};
    out.sub_host = str(wh.Host) || str(wh.host);
    out.sub_path = str(ws.path);
    out.sub_type = "ws";
  } else if (net === "grpc") {
    const g = (ss.grpcSettings as Record<string, unknown>) || {};
    out.sub_path = str(g.serviceName);
    out.sub_type = "grpc";
    out.sub_host = str(g.authority);
  }

  if (secRaw === "tls") {
    const tls = asRecord(ss.tlsSettings);
    out.sub_sni = str(tls.serverName);
    out.sub_alpn = firstStr(tls.alpn);
    out.sub_fp = str(tls.fingerprint);
    out.sub_allow_insecure = tls.allowInsecure === true || tls.allowInsecure === 1 || tls.allowInsecure === "1" ? 1 : 0;
  } else if (secRaw === "reality") {
    const rs = asRecord(ss.realitySettings);
    const rsSettings = asRecord(rs.settings);
    out.sub_reality_pbk = str(rs.publicKey) || str(rsSettings.publicKey);
    out.sub_reality_sid = str(rs.shortId) || firstStr(rs.shortIds);
    out.sub_reality_spx = str(rs.spiderX) || str(rsSettings.spiderX) || "/";
    out.sub_sni = str(rs.serverName) || firstStr(rs.serverNames);
    out.sub_fp = str(rs.fingerprint) || str(rsSettings.fingerprint) || "chrome";
  }

  return out;
}

/** Нужен для случаев x-ui, где есть только realitySettings.privateKey (без publicKey). */
export function extractRealityPrivateKeyFromConfig(
  config: Record<string, unknown>,
  preferredPort?: number,
): string {
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) return "";
  const ib = pickVlessInbound(inbounds, preferredPort);
  if (!ib) return "";
  const ss = streamSettingsOfInbound(ib);
  const secRaw = str(ss.security).toLowerCase();
  if (secRaw !== "reality") return "";
  const rs = asRecord(ss.realitySettings);
  const rsSettings = asRecord(rs.settings);
  return str(rs.privateKey) || str(rsSettings.privateKey);
}

/** 32 байта: hex (64 символа) или base64 / base64url (как в JSON xray / x-ui). */
function decodeRealityKey32(raw: string): Uint8Array | null {
  const t = raw.replace(/\s+/g, "").trim();
  if (!t) return null;
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    return Uint8Array.from(Buffer.from(t, "hex"));
  }
  let b64 = t.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length === 32) return new Uint8Array(buf);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Локальный pbk из privateKey конфига (если на ноде не сработал `xray x25519` по SSH).
 * Кодируем как base64url без padding — как в типичных VLESS Reality URI.
 */
export function deriveRealityPublicKeyFromPrivateLocal(privateKey: string): string {
  const sk = decodeRealityKey32(privateKey);
  if (!sk) return "";
  try {
    const pk = x25519.getPublicKey(sk);
    return Buffer.from(pk).toString("base64url");
  } catch {
    return "";
  }
}

/** Если Reality без publicKey в конфиге — дописать sub_reality_pbk из privateKey (локально). */
export function ensureRealityPublicKeyOnHintsFromConfig(
  config: Record<string, unknown>,
  hints: ServerLinkHints,
  preferredPort?: number,
): void {
  if ((hints.sub_security ?? "").toLowerCase() !== "reality") return;
  if (String(hints.sub_reality_pbk ?? "").trim()) return;
  const priv = extractRealityPrivateKeyFromConfig(config, preferredPort);
  if (!priv) return;
  const pbk = deriveRealityPublicKeyFromPrivateLocal(priv);
  if (pbk) hints.sub_reality_pbk = pbk;
}
