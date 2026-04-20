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

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function firstStr(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0].trim();
  return "";
}

/** Вытащить параметры для VLESS URI из inbound после деплоя (x-ui Reality/TLS/WS и т.д.). */
export function extractVlessLinkHintsFromConfig(config: Record<string, unknown>): ServerLinkHints {
  const out = emptyHints();
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) return out;

  const ib =
    (inbounds.find((x) => (x as { tag?: string }).tag === TZADMIN_VLESS_TAG) as
      | Record<string, unknown>
      | undefined) ??
    (inbounds.find((x) => String((x as { protocol?: string }).protocol ?? "").toLowerCase() === "vless") as
      | Record<string, unknown>
      | undefined);
  if (!ib) return out;

  const ss = (ib.streamSettings as Record<string, unknown>) || {};
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
    const tls = (ss.tlsSettings as Record<string, unknown>) || {};
    out.sub_sni = str(tls.serverName);
    out.sub_alpn = firstStr(tls.alpn);
    out.sub_fp = str(tls.fingerprint);
    out.sub_allow_insecure = tls.allowInsecure === true || tls.allowInsecure === 1 || tls.allowInsecure === "1" ? 1 : 0;
  } else if (secRaw === "reality") {
    const rs = (ss.realitySettings as Record<string, unknown>) || {};
    const rsSettings = (rs.settings as Record<string, unknown>) || {};
    out.sub_reality_pbk = str(rs.publicKey) || str(rsSettings.publicKey);
    out.sub_reality_sid = str(rs.shortId) || firstStr(rs.shortIds);
    out.sub_reality_spx = str(rs.spiderX) || str(rsSettings.spiderX) || "/";
    out.sub_sni = str(rs.serverName) || firstStr(rs.serverNames);
    out.sub_fp = str(rs.fingerprint) || str(rsSettings.fingerprint) || "chrome";
  }

  return out;
}
