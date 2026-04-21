import type { ServerRow, UserRow } from "./db.js";

export type VlessLinkUserSlice = Pick<
  UserRow,
  "flow" | "remote_port" | "reality_pbk" | "reality_fp" | "reality_sni" | "reality_sid" | "reality_spx"
>;

export type VlessLinkServerSlice = Pick<
  ServerRow,
  | "vless_port"
  | "sub_network"
  | "sub_security"
  | "sub_type"
  | "sub_host"
  | "sub_path"
  | "sub_sni"
  | "sub_fp"
  | "sub_alpn"
  | "sub_allow_insecure"
  | "sub_reality_pbk"
  | "sub_reality_sid"
  | "sub_reality_spx"
>;

function pickStr(serverVal: string, userVal: string): string {
  const s = (serverVal ?? "").trim();
  if (s) return s;
  return (userVal ?? "").trim();
}

/**
 * VLESS URI для подписки: Reality из импорта x-ui или TCP без TLS (как в панели).
 */
/** Подпись узла в подписке: сервер, имя клиента и при необходимости комментарий (как в x-ui). */
export function vlessListLabel(serverName: string, user: Pick<UserRow, "name" | "comment">): string {
  const base = `${serverName} (${user.name})`;
  const note = (user.comment || "").trim();
  if (!note || note === user.name.trim()) return base;
  return `${base} · ${note}`;
}

export function buildVlessUriForUser(
  host: string,
  serverVlessPort: number,
  uuid: string,
  label: string,
  user: VlessLinkUserSlice,
  server?: VlessLinkServerSlice,
): string {
  const enc = encodeURIComponent(label || "vpn");
  const port = user.remote_port != null && user.remote_port > 0 ? user.remote_port : serverVlessPort;

  const srvSec = (server?.sub_security ?? "").trim().toLowerCase();
  const srvNet = (server?.sub_network ?? "").trim().toLowerCase();
  const srvType = (server?.sub_type ?? "").trim().toLowerCase();

  const pbk = pickStr(server?.sub_reality_pbk ?? "", user.reality_pbk);
  const sid = pickStr(server?.sub_reality_sid ?? "", user.reality_sid);
  const sni = pickStr(server?.sub_sni ?? "", user.reality_sni);
  const fp = pickStr(server?.sub_fp ?? "", user.reality_fp) || "chrome";
  const spx = pickStr(server?.sub_reality_spx ?? "", user.reality_spx) || "/";

  const secKnown = srvSec === "reality" || srvSec === "tls" || srvSec === "none";
  const allowUserRealityFallback = !secKnown;
  const hasReality =
    (srvSec === "reality" || (allowUserRealityFallback && Boolean(pbk))) &&
    Boolean(sni) &&
    Boolean(sid) &&
    Boolean(pbk);

  if (hasReality) {
    const q = new URLSearchParams({
      type: "tcp",
      encryption: "none",
      security: "reality",
      pbk,
      fp,
      sni,
      sid,
      spx,
    });
    const f = (user.flow ?? "").trim();
    if (f && f !== "xtls-rprx-vision" && f !== "xtls-rprx-vision-udp443") q.set("flow", f);
    else q.set("flow", "xtls-rprx-vision");
    return `vless://${uuid}@${host}:${port}?${q.toString()}#${enc}`;
  }

  const tlsSni = pickStr(server?.sub_sni ?? "", user.reality_sni);
  const tlsFp = pickStr(server?.sub_fp ?? "", user.reality_fp) || "chrome";
  const tlsAlpn = (server?.sub_alpn ?? "").trim();
  const insecure = server?.sub_allow_insecure === 1 ? 1 : 0;
  const transportNet =
    srvNet ||
    (srvType === "ws" || srvType === "grpc" || srvType === "http" ? srvType : "");
  const useTls =
    tlsSni &&
    (srvSec === "tls" ||
      (srvSec !== "reality" && (transportNet === "ws" || transportNet === "grpc" || transportNet === "http")));

  if (useTls) {
    const q = new URLSearchParams({
      type: srvType && srvType !== "tcp" ? srvType : "tcp",
      encryption: "none",
      security: "tls",
      sni: tlsSni,
      fp: tlsFp,
    });
    if (tlsAlpn) q.set("alpn", tlsAlpn);
    if (insecure === 1) q.set("allowInsecure", "1");

    if (transportNet === "ws") {
      q.set("type", "ws");
      const h = (server?.sub_host ?? "").trim();
      const pth = (server?.sub_path ?? "").trim();
      if (h) q.set("host", h);
      if (pth) q.set("path", pth);
    } else if (transportNet === "grpc") {
      q.set("type", "grpc");
      const svc = (server?.sub_path ?? "").trim();
      if (svc) q.set("serviceName", svc);
      const auth = (server?.sub_host ?? "").trim();
      if (auth) q.set("authority", auth);
    } else {
      const typ = srvType && srvType !== "tcp" ? srvType : "tcp";
      q.set("type", typ);
      if (typ === "http") {
        const h = (server?.sub_host ?? "").trim();
        const pth = (server?.sub_path ?? "").trim();
        if (h) q.set("host", h);
        if (pth) q.set("path", pth);
      }
    }

    const f = (user.flow ?? "").trim();
    if (f && f !== "xtls-rprx-vision" && f !== "xtls-rprx-vision-udp443") q.set("flow", f);
    return `vless://${uuid}@${host}:${port}?${q.toString()}#${enc}`;
  }

  const q = new URLSearchParams({
    encryption: "none",
    security: "none",
    type: "tcp",
  });
  const f = (user.flow ?? "").trim();
  /**
   * Vision / REALITY-flow без reality_pbk даёт невалидный URI (security=none + vision) — клиенты его игнорируют.
   * В этом случае не подставляем flow вообще (plain TCP VLESS).
   */
  if (
    f &&
    f !== "xtls-rprx-vision" &&
    f !== "xtls-rprx-vision-udp443"
  ) {
    q.set("flow", f);
  }
  return `vless://${uuid}@${host}:${port}?${q.toString()}#${enc}`;
}

export function buildVlessUri(host: string, port: number, uuid: string, name: string): string {
  return buildVlessUriForUser(host, port, uuid, name, {
    flow: "",
    remote_port: null,
    reality_pbk: "",
    reality_fp: "chrome",
    reality_sni: "",
    reality_sid: "",
    reality_spx: "/",
  });
}

export function buildSubscriptionPayload(links: string[]): string {
  const body = links.join("\n");
  return Buffer.from(body, "utf8").toString("base64");
}
