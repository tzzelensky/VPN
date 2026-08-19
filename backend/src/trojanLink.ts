import type { ServerRow, UserRow } from "./db.js";
import { TROJAN_DEFAULT_PORT, TROJAN_DEFAULT_SNI } from "./trojanConstants.js";
import { countryFlagEmoji } from "./serverDisplay.js";

/** Пароль Trojan = vless_uuid пользователя (как HY2 userpass). */
export function buildTrojanUriForUser(server: ServerRow, user: UserRow): string {
  const uuid = String(user.vless_uuid ?? "").trim();
  if (!uuid) return "";
  const host = String(server.host ?? "").trim();
  if (!host) return "";
  const rawPort = Math.floor(Number(server.trojan_port) || 0);
  const port = rawPort >= 1 && rawPort <= 65535 ? rawPort : TROJAN_DEFAULT_PORT;
  if (!port) return "";
  const sni = String(server.trojan_sni ?? "").trim() || TROJAN_DEFAULT_SNI;
  const pin = String(server.trojan_cert_sha256 ?? "")
    .trim()
    .replace(/:/g, "")
    .toLowerCase();
  const flag = countryFlagEmoji(server.country_code);
  const baseName = String(server.name || host).trim() || host;
  const remark = `${flag ? `${flag} ` : ""}${baseName} Trojan · ${user.name}`.trim();
  const q = new URLSearchParams();
  q.set("security", "tls");
  q.set("type", "tcp");
  q.set("sni", sni);
  q.set("fp", "chrome");
  if (pin) {
    q.set("pinSHA256", pin);
    q.set("pcs", pin);
  } else {
    q.set("allowInsecure", "1");
  }
  return `trojan://${encodeURIComponent(uuid)}@${host}:${port}?${q.toString()}#${encodeURIComponent(remark)}`;
}
