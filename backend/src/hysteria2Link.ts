import type { ServerRow, UserRow } from "./db.js";
import { HYSTERIA2_DEFAULT_SNI } from "./hysteria2Constants.js";
import { countryFlagEmoji } from "./serverDisplay.js";

/** Auth userpass: username=password=vless_uuid. */
export function buildHysteria2UriForUser(server: ServerRow, user: UserRow): string {
  const uuid = String(user.vless_uuid ?? "").trim();
  if (!uuid) return "";
  const host = String(server.host ?? "").trim();
  if (!host) return "";
  const rawPort = Math.floor(Number(server.hysteria2_port) || 0);
  const port = rawPort >= 1024 && rawPort <= 65535 ? rawPort : 36712;
  if (!port) return "";
  const sni = String(server.hysteria2_sni ?? "").trim() || HYSTERIA2_DEFAULT_SNI;
  const pin = String(server.hysteria2_cert_sha256 ?? "")
    .trim()
    .replace(/:/g, "")
    .toLowerCase();
  const flag = countryFlagEmoji(server.country_code);
  const baseName = String(server.name || host).trim() || host;
  const remark = `${flag ? `${flag} ` : ""}${baseName} HY2 · ${user.name}`.trim();
  const q = new URLSearchParams();
  q.set("sni", sni);
  // Xray-клиенты (Happ/Incy): insecure→allowInsecure запрещён; pin через pinSHA256/pcs
  if (pin) {
    q.set("pinSHA256", pin);
    q.set("pcs", pin);
  } else {
    q.set("insecure", "1");
  }
  const auth = `${encodeURIComponent(uuid)}:${encodeURIComponent(uuid)}`;
  return `hysteria2://${auth}@${host}:${port}/?${q.toString()}#${encodeURIComponent(remark)}`;
}
