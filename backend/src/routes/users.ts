import { Router } from "express";
import {
  addUserDeviceSlot,
  applyUsersTrafficSnapshot,
  backfillDeployedServerRealityFromUser,
  coerceExpiryTimeMs,
  createUser,
  deleteUser,
  dropperWinsForClientRow,
  findUserByVlessUuid,
  getUser,
  listDeployedServers,
  listUsers,
  removeUserDeviceSlot,
  updateUserRow,
  userAllowedOnServers,
  type CreateUserInput,
  type UserRow,
} from "../db.js";
import { primarySubscriptionUrl, publicSubUrl } from "../subscriptionUrl.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { pushClientListToAllDeployedServers, refreshSpeedLimitsOnAllDeployedServers, removeUserUuidFromAllServers } from "../userSync.js";
import { initNdjsonStream, ndjsonLine, wantsNdjsonStream } from "../streamUtil.js";
import { resolveSubscriptionBase64, resolveSubscriptionLinks } from "../subscriptionResolve.js";
import { countOnlineIpsForUserOnServer, peekUserTrafficForSubscription } from "../xrayStatsPull.js";
import { generateX25519RealityKeyPair } from "../realityKeygen.js";
import { logCommunicationMessage } from "../communicationLog.js";
import { sendTelegramMessage } from "../telegram/api.js";
import { sendExpiredSubscriptionReminder, sendExpiryRenewalReminder } from "../telegram/expiryNotify.js";
import { expiryAutoNotifyStatusForUser } from "../expiryAutoNotifyStatus.js";
import { runAutoTrafficNotificationsOnce } from "../telegram/trafficNotify.js";
import { pullTrafficFromAllDeployedServers } from "../xrayStatsPull.js";
import { refreshMissingSubscriptionHintsIfDue } from "../subscriptionHintsRefresh.js";
import { resetUserTrafficCounters } from "../trafficReset.js";
import { coerceExtraVlessLinksInput, isValidVlessUri } from "../extraVless.js";
import { userHasPaidWhitelistProduct } from "../whitelistVaultDb.js";
import { isDeviceLimitGloballyEnabled, isDeviceLimitActiveForUser } from "../deviceLimitEffective.js";
import { activeDeviceSlots, userDeviceTotalLimit } from "../userDeviceSlots.js";
import { migrateUserDeviceSlotsFromOnline } from "../deviceLimitMigration.js";

const router = Router();

/** После sync онлайн считается актуальным это время (клиенты/админка опрос не чаще ~30 с). */
const ONLINE_SNAPSHOT_TTL_MS = 75_000;

function deriveOnlineFromRow(u: UserRow): boolean {
  const t = u.stats_synced_at;
  if (!t || !Number.isFinite(t) || Date.now() - t > ONLINE_SNAPSHOT_TTL_MS) return false;
  return Number(u.online_devices) > 0 || u.online_snapshot === 1;
}

function isExpiredUser(u: UserRow): boolean {
  return Number(u.expiry_time) > 0 && Number(u.expiry_time) <= Date.now();
}

function parseChatId(raw: string): number | null {
  const n = Math.floor(Number(String(raw ?? "").trim()));
  return Number.isFinite(n) && n > 0 ? n : null;
}

router.use(requireAuth);

/** Пара X25519 для Reality: publicKey в клиент, privateKey — в inbound Xray на сервере. */
router.post("/reality-key", (_req, res) => {
  res.json(generateX25519RealityKeyPair());
});

/** Синхронизация UUID всех клиентов на развёрнутые серверы (как после сохранения карточки). */
router.post("/push-all", async (_req, res) => {
  try {
    await pushClientListToAllDeployedServers();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Опрос Xray на узлах (statsquery) и запись traffic_up/down + онлайн в БД. */
router.post("/sync-stats", async (_req, res) => {
  const t0 = Date.now();
  try {
    const beforeUsers = listUsers();
    const wasAllowed = new Map<number, boolean>(beforeUsers.map((u) => [u.id, userAllowedOnServers(u)]));
    const { byUuid, errors, warns } = await pullTrafficFromAllDeployedServers();
    const rows: Array<{
      vless_uuid: string;
      traffic_up: number;
      traffic_down: number;
      online_count: number;
    }> = [];
    const servers = listDeployedServers();
    for (const u of listUsers()) {
      const k = u.vless_uuid.trim().toLowerCase();
      const agg = byUuid.get(k) ?? byUuid.get(u.vless_uuid);
      let onlineCount = Math.max(0, Math.floor(Number(agg?.online) || 0));
      if (isDeviceLimitActiveForUser(u)) {
        let maxIps = 0;
        for (const row of servers) {
          try {
            maxIps = Math.max(maxIps, await countOnlineIpsForUserOnServer(row, u));
          } catch {
            /* skip */
          }
        }
        onlineCount = Math.max(onlineCount, maxIps);
      }
      if (agg || onlineCount > 0) {
        rows.push({
          vless_uuid: u.vless_uuid,
          traffic_up: Math.max(0, Math.floor(Number(agg?.up) || 0)),
          traffic_down: Math.max(0, Math.floor(Number(agg?.down) || 0)),
          online_count: onlineCount,
        });
      }
    }
    const updated = applyUsersTrafficSnapshot(rows, Date.now());
    const afterUsers = listUsers();
    const accessChanged = afterUsers.some((u) => (wasAllowed.get(u.id) ?? false) !== userAllowedOnServers(u));
    if (accessChanged) {
      try {
        // Если лимит исчерпан (или, наоборот, снова появился доступ), сразу синхронизируем UUID на узлы.
        await pushClientListToAllDeployedServers();
      } catch (e) {
        warns.push(`push-after-sync: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      // Не ждём фонового интервала: уведомляем о low/empty сразу после актуализации счётчиков.
      await runAutoTrafficNotificationsOnce();
    } catch (e) {
      warns.push(`traffic-notify: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await refreshSpeedLimitsOnAllDeployedServers();
    } catch (e) {
      warns.push(`speed-limit: ${e instanceof Error ? e.message : String(e)}`);
    }
    res.json({
      ok: errors.length === 0,
      updated,
      errors,
      warns,
      ms: Date.now() - t0,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

function deviceSlotDto(u: UserRow, slot: UserRow["device_slots"][number]) {
  return {
    id: slot.id,
    label: slot.label,
    created_at: slot.created_at,
    last_seen_at: slot.last_seen_at,
    last_ip: slot.last_ip,
    subscription_url: publicSubUrl(u.sub_token, slot.id),
  };
}

function userDto(u: UserRow) {
  const expiryAuto = expiryAutoNotifyStatusForUser(u);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    vless_uuid: u.vless_uuid,
    sub_token: u.sub_token,
    subscription_url: primarySubscriptionUrl(u),
    flow: u.flow,
    total_gb: u.total_gb,
    expiry_time: u.expiry_time,
    enable: u.enable === 1,
    tg_id: u.tg_id,
    comment: u.comment,
    traffic_up: u.traffic_up,
    traffic_down: u.traffic_down,
    remote_port: u.remote_port,
    reality_pbk: u.reality_pbk,
    reality_fp: u.reality_fp,
    reality_sni: u.reality_sni,
    reality_sid: u.reality_sid,
    reality_spx: u.reality_spx,
    subscription_server_count: u.subscription_server_count,
    subscription_server_ids: u.subscription_server_ids,
    device_limit_enabled: u.device_limit_enabled === 1,
    device_limit_global_enabled: isDeviceLimitGloballyEnabled(),
    device_limit_active: isDeviceLimitActiveForUser(u),
    device_limit_count: u.device_limit_count,
    device_limit_total: isDeviceLimitActiveForUser(u) ? userDeviceTotalLimit(u) : 0,
    devices_registered: activeDeviceSlots(u.device_slots ?? []).length,
    device_slots: (u.device_slots ?? []).map((s) => deviceSlotDto(u, s)),
    speed_limit_mbps: u.speed_limit_mbps,
    whitelist_happ_enabled: u.whitelist_happ_enabled === 1,
    whitelist_purchased: userHasPaidWhitelistProduct(u),
    online: deriveOnlineFromRow(u),
    online_devices: Number(u.online_devices) || 0,
    stats_synced_at: u.stats_synced_at,
    connection_profile: u.connection_profile,
    dropper_tickets: u.dropper_tickets,
    dropper_wins: dropperWinsForClientRow(u),
    extra_vless_links: u.extra_vless_links ?? [],
    expiry_auto_notify_status: expiryAuto.status,
    expiry_auto_notify_hint: expiryAuto.hint,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

router.get("/", (_req, res) => {
  res.json(listUsers().filter((u) => u.is_test_subscription !== 1).map(userDto));
});

function parseCreateBody(req: import("express").Request): CreateUserInput & { name?: string } {
  const b = req.body as Record<string, unknown>;
  return {
    name: b.name != null ? String(b.name) : undefined,
    email: b.email != null ? String(b.email) : undefined,
    vless_uuid: b.vless_uuid != null ? String(b.vless_uuid) : undefined,
    sub_token: b.sub_token != null ? String(b.sub_token) : undefined,
    flow: b.flow != null ? String(b.flow) : undefined,
    total_gb: b.total_gb != null ? Number(b.total_gb) : undefined,
    expiry_time: b.expiry_time != null ? Number(b.expiry_time) : undefined,
    enable:
      typeof b.enable === "boolean"
        ? b.enable
          ? 1
          : 0
        : b.enable === false || b.enable === 0
          ? 0
          : b.enable === true || b.enable === 1
            ? 1
            : undefined,
    tg_id: b.tg_id != null ? String(b.tg_id) : undefined,
    comment: b.comment != null ? String(b.comment) : undefined,
    traffic_up: b.traffic_up != null ? Number(b.traffic_up) : undefined,
    traffic_down: b.traffic_down != null ? Number(b.traffic_down) : undefined,
    remote_port: b.remote_port != null && b.remote_port !== "" ? Number(b.remote_port) : undefined,
    reality_pbk: b.reality_pbk != null ? String(b.reality_pbk) : undefined,
    reality_fp: b.reality_fp != null ? String(b.reality_fp) : undefined,
    reality_sni: b.reality_sni != null ? String(b.reality_sni) : undefined,
    reality_sid: b.reality_sid != null ? String(b.reality_sid) : undefined,
    reality_spx: b.reality_spx != null ? String(b.reality_spx) : undefined,
    subscription_server_count:
      b.subscription_server_count != null ? Number(b.subscription_server_count) : undefined,
    subscription_server_ids: Array.isArray(b.subscription_server_ids)
      ? (b.subscription_server_ids as unknown[]).map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0)
      : undefined,
    device_limit_enabled:
      typeof b.device_limit_enabled === "boolean"
        ? b.device_limit_enabled
          ? 1
          : 0
        : b.device_limit_enabled === false || b.device_limit_enabled === 0
          ? 0
          : b.device_limit_enabled === true || b.device_limit_enabled === 1
            ? 1
            : undefined,
    device_limit_count: b.device_limit_count != null ? Number(b.device_limit_count) : undefined,
    speed_limit_mbps: b.speed_limit_mbps != null && b.speed_limit_mbps !== "" ? Number(b.speed_limit_mbps) : undefined,
    whitelist_happ_enabled:
      typeof b.whitelist_happ_enabled === "boolean"
        ? b.whitelist_happ_enabled
          ? 1
          : 0
        : b.whitelist_happ_enabled === false || b.whitelist_happ_enabled === 0
          ? 0
          : b.whitelist_happ_enabled === true || b.whitelist_happ_enabled === 1
            ? 1
            : undefined,
    connection_profile:
      b.connection_profile != null && String(b.connection_profile).toLowerCase() === "reality" ? "reality" : undefined,
    extra_vless_links: coerceExtraVlessLinksInput(b.extra_vless_links),
  };
}

function assertExtraVlessValid(links: import("../extraVless.js").ExtraVlessLink[] | undefined): void {
  if (links === undefined) return;
  const raw = links;
  for (const item of raw) {
    if (!isValidVlessUri(item.uri)) {
      throw new Error("Некорректная VLESS-ссылка в дополнительных ключах");
    }
  }
}

router.post("/", async (req, res) => {
  const stream = wantsNdjsonStream(req);
  if (stream) initNdjsonStream(res);
  const log = stream
    ? (msg: string) => {
        ndjsonLine(res, { type: "log", msg, t: Date.now() });
      }
    : undefined;

  const input = parseCreateBody(req);
  if (!input.name?.trim() && !input.email?.trim()) {
    input.name = "Пользователь";
  }
  assertExtraVlessValid(input.extra_vless_links);

  try {
    log?.("Создание пользователя…");
    const user = createUser(input);
    log?.(`UUID: ${user.vless_uuid}`);
    log?.("Синхронизация на серверах…");
    await pushClientListToAllDeployedServers(log);
    log?.("Готово.");
    if (stream) {
      ndjsonLine(res, { type: "done", ok: true, user: userDto(user) });
      return res.end();
    }
    res.json({ user: userDto(user) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (stream) {
      ndjsonLine(res, { type: "error", message });
      return res.end();
    }
    res.status(message.includes("UUID") ? 409 : 500).json({ error: message });
  }
});

router.patch("/:id(\\d+)", async (req, res) => {
  const id = Number(req.params.id);
  const patch = parseCreateBody(req) as Partial<CreateUserInput> & { name?: string };
  assertExtraVlessValid(patch.extra_vless_links);
  const before = getUser(id);
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  let u = updateUserRow(id, patch);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  backfillDeployedServerRealityFromUser(u);

  const explicitlyEnabledNow = patch.device_limit_enabled === 1;
  const turnedOnInPatch = before.device_limit_enabled !== 1 && explicitlyEnabledNow;
  const becameLimitActive = !isDeviceLimitActiveForUser(before) && isDeviceLimitActiveForUser(u);
  if ((turnedOnInPatch || becameLimitActive) && isDeviceLimitActiveForUser(u)) {
    try {
      const migrated = await migrateUserDeviceSlotsFromOnline(id);
      if (migrated.user) u = migrated.user;
    } catch (e) {
      console.error("[users] migrate slots after enabling limit:", e instanceof Error ? e.message : e);
    }
  }

  res.json({ user: userDto(u) });
  void pushClientListToAllDeployedServers().catch((e) => {
    console.error("[users] push after patch:", e);
  });
});

router.post("/:id(\\d+)/notify-expiry", async (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const b = req.body as { tg_id?: unknown; expiry_time?: unknown };
  const effective: UserRow = { ...u };
  if (b.tg_id !== undefined) effective.tg_id = String(b.tg_id ?? "").trim();
  if (b.expiry_time !== undefined) effective.expiry_time = coerceExpiryTimeMs(b.expiry_time);
  try {
    await sendExpiryRenewalReminder(effective, { manual: true });
    res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const bad = new Set(["no_tg", "no_expiry", "expired", "too_early"]);
    if (bad.has(msg)) {
      res.status(400).json({ error: msg });
      return;
    }
    if (msg === "telegram_not_configured") {
      res.status(503).json({ error: msg });
      return;
    }
    res.status(502).json({ error: msg });
  }
});

router.post("/:id(\\d+)/notify-expired", async (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const b = req.body as { tg_id?: unknown; expiry_time?: unknown };
  const effective: UserRow = { ...u };
  if (b.tg_id !== undefined) effective.tg_id = String(b.tg_id ?? "").trim();
  if (b.expiry_time !== undefined) effective.expiry_time = coerceExpiryTimeMs(b.expiry_time);
  try {
    await sendExpiredSubscriptionReminder(effective, { manual: true });
    res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const bad = new Set(["no_tg", "no_expiry", "not_expired"]);
    if (bad.has(msg)) {
      res.status(400).json({ error: msg });
      return;
    }
    if (msg === "telegram_not_configured") {
      res.status(503).json({ error: msg });
      return;
    }
    res.status(502).json({ error: msg });
  }
});

router.post("/:id(\\d+)/reset-traffic", async (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const next = await resetUserTrafficCounters(u);
  if (!next) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true, user: userDto(next) });
});

router.post("/bulk-delete-inactive", async (req, res) => {
  const body = req.body as { user_ids?: unknown; send_message?: unknown; message?: unknown };
  const requestedIds = Array.isArray(body.user_ids)
    ? body.user_ids
        .map((x) => Math.floor(Number(x)))
        .filter((n, i, arr) => Number.isFinite(n) && n > 0 && arr.indexOf(n) === i)
    : [];
  if (requestedIds.length === 0) {
    res.status(400).json({ error: "user_ids_required" });
    return;
  }

  const sendMessage = body.send_message === true || body.send_message === 1 || body.send_message === "1";
  const message = String(body.message ?? "").trim();
  if (sendMessage && !message) {
    res.status(400).json({ error: "message_required" });
    return;
  }

  const requestedSet = new Set(requestedIds);
  const inactiveUsers = listUsers().filter((u) => requestedSet.has(u.id) && isExpiredUser(u));
  if (inactiveUsers.length === 0) {
    res.status(400).json({ error: "inactive_users_not_found" });
    return;
  }

  const notifyFailures: Array<{ user_id: number; user_name: string; error: string }> = [];
  const deleteFailures: Array<{ user_id: number; user_name: string; error: string }> = [];
  const notifiedRecipients: Array<{ user_id: number; user_name: string }> = [];
  let deleted = 0;

  for (const u of inactiveUsers) {
    if (sendMessage) {
      const chatId = parseChatId(u.tg_id);
      if (chatId == null) {
        notifyFailures.push({ user_id: u.id, user_name: u.name, error: "no_tg_id" });
      } else {
        try {
          await sendTelegramMessage(chatId, message);
          notifiedRecipients.push({ user_id: u.id, user_name: u.name });
        } catch (e) {
          notifyFailures.push({
            user_id: u.id,
            user_name: u.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    try {
      await removeUserUuidFromAllServers(u.vless_uuid);
      deleteUser(u.id);
      deleted++;
    } catch (e) {
      deleteFailures.push({
        user_id: u.id,
        user_name: u.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (sendMessage && notifiedRecipients.length > 0) {
    logCommunicationMessage({
      automatic: false,
      source_label: "Удаление неактивных",
      mode: "selected",
      text: message,
      has_photo: false,
      recipients: notifiedRecipients,
      sent: notifiedRecipients.length,
      attempted: inactiveUsers.length,
      failed: notifyFailures.length,
    });
  }

  res.json({
    ok: deleteFailures.length === 0,
    attempted: inactiveUsers.length,
    deleted,
    notified: notifiedRecipients.length,
    delete_failures: deleteFailures,
    notify_failures: notifyFailures,
  });
});

router.get("/:id(\\d+)/subscription", (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ url: primarySubscriptionUrl(u) });
});

router.post("/:id(\\d+)/device-slots", (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
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
    res.status(409).json({ error: "device_limit_full", user: userDto(result.user!) });
    return;
  }
  res.status(201).json({
    slot: deviceSlotDto(result.user!, result.slot!),
    user: userDto(result.user!),
  });
});

router.delete("/:id(\\d+)/device-slots/:deviceId", (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const deviceId = decodeURIComponent(String(req.params.deviceId ?? "").trim());
  const next = removeUserDeviceSlot(id, deviceId);
  if (!next) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ user: userDto(next) });
});

router.get("/:id(\\d+)/preview", async (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    await refreshMissingSubscriptionHintsIfDue();
  } catch {
    /* ignore */
  }
  backfillDeployedServerRealityFromUser(u);
  let fresh = getUser(id) ?? u;
  try {
    const peek = await peekUserTrafficForSubscription(fresh);
    fresh = {
      ...fresh,
      online_devices: Math.max(0, Math.floor(Number(peek.online) || 0)),
      online_snapshot: Number(peek.online) > 0 ? 1 : 0,
    };
  } catch {
    /* ignore */
  }
  const links = resolveSubscriptionLinks(fresh, { apply_device_limit: false });
  res.json({
    count: links.length,
    links,
    base64: resolveSubscriptionBase64(fresh, { apply_device_limit: false }),
  });
});

router.delete("/:id(\\d+)", async (req, res) => {
  const id = Number(req.params.id);
  const stream = wantsNdjsonStream(req);
  if (stream) initNdjsonStream(res);
  const log = stream
    ? (msg: string) => {
        ndjsonLine(res, { type: "log", msg, t: Date.now() });
      }
    : undefined;

  const u = getUser(id);
  if (!u) {
    if (stream) {
      ndjsonLine(res, { type: "error", message: "not_found" });
      return res.end();
    }
    return res.status(404).json({ error: "not_found" });
  }

  try {
    log?.(`Удаление UUID с серверов: ${u.vless_uuid}`);
    await removeUserUuidFromAllServers(u.vless_uuid, log);
    deleteUser(id);
    if (stream) {
      ndjsonLine(res, { type: "done", ok: true });
      return res.end();
    }
    res.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (stream) {
      ndjsonLine(res, { type: "error", message });
      return res.end();
    }
    res.status(500).json({ error: message });
  }
});

export default router;
