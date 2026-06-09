import { getConfigVaultSettings } from "./configVaultDb.js";
import { runConfigVaultCheckAll } from "./configVaultService.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runConfigVaultAutoCheckOnce(): Promise<void> {
  if (running) return;
  const settings = getConfigVaultSettings();
  if (!settings.auto_check_enabled) return;
  const intervalMs = Math.max(60_000, settings.interval_minutes * 60_000);
  if (settings.last_auto_run_at) {
    const last = Date.parse(settings.last_auto_run_at);
    if (Number.isFinite(last) && Date.now() - last < intervalMs) return;
  }
  running = true;
  try {
    await runConfigVaultCheckAll("auto");
  } finally {
    running = false;
  }
}

export function startConfigVaultAutoCheckLoop(): void {
  if (timer) return;
  const tick = () => {
    void runConfigVaultAutoCheckOnce();
  };
  timer = setInterval(tick, 60_000);
  console.log("[config-vault] auto-check loop started (tick every 60s)");
}
