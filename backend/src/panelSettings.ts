import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultPanelSettings,
  normalizeSectionOrder,
  orderPanelSectionMeta,
  PANEL_SECTION_META,
  type PanelSectionKey,
  type PanelSettings,
} from "./panelSettingsTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const settingsPath = process.env.PANEL_SETTINGS_PATH ?? path.join(path.dirname(dataFile), "panel_settings.json");
const secretsPath = process.env.PANEL_SECRETS_PATH ?? path.join(path.dirname(dataFile), "panel_secrets.json");

type PanelSecrets = {
  botToken?: string;
};

let cached: PanelSettings | null = null;
let cachedSecrets: PanelSecrets | null = null;

function readSecretsFile(): PanelSecrets {
  try {
    if (!fs.existsSync(secretsPath)) return {};
    return JSON.parse(fs.readFileSync(secretsPath, "utf8")) as PanelSecrets;
  } catch {
    return {};
  }
}

function writeSecretsFile(secrets: PanelSecrets): void {
  fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
  const tmp = `${secretsPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(secrets, null, 2), "utf8");
  fs.renameSync(tmp, secretsPath);
  cachedSecrets = secrets;
}

function mergeSettings(raw: Partial<PanelSettings> | null): PanelSettings {
  const base = defaultPanelSettings();
  if (!raw) return base;
  const rawBanner = raw.panel?.subscriptionBanner;
  return {
    panel: {
      ...base.panel,
      ...(raw.panel ?? {}),
      subscriptionBanner: {
        ...base.panel.subscriptionBanner,
        ...(rawBanner ?? {}),
      },
    },
    ui: { ...base.ui, ...(raw.ui ?? {}) },
    sections: { ...base.sections, ...(raw.sections ?? {}) },
    sectionOrder: normalizeSectionOrder(raw.sectionOrder ?? base.sectionOrder),
    telegram: { ...base.telegram, ...(raw.telegram ?? {}) },
    security: { ...base.security, ...(raw.security ?? {}) },
    maintenance: { ...base.maintenance, ...(raw.maintenance ?? {}) },
    updatedAt: raw.updatedAt ?? base.updatedAt,
  };
}

function readSettingsFile(): PanelSettings {
  try {
    if (!fs.existsSync(settingsPath)) return defaultPanelSettings();
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Partial<PanelSettings>;
    return mergeSettings(parsed);
  } catch (e) {
    console.error("[panel-settings] read failed:", e instanceof Error ? e.message : e);
    return defaultPanelSettings();
  }
}

function writeSettingsFile(settings: PanelSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
  fs.renameSync(tmp, settingsPath);
  cached = settings;
}

export function initPanelSettings(): void {
  cached = readSettingsFile();
  cachedSecrets = readSecretsFile();
  console.log("[panel-settings] loaded:", settingsPath);
}

export function getPanelSettings(): PanelSettings {
  if (!cached) cached = readSettingsFile();
  return cached;
}

/** Перечитать panel_settings.json с диска (актуально для WebApp feature flags). */
export function refreshPanelSettingsCache(): PanelSettings {
  cached = readSettingsFile();
  return cached;
}

export function savePanelSettings(next: PanelSettings): PanelSettings {
  const merged = mergeSettings(next);
  const out: PanelSettings = {
    ...merged,
    sectionOrder: normalizeSectionOrder(next.sectionOrder ?? merged.sectionOrder),
    updatedAt: Date.now(),
  };
  writeSettingsFile(out);
  return out;
}

export function resetPanelSettings(): PanelSettings {
  const out = defaultPanelSettings();
  writeSettingsFile(out);
  return out;
}

export function getPanelBotToken(): string {
  const secrets = cachedSecrets ?? readSecretsFile();
  const fromStore = String(secrets.botToken ?? "").trim();
  if (fromStore) return fromStore;
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

export function setPanelBotToken(token: string | null): void {
  const secrets = { ...(cachedSecrets ?? readSecretsFile()) };
  const t = String(token ?? "").trim();
  if (t) secrets.botToken = t;
  else delete secrets.botToken;
  writeSecretsFile(secrets);
}

export function maskSecret(value: string, visibleTail = 4): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  const colon = v.indexOf(":");
  if (colon > 0 && colon < v.length - 1) {
    const prefix = v.slice(0, colon + 1);
    const secret = v.slice(colon + 1);
    if (secret.length <= visibleTail + 2) return `${prefix}••••••••`;
    const hiddenLen = Math.min(10, Math.max(4, secret.length - visibleTail));
    return `${prefix}${"•".repeat(hiddenLen)}${secret.slice(-visibleTail)}`;
  }
  if (v.length <= visibleTail + 2) return "••••••••";
  return `${"•".repeat(Math.min(12, v.length - visibleTail))}${v.slice(-visibleTail)}`;
}

export function getPanelBotTokenMasked(): { configured: boolean; masked: string } {
  const token = getPanelBotToken();
  if (!token) return { configured: false, masked: "" };
  return { configured: true, masked: maskSecret(token, 4) };
}

export function getEffectiveTelegramAdminIds(settings?: PanelSettings): number[] {
  const s = settings ?? getPanelSettings();
  const fromPanel = s.telegram.adminIds.filter((n) => Number.isFinite(n) && n > 0);
  if (fromPanel.length > 0) return fromPanel;
  const raw = process.env.TELEGRAM_ADMIN_IDS ?? process.env.TELEGRAM_ADMIN_ID ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function isSectionVisible(key: PanelSectionKey, settings?: PanelSettings): boolean {
  const s = settings ?? getPanelSettings();
  return s.sections[key] !== false;
}

export function validateSections(sections: Record<PanelSectionKey, boolean>): void {
  const visible = PANEL_SECTION_META.filter((m) => sections[m.key] !== false);
  if (visible.length < 1) throw new Error("at_least_one_section");
}

export function pathToSectionKey(pathname: string): PanelSectionKey | null {
  const p = pathname.replace(/\/$/, "") || "/";
  const hit = PANEL_SECTION_META.find((m) => m.path === p || p.startsWith(`${m.path}/`));
  return hit?.key ?? null;
}

export function firstVisibleSectionPath(settings?: PanelSettings): string {
  const s = settings ?? getPanelSettings();
  const meta = orderPanelSectionMeta(s.sectionOrder);
  const hit = meta.find((m) => s.sections[m.key] !== false);
  return hit?.path ?? "/servers";
}

export function exportSettingsForClient(settings: PanelSettings) {
  const tokenInfo = getPanelBotTokenMasked();
  return {
    settings,
    meta: { sections: orderPanelSectionMeta(settings.sectionOrder) },
    telegram: {
      botTokenConfigured: tokenInfo.configured,
      botTokenMasked: tokenInfo.masked,
      adminIds: getEffectiveTelegramAdminIds(settings),
    },
    avatarUrl: settings.panel.avatarPath
      ? `/api/settings/avatar?v=${settings.updatedAt}`
      : null,
  };
}

export function settingsForExport(settings: PanelSettings) {
  const tokenInfo = getPanelBotTokenMasked();
  return {
    ...settings,
    telegram: {
      ...settings.telegram,
      botTokenConfigured: tokenInfo.configured,
      botTokenMasked: tokenInfo.masked,
    },
  };
}
