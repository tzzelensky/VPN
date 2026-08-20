import { listUsers, updateUserRow } from "./db.js";
import { isSubscriptionExpired } from "./subscriptionAccess.js";
import { pushClientListToAllDeployedServers } from "./userSync.js";

/**
 * Снимает истёкших клиентов с Xray/HY2/Trojan и выключает enable в панели.
 * Без sync UUID остаются на узлах — клиент с кэшем продолжает подключаться.
 */
export async function enforceExpiredSubscriptionAccessOnce(log?: (line: string) => void): Promise<{
  disabled: number;
  synced: boolean;
}> {
  const now = Date.now();
  let disabled = 0;

  for (const u of listUsers()) {
    if (!isSubscriptionExpired(u, now)) continue;
    if (u.enable !== 1) continue;
    updateUserRow(u.id, { enable: 0 });
    disabled += 1;
  }

  const anyExpired = listUsers().some((u) => isSubscriptionExpired(u, now));
  if (!anyExpired && disabled === 0) {
    return { disabled: 0, synced: false };
  }

  // Сигнатура sync сама сделает no-op, если список UUID уже актуальный.
  log?.(
    `[expiry-access] enforce: disabled=${disabled}, pushing client list to deployed servers…`,
  );
  await pushClientListToAllDeployedServers((line) => log?.(line));
  return { disabled, synced: true };
}

let bootSyncDone = false;
const handledExpiredIds = new Set<number>();

export async function runExpiredSubscriptionAccessTick(): Promise<void> {
  const now = Date.now();
  const expired = listUsers().filter((u) => isSubscriptionExpired(u, now));
  const expiredIds = expired.map((u) => u.id);
  const newlyExpired = expiredIds.filter((id) => !handledExpiredIds.has(id));
  const hasEnabledExpired = expired.some((u) => u.enable === 1);

  if (!bootSyncDone || newlyExpired.length > 0 || hasEnabledExpired) {
    const r = await enforceExpiredSubscriptionAccessOnce((line) => console.log(line));
    bootSyncDone = true;
    handledExpiredIds.clear();
    for (const id of expiredIds) handledExpiredIds.add(id);
    if (r.synced || r.disabled) {
      console.log(`[expiry-access] done: disabled=${r.disabled}, synced=${r.synced}`);
    }
  }
}

export function startExpiredSubscriptionAccessLoop(): void {
  const CHECK_MS = 60_000;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runExpiredSubscriptionAccessTick();
    } catch (e) {
      console.error("[expiry-access]", e instanceof Error ? e.message : e);
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(() => void tick(), CHECK_MS);
  console.log("[expiry-access] loop started (check each minute)");
}
