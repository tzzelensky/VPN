import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { applyPanelUiSettings } from "./applyPanelUi";
import { fetchPanelSettings, patchPanelSettings, type PanelSettingsPatchPayload } from "./api";
import {
  getFirstVisiblePath,
  isSectionPathVisible,
  normalizeSectionOrder,
  orderSectionsMeta,
  PANEL_NAV_SECTIONS,
} from "./panelNavUtils";
import type { PanelSettings, PanelSettingsResponse, PanelSectionMeta } from "./panelSettingsTypes";

type PanelSettingsContextValue = {
  loaded: boolean;
  settings: PanelSettings | null;
  meta: PanelSectionMeta[];
  telegram: PanelSettingsResponse["telegram"] | null;
  avatarUrl: string | null;
  refresh: () => Promise<void>;
  applyPatch: (payload: PanelSettingsPatchPayload) => Promise<PanelSettingsResponse>;
  isSectionVisible: (path: string) => boolean;
  firstVisiblePath: string;
  confirmDangerous: (message: string) => boolean;
  maskSecret: (value: string) => string;
};

const PanelSettingsContext = createContext<PanelSettingsContextValue | null>(null);

export function PanelSettingsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [loaded, setLoaded] = useState(!enabled);
  const [data, setData] = useState<PanelSettingsResponse | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoaded(true);
      return;
    }
    try {
      const r = await fetchPanelSettings();
      setData((prev) => {
        if (
          prev &&
          prev.settings.updatedAt === r.settings.updatedAt &&
          prev.settings.panel.avatarPath === r.settings.panel.avatarPath &&
          prev.avatarUrl === r.avatarUrl
        ) {
          return prev;
        }
        return r;
      });
      applyPanelUiSettings(r.settings);
    } catch {
      setData(null);
    } finally {
      setLoaded(true);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyPatch = useCallback(async (payload: PanelSettingsPatchPayload) => {
    const r = await patchPanelSettings(payload);
    setData(r);
    applyPanelUiSettings(r.settings);
    return r;
  }, []);

  const value = useMemo<PanelSettingsContextValue>(() => {
    const rawSettings = data?.settings ?? null;
    const settings = rawSettings
      ? {
          ...rawSettings,
          sectionOrder: normalizeSectionOrder(rawSettings.sectionOrder),
        }
      : null;
    const baseMeta = data?.meta.sections?.length ? data.meta.sections : PANEL_NAV_SECTIONS;
    const meta = orderSectionsMeta(baseMeta, settings?.sectionOrder);
    const firstVisiblePath = getFirstVisiblePath(settings, meta);

    return {
      loaded,
      settings,
      meta,
      telegram: data?.telegram ?? null,
      avatarUrl: data?.avatarUrl ?? null,
      refresh,
      applyPatch,
      isSectionVisible: (path: string) => isSectionPathVisible(path, settings, meta),
      firstVisiblePath,
      confirmDangerous: (message: string) => {
        if (!settings?.security.confirmDangerousActions) return true;
        return window.confirm(message);
      },
      maskSecret: (value: string) => {
        const v = String(value ?? "").trim();
        if (!settings?.security.maskSecrets || !v) return v;
        if (v.length <= 8) return "••••••••";
        return `${"•".repeat(8)}${v.slice(-4)}`;
      },
    };
  }, [loaded, data, refresh, applyPatch]);

  return <PanelSettingsContext.Provider value={value}>{children}</PanelSettingsContext.Provider>;
}

export function usePanelSettings(): PanelSettingsContextValue {
  const ctx = useContext(PanelSettingsContext);
  if (!ctx) {
    return {
      loaded: true,
      settings: null,
      meta: [],
      telegram: null,
      avatarUrl: null,
      refresh: async () => {},
      applyPatch: async () => {
        throw new Error("no_provider");
      },
      isSectionVisible: () => true,
      firstVisiblePath: "/servers",
      confirmDangerous: (m) => window.confirm(m),
      maskSecret: (v) => v,
    };
  }
  return ctx;
}
