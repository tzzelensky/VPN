import { getTelegramProxySettings } from "./telegramProxiesDb.js";
import { runTelegramProxyCheckAll } from "./telegramProxyService.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runTelegramProxyAutoCheckOnce(): Promise<void> {
  if (running) return;
  const settings = getTelegramProxySettings();
  if (!settings.auto_check_enabled) return;
  const intervalMs = Math.max(60_000, settings.interval_minutes * 60_000);
  if (settings.last_auto_run_at) {
    const last = Date.parse(settings.last_auto_run_at);
    if (Number.isFinite(last) && Date.now() - last < intervalMs) return;
  }
  running = true;
  try {
    await runTelegramProxyCheckAll("auto");
  } finally {
    running = false;
  }
}

export function startTelegramProxyAutoCheckLoop(): void {
  if (timer) return;
  const tick = () => {
    void runTelegramProxyAutoCheckOnce();
  };
  timer = setInterval(tick, 60_000);
  console.log("[telegram-proxies] auto-check loop started (tick every 60s)");
}
