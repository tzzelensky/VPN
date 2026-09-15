import { listDeployedServers } from "./db.js";
import { clearXrayLogFiles, trimXrayLogFilesIfLarge } from "./xrayLogsService.js";

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const HOURLY_TRIM_MS = 60 * 60 * 1000;

function isAutoCleanEnabled(): boolean {
  const raw = String(process.env.XRAY_LOGS_AUTO_CLEAN ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function mskDateParts(nowMs: number): { y: number; m: number; d: number } {
  const shifted = new Date(nowMs + MSK_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
  };
}

/** Unix ms для полуночи указанного календарного дня по Москве (UTC+3). */
function mskMidnightUtcMs(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 0, 0, 0, 0) - MSK_OFFSET_MS;
}

export function msUntilNextMskMidnight(nowMs = Date.now()): number {
  const { y, m, d } = mskDateParts(nowMs);
  const todayMidnight = mskMidnightUtcMs(y, m, d);
  const next = nowMs < todayMidnight ? todayMidnight : mskMidnightUtcMs(y, m, d + 1);
  return Math.max(1000, next - nowMs);
}

export async function runXrayLogsAutoCleanOnce(): Promise<void> {
  const servers = listDeployedServers();
  if (servers.length === 0) {
    console.log("[xray-logs-clean] нет развёрнутых серверов — пропуск");
    return;
  }
  console.log(`[xray-logs-clean] полная очистка логов на ${servers.length} сервер(ах)…`);
  for (const server of servers) {
    try {
      const result = await clearXrayLogFiles(server.id, ["access", "error"]);
      if (result.errors.length > 0) {
        console.warn(
          `[xray-logs-clean] #${server.id} ${server.name}: очищено ${result.cleared.length}, ошибки: ${result.errors.join("; ")}`,
        );
      } else {
        console.log(`[xray-logs-clean] #${server.id} ${server.name}: очищено файлов ${result.cleared.length}`);
      }
    } catch (e) {
      console.error(
        `[xray-logs-clean] #${server.id} ${server.name}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
}

export async function runXrayLogsHourlyTrimOnce(): Promise<void> {
  const servers = listDeployedServers();
  if (servers.length === 0) return;
  console.log(`[xray-logs-trim] почасовой trim на ${servers.length} сервер(ах)…`);
  for (const server of servers) {
    try {
      const result = await trimXrayLogFilesIfLarge(server.id);
      if (result.trimmed.length > 0) {
        console.log(
          `[xray-logs-trim] #${server.id} ${server.name}: обрезано ${result.trimmed.length} файл(ов)`,
        );
      }
      if (result.errors.length > 0) {
        console.warn(
          `[xray-logs-trim] #${server.id} ${server.name}: ${result.errors.join("; ")}`,
        );
      }
    } catch (e) {
      console.error(
        `[xray-logs-trim] #${server.id} ${server.name}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
}

let dailyTimer: ReturnType<typeof setTimeout> | null = null;
let hourlyTimer: ReturnType<typeof setInterval> | null = null;
let dailyBusy = false;
let hourlyBusy = false;

function scheduleNextDailyRun(): void {
  if (dailyTimer) clearTimeout(dailyTimer);
  const delay = msUntilNextMskMidnight();
  const nextAt = new Date(Date.now() + delay).toISOString();
  console.log(
    `[xray-logs-clean] следующий truncate через ${Math.round(delay / 60000)} мин (≈ ${nextAt}, полночь МСК)`,
  );
  dailyTimer = setTimeout(() => {
    void (async () => {
      if (dailyBusy) return;
      dailyBusy = true;
      try {
        await runXrayLogsAutoCleanOnce();
      } finally {
        dailyBusy = false;
        scheduleNextDailyRun();
      }
    })();
  }, delay);
}

export function startXrayLogsAutoCleanLoop(): void {
  if (!isAutoCleanEnabled()) {
    console.log("[xray-logs-clean] отключено (XRAY_LOGS_AUTO_CLEAN=0)");
    return;
  }
  scheduleNextDailyRun();
  console.log("[xray-logs-clean] ежедневная очистка в 00:00 МСК включена");

  if (hourlyTimer) clearInterval(hourlyTimer);
  hourlyTimer = setInterval(() => {
    void (async () => {
      if (hourlyBusy) return;
      hourlyBusy = true;
      try {
        await runXrayLogsHourlyTrimOnce();
      } finally {
        hourlyBusy = false;
      }
    })();
  }, HOURLY_TRIM_MS);
  console.log("[xray-logs-trim] почасовой size-trim (>32МБ → хвост 8МБ) включён");

  // Первый trim через ~2 мин после старта, чтобы не бить SSH на boot.
  setTimeout(() => {
    void (async () => {
      if (hourlyBusy) return;
      hourlyBusy = true;
      try {
        await runXrayLogsHourlyTrimOnce();
      } finally {
        hourlyBusy = false;
      }
    })();
  }, 2 * 60 * 1000);
}
