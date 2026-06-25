import { listDeployedServers, listUsers, type UserRow } from "./db.js";
import { isDeviceLimitActiveForUser } from "./deviceLimitEffective.js";
import { getDeviceLimitSettings } from "./deviceLimitStore.js";
import { normalizeClientIp } from "./deviceLimitSubscription.js";
import { activeDeviceSlots, normalizeDeviceSlots, userDeviceTotalLimit } from "./userDeviceSlots.js";
import {
  collectOnlineIpsForUser,
  pullTrafficFromAllDeployedServers,
} from "./xrayStatsPull.js";

export type ConnectionScanRow = {
  user_id: number;
  user_name: string;
  tg_id: string;
  limit_active: boolean;
  device_limit_enabled: boolean;
  registered_devices: number;
  registered_names: string[];
  device_limit: number | null;
  /** Активных подключений по Xray (уникальные IP). */
  online_connections: number;
  online_ips: string[];
  /** Счётчик онлайн с узлов (если IP-лист недоступен). */
  xray_online_count: number;
};

export type ConnectionScanResult = {
  generated_at: string;
  scan_duration_ms: number;
  servers_scanned: number;
  errors: string[];
  warnings: string[];
  settings: {
    enabled: boolean;
    limit_scope: string;
    default_slots: number;
  };
  summary: {
    subscriptions_total: number;
    online_now: number;
    total_live_connections: number;
    registered_devices_total: number;
    limit_active: number;
  };
  rows: ConnectionScanRow[];
};

async function scanUserConnections(
  user: UserRow,
  xrayOnline: number,
  settings: ReturnType<typeof getDeviceLimitSettings>,
): Promise<ConnectionScanRow> {
  const active = activeDeviceSlots(normalizeDeviceSlots(user.device_slots));
  const limitActive = isDeviceLimitActiveForUser(user);
  let ips: string[] = [];
  if (xrayOnline > 0) {
    try {
      ips = await collectOnlineIpsForUser(user);
    } catch {
      ips = [];
    }
  }
  const uniqueIps = [...new Set(ips.map((ip) => normalizeClientIp(ip)).filter(Boolean))];
  const connections = uniqueIps.length > 0 ? uniqueIps.length : Math.max(0, xrayOnline);
  return {
    user_id: user.id,
    user_name: user.name,
    tg_id: user.tg_id,
    limit_active: limitActive,
    device_limit_enabled: user.device_limit_enabled === 1,
    registered_devices: active.length,
    registered_names: active.map((s) => s.device_name || s.label || "Устройство"),
    device_limit: limitActive ? userDeviceTotalLimit(user, settings) : null,
    online_connections: connections,
    online_ips: uniqueIps.length > 0 ? uniqueIps : [],
    xray_online_count: Math.max(0, xrayOnline),
  };
}

/** Живой опрос Xray: подключения всех подписок (только чтение). */
export async function scanAllUsersConnectionSnapshot(): Promise<ConnectionScanResult> {
  const started = Date.now();
  const settings = getDeviceLimitSettings();
  const users = listUsers().filter((u) => u.is_test_subscription !== 1);
  const servers = listDeployedServers();
  const { byUuid, errors, warns } = await pullTrafficFromAllDeployedServers();

  const onlineUsers: UserRow[] = [];
  const offlineUsers: UserRow[] = [];
  for (const u of users) {
    const key = u.vless_uuid.trim().toLowerCase();
    const online = byUuid.get(key)?.online ?? 0;
    if (online > 0) onlineUsers.push(u);
    else offlineUsers.push(u);
  }

  const onlineRows = await Promise.all(
    onlineUsers.map((u) => {
      const key = u.vless_uuid.trim().toLowerCase();
      const xrayOnline = byUuid.get(key)?.online ?? 0;
      return scanUserConnections(u, xrayOnline, settings);
    }),
  );

  const offlineRows: ConnectionScanRow[] = offlineUsers.map((u) => {
    const active = activeDeviceSlots(normalizeDeviceSlots(u.device_slots));
    const limitActive = isDeviceLimitActiveForUser(u);
    return {
      user_id: u.id,
      user_name: u.name,
      tg_id: u.tg_id,
      limit_active: limitActive,
      device_limit_enabled: u.device_limit_enabled === 1,
      registered_devices: active.length,
      registered_names: active.map((s) => s.device_name || s.label || "Устройство"),
      device_limit: limitActive ? userDeviceTotalLimit(u, settings) : null,
      online_connections: 0,
      online_ips: [],
      xray_online_count: 0,
    };
  });

  const rows = [...onlineRows, ...offlineRows].sort(
    (a, b) => b.online_connections - a.online_connections || b.registered_devices - a.registered_devices || a.user_id - b.user_id,
  );

  const onlineNow = rows.filter((r) => r.online_connections > 0).length;
  return {
    generated_at: new Date().toISOString(),
    scan_duration_ms: Date.now() - started,
    servers_scanned: servers.length,
    errors,
    warnings: warns,
    settings: {
      enabled: settings.enabled,
      limit_scope: settings.limit_scope,
      default_slots: settings.default_slots,
    },
    summary: {
      subscriptions_total: rows.length,
      online_now: onlineNow,
      total_live_connections: rows.reduce((s, r) => s + r.online_connections, 0),
      registered_devices_total: rows.reduce((s, r) => s + r.registered_devices, 0),
      limit_active: rows.filter((r) => r.limit_active).length,
    },
    rows,
  };
}
