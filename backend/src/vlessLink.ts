import type { UserRow } from "./db.js";

export type VlessLinkUserSlice = Pick<
  UserRow,
  "flow" | "remote_port" | "reality_pbk" | "reality_fp" | "reality_sni" | "reality_sid" | "reality_spx"
>;

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
): string {
  const enc = encodeURIComponent(label || "vpn");
  const port = user.remote_port != null && user.remote_port > 0 ? user.remote_port : serverVlessPort;
  const hasReality =
    Boolean(user.reality_pbk) && Boolean(user.reality_sni) && Boolean(user.reality_sid);

  if (hasReality) {
    const q = new URLSearchParams({
      type: "tcp",
      security: "reality",
      pbk: user.reality_pbk,
      fp: user.reality_fp || "chrome",
      sni: user.reality_sni,
      sid: user.reality_sid,
      spx: user.reality_spx || "/",
    });
    q.set("flow", "xtls-rprx-vision");
    return `vless://${uuid}@${host}:${port}?${q.toString()}#${enc}`;
  }

  const q = new URLSearchParams({
    encryption: "none",
    security: "none",
    type: "tcp",
  });
  const f = (user.flow ?? "").trim();
  /** Vision с security=none недопустим — клиенты отбрасывают такие узлы. */
  if (f && f !== "xtls-rprx-vision" && f !== "xtls-rprx-vision-udp443") q.set("flow", f);
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
