import { getWhitelistVaultSettings, isWhitelistVaultEnabled } from "./whitelistVaultDb.js";
import { runWhitelistVaultCheckAll } from "./whitelistVaultService.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runWhitelistVaultAutoCheckOnce(): Promise<void> {
  if (running) return;
  if (!isWhitelistVaultEnabled()) return;
  const settings = getWhitelistVaultSettings();
  if (!settings.auto_check_enabled) return;
  const intervalMs = Math.max(60_000, settings.interval_minutes * 60_000);
  if (settings.last_auto_run_at) {
    const last = Date.parse(settings.last_auto_run_at);
    if (Number.isFinite(last) && Date.now() - last < intervalMs) return;
  }
  running = true;
  try {
    await runWhitelistVaultCheckAll("auto");
  } finally {
    running = false;
  }
}

export function startWhitelistVaultAutoCheckLoop(): void {
  if (timer) return;
  const tick = () => {
    void runWhitelistVaultAutoCheckOnce();
  };
  timer = setInterval(tick, 60_000);
  console.log("[whitelist-vault] auto-check loop started (tick every 60s)");
}
