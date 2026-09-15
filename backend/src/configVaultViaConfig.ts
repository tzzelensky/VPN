/**
 * Проверка ключей конфиг-хранилища через сторонний клиентский конфиг:
 * локальный Xray (SOCKS на 127.0.0.1) + SOCKS5 CONNECT к host:port ключа.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { listUsers } from "./db.js";
import { shareLinkToHappProfile } from "./happSubscriptionJson.js";
import { primarySubscriptionUrl } from "./subscriptionUrl.js";
import { parseProxyUri } from "./configVaultUri.js";
import type { VlessProbeResult } from "./vlessKeyChecker.js";

const LOCAL_XRAY_CANDIDATES = [
  "/usr/local/bin/xray",
  "/usr/bin/xray",
  "/usr/local/sbin/xray",
  "/usr/sbin/xray",
  "/usr/local/x-ui/bin/xray-linux-amd64",
  "/usr/local/x-ui/bin/xray",
];

export function findLocalXrayBinary(): string | null {
  for (const p of LOCAL_XRAY_CANDIDATES) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      s.close((err) => {
        if (err) reject(err);
        else if (!port) reject(new Error("Не удалось выделить порт"));
        else resolve(port);
      });
    });
    s.on("error", reject);
  });
}

function waitForTcp(host: string, port: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error("Xray SOCKS не поднялся вовремя"));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function socksInbound(port: number): Record<string, unknown> {
  return {
    listen: "127.0.0.1",
    port,
    protocol: "socks",
    settings: { auth: "noauth", udp: true },
    sniffing: { destOverride: ["http", "tls", "quic"], enabled: true, routeOnly: true },
    tag: "socks",
  };
}

function ensureProxyOutboundTag(profile: Record<string, unknown>): void {
  const outbounds = Array.isArray(profile.outbounds) ? (profile.outbounds as Record<string, unknown>[]) : [];
  const hasProxy = outbounds.some((o) => String(o.tag ?? "") === "proxy");
  if (!hasProxy && outbounds.length > 0) {
    const first = outbounds[0];
    const proto = String(first.protocol ?? "");
    if (proto && proto !== "freedom" && proto !== "blackhole" && proto !== "dns") {
      first.tag = "proxy";
    }
  }
  if (!profile.routing || typeof profile.routing !== "object" || Array.isArray(profile.routing)) {
    profile.routing = {
      domainStrategy: "IPIfNonMatch",
      rules: [{ type: "field", network: "tcp,udp", outboundTag: "proxy" }],
    };
  }
}

/**
 * URI → Happ-профиль; JSON → as-is с переписанным SOCKS inbound.
 */
export function buildViaConfigXrayJson(raw: string, socksPort: number): Record<string, unknown> {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("Сторонний конфиг пуст");

  let profile: Record<string, unknown> | null = null;
  if (/^(vless|trojan|hysteria2?|hy2):\/\//i.test(text)) {
    profile = shareLinkToHappProfile(text.split(/\r?\n/)[0]!.trim());
    if (!profile) throw new Error("Не удалось разобрать ссылку стороннего конфига");
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Сторонний конфиг: ожидается vless/trojan/hysteria2 или JSON");
    }
    if (Array.isArray(parsed)) {
      const first = parsed.find((x) => x && typeof x === "object") as Record<string, unknown> | undefined;
      if (!first) throw new Error("JSON-массив пуст");
      profile = { ...first };
    } else if (parsed && typeof parsed === "object") {
      profile = { ...(parsed as Record<string, unknown>) };
    } else {
      throw new Error("Некорректный JSON стороннего конфига");
    }
  }

  ensureProxyOutboundTag(profile);
  profile.inbounds = [socksInbound(socksPort)];
  if (!profile.log || typeof profile.log !== "object") {
    profile.log = { loglevel: "warning" };
  }
  return profile;
}

function socks5ConnectOnce(
  proxyHost: string,
  proxyPort: number,
  destHost: string,
  destPort: number,
  timeoutMs: number,
): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: proxyHost, port: proxyPort });
    let settled = false;
    let step: "greeting" | "connect" = "greeting";
    let buf = Buffer.alloc(0);

    const finish = (ok: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ok, latencyMs: Date.now() - started, error });
    };

    const timer = setTimeout(() => finish(false, "Таймаут SOCKS"), timeoutMs);

    socket.on("connect", () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (step === "greeting") {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x00) {
          finish(false, "SOCKS5: отказ в авторизации");
          return;
        }
        buf = buf.subarray(2);
        step = "connect";
        const hostBuf = Buffer.from(destHost, "utf8");
        const req = Buffer.alloc(7 + hostBuf.length);
        req[0] = 0x05;
        req[1] = 0x01; // CONNECT
        req[2] = 0x00;
        req[3] = 0x03; // domain
        req[4] = hostBuf.length;
        hostBuf.copy(req, 5);
        req.writeUInt16BE(destPort, 5 + hostBuf.length);
        socket.write(req);
        return;
      }
      if (buf.length < 5) return;
      const rep = buf[1];
      if (rep !== 0x00) {
        finish(false, `SOCKS5 CONNECT отказан (код ${rep})`);
        return;
      }
      finish(true, null);
    });

    socket.on("error", (err) => finish(false, err instanceof Error ? err.message : String(err)));
  });
}

export async function probeVlessEndpointViaSocks(
  rawUri: string,
  socksHost: string,
  socksPort: number,
  attempts: number,
  timeoutSec: number,
): Promise<VlessProbeResult> {
  const parsed = parseProxyUri(rawUri);
  if (!parsed) {
    return {
      attempts_total: attempts,
      attempts_success: 0,
      attempts_failed: attempts,
      avg_latency_ms: null,
      min_latency_ms: null,
      max_latency_ms: null,
      last_error: "Некорректная ссылка (vless://, trojan:// или hysteria2://)",
      status: "unavailable",
    };
  }
  return probeTcpHostPortViaSocks(parsed.address, parsed.port, socksHost, socksPort, attempts, timeoutSec);
}

/** TCP CONNECT через SOCKS5 к произвольному host:port (серверы панели). */
export async function probeTcpHostPortViaSocks(
  destHost: string,
  destPort: number,
  socksHost: string,
  socksPort: number,
  attempts: number,
  timeoutSec: number,
): Promise<VlessProbeResult> {
  const host = String(destHost ?? "").trim();
  const port = Math.floor(Number(destPort) || 0);
  if (!host || !(port >= 1 && port <= 65535)) {
    return {
      attempts_total: attempts,
      attempts_success: 0,
      attempts_failed: attempts,
      avg_latency_ms: null,
      min_latency_ms: null,
      max_latency_ms: null,
      last_error: "Некорректный host:port",
      status: "unavailable",
    };
  }
  const timeoutMs = Math.max(3000, Math.min(60000, timeoutSec * 1000));
  const total = Math.max(1, Math.min(10, attempts));
  const results: Array<{ ok: boolean; latencyMs: number; error: string | null }> = [];
  for (let i = 0; i < total; i++) {
    results.push(await socks5ConnectOnce(socksHost, socksPort, host, port, timeoutMs));
  }
  const latencies: number[] = [];
  let last_error: string | null = null;
  let success = 0;
  for (const r of results) {
    if (r.ok) {
      success += 1;
      latencies.push(r.latencyMs);
    } else {
      last_error = r.error;
    }
  }
  const failed = total - success;
  const avg =
    latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const min = latencies.length > 0 ? Math.min(...latencies) : null;
  const max = latencies.length > 0 ? Math.max(...latencies) : null;
  let status: "available" | "unavailable" | "unstable";
  if (success === total) status = "available";
  else if (success === 0) status = "unavailable";
  else status = "unstable";
  return {
    attempts_total: total,
    attempts_success: success,
    attempts_failed: failed,
    avg_latency_ms: avg,
    min_latency_ms: min,
    max_latency_ms: max,
    last_error,
    status,
  };
}

export type ViaConfigTunnel = {
  socksHost: string;
  socksPort: number;
  stop: () => Promise<void>;
};

export async function startViaConfigTunnel(rawConfig: string): Promise<ViaConfigTunnel> {
  const xrayBin = findLocalXrayBinary();
  if (!xrayBin) {
    throw new Error("На сервере панели нет xray. Установите Xray (/usr/local/bin/xray) или x-ui.");
  }
  const socksPort = await pickFreePort();
  const config = buildViaConfigXrayJson(rawConfig, socksPort);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpn-via-config-"));
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

  let child: ChildProcess | null = null;
  let stderr = "";
  try {
    child = spawn(xrayBin, ["run", "-c", configPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.stdout?.on("data", () => {
      /* ignore */
    });

    const proc = child;
    const exitEarly = new Promise<never>((_, reject) => {
      proc.once("exit", (code) => {
        reject(new Error(`Xray завершился с кодом ${code}. ${stderr.slice(0, 300)}`));
      });
      proc.once("error", (e) => reject(e));
    });

    await Promise.race([waitForTcp("127.0.0.1", socksPort, 15_000), exitEarly]);
  } catch (e) {
    try {
      child?.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw e instanceof Error ? e : new Error(String(e));
  }

  const proc = child!;
  return {
    socksHost: "127.0.0.1",
    socksPort,
    stop: async () => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 300));
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

export async function runWithViaConfigTunnel<T>(
  rawConfig: string,
  fn: (tunnel: ViaConfigTunnel) => Promise<T>,
): Promise<T> {
  const tunnel = await startViaConfigTunnel(rawConfig);
  try {
    return await fn(tunnel);
  } finally {
    await tunnel.stop();
  }
}

export type ViaConfigSubscriptionRefreshResult = {
  ok: boolean;
  status_code: number | null;
  error: string | null;
  user_found: boolean;
  url: string | null;
};

/** GET подписки пользователя с именем tzadmin (как обновление в Happ). */
export async function tryRefreshTzadminSubscription(): Promise<ViaConfigSubscriptionRefreshResult> {
  const user = listUsers().find((u) => String(u.name ?? "").trim().toLowerCase() === "tzadmin");
  if (!user) {
    return {
      ok: false,
      status_code: null,
      error: "Пользователь tzadmin не найден",
      user_found: false,
      url: null,
    };
  }
  const url = primarySubscriptionUrl(user);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Happ/1.0",
        Accept: "*/*",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const ct = String(res.headers.get("content-type") ?? "").toLowerCase();
    const text = await res.text();
    const looksHtml = ct.includes("text/html") || /^\s*</.test(text);
    if (!res.ok) {
      return {
        ok: false,
        status_code: res.status,
        error: `HTTP ${res.status}`,
        user_found: true,
        url,
      };
    }
    if (looksHtml) {
      return {
        ok: false,
        status_code: res.status,
        error: "Ответ похож на HTML-витрину, не на подписку Happ",
        user_found: true,
        url,
      };
    }
    if (!text.trim()) {
      return {
        ok: false,
        status_code: res.status,
        error: "Пустое тело подписки",
        user_found: true,
        url,
      };
    }
    return { ok: true, status_code: res.status, error: null, user_found: true, url };
  } catch (e) {
    return {
      ok: false,
      status_code: null,
      error: e instanceof Error ? e.message : String(e),
      user_found: true,
      url,
    };
  }
}
