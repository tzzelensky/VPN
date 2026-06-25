import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getPanelSettings } from "../panelSettings.js";
import {
  createTelegramProxy,
  deleteTelegramProxy,
  getTelegramProxiesOverview,
  getTelegramProxyLogs,
  listProxyEvents,
  listServersForProxies,
  proxyForApi,
  purgeServerProxies,
  restartTelegramProxy,
  runTelegramProxyCheck,
  saveProxySettings,
  startTelegramProxyCheckAllBackground,
  suggestFreePort,
  updateTelegramProxy,
} from "../telegramProxyService.js";
import {
  getTelegramProxy,
  listTelegramProxies,
  listTelegramProxyChecks,
} from "../telegramProxiesDb.js";
import type { TelegramProxyType } from "../telegramProxiesTypes.js";
import { generateMtprotoDdSecret, generateMtprotoSecret } from "../telegramProxyDeploy.js";

const router = Router();
router.use(requireAuth);

function includeSecrets(): boolean {
  return !getPanelSettings().security.maskSecrets;
}

function mapProxies(rows: ReturnType<typeof listTelegramProxies>) {
  return rows.map((p) => proxyForApi(p, includeSecrets()));
}

function parseType(raw: unknown): TelegramProxyType | null {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "mtproto" || t === "socks5" || t === "http") return t;
  return null;
}

router.get("/", (_req, res) => {
  res.json({
    ...getTelegramProxiesOverview(),
    servers: listServersForProxies(),
    proxies: mapProxies(listTelegramProxies()),
  });
});

router.get("/settings", (_req, res) => {
  res.json(getTelegramProxiesOverview());
});

router.patch("/settings", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const settings = saveProxySettings({
      auto_check_enabled: b.auto_check_enabled as boolean | undefined,
      interval_minutes: Number.isFinite(Number(b.interval_minutes)) ? Number(b.interval_minutes) : undefined,
      attempts_per_check: Number.isFinite(Number(b.attempts_per_check)) ? Number(b.attempts_per_check) : undefined,
      attempt_timeout_sec: Number.isFinite(Number(b.attempt_timeout_sec)) ? Number(b.attempt_timeout_sec) : undefined,
      notify_on_unavailable: b.notify_on_unavailable as boolean | undefined,
      notify_on_recovery: b.notify_on_recovery as boolean | undefined,
      notify_cooldown_minutes: Number.isFinite(Number(b.notify_cooldown_minutes))
        ? Number(b.notify_cooldown_minutes)
        : undefined,
    });
    res.json({ ...getTelegramProxiesOverview(), settings });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/events", (req, res) => {
  const limit = Math.min(500, Math.max(1, Math.floor(Number(req.query.limit) || 200)));
  res.json({ events: listProxyEvents(limit) });
});

router.get("/suggest-port", async (req, res) => {
  try {
    const serverId = Math.floor(Number(req.query.server_id));
    const type = parseType(req.query.type);
    if (!serverId || !type) {
      res.status(400).json({ error: "Укажите server_id и type" });
      return;
    }
    const port = await suggestFreePort(serverId, type);
    res.json({ port });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/generate-secret", (req, res) => {
  const mode = String(req.query.mode ?? "dd").trim().toLowerCase();
  res.json({ secret: mode === "ee" ? generateMtprotoSecret() : generateMtprotoDdSecret() });
});

router.post("/check-all", (_req, res) => {
  const { total, already_running } = startTelegramProxyCheckAllBackground("manual");
  res.json({
    ...getTelegramProxiesOverview(),
    proxies: mapProxies(listTelegramProxies()),
    total,
    already_running,
    started: !already_running,
  });
});

router.post("/servers/:serverId/check-all", async (req, res) => {
  const serverId = Math.floor(Number(req.params.serverId));
  const proxies = listTelegramProxies({ server_id: serverId }).filter((p) => p.active);
  let checked = 0;
  const errors: string[] = [];
  for (const p of proxies) {
    try {
      await runTelegramProxyCheck(p.id, "manual");
      checked += 1;
    } catch (e) {
      errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  res.json({
    checked,
    errors,
    proxies: mapProxies(listTelegramProxies({ server_id: serverId })),
  });
});

router.post("/servers/:serverId/purge", async (req, res) => {
  try {
    const serverId = Math.floor(Number(req.params.serverId));
    const result = await purgeServerProxies(serverId);
    res.json({
      ...result,
      ...getTelegramProxiesOverview(),
      servers: listServersForProxies(),
      proxies: mapProxies(listTelegramProxies()),
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/", async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const type = parseType(b.type);
    if (!type) {
      res.status(400).json({ error: "Некорректный тип прокси" });
      return;
    }
    const result = await createTelegramProxy({
      server_id: Math.floor(Number(b.server_id)),
      name: String(b.name ?? ""),
      type,
      port: b.port != null ? Math.floor(Number(b.port)) : undefined,
      auth_enabled: b.auth_enabled as boolean | undefined,
      username: b.username != null ? String(b.username) : undefined,
      password: b.password != null ? String(b.password) : undefined,
      secret: b.secret != null ? String(b.secret) : undefined,
      auto_generate: b.auto_generate as boolean | undefined,
      active: b.active as boolean | undefined,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  const row = getTelegramProxy(id);
  if (!row) {
    res.status(404).json({ error: "Прокси не найден" });
    return;
  }
  res.json({ proxy: proxyForApi(row, true) });
});

router.patch("/:id", async (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const b = (req.body ?? {}) as Record<string, unknown>;
    const result = await updateTelegramProxy(id, {
      name: b.name != null ? String(b.name) : undefined,
      port: b.port != null ? Math.floor(Number(b.port)) : undefined,
      auth_enabled: b.auth_enabled as boolean | undefined,
      username: b.username != null ? String(b.username) : undefined,
      password: b.password != null ? String(b.password) : undefined,
      secret: b.secret != null ? String(b.secret) : undefined,
      active: b.active as boolean | undefined,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    await deleteTelegramProxy(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/:id/check", async (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const result = await runTelegramProxyCheck(id, "manual");
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/:id/restart", async (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const result = await restartTelegramProxy(id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id/checks", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 50)));
  res.json({ checks: listTelegramProxyChecks(id, limit) });
});

router.get("/:id/logs", async (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const lines = Math.min(300, Math.max(10, Math.floor(Number(req.query.lines) || 80)));
    const result = await getTelegramProxyLogs(id, lines);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
