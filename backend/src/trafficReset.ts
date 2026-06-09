import { updateUserRow, type UserRow } from "./db.js";
import { clearSubscriptionUsageMonotonic } from "./subscriptionMeta.js";
import { peekUserTrafficFromServers } from "./xrayStatsPull.js";

/** Обнулить учёт трафика в панели, baseline на узлах — как «Сбросить трафик» в админке. */
export async function resetUserTrafficCounters(user: UserRow): Promise<UserRow | undefined> {
  let rawUp = Number.isFinite(Number(user.stats_raw_up)) ? Math.max(0, Math.floor(Number(user.stats_raw_up))) : 0;
  let rawDown = Number.isFinite(Number(user.stats_raw_down))
    ? Math.max(0, Math.floor(Number(user.stats_raw_down)))
    : 0;
  try {
    const agg = await peekUserTrafficFromServers(user);
    rawUp = Math.max(0, Math.floor(Number(agg.up) || 0));
    rawDown = Math.max(0, Math.floor(Number(agg.down) || 0));
  } catch {
    /* узлы недоступны — оставляем сохранённый baseline */
  }
  const next = updateUserRow(user.id, {
    traffic_up: 0,
    traffic_down: 0,
    online_snapshot: 0,
    online_devices: 0,
    stats_synced_at: Date.now(),
    stats_raw_up: rawUp,
    stats_raw_down: rawDown,
    traffic_notify_state: "",
  });
  if (next) clearSubscriptionUsageMonotonic(next);
  return next;
}
