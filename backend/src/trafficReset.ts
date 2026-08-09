import { updateUserRow, type UserRow } from "./db.js";
import { pullHysteria2TrafficFromAllServers } from "./hysteria2TrafficPull.js";
import { clearSubscriptionUsageMonotonic } from "./subscriptionMeta.js";
import { peekUserTrafficFromServers } from "./xrayStatsPull.js";

const BYTES_PER_GB = 1073741824;

async function peekBaselines(user: UserRow): Promise<{
  rawUp: number;
  rawDown: number;
  hy2Up: number;
  hy2Down: number;
}> {
  let rawUp = Number.isFinite(Number(user.stats_raw_up)) ? Math.max(0, Math.floor(Number(user.stats_raw_up))) : 0;
  let rawDown = Number.isFinite(Number(user.stats_raw_down))
    ? Math.max(0, Math.floor(Number(user.stats_raw_down)))
    : 0;
  let hy2Up = Number.isFinite(Number(user.hy2_stats_raw_up))
    ? Math.max(0, Math.floor(Number(user.hy2_stats_raw_up)))
    : 0;
  let hy2Down = Number.isFinite(Number(user.hy2_stats_raw_down))
    ? Math.max(0, Math.floor(Number(user.hy2_stats_raw_down)))
    : 0;

  try {
    const agg = await peekUserTrafficFromServers(user);
    rawUp = Math.max(0, Math.floor(Number(agg.up) || 0));
    rawDown = Math.max(0, Math.floor(Number(agg.down) || 0));
  } catch {
    /* узлы недоступны — оставляем сохранённый baseline */
  }

  try {
    const hy2 = await pullHysteria2TrafficFromAllServers();
    const key = String(user.vless_uuid ?? "")
      .trim()
      .toLowerCase();
    const hit = key ? hy2.byUuid.get(key) : undefined;
    if (hit) {
      hy2Up = Math.max(0, Math.floor(Number(hit.up) || 0));
      hy2Down = Math.max(0, Math.floor(Number(hit.down) || 0));
    }
  } catch {
    /* hy2 недоступен — оставляем сохранённый baseline */
  }

  return { rawUp, rawDown, hy2Up, hy2Down };
}

function splitUsedBytes(user: UserRow, usedBytes: number): { up: number; down: number } {
  const total = Math.max(0, Math.floor(usedBytes));
  const prevUp = Math.max(0, Math.floor(Number(user.traffic_up) || 0));
  const prevDown = Math.max(0, Math.floor(Number(user.traffic_down) || 0));
  const prevTotal = prevUp + prevDown;
  if (prevTotal <= 0 || total <= 0) {
    return { up: 0, down: total };
  }
  const up = Math.min(total, Math.round((total * prevUp) / prevTotal));
  return { up, down: total - up };
}

/** Выставить учтённый трафик (байты) и перебазировать counters на узлах — для Happ/клиентов. */
export async function setUserTrafficUsedBytes(
  user: UserRow,
  usedBytes: number,
): Promise<UserRow | undefined> {
  const { rawUp, rawDown, hy2Up, hy2Down } = await peekBaselines(user);
  const { up, down } = splitUsedBytes(user, usedBytes);
  const next = updateUserRow(user.id, {
    traffic_up: up,
    traffic_down: down,
    online_snapshot: usedBytes <= 0 ? 0 : user.online_snapshot,
    online_devices: usedBytes <= 0 ? 0 : user.online_devices,
    stats_synced_at: Date.now(),
    stats_raw_up: rawUp,
    stats_raw_down: rawDown,
    hy2_stats_raw_up: hy2Up,
    hy2_stats_raw_down: hy2Down,
    traffic_notify_state: "",
  });
  if (next) clearSubscriptionUsageMonotonic(next);
  return next;
}

/** Обнулить учёт трафика в панели, baseline на узлах — как «Сбросить трафик» в админке. */
export async function resetUserTrafficCounters(user: UserRow): Promise<UserRow | undefined> {
  return setUserTrafficUsedBytes(user, 0);
}

/** used_gb с точностью до сотых → байты. */
export function usedGbToBytes(usedGb: number): number {
  const gb = Math.round(Number(usedGb) * 100) / 100;
  if (!Number.isFinite(gb) || gb < 0) return 0;
  return Math.max(0, Math.round(gb * BYTES_PER_GB));
}
