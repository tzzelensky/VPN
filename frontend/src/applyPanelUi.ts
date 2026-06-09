import type { PanelSettings } from "./panelSettingsTypes";
import { syncThemeFromPanelSetting, type AdminThemeSetting } from "./adminTheme";

const ACCENT_VARS: Record<string, { accent: string; dim: string }> = {
  blue: { accent: "#3d9eff", dim: "#2a7fd4" },
  green: { accent: "#22c55e", dim: "#16a34a" },
  purple: { accent: "#a855f7", dim: "#7c3aed" },
  orange: { accent: "#f97316", dim: "#ea580c" },
  red: { accent: "#ef4444", dim: "#dc2626" },
};

export function applyPanelUiSettings(settings: PanelSettings): void {
  syncThemeFromPanelSetting(settings.ui.theme as AdminThemeSetting);

  const accentKey = String(settings.ui.accentColor ?? "blue");
  const preset = ACCENT_VARS[accentKey];
  if (preset) {
    document.documentElement.style.setProperty("--accent", preset.accent);
    document.documentElement.style.setProperty("--accent-dim", preset.dim);
    document.documentElement.removeAttribute("data-accent-custom");
  } else if (/^#[0-9a-f]{6}$/i.test(accentKey)) {
    document.documentElement.style.setProperty("--accent", accentKey);
    document.documentElement.style.setProperty("--accent-dim", accentKey);
    document.documentElement.setAttribute("data-accent-custom", "1");
  }

  document.documentElement.classList.toggle("admin-compact", settings.ui.compactMode);
  document.documentElement.classList.toggle("admin-no-hints", !settings.ui.showHints);
  document.documentElement.dataset.panelTimezone = settings.ui.timezone || "Europe/Moscow";
}
