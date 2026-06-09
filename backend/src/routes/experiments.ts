import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  activateMobilePreset,
  checkServerPortForExperiment,
  createExperiment,
  deleteExperiment,
  EXPERIMENT_PRESETS,
  getExperimentClientJson,
  getExperimentDiagnosticReport,
  getExperimentPortPlan,
  listExperimentsPublic,
  patchExperimentNote,
  runExperimentDiagnostics,
} from "../experimentService.js";
import { DEPRECATED_WS_REALITY_NOTE } from "../experimentTypes.js";
import type { ExperimentCreateOptions, ExperimentPresetId } from "../experimentTypes.js";

const router = Router();
router.use(requireAuth);

const MOBILE_WARNING =
  "Тесты на портах кроме 443 не доказывают, что протокол не работает. Мобильный оператор может блокировать сам порт. Для честного теста используйте 443 на отдельном IP/сервере или через SNI routing.";

router.get("/presets", (_req, res) => {
  res.json({ presets: EXPERIMENT_PRESETS, deprecated_note: DEPRECATED_WS_REALITY_NOTE, mobile_warning: MOBILE_WARNING });
});

router.get("/mobile-test-info", (_req, res) => {
  res.json({
    mobile_warning: MOBILE_WARNING,
    honest_test_hint:
      "Честный мобильный тест — только порт 443. Если 443 занят рабочими inbound, используйте сервер «только для экспериментов», отдельный IP или SNI routing.",
    options: [
      "Отдельный тестовый сервер (experimental only)",
      "Отдельный дополнительный IP",
      "SNI routing / reverse proxy / fallback architecture",
    ],
  });
});

router.get("/port-plan", async (req, res) => {
  const serverId = Number(req.query.server_id);
  const port = Number(req.query.port) || 443;
  if (!Number.isFinite(serverId) || serverId <= 0) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  try {
    const plan = await getExperimentPortPlan(serverId, port);
    res.json(plan);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

router.get("/", (_req, res) => {
  res.json({ experiments: listExperimentsPublic(), mobile_warning: MOBILE_WARNING });
});

router.post("/", async (req, res) => {
  try {
    const body = req.body as ExperimentCreateOptions;
    if (!body?.server_id || !body?.name?.trim()) {
      res.status(400).json({ error: "bad_payload" });
      return;
    }
    const exp = await createExperiment(body);
    res.status(201).json(exp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("port_busy:")) {
      const [, p, tag] = msg.split(":");
      res.status(409).json({
        error: msg,
        hint: `Порт ${p} занят inbound «${tag}». Выберите другой порт — существующий inbound не перезаписывается.`,
      });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

router.post("/activate-mobile", async (req, res) => {
  const serverId = Number((req.body as { server_id?: unknown })?.server_id);
  const presetId = String((req.body as { preset_id?: unknown })?.preset_id ?? "").trim() as ExperimentPresetId;
  if (!Number.isFinite(serverId) || serverId <= 0 || !presetId) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  try {
    const exp = await activateMobilePreset(serverId, presetId);
    res.status(201).json(exp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

router.post("/:id(\\d+)/port-check", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    const result = await checkServerPortForExperiment(id);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(404).json({ error: msg });
  }
});

router.post("/:id(\\d+)/diagnose", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    const result = await runExperimentDiagnostics(id);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(404).json({ error: msg });
  }
});

router.get("/:id(\\d+)/client-json", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    const json = getExperimentClientJson(id);
    res.json({ json });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(404).json({ error: msg });
  }
});

router.get("/:id(\\d+)/diagnostic-report", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    const result = await getExperimentDiagnosticReport(id);
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(404).json({ error: msg });
  }
});

router.patch("/:id(\\d+)/note", async (req, res) => {
  const id = Number(req.params.id);
  const note = String((req.body as { user_note?: unknown })?.user_note ?? "").trim();
  if (!Number.isFinite(id) || id <= 0 || !["", "works", "fail", "partial"].includes(note)) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  try {
    const exp = patchExperimentNote(id, note as "" | "works" | "fail" | "partial");
    res.json(exp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(404).json({ error: msg });
  }
});

router.delete("/:id(\\d+)", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    await deleteExperiment(id);
    res.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
