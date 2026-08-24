import { Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  deletePanelAvatarFiles,
  readPanelAvatar,
  savePanelAvatar,
  deletePanelMenuImageFiles,
} from "../panelSettingsFiles.js";
import {
  defaultPanelSettings,
  normalizeDecoyShop,
  normalizeSectionOrder,
  normalizeVpnServerOrder,
  PANEL_SECTION_META,
  type PanelSectionKey,
  type PanelSettings,
} from "../panelSettingsTypes.js";
import {
  exportSettingsForClient,
  getPanelBotToken,
  getPanelGeminiApiKey,
  getPanelSettings,
  getPanelBotTokenMasked,
  getEffectiveTelegramAdminIds,
  resetPanelSettings,
  savePanelSettings,
  setPanelBotToken,
  setPanelGeminiApiKey,
  settingsForExport,
  validateSections,
} from "../panelSettings.js";
import { listDeployedServers } from "../db.js";
import {
  applyVpnDisplayOrderToAllUsers,
  normalizeGlobalVpnDisplayEntryOrder,
} from "../vpnDisplayCatalog.js";
import { entryOrderFromServerOrder, vlessIdsFromEntryOrder } from "../vpnDisplayOrder.js";
import { clearAiLogs, listAiLogs } from "../aiLogStore.js";
import { getTelegramBotToken } from "../telegram/env.js";
import { normalizeTelegramButtonColors } from "../telegram/inlineButtonStyles.js";

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
    savePanelSettings({ ...s, panel: { ...s.panel, avatarPath: null } });
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Cache-Control", "private, no-cache");
  res.send(file.bytes);
});

router.get("/telegram-bot-token", (_req, res) => {
  const token = getPanelBotToken();
  if (!token) {
    res.status(404).json({ error: "token_not_configured" });
    return;
  }
  res.json({ botToken: token });
});

router.get("/gemini-api-key", (_req, res) => {
  const geminiApiKey = getPanelGeminiApiKey();
  if (!geminiApiKey) {
    res.status(404).json({ error: "gemini_api_key_not_configured" });
    return;
  }
  res.json({ geminiApiKey });
});

router.get("/ai-logs", (req, res) => {
  const limit = Math.min(400, Math.max(1, Math.floor(Number(req.query.limit) || 200)));
  res.json({ entries: listAiLogs(limit) });
});

router.delete("/ai-logs", (_req, res) => {
  const cleared = clearAiLogs();
  logSettingsAction(`AI chat logs cleared (${cleared})`);
  res.json({ ok: true, cleared });
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
  const appRoot = (() => {
    const fromEnv = (process.env.APP_ROOT ?? "").trim();
    if (fromEnv) return fromEnv;
    const cwd = process.cwd();
    const parent = path.dirname(cwd);
    return parent;
  })();
  let panelVersion = process.env.npm_package_version ?? "1.0.0";
  try {
    const text = fs.readFileSync(path.join(appRoot, "frontend", "src", "panelVersion.ts"), "utf8");
    const major = /PANEL_VERSION_MAJOR\s*=\s*(\d+)/.exec(text)?.[1];
    const minor = /PANEL_VERSION_MINOR\s*=\s*(\d+)/.exec(text)?.[1];
    if (major && minor) panelVersion = `${major}.${String(Number(minor)).padStart(2, "0")}`;
  } catch {
    /* keep npm version */
  }
  res.json({
    panelVersion,
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
  const body = (req.body ?? {}) as {
    settings?: Partial<PanelSettings>;
    botToken?: unknown;
    geminiApiKey?: unknown;
    clearGeminiApiKey?: unknown;
  };
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
    vpnDisplay: { ...prev.vpnDisplay, ...(body.settings?.vpnDisplay ?? {}) },
  };
  if (body.settings?.vpnDisplay !== undefined) {
    const deployedIds = listDeployedServers().map((s) => s.id);
    const incoming = body.settings.vpnDisplay;
    let entryOrder =
      incoming.entryOrder !== undefined
        ? normalizeGlobalVpnDisplayEntryOrder(incoming.entryOrder)
        : normalizeGlobalVpnDisplayEntryOrder(prev.vpnDisplay?.entryOrder ?? []);
    if ((!entryOrder.length || incoming.entryOrder === undefined) && Array.isArray(incoming.serverOrder)) {
      const fromServers = entryOrderFromServerOrder(incoming.serverOrder);
      if (fromServers.length) entryOrder = normalizeGlobalVpnDisplayEntryOrder(fromServers);
    }
    const serverOrder = normalizeVpnServerOrder(vlessIdsFromEntryOrder(entryOrder), deployedIds);
    next.vpnDisplay = { serverOrder, entryOrder };
  }
  if (!String(next.panel.title ?? "").trim()) {
    res.status(400).json({ error: "title_required" });
    return;
  }
  next.panel.title = String(next.panel.title).trim().slice(0, 120);
  next.panel.subtitle = String(next.panel.subtitle ?? "").trim().slice(0, 240);
  next.panel.brandName = String(next.panel.brandName ?? "").trim().slice(0, 80);
  next.panel.telegramFooter = String(next.panel.telegramFooter ?? "").trim().slice(0, 500);
  next.panel.shopReviewKeyword = String(next.panel.shopReviewKeyword ?? "").trim().slice(0, 80);
  const prevBanner = prev.panel.subscriptionBanner ?? defaultPanelSettings().panel.subscriptionBanner;
  const bannerIn = body.settings?.panel?.subscriptionBanner;
  if (bannerIn) {
    let tgUrl = String(bannerIn.telegramUrl ?? prevBanner.telegramUrl ?? "").trim();
    if (tgUrl.startsWith("@")) tgUrl = `https://t.me/${tgUrl.slice(1)}`;
    next.panel.subscriptionBanner = {
      enabled: bannerIn.enabled === true,
      text: String(bannerIn.text ?? prevBanner.text ?? "").trim().slice(0, 2000),
      whitelistText: String(
        (bannerIn as { whitelistText?: unknown }).whitelistText ?? prevBanner.whitelistText ?? "",
      )
        .trim()
        .slice(0, 2000),
      telegramUrl: tgUrl.slice(0, 500),
      telegramLinkText:
        String(bannerIn.telegramLinkText ?? prevBanner.telegramLinkText ?? "тех. поддержку").trim().slice(0, 120) ||
        "тех. поддержку",
    };
  } else if (!next.panel.subscriptionBanner) {
    next.panel.subscriptionBanner = { ...prevBanner };
  }
  next.panel.decoyShop = normalizeDecoyShop(
    body.settings?.panel?.decoyShop ?? next.panel.decoyShop ?? prev.panel.decoyShop,
  );
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
  if (body.settings?.telegram?.buttonColors) {
    next.telegram.buttonColors = normalizeTelegramButtonColors(body.settings.telegram.buttonColors);
  }
  if (body.settings?.telegram && "aiAssistantEnabled" in body.settings.telegram) {
    next.telegram.aiAssistantEnabled = body.settings.telegram.aiAssistantEnabled === true;
  }
  if (body.settings?.telegram && "geminiModel" in body.settings.telegram) {
    const m = String(body.settings.telegram.geminiModel ?? "")
      .trim()
      .slice(0, 80);
    next.telegram.geminiModel = m || prev.telegram.geminiModel || "gemini-2.5-flash-lite";
  }
  if (body.settings?.ui && "webAppNewDesign" in body.settings.ui) {
    next.ui.webAppNewDesign = body.settings.ui.webAppNewDesign === true;
  }
  if (body.settings?.ui && "webAppPreviewEnabled" in body.settings.ui) {
    next.ui.webAppPreviewEnabled = body.settings.ui.webAppPreviewEnabled === true;
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
  if (body.clearGeminiApiKey === true) {
    setPanelGeminiApiKey(null);
    logSettingsAction("Gemini API key cleared");
  } else if (body.geminiApiKey != null && String(body.geminiApiKey).trim()) {
    const key = String(body.geminiApiKey).trim();
    if (key.length < 16 || key.length > 512) {
      res.status(400).json({ error: "invalid_gemini_api_key" });
      return;
    }
    setPanelGeminiApiKey(key);
    logSettingsAction("Gemini API key updated (value not logged)");
  }
  const saved = savePanelSettings(next);
  if (body.settings?.vpnDisplay !== undefined) {
    const prevEntry = prev.vpnDisplay?.entryOrder ?? [];
    const nextEntry = saved.vpnDisplay.entryOrder;
    const orderChanged =
      prevEntry.length !== nextEntry.length || prevEntry.some((k, i) => k !== nextEntry[i]);
    if (orderChanged) {
      const applied = applyVpnDisplayOrderToAllUsers(nextEntry);
      logSettingsAction(`VPN display entry order updated (users reordered: ${applied.updated_users})`);
    }
  }
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
  deletePanelMenuImageFiles();
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
    telegram: {
      ...defaultPanelSettings().telegram,
      ...(raw.settings.telegram ?? {}),
      buttonColors: normalizeTelegramButtonColors(raw.settings.telegram?.buttonColors),
    },
    security: { ...defaultPanelSettings().security, ...(raw.settings.security ?? {}) },
    maintenance: { ...defaultPanelSettings().maintenance, ...(raw.settings.maintenance ?? {}) },
    vpnDisplay: {
      serverOrder: Array.isArray(raw.settings.vpnDisplay?.serverOrder)
        ? normalizeVpnServerOrder(
            raw.settings.vpnDisplay.serverOrder,
            listDeployedServers().map((s) => s.id),
          )
        : [],
      entryOrder: normalizeGlobalVpnDisplayEntryOrder(
        raw.settings.vpnDisplay?.entryOrder ??
          entryOrderFromServerOrder(raw.settings.vpnDisplay?.serverOrder),
      ),
    },
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
