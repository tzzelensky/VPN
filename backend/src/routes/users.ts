import { Router } from "express";
import {
  applyUsersTrafficSnapshot,
  backfillDeployedServerRealityFromUser,
  coerceExpiryTimeMs,
  createUser,
  deleteUser,
  findUserByVlessUuid,
  getUser,
  listUsers,
  updateUserRow,
  userAllowedOnServers,
  type CreateUserInput,
  type UserRow,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { pushClientListToAllDeployedServers, removeUserUuidFromAllServers } from "../userSync.js";
import { initNdjsonStream, ndjsonLine, wantsNdjsonStream } from "../streamUtil.js";
import { buildSubscriptionPayload } from "../vlessLink.js";
import { subscriptionVlessLinksForUser } from "../subscriptionLinks.js";
import { parseXuiInboundImport } from "../xuiImport.js";
import { generateX25519RealityKeyPair } from "../realityKeygen.js";
import { sendExpiryRenewalReminder } from "../telegram/expiryNotify.js";
import { runAutoTrafficNotificationsOnce } from "../telegram/trafficNotify.js";
import { peekUserTrafficFromServers, pullTrafficFromAllDeployedServers } from "../xrayStatsPull.js";
import { refreshMissingSubscriptionHintsIfDue } from "../subscriptionHintsRefresh.js";

const router = Router();

/** После sync онлайн считается актуальным это время (клиенты/админка опрос не чаще ~30 с). */
const ONLINE_SNAPSHOT_TTL_MS = 75_000;

function deriveOnlineFromRow(u: UserRow): boolean {
  const t = u.stats_synced_at;
  if (!t || !Number.isFinite(t) || Date.now() - t > ONLINE_SNAPSHOT_TTL_MS) return false;
  return u.online_snapshot === 1;
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
      online: boolean;
    }> = [];
    for (const u of listUsers()) {
      const k = u.vless_uuid.trim().toLowerCase();
      const agg = byUuid.get(k) ?? byUuid.get(u.vless_uuid);
      if (agg) {
        rows.push({
          vless_uuid: u.vless_uuid,
          traffic_up: agg.up,
          traffic_down: agg.down,
          online: agg.online > 0,
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

function publicSubUrl(subToken: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${base}/sub/${subToken}`;
}

function userDto(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    vless_uuid: u.vless_uuid,
    sub_token: u.sub_token,
    subscription_url: publicSubUrl(u.sub_token),
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
    online: deriveOnlineFromRow(u),
    stats_synced_at: u.stats_synced_at,
    connection_profile: u.connection_profile,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

router.get("/", (_req, res) => {
  res.json(listUsers().map(userDto));
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
    connection_profile:
      b.connection_profile != null && String(b.connection_profile).toLowerCase() === "reality" ? "reality" : undefined,
  };
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

router.post("/import", async (req, res) => {
  const stream = wantsNdjsonStream(req);
  if (stream) initNdjsonStream(res);
  const log = stream
    ? (msg: string) => {
        ndjsonLine(res, { type: "log", msg, t: Date.now() });
      }
    : undefined;

  try {
    let raw: unknown = req.body?.json ?? req.body?.raw ?? req.body;
    if (typeof raw === "string") {
      raw = JSON.parse(raw) as unknown;
    }
    const parsed = parseXuiInboundImport(raw);
    if (!parsed.ok) {
      if (stream) {
        ndjsonLine(res, { type: "error", message: parsed.error });
        return res.end();
      }
      return res.status(400).json({ error: parsed.error });
    }
    const existing = findUserByVlessUuid(parsed.data.vless_uuid ?? "");
    if (existing) {
      const err = "Пользователь с таким UUID уже существует.";
      if (stream) {
        ndjsonLine(res, { type: "error", message: err });
        return res.end();
      }
      return res.status(409).json({ error: err });
    }
    log?.("Импорт из x-ui…");
    const user = createUser(parsed.data);
    log?.(`Создан: ${user.name}`);
    await pushClientListToAllDeployedServers(log);
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
    res.status(500).json({ error: message });
  }
});

router.patch("/:id(\\d+)", async (req, res) => {
  const id = Number(req.params.id);
  const patch = parseCreateBody(req) as Partial<CreateUserInput> & { name?: string };
  const u = updateUserRow(id, patch);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  backfillDeployedServerRealityFromUser(u);
  try {
    await pushClientListToAllDeployedServers();
    res.json({ user: userDto(u) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
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
    await sendExpiryRenewalReminder(effective);
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

router.post("/:id(\\d+)/reset-traffic", async (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  let rawUp = Number.isFinite(Number(u.stats_raw_up)) ? Math.max(0, Math.floor(Number(u.stats_raw_up))) : 0;
  let rawDown = Number.isFinite(Number(u.stats_raw_down)) ? Math.max(0, Math.floor(Number(u.stats_raw_down))) : 0;
  try {
    const agg = await peekUserTrafficFromServers(u);
    rawUp = Math.max(0, Math.floor(Number(agg.up) || 0));
    rawDown = Math.max(0, Math.floor(Number(agg.down) || 0));
  } catch {
    /* узлы недоступны — используем сохранённый baseline из БД */
  }
  const next = updateUserRow(id, {
    traffic_up: 0,
    traffic_down: 0,
    online_snapshot: 0,
    stats_synced_at: Date.now(),
    stats_raw_up: rawUp,
    stats_raw_down: rawDown,
    traffic_notify_state: "",
  });
  if (!next) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true, user: userDto(next) });
});

router.get("/:id(\\d+)/subscription", (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ url: publicSubUrl(u.sub_token) });
});

router.get("/:id(\\d+)/preview", async (req, res) => {
  const id = Number(req.params.id);
  const u = getUser(id);
  if (!u) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!userAllowedOnServers(u)) {
    res.json({ count: 0, links: [], base64: buildSubscriptionPayload([]) });
    return;
  }
  try {
    await refreshMissingSubscriptionHintsIfDue();
  } catch {
    /* ignore */
  }
  backfillDeployedServerRealityFromUser(u);
  const fresh = getUser(id) ?? u;
  const links = subscriptionVlessLinksForUser(fresh);
  res.json({ count: links.length, links, base64: buildSubscriptionPayload(links) });
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
