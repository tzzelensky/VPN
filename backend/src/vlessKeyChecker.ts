import net from "node:net";
import { parseProxyUri } from "./configVaultUri.js";

export type VlessProbeResult = {
  attempts_total: number;
  attempts_success: number;
  attempts_failed: number;
  avg_latency_ms: number | null;
  min_latency_ms: number | null;
  max_latency_ms: number | null;
  last_error: string | null;
  status: "available" | "unavailable" | "unstable";
};

function tcpConnectOnce(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (ok: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ok, latencyMs: Date.now() - started, error });
    };
    const timer = setTimeout(() => finish(false, "Таймаут подключения"), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true, null);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      finish(false, err instanceof Error ? err.message : String(err));
    });
  });
}

/**
 * Проверка доступности VLESS-узла: TCP к address:port (5 попыток).
 * Не логирует полный URI.
 */
export async function probeVlessEndpoint(
  rawUri: string,
  attempts: number,
  timeoutSec: number,
  _testUrl?: string,
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
  const timeoutMs = Math.max(3000, Math.min(60000, timeoutSec * 1000));
  const total = Math.max(1, Math.min(10, attempts));
  const results = await Promise.all(
    Array.from({ length: total }, () => tcpConnectOnce(parsed.address, parsed.port, timeoutMs)),
  );
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
