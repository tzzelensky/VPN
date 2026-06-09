import { Router } from "express";
import {
  buildProxyUrisFromClientJson,
  parseProxyUri,
  validateWhitelistKeyInput,
} from "../configVaultUri.js";
import {
  bulkAssignWhitelistVaultKeys,
  bulkDeleteWhitelistVaultKeys,
  bulkRenameWhitelistVaultKeys,
  createWhitelistVaultKey,
  deleteAllWhitelistVaultKeys,
  deleteWhitelistVaultKey,
  getWhitelistVaultKey,
  importWhitelistVaultUris,
  listWhitelistPurchases,
  listWhitelistVaultChecks,
  listWhitelistVaultKeys,
  purgeWhitelistVaultChecksOlderThanDays,
  saveWhitelistInstructionSettings,
  saveWhitelistPurchaseSettings,
  saveWhitelistVaultSettings,
  setWhitelistVaultKeyAssignment,
  updateWhitelistVaultKey,
  whitelistKeyForApi,
} from "../whitelistVaultDb.js";
import {
  getWhitelistVaultOverview,
  runWhitelistVaultCheckForKey,
  startWhitelistVaultCheckAllBackground,
} from "../whitelistVaultService.js";
import { sendWhitelistInstructionTestToAdmin } from "../whitelistPurchaseService.js";
import {
  deleteWhitelistInstructionPhoto,
  readWhitelistInstructionPhoto,
  saveWhitelistInstructionPhoto,
} from "../whitelistInstructionFiles.js";
import type { WhitelistAssignmentMode } from "../whitelistVaultTypes.js";
import { getPanelSettings } from "../panelSettings.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.get("/instruction/photo/:name", (req, res) => {
  const name = String(req.params.name ?? "").trim();
  const hit = readWhitelistInstructionPhoto(name);
  if (!hit) {
    res.status(404).send("not_found");
    return;
  }
  res.setHeader("Content-Type", hit.mime);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(hit.bytes);
});

router.use(requireAuth);

function includeRaw(): boolean {
  return !getPanelSettings().security.maskSecrets;
}

function mapKeys(keys: ReturnType<typeof listWhitelistVaultKeys>) {
  return keys.map((k) => whitelistKeyForApi(k, includeRaw()));
}

function parseAssignment(body: Record<string, unknown>): {
  assignment_mode?: WhitelistAssignmentMode;
  assigned_user_ids?: number[];
} {
  const modeRaw = body.assignment_mode != null ? String(body.assignment_mode).trim().toLowerCase() : undefined;
  const assignment_mode =
    modeRaw === "all" || modeRaw === "selected" || modeRaw === "none" ? modeRaw : undefined;
  const assigned_user_ids = Array.isArray(body.assigned_user_ids)
    ? body.assigned_user_ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0)
    : undefined;
  return { assignment_mode, assigned_user_ids };
}

router.get("/", (_req, res) => {
  res.json({
    ...getWhitelistVaultOverview(),
    keys: mapKeys(listWhitelistVaultKeys()),
  });
});

router.get("/settings", (_req, res) => {
  res.json(getWhitelistVaultOverview());
});

router.patch("/settings", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const purchasePatch =
      b.purchase && typeof b.purchase === "object"
        ? (b.purchase as Record<string, unknown>)
        : undefined;
    const instructionPatch =
      b.instruction && typeof b.instruction === "object"
        ? (b.instruction as Record<string, unknown>)
        : undefined;
    const settings = saveWhitelistVaultSettings({
      enabled: b.enabled as boolean | undefined,
      auto_check_enabled: b.auto_check_enabled as boolean | undefined,
      interval_minutes: Number.isFinite(Number(b.interval_minutes)) ? Number(b.interval_minutes) : undefined,
      attempts_per_check: Number.isFinite(Number(b.attempts_per_check)) ? Number(b.attempts_per_check) : undefined,
      attempt_timeout_sec: Number.isFinite(Number(b.attempt_timeout_sec))
        ? Number(b.attempt_timeout_sec)
        : undefined,
      test_url: b.test_url != null ? String(b.test_url) : undefined,
      notify_on_unavailable: b.notify_on_unavailable as boolean | undefined,
      notify_cooldown_minutes: Number.isFinite(Number(b.notify_cooldown_minutes))
        ? Number(b.notify_cooldown_minutes)
        : undefined,
      purchase: purchasePatch
        ? {
            ...(purchasePatch.sale_enabled !== undefined ? { sale_enabled: purchasePatch.sale_enabled === true } : {}),
            ...(Number.isFinite(Number(purchasePatch.price_rub)) ? { price_rub: Number(purchasePatch.price_rub) } : {}),
            ...(purchasePatch.duration != null
              ? { duration: String(purchasePatch.duration) as "subscription_end" | "30_days" | "forever" }
              : {}),
            ...(purchasePatch.miniapp_description != null
              ? { miniapp_description: String(purchasePatch.miniapp_description) }
              : {}),
            ...(purchasePatch.bot_description != null ? { bot_description: String(purchasePatch.bot_description) } : {}),
            ...(purchasePatch.issue_unavailable_keys !== undefined
              ? { issue_unavailable_keys: purchasePatch.issue_unavailable_keys === true }
              : {}),
          }
        : undefined,
      instruction: instructionPatch
        ? {
            ...(instructionPatch.title != null ? { title: String(instructionPatch.title) } : {}),
            ...(instructionPatch.text != null ? { text: String(instructionPatch.text) } : {}),
          }
        : undefined,
    });
    res.json({ ...getWhitelistVaultOverview(), settings });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/purchases", (_req, res) => {
  res.json({ purchases: listWhitelistPurchases(200) });
});

router.patch("/purchase-settings", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const purchase = saveWhitelistPurchaseSettings({
      sale_enabled: b.sale_enabled as boolean | undefined,
      price_rub: Number.isFinite(Number(b.price_rub)) ? Number(b.price_rub) : undefined,
      duration: b.duration != null ? (String(b.duration) as "subscription_end" | "30_days" | "forever") : undefined,
      miniapp_description: b.miniapp_description != null ? String(b.miniapp_description) : undefined,
      bot_description: b.bot_description != null ? String(b.bot_description) : undefined,
      issue_unavailable_keys: b.issue_unavailable_keys as boolean | undefined,
    });
    res.json({ purchase, ...getWhitelistVaultOverview() });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch("/instruction", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const instruction = saveWhitelistInstructionSettings({
      title: b.title != null ? String(b.title) : undefined,
      text: b.text != null ? String(b.text) : undefined,
    });
    res.json({ instruction, ...getWhitelistVaultOverview() });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/instruction/photo", (req, res) => {
  try {
    const b = (req.body ?? {}) as { photo_base64?: unknown; photo_mime?: unknown };
    const raw = String(b.photo_base64 ?? "").trim();
    const m = /^data:([^;]+);base64,(.+)$/i.exec(raw);
    const mime = m?.[1] ?? String(b.photo_mime ?? "image/jpeg");
    const b64 = m?.[2] ?? raw;
    if (!b64) {
      res.status(400).json({ error: "Фото не передано" });
      return;
    }
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length < 16) {
      res.status(400).json({ error: "Некорректное фото" });
      return;
    }
    const cur = getWhitelistVaultOverview().settings.instruction.photo_path;
    deleteWhitelistInstructionPhoto(cur);
    const rel = saveWhitelistInstructionPhoto(bytes, mime);
    const instruction = saveWhitelistInstructionSettings({ photo_path: rel });
    res.json({ instruction, ...getWhitelistVaultOverview() });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/instruction/photo", (_req, res) => {
  const cur = getWhitelistVaultOverview().settings.instruction.photo_path;
  deleteWhitelistInstructionPhoto(cur);
  const instruction = saveWhitelistInstructionSettings({ photo_path: null });
  res.json({ instruction, ...getWhitelistVaultOverview() });
});

router.post("/instruction/test", async (req, res) => {
  try {
    const adminId = Math.floor(Number((req.body as { admin_chat_id?: unknown })?.admin_chat_id));
    if (!adminId) {
      res.status(400).json({ error: "Укажите admin_chat_id" });
      return;
    }
    await sendWhitelistInstructionTestToAdmin(adminId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = String(b.name ?? "").trim();
    const raw_uri = String(b.raw_uri ?? "").trim();
    const err = validateWhitelistKeyInput(
      name,
      raw_uri,
      listWhitelistVaultKeys().map((k) => k.raw_uri),
    );
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    const assign = parseAssignment(b);
    const created = createWhitelistVaultKey({
      name,
      raw_uri,
      active: !(b.active === false || b.active === 0 || b.active === "0"),
      include_in_sale: b.include_in_sale === true || b.include_in_sale === 1 || b.include_in_sale === "1",
      notify_on_fail: !(b.notify_on_fail === false || b.notify_on_fail === 0 || b.notify_on_fail === "0"),
      source_type: "manual_vless",
      assignment_mode: assign.assignment_mode,
      assigned_user_ids: assign.assigned_user_ids,
    });
    res.status(201).json({ key: whitelistKeyForApi(created, includeRaw()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/import", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const text = String(b.text ?? "");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const assign = parseAssignment(b);
    const result = importWhitelistVaultUris(lines, {
      name_prefix: String(b.name_prefix ?? "").trim(),
      active: !(b.active === false || b.active === 0 || b.active === "0"),
      include_in_sale: b.include_in_sale === true || b.include_in_sale === 1 || b.include_in_sale === "1",
      notify_on_fail: !(b.notify_on_fail === false || b.notify_on_fail === 0 || b.notify_on_fail === "0"),
      source_type: "manual_vless",
      assignment_mode: assign.assignment_mode,
      assigned_user_ids: assign.assigned_user_ids,
    });
    res.json({ ...result, keys: mapKeys(listWhitelistVaultKeys()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/import-json", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const jsonText = String(b.json ?? b.text ?? "").trim();
    if (!jsonText) {
      res.status(400).json({ error: "Вставьте JSON-конфиг" });
      return;
    }
    const built = buildProxyUrisFromClientJson(jsonText);
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }
    const assign = parseAssignment(b);
    const customName = String(b.name ?? "").trim();
    const importAll = b.import_all !== false && b.import_all !== 0 && b.import_all !== "0";
    const items = built.uris.length > 1 && importAll ? built.uris : [built.uris[0]!];
    const created: ReturnType<typeof createWhitelistVaultKey>[] = [];
    const errors: string[] = [];
    for (const item of items) {
      const name =
        customName && items.length > 1
          ? `${customName} · ${item.name}`.slice(0, 120)
          : customName || item.name;
      try {
        created.push(
          createWhitelistVaultKey({
            name,
            raw_uri: item.uri,
            active: !(b.active === false || b.active === 0 || b.active === "0"),
            include_in_sale: b.include_in_sale === true || b.include_in_sale === 1 || b.include_in_sale === "1",
            notify_on_fail: !(b.notify_on_fail === false || b.notify_on_fail === 0 || b.notify_on_fail === "0"),
            source_type: "json_import",
            assignment_mode: assign.assignment_mode,
            assigned_user_ids: assign.assigned_user_ids,
          }),
        );
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (created.length === 0) {
      res.status(400).json({ error: errors[0] ?? "Не удалось импортировать ключи" });
      return;
    }
    res.status(201).json({
      key: whitelistKeyForApi(created[0]!, includeRaw()),
      keys: created.map((k) => whitelistKeyForApi(k, includeRaw())),
      added: created.length,
      errors,
      parsed_uris: items.map((x) => x.uri),
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/parse-json", (req, res) => {
  try {
    const jsonText = String((req.body as { json?: unknown })?.json ?? "").trim();
    if (!jsonText) {
      res.status(400).json({ error: "Вставьте JSON-конфиг" });
      return;
    }
    const built = buildProxyUrisFromClientJson(jsonText);
    if ("error" in built) {
      res.status(400).json({ error: built.error });
      return;
    }
    const first = built.uris[0]!;
    res.json({
      uri: first.uri,
      name: first.name,
      uris: built.uris,
      parsed: parseProxyUri(first.uri),
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/check-all", (_req, res) => {
  try {
    const { total, already_running } = startWhitelistVaultCheckAllBackground("manual");
    res.json({
      started: true,
      already_running,
      total,
      checked: 0,
      ...getWhitelistVaultOverview(),
      keys: mapKeys(listWhitelistVaultKeys()),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/bulk/rename", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(b.ids) ? b.ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0) : [];
    const remark = String(b.remark ?? b.name ?? "").trim();
    const result = bulkRenameWhitelistVaultKeys(ids, remark);
    res.json({ ...result, keys: mapKeys(listWhitelistVaultKeys()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/bulk/assignment", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(b.ids) ? b.ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0) : [];
    const mode = String(b.assignment_mode ?? "selected").trim().toLowerCase() as WhitelistAssignmentMode;
    if (mode !== "none" && mode !== "all" && mode !== "selected") {
      res.status(400).json({ error: "Некорректный режим назначения" });
      return;
    }
    const userIds = Array.isArray(b.assigned_user_ids)
      ? b.assigned_user_ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0)
      : [];
    const result = bulkAssignWhitelistVaultKeys(ids, mode, userIds);
    res.json({ ...result, keys: mapKeys(listWhitelistVaultKeys()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/bulk/delete", (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const deleteAll = b.delete_all === true || String(b.delete_all ?? "").toLowerCase() === "true";
    const result = deleteAll
      ? deleteAllWhitelistVaultKeys()
      : bulkDeleteWhitelistVaultKeys(
          Array.isArray(b.ids) ? b.ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0) : [],
        );
    res.json({ ...result, keys: mapKeys(listWhitelistVaultKeys()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  const k = getWhitelistVaultKey(id);
  if (!k) {
    res.status(404).json({ error: "Ключ не найден" });
    return;
  }
  res.json({ key: whitelistKeyForApi(k, true), parsed: parseProxyUri(k.raw_uri) });
});

router.patch("/:id", (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const cur = getWhitelistVaultKey(id);
    if (!cur) {
      res.status(404).json({ error: "Ключ не найден" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.raw_uri != null) {
      const err = validateWhitelistKeyInput(
        String(b.name ?? cur.name),
        String(b.raw_uri),
        listWhitelistVaultKeys().filter((k) => k.id !== id).map((k) => k.raw_uri),
      );
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }
    const assign = parseAssignment(b);
    const updated = updateWhitelistVaultKey(id, {
      name: b.name != null ? String(b.name) : undefined,
      raw_uri: b.raw_uri != null ? String(b.raw_uri) : undefined,
      active: b.active !== undefined ? !(b.active === false || b.active === 0 || b.active === "0") : undefined,
      include_in_sale:
        b.include_in_sale !== undefined
          ? b.include_in_sale === true || b.include_in_sale === 1 || b.include_in_sale === "1"
          : undefined,
      notify_on_fail:
        b.notify_on_fail !== undefined ? !(b.notify_on_fail === false || b.notify_on_fail === 0 || b.notify_on_fail === "0") : undefined,
      assignment_mode: assign.assignment_mode,
      assigned_user_ids: assign.assigned_user_ids,
    });
    res.json({ key: whitelistKeyForApi(updated, includeRaw()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/:id", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  if (!getWhitelistVaultKey(id)) {
    res.status(404).json({ error: "Ключ не найден" });
    return;
  }
  deleteWhitelistVaultKey(id);
  res.json({ ok: true });
});

router.post("/:id/assignment", (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const b = (req.body ?? {}) as Record<string, unknown>;
    const mode = String(b.assignment_mode ?? "none").trim().toLowerCase() as WhitelistAssignmentMode;
    if (mode !== "none" && mode !== "all" && mode !== "selected") {
      res.status(400).json({ error: "Некорректный режим назначения" });
      return;
    }
    const userIds = Array.isArray(b.assigned_user_ids)
      ? b.assigned_user_ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0)
      : [];
    const key = setWhitelistVaultKeyAssignment(id, mode, userIds);
    res.json({ key: whitelistKeyForApi(key, includeRaw()) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/:id/check", async (req, res) => {
  try {
    const id = Math.floor(Number(req.params.id));
    const result = await runWhitelistVaultCheckForKey(id, "manual");
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
  let checks = listWhitelistVaultChecks(id, limit);
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
  const removed = purgeWhitelistVaultChecksOlderThanDays(days);
  res.json({ removed });
});

export default router;
