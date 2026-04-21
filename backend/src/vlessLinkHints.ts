import { x25519 } from "@noble/curves/ed25519.js";
import { TZADMIN_VLESS_TAG } from "./ssh.js";

export type ServerLinkHints = {
  sub_port: number;
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
  sub_port: 0,
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

function listVlessInbounds(inbounds: unknown[]): Record<string, unknown>[] {
  return inbounds.filter(
    (x) => String((x as { protocol?: string }).protocol ?? "").toLowerCase() === "vless",
  ) as Record<string, unknown>[];
}

function hintScore(h: ServerLinkHints): number {
  const sec = (h.sub_security ?? "").toLowerCase();
  let s = 0;
  if (sec === "reality") s += 200;
  if (sec === "tls") s += 100;
  if (String(h.sub_reality_pbk ?? "").trim()) s += 80;
  if (String(h.sub_sni ?? "").trim()) s += 20;
  if (String(h.sub_reality_sid ?? "").trim()) s += 15;
  if (String(h.sub_network ?? "").trim()) s += 1;
  return s;
}

function firstStr(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item !== "string") continue;
      const t = item.trim();
      if (t) return t;
    }
  }
  return "";
}

function firstRealityShortId(rs: Record<string, unknown>): string {
  const one = str(rs.shortId);
  if (one) return one;
  const raw = rs.shortIds;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("[")) {
      try {
        const a = JSON.parse(t) as unknown;
        if (Array.isArray(a) && a.length > 0 && typeof a[0] === "string") return a[0].trim();
      } catch {
        /* ignore */
      }
    }
    if (/^[0-9a-f]+$/i.test(t) || /^[a-zA-Z0-9_-]+$/.test(t)) return t;
  }
  return firstStr(raw);
}

function realityPrivateKeyFromBlocks(rs: Record<string, unknown>, rsSettings: Record<string, unknown>): string {
  for (const k of ["privateKey", "private_key", "PrivateKey"] as const) {
    const a = str((rs as Record<string, unknown>)[k]);
    if (a) return a;
    const b = str((rsSettings as Record<string, unknown>)[k]);
    if (b) return b;
  }
  return "";
}

function realityPublicKeyFromBlocks(rs: Record<string, unknown>, rsSettings: Record<string, unknown>): string {
  for (const k of ["publicKey", "public_key", "PublicKey"] as const) {
    const a = str((rs as Record<string, unknown>)[k]);
    if (a) return a;
    const b = str((rsSettings as Record<string, unknown>)[k]);
    if (b) return b;
  }
  return "";
}

/** Параметры подписки из одного VLESS inbound. */
function extractVlessLinkHintsFromInbound(ib: Record<string, unknown>): ServerLinkHints {
  const out = emptyHints();
  const p = Number(ib.port);
  out.sub_port = Number.isFinite(p) && p > 0 ? p : 0;
  const ss = streamSettingsOfInbound(ib);
  const net = str(ss.network).toLowerCase() || "tcp";
  out.sub_network = net;
  out.sub_type = net === "tcp" ? "tcp" : net;

  const secRaw = str(ss.security).toLowerCase();
  out.sub_security = secRaw;

  if (net === "tcp") {
    const tcp = asRecord(ss.tcpSettings);
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
    const ws = asRecord(ss.wsSettings);
    const wh = (ws.headers as Record<string, unknown> | undefined) ?? {};
    out.sub_host = str(wh.Host) || str(wh.host);
    out.sub_path = str(ws.path);
    out.sub_type = "ws";
  } else if (net === "grpc") {
    const g = asRecord(ss.grpcSettings);
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
    out.sub_reality_pbk = realityPublicKeyFromBlocks(rs, rsSettings);
    out.sub_reality_sid = firstRealityShortId(rs);
    out.sub_reality_spx = str(rs.spiderX) || str(rsSettings.spiderX) || "/";
    out.sub_sni = str(rs.serverName) || firstStr(rs.serverNames);
    out.sub_fp = str(rs.fingerprint) || str(rsSettings.fingerprint) || "chrome";
  }

  return out;
}

function orderedVlessInboundsForHints(
  inbounds: unknown[],
  preferredPort?: number,
): Record<string, unknown>[] {
  const vless = listVlessInbounds(inbounds);
  const primary = pickVlessInbound(inbounds, preferredPort);
  const ordered: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const push = (ib: Record<string, unknown> | undefined) => {
    if (!ib || seen.has(ib)) return;
    seen.add(ib);
    ordered.push(ib);
  };
  push(primary);
  for (const ib of vless) {
    if (streamSecurityOfInbound(ib) === "reality") push(ib);
  }
  for (const ib of vless) push(ib);
  return ordered;
}

/** Вытащить параметры для VLESS URI из inbound после деплоя (x-ui Reality/TLS/WS и т.д.). */
export function extractVlessLinkHintsFromConfig(
  config: Record<string, unknown>,
  preferredPort?: number,
): ServerLinkHints {
  const out = emptyHints();
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) return out;

  // Если панельный inbound уже есть, используем строго его:
  // иначе можно "перепрыгнуть" на более "богатый" Reality inbound x-ui.
  const tagged = inbounds.find(
    (x) =>
      String((x as { protocol?: string }).protocol ?? "").toLowerCase() === "vless" &&
      (x as { tag?: string }).tag === TZADMIN_VLESS_TAG,
  ) as Record<string, unknown> | undefined;
  if (tagged) return extractVlessLinkHintsFromInbound(tagged);

  const tryIbs = orderedVlessInboundsForHints(inbounds, preferredPort);
  if (tryIbs.length === 0) return out;

  let best = emptyHints();
  let bestScore = -1;
  for (const ib of tryIbs) {
    const h = extractVlessLinkHintsFromInbound(ib);
    const sc = hintScore(h);
    if (sc > bestScore) {
      best = h;
      bestScore = sc;
    }
    if (
      (h.sub_security ?? "").toLowerCase() === "reality" &&
      String(h.sub_reality_pbk ?? "").trim() &&
      String(h.sub_sni ?? "").trim()
    ) {
      best = h;
      break;
    }
  }
  return best;
}

/** Нужен для случаев x-ui, где есть только realitySettings.privateKey (без publicKey). */
export function extractRealityPrivateKeyFromConfig(
  config: Record<string, unknown>,
  preferredPort?: number,
): string {
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) return "";
  for (const ib of orderedVlessInboundsForHints(inbounds, preferredPort)) {
    const ss = streamSettingsOfInbound(ib);
    if (str(ss.security).toLowerCase() !== "reality") continue;
    const rs = asRecord(ss.realitySettings);
    const rsSettings = asRecord(rs.settings);
    const pk = realityPrivateKeyFromBlocks(rs, rsSettings);
    if (pk) return pk;
  }
  return "";
}

/** 32 байта: hex (64 символа) или base64 / base64url (как в JSON xray / x-ui). */
function decodeRealityKey32(raw: string): Uint8Array | null {
  let t = raw.replace(/\s+/g, "").trim();
  if (!t) return null;
  if (t.startsWith("0x") || t.startsWith("0X")) t = t.slice(2);
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    return Uint8Array.from(Buffer.from(t, "hex"));
  }
  try {
    const bufUrl = Buffer.from(t, "base64url");
    if (bufUrl.length === 32) return new Uint8Array(bufUrl);
  } catch {
    /* ignore */
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
