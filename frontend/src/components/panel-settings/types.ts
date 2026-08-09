import type { PanelSettings } from "../../panelSettingsTypes";

export type SettingsTabId = "brand" | "navVpn" | "bot" | "appearance" | "system";

export const SETTINGS_NAV: Array<{ id: SettingsTabId; label: string; hint?: string }> = [
  { id: "brand", label: "Бренд" },
  { id: "navVpn", label: "Меню и VPN" },
  { id: "bot", label: "Бот" },
  { id: "appearance", label: "Внешний вид" },
  { id: "system", label: "Система" },
];

export type PatchDraft = (fn: (d: PanelSettings) => PanelSettings) => void;

export type MsgState = { type: "ok" | "err"; text: string } | null;
