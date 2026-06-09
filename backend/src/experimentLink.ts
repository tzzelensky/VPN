import type { VpnExperimentRow } from "./db.js";
import { buildSubscriptionPayload } from "./vlessLink.js";

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function maskSecret(value: string, visible = 4): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (v.length <= visible * 2) return "***";
  return `${v.slice(0, visible)}…${v.slice(-visible)}`;
}

export function maskUuid(uuid: string): string {
  return maskSecret(uuid, 4);
}

export function maskLogLine(line: string): string {
  let out = line;
  out = out.replace(UUID_RE, "********-****-****-****-************");
  out = out.replace(/("(?:privateKey|publicKey|shortIds?)"\s*:\s*")([^"]{6,})(")/gi, '$1[masked]$3');
  return out;
}

/** fp в URI — только значения, которые понимают Happ / v2rayNG. */
export function experimentFpForClient(fp: string): string {
  const v = (fp ?? "").trim().toLowerCase();
  if (v === "firefox" || v === "safari" || v === "chrome" || v === "ios" || v === "android") return v;
  return "chrome";
}

function experimentFragmentLabel(exp: Pick<VpnExperimentRow, "id" | "name">): string {
  const ascii = `EXP-${exp.id}`;
  return encodeURIComponent(ascii);
}

export function buildExperimentVlessUri(
  host: string,
  exp: Pick<
    VpnExperimentRow,
    | "id"
    | "vless_uuid"
    | "port"
    | "network"
    | "security"
    | "flow"
    | "fingerprint"
    | "server_name"
    | "reality_pbk"
    | "reality_sid"
    | "reality_spx"
    | "ws_path"
    | "grpc_service"
    | "name"
  >,
): string {
  const pbk = (exp.reality_pbk ?? "").trim();
  const sid = (exp.reality_sid ?? "").trim();
  const sni = (exp.server_name ?? "").trim();
  if (!pbk || !sid || !sni) {
    throw new Error("experiment_reality_incomplete");
  }

  const net = exp.network === "ws" || exp.network === "grpc" ? exp.network : "tcp";
  const fp = experimentFpForClient(exp.fingerprint);
  const label = experimentFragmentLabel(exp);

  if (exp.security === "reality") {
    const q = new URLSearchParams({
      type: net,
      encryption: "none",
      security: "reality",
      pbk,
      fp,
      sni,
      sid,
      spx: (exp.reality_spx ?? "").trim() || "/",
    });
    if (net === "tcp") {
      const f = (exp.flow ?? "").trim();
      if (f) q.set("flow", f === "xtls-rprx-vision-udp443" ? "xtls-rprx-vision" : f);
    }
    if (net === "ws") {
      if (exp.ws_path) q.set("path", exp.ws_path);
      q.set("host", sni);
    }
    if (net === "grpc") {
      if (exp.grpc_service) q.set("serviceName", exp.grpc_service);
      q.set("mode", "gun");
    }
    return `vless://${exp.vless_uuid}@${host}:${exp.port}?${q.toString()}#${label}`;
  }

  const q = new URLSearchParams({
    type: net,
    encryption: "none",
    security: exp.security === "tls" ? "tls" : "none",
  });
  if (exp.security === "tls") {
    q.set("sni", sni);
    q.set("fp", fp);
  }
  if (net === "ws" && exp.ws_path) {
    q.set("path", exp.ws_path);
    q.set("host", sni);
  }
  if (net === "grpc" && exp.grpc_service) {
    q.set("serviceName", exp.grpc_service);
    q.set("mode", "gun");
  }
  return `vless://${exp.vless_uuid}@${host}:${exp.port}?${q.toString()}#${label}`;
}

/** Через /api/exp-sub — nginx уже проксирует /api/ на Node. */
export function publicExperimentSubUrl(subToken: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");
  const path = `/api/exp-sub/${encodeURIComponent(subToken)}`;
  if (!base) return path;
  return `${base}${path}`;
}

export function buildExperimentSubscriptionPayload(uri: string): string {
  return buildSubscriptionPayload([uri]);
}
