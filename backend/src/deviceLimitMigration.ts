import { getUser, listDeployedServers, listUsers, updateUserRow, type UserRow } from "./db.js";
import { isDeviceLimitActiveForUser } from "./deviceLimitEffective.js";
import { appendDeviceLimitEvent, getRecentSubscriptionDeviceHit } from "./deviceLimitStore.js";
import { normalizeClientIp } from "./deviceLimitSubscription.js";
import { parseDeviceFromUserAgent, isUsefulDeviceName } from "./deviceNameFromUa.js";
import {
  activeDeviceSlots,
  deviceFingerprintFromUserAgent,
  deviceIdFromClientIp,
  isMigrationPlaceholderDeviceName,
  isMigrationPlaceholderSlot,
  normalizeDeviceSlots,
  newDeviceSlot,
  type UserDeviceSlot,
} from "./userDeviceSlots.js";
import { listOnlineIpsForUserOnServer, peekUserTrafficFromServers } from "./xrayStatsPull.js";
import { touchDeviceLimitForUser } from "./db.js";

const ONLINE_SNAPSHOT_TTL_MS = 75_000;

function mergeUniqueIps(into: string[], add: string[]): void {
  const seen = new Set(into.map((ip) => normalizeClientIp(ip)).filter(Boolean));
  for (const raw of add) {
    const ip = normalizeClientIp(raw);
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    into.push(ip);
  }
}

function userLooksOnline(u: UserRow): boolean {
  const t = u.stats_synced_at;
  if (!t || !Number.isFinite(t) || Date.now() - t > ONLINE_SNAPSHOT_TTL_MS) return false;
  return Number(u.online_devices) > 0 || u.online_snapshot === 1;
}

/** Собрать IP онлайн-сессий с узлов (не зависит от флага лимита на подписке). */
async function collectOnlineIpsForUser(user: UserRow): Promise<string[]> {
  const ips: string[] = [];
  for (const row of listDeployedServers()) {
    try {
      mergeUniqueIps(ips, await listOnlineIpsForUserOnServer(row, user));
    } catch (e) {
      console.error(
        "[device-limit] list online ips:",
        row.host,
        e instanceof Error ? e.message : e,
      );
    }
  }
  if (ips.length === 0) {
    try {
      const peek = await peekUserTrafficFromServers(user);
      mergeUniqueIps(ips, peek.online_ips ?? []);
    } catch (e) {
      console.error("[device-limit] migration peek failed:", e instanceof Error ? e.message : e);
    }
  }
  return ips;
}

function applyRecentHitToPlaceholderSlots(
  slots: UserDeviceSlot[],
  hit: ReturnType<typeof getRecentSubscriptionDeviceHit>,
): { slots: UserDeviceSlot[]; changed: number } {
  if (!hit?.ua?.trim()) return { slots, changed: 0 };
  const parsed = parseDeviceFromUserAgent(hit.ua);
  if (!isUsefulDeviceName(parsed.device_name)) return { slots, changed: 0 };
  let changed = 0;
  const next = slots.map((s) => {
    if (s.active !== 1 || s.deleted_at || !isMigrationPlaceholderSlot(s)) return s;
    changed++;
    return {
      ...s,
      device_name: parsed.device_name,
      label: parsed.device_name,
      user_agent: hit.ua,
      device_type: parsed.device_type !== "unknown" ? parsed.device_type : s.device_type,
      last_ip: normalizeClientIp(hit.ip) || s.last_ip,
    };
  });
  return { slots: next, changed };
}

function slotFromOnlineContext(ip: string, index: number, ua?: string): UserDeviceSlot {
  const normalized = normalizeClientIp(ip);
  const name =
    ua && isUsefulDeviceName(parseDeviceFromUserAgent(ua).device_name)
      ? parseDeviceFromUserAgent(ua).device_name
      : `Устройство ${index + 1}`;
  return newDeviceSlot(name, {
    requestIp: normalized,
    userAgent: ua ?? "",
    deviceId: deviceIdFromClientIp(ip),
  });
}

function repairIpNamedSlots(slots: UserDeviceSlot[]): { slots: UserDeviceSlot[]; changed: number } {
  let changed = 0;
  const next = slots.map((slot, i) => {
    const name = String(slot.device_name || slot.label || "").trim();
    if (!isMigrationPlaceholderDeviceName(name)) return slot;
    if (/^Устройство\s+\d+$/i.test(name)) return slot;
    const fixed = `Устройство ${i + 1}`;
    changed++;
    return { ...slot, device_name: fixed, label: fixed };
  });
  return { slots: next, changed };
}

/** При включении лимита — зарегистрировать текущие онлайн-подключения как устройства. */
export async function migrateUserDeviceSlotsFromOnline(
  userId: number,
): Promise<{ user?: UserRow; added: number }> {
  const user = getUser(userId);
  if (!user || !isDeviceLimitActiveForUser(user)) return { added: 0 };

  const ips = await collectOnlineIpsForUser(user);
  const recentHit = getRecentSubscriptionDeviceHit(userId);

  let existing = normalizeDeviceSlots(user.device_slots);
  const repaired = repairIpNamedSlots(existing);
  existing = repaired.slots;
  const seenIds = new Set(existing.map((s) => s.id));
  const seenIps = new Set(
    existing.map((s) => normalizeClientIp(s.last_ip)).filter(Boolean),
  );
  const toAdd: UserDeviceSlot[] = [];

  for (const rawIp of ips) {
    const ip = normalizeClientIp(rawIp);
    if (!ip || seenIps.has(ip)) continue;
    seenIps.add(ip);
    const id = deviceIdFromClientIp(ip);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const slotUa =
      recentHit?.ua &&
      (!recentHit.ip || normalizeClientIp(recentHit.ip) === ip || ips.length === 1)
        ? recentHit.ua
        : undefined;
    toAdd.push(slotFromOnlineContext(ip, activeDeviceSlots(existing).length + toAdd.length, slotUa));
  }

  if (toAdd.length === 0 && repaired.changed === 0) {
    const renamed = applyRecentHitToPlaceholderSlots(existing, recentHit);
    if (renamed.changed) {
      return { user: updateUserRow(userId, { device_slots: renamed.slots }), added: renamed.changed };
    }
    return { user, added: 0 };
  }

  const merged = [...existing, ...toAdd];
  const newActiveCount = activeDeviceSlots(merged).length;
  const curCount = Math.max(1, Math.floor(Number(user.device_limit_count) || 1));
  const nextCount = Math.max(curCount, newActiveCount);

  const next = updateUserRow(userId, {
    device_slots: merged,
    device_limit_count: nextCount,
  });

  if (toAdd.length > 0) {
    appendDeviceLimitEvent({
      user_id: userId,
      subscription_id: userId,
      device_id: "",
      event_type: "device_migration_from_online",
      message: `Миграция: +${toAdd.length} устройств из онлайн (${ips.length} IP)`,
      metadata_json: JSON.stringify({
        ips,
        added: toAdd.map((s) => ({ id: s.id, ip: s.last_ip, name: s.device_name })),
      }),
    });
  }

  return { user: next, added: toAdd.length + repaired.changed };
}

/** Миграция слотов для всех онлайн-подписок с активным лимитом (после глобального включения). */
export async function migrateOnlineUsersWithDeviceLimit(): Promise<number> {
  let count = 0;
  for (const u of listUsers()) {
    if (u.is_test_subscription === 1) continue;
    if (!isDeviceLimitActiveForUser(u)) continue;
    if (!userLooksOnline(u)) continue;
    try {
      const r = await migrateUserDeviceSlotsFromOnline(u.id);
      if (r.added > 0) count++;
    } catch (e) {
      console.error("[device-limit] bulk migration:", u.id, e instanceof Error ? e.message : e);
    }
  }
  return count;
}

/** Обновить заглушки «Устройство N» из последнего UA запроса подписки (WebApp / после миграции). */
export function refreshPlaceholderDeviceSlots(userId: number): UserRow | undefined {
  const user = getUser(userId);
  if (!user || !isDeviceLimitActiveForUser(user)) return undefined;

  const hit = getRecentSubscriptionDeviceHit(userId);
  const slots = normalizeDeviceSlots(user.device_slots);
  const placeholders = slots.filter((s) => s.active === 1 && !s.deleted_at && isMigrationPlaceholderSlot(s));
  if (placeholders.length === 0) return undefined;

  if (hit?.ua?.trim()) {
    const parsed = parseDeviceFromUserAgent(hit.ua);
    if (isUsefulDeviceName(parsed.device_name)) {
      let changed = false;
      const nextSlots = slots.map((s) => {
        if (s.active !== 1 || s.deleted_at || !isMigrationPlaceholderSlot(s)) return s;
        changed = true;
        return {
          ...s,
          device_name: parsed.device_name,
          label: parsed.device_name,
          user_agent: hit.ua,
          device_type: parsed.device_type !== "unknown" ? parsed.device_type : s.device_type,
          last_ip: normalizeClientIp(hit.ip) || s.last_ip,
          last_seen_at: new Date().toISOString(),
        };
      });
      if (changed) {
        return updateUserRow(userId, { device_slots: nextSlots });
      }
    }
  }

  if (!hit?.ua?.trim()) return undefined;
  const deviceId =
    hit.did?.trim() ||
    deviceFingerprintFromUserAgent(hit.ua) ||
    placeholders[0]!.id;
  const result = touchDeviceLimitForUser(userId, deviceId, {
    requestIp: hit.ip,
    userAgent: hit.ua,
    autoBind: true,
  });
  return result.user;
}
