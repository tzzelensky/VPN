import { Router } from "express";
import {
  createConfigVaultKey,
  deleteConfigVaultKey,
  getConfigVaultKey,
  importConfigVaultKeys,
  listConfigVaultChecks,
  listConfigVaultKeys,
  purgeConfigVaultChecksOlderThanDays,
  saveConfigVaultSettings,
  setConfigVaultKeyInSubscriptions,
  updateConfigVaultKey,
  vaultKeyForApi,
} from "../configVaultDb.js";
import { getConfigVaultOverview, runConfigVaultCheckForKey, startConfigVaultCheckAllBackground } from "../configVaultService.js";
import { parseProxyUri, validateConfigVaultKeyInput } from "../configVaultUri.js";
import { getPanelSettings } from "../panelSettings.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

function includeRaw(): boolean {
  return !getPanelSettings().security.maskSecrets;
}

function mapKeys(keys: ReturnType<typeof listConfigVaultKeys>) {
  return keys.map((k) => vaultKeyForApi(k, includeRaw()));
}

router.get("/", (_req, res) => {
  res.json({
    ...getConfigVaultOverview(),
    keys: mapKeys(listConfigVaultKeys()),
  });
});

router.get("/settings", (_req, res) => {
  res.json(getConfigVaultOverview());
});

router.patch("/settings", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const settings = saveConfigVaultSettings({
      auto_check_enabled: b.auto_check_enabled as boolean | undefined,
      interval_minutes: Number.isFinite(Number(b.interval_minutes)) ? Number(b.interval_minutes) : undefined,
      attempts_per_check: Number.isFinite(Number(b.attempts_per_check)) ? Number(b.attempts_per_check) : undefined,
      attempt_timeout_sec: Number.isFinite(Number(b.attempt_timeout_sec)) ? Number(b.attempt_timeout_sec) : undefined,
      test_url: b.test_url != null ? String(b.test_url) : undefined,
      notify_on_unavailable: b.notify_on_unavailable as boolean | undefined,
      notify_on_recovery: b.notify_on_recovery as boolean | undefined,
      notify_cooldown_minutes: Number.isFinite(Number(b.notify_cooldown_minutes))
        ? Number(b.notify_cooldown_minutes)
        : undefined,
    });
    const overview = getConfigVaultOverview();
    res.json({ ...overview, settings });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/", (req, res) => {
  try {
    const b = (req.body ?? {}) as { name?: unknown; raw_uri?: unknown; active?: unknown; notify_on_fail?: unknown };
    const name = String(b.name ?? "").trim();
    const raw_uri = String(b.raw_uri ?? "").trim();
    const err = validateConfigVaultKeyInput(
      name,
      raw_uri,
      listConfigVaultKeys().map((k) => k.raw_uri),
    );
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    const created = createConfigVaultKey({
      name,
      raw_uri,
      active: !(b.active === false || b.active === 0 || b.active === "0"),
      notify_on_fail: !(b.notify_on_fail === false || b.notify_on_fail === 0 || b.notify_on_fail === "0"),
    });
    res.status(201).json({ key: vaultKeyForApi(created, includeRaw()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/import", (req, res) => {
  try {
    const b = (req.body ?? {}) as { text?: unknown; name_prefix?: unknown; active?: unknown; notify_on_fail?: unknown };
    const text = String(b.text ?? "");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const result = importConfigVaultKeys(lines, {
      name_prefix: String(b.name_prefix ?? "").trim(),
      active: !(b.active === false || b.active === 0 || b.active === "0"),
      notify_on_fail: !(b.notify_on_fail === false || b.notify_on_fail === 0 || b.notify_on_fail === "0"),
    });
    res.json({ ...result, keys: mapKeys(listConfigVaultKeys()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/export", (req, res) => {
  const mode = String(req.query.mode ?? "all").trim().toLowerCase();
  let keys = listConfigVaultKeys();
  if (mode === "active") keys = keys.filter((k) => k.active);
  else if (mode === "subscriptions") keys = keys.filter((k) => k.added_to_subscriptions);
  else if (mode === "available") keys = keys.filter((k) => k.last_check_status === "available");
  const fmt = String(req.query.format ?? "txt").trim().toLowerCase();
  if (fmt === "json") {
    res.json({
      exported_at: new Date().toISOString(),
      keys: keys.map((k) => ({
        name: k.name,
        uri: k.raw_uri,
        active: k.active,
        added_to_subscriptions: k.added_to_subscriptions,
      })),
    });
    return;
  }
  const body = keys.map((k) => k.raw_uri).join("\n");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="vless-keys-${mode}.txt"`);
  res.send(body);
});

router.post("/check-all", (_req, res) => {
  try {
    const { total, already_running } = startConfigVaultCheckAllBackground("manual");
    res.json({
      started: true,
      already_running,
      total,
      checked: 0,
      ...getConfigVaultOverview(),
      keys: mapKeys(listConfigVaultKeys()),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  const k = getConfigVaultKey(id);
  if (!k) {
    res.status(404).json({ error: "Ключ не найден" });
    return;
  }
  // Полный URI только для авторизованного просмотра/редактирования одного ключа.
  res.json({ key: vaultKeyForApi(k, true), parsed: parseProxyUri(k.raw_uri) });
});

router.patch("/:id", (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const cur = getConfigVaultKey(id);
    if (!cur) {
      res.status(404).json({ error: "Ключ не найден" });
      return;
    }
    const b = (req.body ?? {}) as {
      name?: unknown;
      raw_uri?: unknown;
      active?: unknown;
      notify_on_fail?: unknown;
    };
    if (b.raw_uri != null) {
      const err = validateConfigVaultKeyInput(
        String(b.name ?? cur.name),
        String(b.raw_uri),
        listConfigVaultKeys().filter((k) => k.id !== id).map((k) => k.raw_uri),
      );
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }
    const updated = updateConfigVaultKey(id, {
      name: b.name != null ? String(b.name) : undefined,
      raw_uri: b.raw_uri != null ? String(b.raw_uri) : undefined,
      active: b.active !== undefined ? !(b.active === false || b.active === 0 || b.active === "0") : undefined,
      notify_on_fail:
        b.notify_on_fail !== undefined ? !(b.notify_on_fail === false || b.notify_on_fail === 0 || b.notify_on_fail === "0") : undefined,
    });
    res.json({ key: vaultKeyForApi(updated, includeRaw()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/:id", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  if (!getConfigVaultKey(id)) {
    res.status(404).json({ error: "Ключ не найден" });
    return;
  }
  deleteConfigVaultKey(id);
  res.json({ ok: true });
});

router.post("/:id/subscriptions", (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const added = (req.body as { added?: unknown })?.added !== false;
    const key = setConfigVaultKeyInSubscriptions(id, added);
    res.json({ key: vaultKeyForApi(key, includeRaw()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/:id/check", async (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const result = await runConfigVaultCheckForKey(id, "manual");
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id/checks", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  const status = String(req.query.status ?? "").trim().toLowerCase();
  const triggered = String(req.query.triggered_by ?? "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || 50)));
  let checks = listConfigVaultChecks(id, limit);
  if (status === "available" || status === "unavailable" || status === "unstable") {
    checks = checks.filter((c) => c.status === status);
  }
  if (triggered === "manual" || triggered === "auto") {
    checks = checks.filter((c) => c.triggered_by === triggered);
  }
  res.json({ checks });
});

router.delete("/:id/checks", (req, res) => {
  const days = Math.max(1, Math.floor(Number(req.query.older_than_days) || 30));
  const removed = purgeConfigVaultChecksOlderThanDays(days);
  res.json({ removed });
});

export default router;
