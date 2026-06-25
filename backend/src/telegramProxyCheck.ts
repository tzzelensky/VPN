import net from "node:net";
import type { TelegramProxyRow, TelegramProxyStatus } from "./telegramProxiesTypes.js";
import { mtprotoSecretForTelegramLink, mtprotoSecretFrontingHost } from "./telegramProxyDeploy.js";

export type ProxyCheckResult = {
  status: TelegramProxyStatus;
  latency_ms: number | null;
  error_message: string | null;
};

function tcpCheck(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; latency: number | null; error: string | null }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean, error: string | null) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve({ ok, latency: ok ? Date.now() - started : null, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, null));
    socket.once("timeout", () => finish(false, "Таймаут подключения"));
    socket.once("error", (e) => finish(false, e.message || "Ошибка TCP"));
    socket.connect(port, host);
  });
}

export async function checkTelegramProxyReachability(
  proxy: Pick<TelegramProxyRow, "host" | "port" | "type" | "auth_enabled" | "username" | "password">,
  timeoutMs: number,
): Promise<ProxyCheckResult> {
  const host = proxy.host.trim();
  const port = Math.floor(Number(proxy.port));
  if (!host || !Number.isFinite(port) || port < 1) {
    return { status: "unavailable", latency_ms: null, error_message: "Некорректный host/port" };
  }

  const tcp = await tcpCheck(host, port, timeoutMs);
  if (!tcp.ok) {
    const status: TelegramProxyStatus = tcp.error?.includes("Таймаут") ? "timeout" : "unavailable";
    return { status, latency_ms: null, error_message: tcp.error };
  }

  // MTProto: TCP open is sufficient minimum check
  if (proxy.type === "mtproto") {
    return { status: "available", latency_ms: tcp.latency, error_message: null };
  }

  // SOCKS5/HTTP: TCP + note if auth required (deep auth test optional later)
  if (proxy.auth_enabled && (!proxy.username || !proxy.password)) {
    return { status: "auth_error", latency_ms: tcp.latency, error_message: "Включена авторизация, но нет логина/пароля" };
  }

  return { status: "available", latency_ms: tcp.latency, error_message: null };
}

export function buildMtprotoLinks(host: string, port: number, secret: string): { tg: string; tme: string } {
  const h = encodeURIComponent(host.trim());
  const p = String(port);
  const linkSecret = mtprotoSecretForTelegramLink(secret);
  const s = encodeURIComponent(linkSecret);
  const q = `server=${h}&port=${p}&secret=${s}`;
  return {
    tg: `tg://proxy?${q}`,
    tme: `https://t.me/proxy?${q}`,
  };
}

export function buildSocks5Links(
  host: string,
  port: number,
  username?: string,
  password?: string,
): { tg: string; tme: string } {
  const h = encodeURIComponent(host.trim());
  const p = String(port);
  let q = `server=${h}&port=${p}`;
  const user = String(username ?? "").trim();
  const pass = String(password ?? "").trim();
  if (user) q += `&user=${encodeURIComponent(user)}`;
  if (pass) q += `&pass=${encodeURIComponent(pass)}`;
  return {
    tg: `tg://socks?${q}`,
    tme: `https://t.me/socks?${q}`,
  };
}

export function buildProxyConnectionText(proxy: TelegramProxyRow): string {
  if (proxy.type === "mtproto") {
    const links = buildMtprotoLinks(proxy.host, proxy.port, proxy.secret);
    const sni = mtprotoSecretFrontingHost(proxy.secret);
    const sniLine = sni ? `\nFakeTLS SNI: ${sni}` : "";
    return `MTProto${sniLine}\n${links.tg}\n${links.tme}`;
  }
  if (proxy.type === "socks5") {
    const links = buildSocks5Links(
      proxy.host,
      proxy.port,
      proxy.auth_enabled ? proxy.username : undefined,
      proxy.auth_enabled ? proxy.password : undefined,
    );
    const auth =
      proxy.auth_enabled && proxy.username
        ? `\nЛогин: ${proxy.username}\nПароль: ${proxy.password}`
        : "\nБез авторизации";
    return `SOCKS5\n${links.tg}\n${links.tme}\nHost: ${proxy.host}\nPort: ${proxy.port}${auth}`;
  }
  const auth =
    proxy.auth_enabled && proxy.username
      ? `\nЛогин: ${proxy.username}\nПароль: ${proxy.password}`
      : "\nБез авторизации";
  return `HTTP\nHost: ${proxy.host}\nPort: ${proxy.port}${auth}\n(в Telegram HTTP-прокси настраивается вручную, без tg:// ссылки)`;
}

export function maskSecret(value: string): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return `${v.slice(0, 2)}${"•".repeat(Math.min(12, v.length - 4))}${v.slice(-2)}`;
}
