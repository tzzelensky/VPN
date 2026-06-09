import { Router } from "express";
import os from "node:os";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  deletePanelAvatarFiles,
  readPanelAvatar,
  savePanelAvatar,
} from "../panelSettingsFiles.js";
import {
  defaultPanelSettings,
  normalizeSectionOrder,
  PANEL_SECTION_META,
  type PanelSectionKey,
  type PanelSettings,
} from "../panelSettingsTypes.js";
import {
  exportSettingsForClient,
  getPanelBotToken,
  getPanelSettings,
  getPanelBotTokenMasked,
  getEffectiveTelegramAdminIds,
  resetPanelSettings,
  savePanelSettings,
  setPanelBotToken,
  settingsForExport,
  validateSections,
} from "../panelSettings.js";
import { getTelegramBotToken } from "../telegram/env.js";

const router = Router();
router.use(requireAuth);

const startTime = Date.now();

function parseDataUrl(input: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(input.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2] || "", "base64");
    if (!buf.length) return null;
    return { mime: m[1] || "image/jpeg", bytes: buf };
  } catch {
    return null;
  }
}

function logSettingsAction(msg: string): void {
  console.log(`[panel-settings] ${msg}`);
}

router.get("/", (_req, res) => {
  res.json(exportSettingsForClient(getPanelSettings()));
});

router.patch("/section-order", (req, res) => {
  const body = (req.body ?? {}) as { order?: unknown };
  if (!Array.isArray(body.order)) {
    res.status(400).json({ error: "order_required" });
    return;
  }
  const prev = getPanelSettings();
  const saved = savePanelSettings({
    ...prev,
    sectionOrder: normalizeSectionOrder(body.order),
  });
  logSettingsAction("Section menu order updated");
  res.json(exportSettingsForClient(saved));
});

router.get("/avatar", (_req, res) => {
  const s = getPanelSettings();
  if (!s.panel.avatarPath) {
    res.status(404).end();
    return;
  }
  const file = readPanelAvatar(s.panel.avatarPath);
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(file.bytes);
});

router.get("/export", (_req, res) => {
  const payload = settingsForExport(getPanelSettings());
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="panel-settings.json"');
  res.send(JSON.stringify(payload, null, 2));
});

router.get("/system", (_req, res) => {
  const s = getPanelSettings();
  const tokenInfo = getPanelBotTokenMasked();
  res.json({
    panelVersion: process.env.npm_package_version ?? "1.0.0",
    nodeVersion: process.version,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    uptimeSec: Math.floor((Date.now() - startTime) / 1000),
    hostname: os.hostname(),
    settingsUpdatedAt: s.updatedAt,
    dataPath: process.env.DATA_PATH ?? "(default)",
    telegramBotConfigured: tokenInfo.configured,
    telegramBotMasked: tokenInfo.masked,
    adminIdsCount: getEffectiveTelegramAdminIds(s).length,
  });
});

router.patch("/", (req, res) => {
  const body = (req.body ?? {}) as { settings?: Partial<PanelSettings>; botToken?: unknown };
  const prev = getPanelSettings();
  const next = {
    ...prev,
    panel: { ...prev.panel, ...(body.settings?.panel ?? {}) },
    ui: { ...prev.ui, ...(body.settings?.ui ?? {}) },
    sections: { ...prev.sections, ...(body.settings?.sections ?? {}) },
    sectionOrder:
      body.settings?.sectionOrder !== undefined
        ? normalizeSectionOrder(body.settings.sectionOrder)
        : prev.sectionOrder,
    telegram: { ...prev.telegram, ...(body.settings?.telegram ?? {}) },
    security: { ...prev.security, ...(body.settings?.security ?? {}) },
    maintenance: { ...prev.maintenance, ...(body.settings?.maintenance ?? {}) },
  };
  if (!String(next.panel.title ?? "").trim()) {
    res.status(400).json({ error: "title_required" });
    return;
  }
  next.panel.title = String(next.panel.title).trim().slice(0, 120);
  next.panel.subtitle = String(next.panel.subtitle ?? "").trim().slice(0, 240);
  next.panel.brandName = String(next.panel.brandName ?? "").trim().slice(0, 80);
  next.panel.telegramFooter = String(next.panel.telegramFooter ?? "").trim().slice(0, 500);
  try {
    validateSections(next.sections);
  } catch {
    res.status(400).json({ error: "at_least_one_section" });
    return;
  }
  if (body.settings?.telegram?.adminIds) {
    next.telegram.adminIds = body.settings.telegram.adminIds
      .map((x) => Math.floor(Number(x)))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  if (body.botToken != null && String(body.botToken).trim()) {
    const token = String(body.botToken).trim();
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      res.status(400).json({ error: "invalid_bot_token" });
      return;
    }
    setPanelBotToken(token);
    logSettingsAction("Telegram bot token updated (value not logged)");
  }
  const saved = savePanelSettings(next);
  if (body.settings?.panel?.title && body.settings.panel.title !== prev.panel.title) {
    logSettingsAction(`Panel title changed to "${saved.panel.title}"`);
  }
  if (body.settings?.sections) {
    logSettingsAction("Section visibility updated");
  }
  if (body.settings?.sectionOrder) {
    logSettingsAction("Section menu order updated");
  }
  res.json(exportSettingsForClient(saved));
});

router.post("/avatar", (req, res) => {
  const body = req.body as { photo_base64?: unknown; photo_mime?: unknown };
  const parsed = body.photo_base64 != null ? parseDataUrl(String(body.photo_base64)) : null;
  if (!parsed) {
    res.status(400).json({ error: "invalid_avatar" });
    return;
  }
  try {
    const rel = savePanelAvatar(parsed.bytes, String(body.photo_mime ?? parsed.mime));
    const prev = getPanelSettings();
    const saved = savePanelSettings({ ...prev, panel: { ...prev.panel, avatarPath: rel } });
    logSettingsAction("Panel avatar updated");
    res.json(exportSettingsForClient(saved));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: msg });
  }
});

router.delete("/avatar", (_req, res) => {
  deletePanelAvatarFiles();
  const prev = getPanelSettings();
  const saved = savePanelSettings({ ...prev, panel: { ...prev.panel, avatarPath: null } });
  logSettingsAction("Panel avatar removed");
  res.json(exportSettingsForClient(saved));
});

router.post("/reset", (_req, res) => {
  deletePanelAvatarFiles();
  const saved = resetPanelSettings();
  logSettingsAction("Settings reset to defaults");
  res.json(exportSettingsForClient(saved));
});

router.post("/import", (req, res) => {
  const raw = req.body as { settings?: PanelSettings };
  if (!raw.settings) {
    res.status(400).json({ error: "settings_required" });
    return;
  }
  const merged = {
    ...defaultPanelSettings(),
    ...raw.settings,
    panel: { ...defaultPanelSettings().panel, ...(raw.settings.panel ?? {}) },
    ui: { ...defaultPanelSettings().ui, ...(raw.settings.ui ?? {}) },
    sections: { ...defaultPanelSettings().sections, ...(raw.settings.sections ?? {}) },
    sectionOrder: normalizeSectionOrder(raw.settings.sectionOrder ?? defaultPanelSettings().sectionOrder),
    telegram: { ...defaultPanelSettings().telegram, ...(raw.settings.telegram ?? {}) },
    security: { ...defaultPanelSettings().security, ...(raw.settings.security ?? {}) },
    maintenance: { ...defaultPanelSettings().maintenance, ...(raw.settings.maintenance ?? {}) },
  };
  if (!String(merged.panel.title ?? "").trim()) {
    res.status(400).json({ error: "title_required" });
    return;
  }
  try {
    validateSections(merged.sections);
  } catch {
    res.status(400).json({ error: "at_least_one_section" });
    return;
  }
  const saved = savePanelSettings(merged);
  logSettingsAction("Settings imported from JSON");
  res.json(exportSettingsForClient(saved));
});

router.post("/telegram/test-bot", async (req, res) => {
  const body = req.body as { botToken?: unknown };
  const token =
    body.botToken != null && String(body.botToken).trim()
      ? String(body.botToken).trim()
      : getTelegramBotToken();
  if (!token) {
    res.status(400).json({ ok: false, error: "token_not_configured" });
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await r.json()) as { ok?: boolean; result?: { username?: string; first_name?: string }; description?: string };
    if (!data.ok) {
      res.json({ ok: false, error: data.description ?? "telegram_error" });
      return;
    }
    res.json({
      ok: true,
      username: data.result?.username ?? null,
      name: data.result?.first_name ?? null,
      message: "Бот подключен",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/telegram/test-message", async (req, res) => {
  const settings = getPanelSettings();
  const adminId = getEffectiveTelegramAdminIds(settings)[0];
  const token = getTelegramBotToken();
  if (!token || !adminId) {
    res.status(400).json({ ok: false, error: "telegram_not_configured" });
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminId,
        text: "Тестовое сообщение из панели управления",
      }),
    });
    const data = (await r.json()) as { ok?: boolean; description?: string };
    if (!data.ok) {
      res.json({ ok: false, error: data.description ?? "send_failed" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
