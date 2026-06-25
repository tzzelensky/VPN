import type { PanelSettings } from "./panelSettingsTypes";
import { getAdminThemeSetting, syncThemeFromPanelSetting, type AdminThemeSetting } from "./adminTheme";

const ACCENT_VARS: Record<string, { accent: string; dim: string }> = {
  blue: { accent: "#3d9eff", dim: "#2a7fd4" },
  green: { accent: "#22c55e", dim: "#16a34a" },
  purple: { accent: "#a855f7", dim: "#7c3aed" },
  orange: { accent: "#f97316", dim: "#ea580c" },
  red: { accent: "#ef4444", dim: "#dc2626" },
};

let lastAppliedKey = "";

function panelUiKey(settings: PanelSettings): string {
  return JSON.stringify({
    theme: settings.ui.theme,
    accent: settings.ui.accentColor,
    compact: settings.ui.compactMode,
    hints: settings.ui.showHints,
    tz: settings.ui.timezone,
  });
}

export function applyPanelUiSettings(settings: PanelSettings): void {
  const key = panelUiKey(settings);
  if (key === lastAppliedKey) return;
  lastAppliedKey = key;

  const themeSetting = settings.ui.theme as AdminThemeSetting;
  if (getAdminThemeSetting() !== themeSetting) {
    syncThemeFromPanelSetting(themeSetting);
  }

  const root = document.documentElement;
  const accentKey = String(settings.ui.accentColor ?? "blue");
  const preset = ACCENT_VARS[accentKey];
  if (preset) {
    root.style.setProperty("--accent", preset.accent);
    root.style.setProperty("--accent-dim", preset.dim);
    root.removeAttribute("data-accent-custom");
  } else if (/^#[0-9a-f]{6}$/i.test(accentKey)) {
    root.style.setProperty("--accent", accentKey);
    root.style.setProperty("--accent-dim", accentKey);
    root.setAttribute("data-accent-custom", "1");
  }

  root.classList.toggle("admin-compact", settings.ui.compactMode);
  root.classList.toggle("admin-no-hints", !settings.ui.showHints);
  root.dataset.panelTimezone = settings.ui.timezone || "Europe/Moscow";
}
