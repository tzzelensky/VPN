import type { ServerRow, UserRow } from "./db.js";
import type { ServerSubscriptionSettings } from "./serverSubscriptionSettings.js";
import { resolveSubscriptionAddress, resolveSubscriptionRemarks, resolveSubscriptionEncryption, resolveSubscriptionFlow } from "./serverSubscriptionSettings.js";

export type VlessLinkUserSlice = Pick<
  UserRow,
  | "flow"
  | "remote_port"
  | "reality_pbk"
  | "reality_fp"
  | "reality_sni"
  | "reality_sid"
  | "reality_spx"
  | "connection_profile"
>;

export type VlessLinkServerSlice = Pick<
  ServerRow,
  | "vless_port"
  | "sub_port"
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
 * VLESS URI из индивидуальных настроек подписки сервера.
 */
export function buildVlessUriFromSubscriptionSettings(
  server: Pick<ServerRow, "host" | "name" | "country_code">,
  user: VlessLinkUserSlice & Pick<UserRow, "vless_uuid" | "name">,
  settings: ServerSubscriptionSettings,
): string {
  const address = resolveSubscriptionAddress(server as ServerRow, settings);
  const label = resolveSubscriptionRemarks(server as ServerRow, settings, user);
  const enc = encodeURIComponent(label || "vpn");
  const port = settings.vless_port;
  const uuid = user.vless_uuid;
  const encryption = resolveSubscriptionEncryption(settings);
  const fp = settings.reality.fingerprint.trim() || "chrome";
  const flow = resolveSubscriptionFlow(settings);

  if (settings.security === "reality") {
    const q = new URLSearchParams({
      type: settings.network === "tcp" ? "tcp" : settings.network,
      encryption,
      security: "reality",
      pbk: settings.reality.public_key,
      fp,
      sni: settings.reality.server_name,
      sid: settings.reality.short_id,
      spx: settings.reality.spider_x.trim() || "/",
    });
    if (settings.reality.allow_insecure) q.set("allowInsecure", "1");
    if (flow) q.set("flow", flow);
    applyTransportQuery(q, settings);
    return `vless://${uuid}@${address}:${port}?${q.toString()}#${enc}`;
  }

  if (settings.security === "tls") {
    const q = new URLSearchParams({
      type: settings.network === "tcp" ? "tcp" : settings.network,
      encryption,
      security: "tls",
      sni: settings.reality.server_name,
      fp,
    });
    if (settings.reality.allow_insecure) q.set("allowInsecure", "1");
    applyTransportQuery(q, settings);
    if (flow) q.set("flow", flow);
    return `vless://${uuid}@${address}:${port}?${q.toString()}#${enc}`;
  }

  const q = new URLSearchParams({
    encryption,
    security: "none",
    type: settings.network === "tcp" ? "tcp" : settings.network,
  });
  applyTransportQuery(q, settings);
  if (flow) q.set("flow", flow);
  return `vless://${uuid}@${address}:${port}?${q.toString()}#${enc}`;
}

function applyTransportQuery(q: URLSearchParams, settings: ServerSubscriptionSettings): void {
  if (settings.network === "ws") {
    q.set("type", "ws");
    if (settings.ws.host) q.set("host", settings.ws.host);
    if (settings.ws.path) q.set("path", settings.ws.path);
  } else if (settings.network === "grpc") {
    q.set("type", "grpc");
    if (settings.grpc.service_name) q.set("serviceName", settings.grpc.service_name);
    if (settings.grpc.authority) q.set("authority", settings.grpc.authority);
  }
}

/**
 * VLESS URI для подписки: Reality из импорта x-ui или TCP без TLS (как в панели).
 * @deprecated Prefer buildVlessUriFromSubscriptionSettings for panel servers.
 */
/** Подпись узла в подписке: только сервер и имя клиента (внутренние заметки не публикуем). */
export function vlessListLabel(serverName: string, user: Pick<UserRow, "name" | "comment">): string {
  return `${serverName} (${user.name})`;
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
  const panelPort = Number(serverVlessPort) || 0;
  const hintedPort =
    server && Number(server.sub_port) > 0 ? Number(server.sub_port) : panelPort;

  const srvSec = (server?.sub_security ?? "").trim().toLowerCase();
  const srvNet = (server?.sub_network ?? "").trim().toLowerCase();
  const srvType = (server?.sub_type ?? "").trim().toLowerCase();

  const pbk = pickStr(server?.sub_reality_pbk ?? "", user.reality_pbk);
  const sid = pickStr(server?.sub_reality_sid ?? "", user.reality_sid);
  const sni = pickStr(server?.sub_sni ?? "", user.reality_sni);
  const fp = pickStr(server?.sub_fp ?? "", user.reality_fp) || "chrome";
  const spx = pickStr(server?.sub_reality_spx ?? "", user.reality_spx) || "/";

  const secKnown = srvSec === "reality" || srvSec === "tls" || srvSec === "none";
  const profileWantsReality = (user.connection_profile ?? "legacy") === "reality";
  const userRealityPort = user.remote_port != null && user.remote_port > 0 ? Number(user.remote_port) : 0;
  const serverPort = Number(hintedPort) || panelPort || 0;
  const matchesServerByPort =
    userRealityPort > 0 && (userRealityPort === serverPort || (panelPort > 0 && userRealityPort === panelPort));
  // Явный профайл reality применяем только к целевому порту (обычно NL Reality inbound),
  // чтобы не ломать остальные узлы в подписке.
  const allowProfileRealityOnThisServer =
    profileWantsReality && (userRealityPort <= 0 || matchesServerByPort);
  const allowUserRealityFallback = !secKnown || allowProfileRealityOnThisServer;
  const port = allowProfileRealityOnThisServer && userRealityPort > 0 ? userRealityPort : hintedPort;
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
    connection_profile: "legacy",
  });
}

export function buildSubscriptionPayload(links: string[]): string {
  const body = links.join("\n");
  return Buffer.from(body, "utf8").toString("base64");
}

function buildNoticeVlessUri(label: string): string {
  const enc = encodeURIComponent(label.trim() || "VPN");
  // Специальная «заглушка» для клиентов подписки: показывается как сервер в списке,
  // но подключение к ней не рабочее и лишь доносит текст уведомления пользователю.
  return `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:443?encryption=none&security=none&type=tcp#${enc}`;
}

export function buildSubscriptionNoticePayload(lines: string[]): string {
  const links = lines
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .map((x) => buildNoticeVlessUri(x));
  return buildSubscriptionPayload(links);
}
