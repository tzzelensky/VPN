import { Router } from "express";
import {
  activeDeviceSlots,
  evaluateDeviceLimitAccess,
  normalizeDeviceId,
  normalizeDeviceSlots,
  resolveDeviceIdFromRequest,
  userDeviceTotalLimit,
} from "../userDeviceSlots.js";
import {
  addAdminDeviceExtraSlots,
  addUserDeviceSlot,
  syncAllUsersDeviceLimitFromGlobal,
  findUsersByTelegramChatId,
  getUser,
  listUsers,
  removeUserDeviceSlot,
  renameUserDeviceSlot,
  reconcileAllUsersDeviceSlots,
  resetUserDeviceSlots,
  updateUserRow,
  userAllowedOnServers,
  type UserRow,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  appendDeviceLimitEvent,
  countDeviceLimitBlockedAttempts,
  getDeviceLimitSettings,
  listDeviceLimitEvents,
  listDeviceSlotPurchases,
  setDeviceLimitSettings,
  type DeviceLimitSettings,
} from "../deviceLimitStore.js";
import { deviceTypeIcon, maskDeviceId } from "../deviceNameFromUa.js";
import { publicSubUrl } from "../subscriptionUrl.js";
import { migrateOnlineUsersWithDeviceLimit, migrateUserDeviceSlotsFromOnline, refreshPlaceholderDeviceSlots } from "../deviceLimitMigration.js";
import { scanAllUsersConnectionSnapshot } from "../deviceLimitConnectionsScan.js";
import { isDeviceLimitActiveForUser } from "../deviceLimitEffective.js";
import { pushClientListToAllDeployedServers } from "../userSync.js";

const router = Router();
router.use(requireAuth);

function deviceSlotDto(u: UserRow, slot: UserRow["device_slots"][number]) {
  return {
    id: slot.id,
    device_id: slot.id,
    device_id_masked: maskDeviceId(slot.id),
    label: slot.label,
    device_name: slot.device_name || slot.label,
    device_type: slot.device_type,
    device_icon: deviceTypeIcon(slot.device_type),
    user_agent: slot.user_agent,
    created_at: slot.created_at,
    first_seen_at: slot.first_seen_at,
    last_seen_at: slot.last_seen_at,
    last_ip: slot.last_ip,
    active: slot.active === 1 && !slot.deleted_at,
    blocked: slot.blocked === 1,
    deleted_at: slot.deleted_at,
    subscription_url: publicSubUrl(u.sub_token, slot.id),
  };
}

function subscriptionRowDto(u: UserRow) {
  const settings = getDeviceLimitSettings();
  const active = activeDeviceSlots(u.device_slots ?? []);
  const limitActive = isDeviceLimitActiveForUser(u);
  const limit = limitActive ? userDeviceTotalLimit(u) : null;
  const last = [...active].sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))[0];
  return {
    user_id: u.id,
    user_name: u.name,
    tg_id: u.tg_id,
    subscription_id: u.id,
    subscription_name: u.name,
    expiry_time: u.expiry_time,
    allowed: userAllowedOnServers(u),
    device_limit_enabled: u.device_limit_enabled === 1,
    devices_used: active.length,
    device_limit: limit,
    device_default_limit: settings.default_slots,
    device_extra_slots: u.device_extra_slots,
    last_device_name: last?.device_name || last?.label || "",
    devices: active.map((s) => deviceSlotDto(u, s)),
  };
}

function overviewStats() {
  const users = listUsers().filter((u) => u.is_test_subscription !== 1);
  const limited = users.filter((u) => isDeviceLimitActiveForUser(u));
  let totalDevices = 0;
  let activeDevices = 0;
  let purchasedExtra = 0;
  for (const u of users) {
    const slots = normalizeDeviceSlots(u.device_slots);
    totalDevices += slots.length;
    activeDevices += activeDeviceSlots(slots).length;
    purchasedExtra += Math.max(0, Math.floor(Number(u.device_extra_slots) || 0));
  }
  const purchases = listDeviceSlotPurchases(5000).filter((p) => p.status === "paid");
  const revenue = purchases.reduce((s, p) => s + Math.max(0, p.amount_total), 0);
  return {
    users_with_limit: limited.length,
    total_devices: totalDevices,
    active_devices: activeDevices,
    blocked_attempts: countDeviceLimitBlockedAttempts(),
    purchased_extra_slots: purchasedExtra,
    purchase_revenue_rub: revenue,
  };
}

router.get("/", (_req, res) => {
  res.json({
    settings: getDeviceLimitSettings(),
    stats: overviewStats(),
  });
});

router.put("/settings", async (req, res) => {
  const prev = getDeviceLimitSettings();
  const body = (req.body ?? {}) as Partial<DeviceLimitSettings>;
  const settings = setDeviceLimitSettings(body);
  const becameEnabled = !prev.enabled && settings.enabled;
  const scopeBecameAll = prev.limit_scope !== "all" && settings.limit_scope === "all";
  if (settings.enabled && settings.limit_scope === "all") {
    syncAllUsersDeviceLimitFromGlobal(settings.default_slots);
  }
  reconcileAllUsersDeviceSlots();
  if (settings.enabled && (becameEnabled || scopeBecameAll)) {
    try {
      await migrateOnlineUsersWithDeviceLimit();
      await pushClientListToAllDeployedServers();
    } catch (e) {
      console.error("[device-limit] bulk migration after settings:", e instanceof Error ? e.message : e);
    }
  }
  res.json({ settings: getDeviceLimitSettings() });
});

router.put("/subscriptions/:id(\\d+)/limit", async (req, res) => {
  const id = Number(req.params.id);
  const u0 = getUser(id);
  if (!u0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const settings = getDeviceLimitSettings();
  if (!settings.enabled) {
    res.status(400).json({ error: "device_limit_globally_disabled", message: "Сначала включите лимит устройств в настройках." });
    return;
  }
  if (settings.limit_scope !== "selected") {
    res.status(400).json({
      error: "limit_scope_all",
      message: "При охвате «все подписки» отдельный выбор не нужен.",
    });
    return;
  }
  const enabled = (req.body as { enabled?: unknown })?.enabled === true || (req.body as { enabled?: unknown })?.enabled === 1;
  const wasEnabled = u0.device_limit_enabled === 1;
  const next = updateUserRow(id, {
    device_limit_enabled: enabled ? 1 : 0,
    device_limit_count: enabled ? Math.max(1, Math.floor(Number(settings.default_slots) || 1)) : u0.device_limit_count,
  });
  if (!next) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  reconcileAllUsersDeviceSlots();
  let rowUser = next;
  if (enabled && !wasEnabled) {
    try {
      const migrated = await migrateUserDeviceSlotsFromOnline(id);
      if (migrated.user) rowUser = migrated.user;
      const refreshed = refreshPlaceholderDeviceSlots(id);
      if (refreshed) rowUser = refreshed;
      await pushClientListToAllDeployedServers();
    } catch (e) {
      console.error("[device-limit] migration after enable:", e instanceof Error ? e.message : e);
    }
  } else {
    void pushClientListToAllDeployedServers().catch(() => {});
  }
  res.json({ row: subscriptionRowDto(rowUser) });
});

router.put("/subscriptions/limit-all", async (req, res) => {
  const settings = getDeviceLimitSettings();
  if (!settings.enabled) {
    res.status(400).json({ error: "device_limit_globally_disabled", message: "Сначала включите лимит устройств в настройках." });
    return;
  }
  if (settings.limit_scope !== "selected") {
    res.status(400).json({
      error: "limit_scope_all",
      message: "При охвате «все подписки» отдельное управление подписками не нужно.",
    });
    return;
  }
  const enabled = (req.body as { enabled?: unknown })?.enabled === true || (req.body as { enabled?: unknown })?.enabled === 1;
  let changed = 0;
  const users = listUsers().filter((u) => u.is_test_subscription !== 1);
  for (const u of users) {
    const currentlyEnabled = u.device_limit_enabled === 1;
    if (currentlyEnabled === enabled) continue;
    const next = updateUserRow(u.id, {
      device_limit_enabled: enabled ? 1 : 0,
      device_limit_count: enabled ? Math.max(1, Math.floor(Number(settings.default_slots) || 1)) : u.device_limit_count,
    });
    if (next) changed++;
  }

  reconcileAllUsersDeviceSlots();
  if (enabled) {
    try {
      await migrateOnlineUsersWithDeviceLimit();
      await pushClientListToAllDeployedServers();
    } catch (e) {
      console.error("[device-limit] bulk migration after subscriptions enable-all:", e instanceof Error ? e.message : e);
    }
  } else {
    void pushClientListToAllDeployedServers().catch(() => {});
  }
  const rows = listUsers()
    .filter((u) => u.is_test_subscription !== 1)
    .map(subscriptionRowDto);
  res.json({ changed, rows });
});

router.get("/subscriptions", (_req, res) => {
  const rows = listUsers()
    .filter((u) => u.is_test_subscription !== 1)
    .map(subscriptionRowDto);
  res.json({ rows });
});

router.get("/subscriptions/:id(\\d+)/devices", (req, res) => {
  const u = getUser(Number(req.params.id));
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(subscriptionRowDto(u));
});

router.post("/subscriptions/:id(\\d+)/devices", (req, res) => {
  const id = Number(req.params.id);
  const label = String((req.body as { label?: unknown })?.label ?? "").trim();
  const result = addUserDeviceSlot(id, label || undefined);
  if (result.error === "not_found") {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (result.error === "device_limit_disabled") {
    res.status(400).json({ error: "device_limit_disabled" });
    return;
  }
  if (result.error === "device_limit_full") {
    res.status(409).json({ error: "device_limit_full" });
    return;
  }
  res.status(201).json({
    slot: deviceSlotDto(result.user!, result.slot!),
    row: subscriptionRowDto(result.user!),
  });
});

router.patch("/subscriptions/:id(\\d+)/devices/:deviceId/rename", (req, res) => {
  const id = Number(req.params.id);
  const deviceId = decodeURIComponent(String(req.params.deviceId ?? ""));
  const name = String((req.body as { name?: unknown })?.name ?? "").trim();
  const next = renameUserDeviceSlot(id, deviceId, name);
  if (!next) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ row: subscriptionRowDto(next) });
});

router.delete("/subscriptions/:id(\\d+)/devices/:deviceId", (req, res) => {
  const id = Number(req.params.id);
  const deviceId = decodeURIComponent(String(req.params.deviceId ?? ""));
  const next = removeUserDeviceSlot(id, deviceId);
  if (!next) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ row: subscriptionRowDto(next) });
});

router.post("/subscriptions/:id(\\d+)/add-slots", (req, res) => {
  const id = Number(req.params.id);
  const slots = Math.max(1, Math.floor(Number((req.body as { slots?: unknown })?.slots) || 1));
  const comment = String((req.body as { comment?: unknown })?.comment ?? "").trim();
  const next = addAdminDeviceExtraSlots(id, slots, comment);
  if (!next) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ row: subscriptionRowDto(next) });
});

router.post("/subscriptions/:id(\\d+)/reset-devices", (req, res) => {
  const id = Number(req.params.id);
  const next = resetUserDeviceSlots(id);
  if (!next) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ row: subscriptionRowDto(next) });
});

router.get("/purchases", (_req, res) => {
  const purchases = listDeviceSlotPurchases(1000).map((p) => {
    const u = getUser(p.subscription_id);
    return {
      ...p,
      user_name: u?.name ?? "",
      subscription_name: u?.name ?? "",
    };
  });
  res.json({ purchases });
});

router.get("/events", (req, res) => {
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(req.query.limit) || 200)));
  res.json({ events: listDeviceLimitEvents(limit) });
});

router.post("/diagnose", (req, res) => {
  const body = req.body as {
    subscription_id?: number;
    device_id?: string;
    user_agent?: string;
  };
  const subId = Math.floor(Number(body.subscription_id) || 0);
  const u = getUser(subId);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const settings = getDeviceLimitSettings();
  const deviceId = normalizeDeviceId(String(body.device_id ?? ""));
  const evalResult = evaluateDeviceLimitAccess(u, deviceId, {
    userAgent: String(body.user_agent ?? ""),
    touchOnly: true,
    autoBind: settings.auto_bind,
    defaultSlots: settings.default_slots,
  });
  res.json({
    subscription_id: u.id,
    device_id: deviceId,
    device_id_masked: maskDeviceId(deviceId),
    global_enabled: settings.enabled,
    limit_scope: settings.limit_scope,
    user_limit_enabled: isDeviceLimitActiveForUser(u),
    total_limit: userDeviceTotalLimit(u, settings),
    active_devices: activeDeviceSlots(u.device_slots ?? []).length,
    allowed: evalResult.allowed,
    reason: evalResult.reason ?? null,
    will_serve_subscription: evalResult.allowed && userAllowedOnServers(u),
  });
});

const ONLINE_SNAPSHOT_TTL_MS = 75_000;

function userLooksOnlineForDiag(u: UserRow): boolean {
  const t = u.stats_synced_at;
  if (!t || !Number.isFinite(t) || Date.now() - t > ONLINE_SNAPSHOT_TTL_MS) return false;
  return Number(u.online_devices) > 0 || u.online_snapshot === 1;
}

/** Сводка по устройствам всех подписок (только чтение, ничего не меняет). */
router.get("/diagnose/subscriptions-overview", (_req, res) => {
  const settings = getDeviceLimitSettings();
  const users = listUsers().filter((u) => u.is_test_subscription !== 1);
  const rows = users.map((u) => {
    const active = activeDeviceSlots(u.device_slots ?? []);
    const limitActive = isDeviceLimitActiveForUser(u);
    const limit = limitActive ? userDeviceTotalLimit(u, settings) : null;
    const online = userLooksOnlineForDiag(u);
    return {
      user_id: u.id,
      user_name: u.name,
      tg_id: u.tg_id,
      limit_active: limitActive,
      device_limit_enabled: u.device_limit_enabled === 1,
      devices_used: active.length,
      device_limit: limit,
      device_extra_slots: Math.max(0, Math.floor(Number(u.device_extra_slots) || 0)),
      online,
      online_devices: Math.max(0, Math.floor(Number(u.online_devices) || 0)),
      device_names: active.map((s) => s.device_name || s.label || "Устройство"),
      last_device_name: [...active].sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))[0]?.device_name ?? "",
    };
  });
  rows.sort((a, b) => b.devices_used - a.devices_used || a.user_id - b.user_id);
  const withDevices = rows.filter((r) => r.devices_used > 0);
  res.json({
    generated_at: new Date().toISOString(),
    settings: {
      enabled: settings.enabled,
      limit_scope: settings.limit_scope,
      default_slots: settings.default_slots,
    },
    summary: {
      subscriptions_total: rows.length,
      limit_active: rows.filter((r) => r.limit_active).length,
      with_devices: withDevices.length,
      total_active_devices: rows.reduce((s, r) => s + r.devices_used, 0),
      online_with_devices: withDevices.filter((r) => r.online).length,
      over_limit: rows.filter((r) => r.limit_active && r.device_limit != null && r.devices_used > r.device_limit).length,
    },
    rows,
  });
});

/** Живой опрос Xray: с каких IP/устройств сейчас подключены подписки (только чтение). */
router.post("/diagnose/connections-scan", async (_req, res) => {
  try {
    const result = await scanAllUsersConnectionSnapshot();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
