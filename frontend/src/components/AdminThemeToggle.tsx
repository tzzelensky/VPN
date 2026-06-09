import { useCallback, useEffect, useState } from "react";
import {
  getAdminTheme,
  initAdminTheme,
  setAdminThemeSetting,
  transitionAdminTheme,
  type AdminTheme,
} from "../adminTheme";
import { usePanelSettings } from "../panelSettingsContext";

function IconSun() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

type Props = {
  className?: string;
  /** sidebar — полный переключатель; icon — только иконка для шапки */
  variant?: "sidebar" | "icon";
};

export default function AdminThemeToggle({ className, variant = "sidebar" }: Props) {
  const panel = usePanelSettings();
  const [theme, setTheme] = useState<AdminTheme>(() => getAdminTheme());
  const [busy, setBusy] = useState(false);

  const syncTheme = useCallback(() => {
    initAdminTheme();
    setTheme(getAdminTheme());
  }, []);

  useEffect(() => {
    syncTheme();
    const onThemeChange = (e: Event) => {
      const next = (e as CustomEvent<AdminTheme>).detail;
      if (next === "light" || next === "dark") setTheme(next);
      else syncTheme();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "vpn-admin-theme" || e.key === "vpn-admin-theme-setting") syncTheme();
    };
    window.addEventListener("admin-theme-change", onThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("admin-theme-change", onThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncTheme]);

  const toggle = useCallback(async () => {
    if (busy) return;
    const next: AdminTheme = theme === "dark" ? "light" : "dark";
    setBusy(true);
    try {
      setAdminThemeSetting(next);
      await transitionAdminTheme(next);
      setTheme(next);
      if (panel.settings) {
        await panel.applyPatch({
          settings: { ui: { ...panel.settings.ui, theme: next } },
        });
      }
    } catch {
      /* тема уже применена локально */
    } finally {
      setBusy(false);
    }
  }, [busy, theme, panel]);

  const isLight = theme === "light";
  const nextLabel = isLight ? "Тёмная тема" : "Светлая тема";

  if (variant === "icon") {
    return (
      <button
        type="button"
        className={`admin-theme-icon-btn ghost ${className ?? ""}`.trim()}
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={isLight}
        aria-label={nextLabel}
        title={nextLabel}
      >
        {isLight ? <IconMoon /> : <IconSun />}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`admin-theme-toggle ${className ?? ""}`.trim()}
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={isLight}
      aria-label={nextLabel}
      title={nextLabel}
    >
      <span className={`admin-theme-toggle-track ${isLight ? "on" : ""}`.trim()} aria-hidden>
        <span className="admin-theme-toggle-thumb">
          <span className="admin-theme-toggle-icon admin-theme-toggle-icon--sun">
            <IconSun />
          </span>
          <span className="admin-theme-toggle-icon admin-theme-toggle-icon--moon">
            <IconMoon />
          </span>
        </span>
      </span>
      <span className="admin-theme-toggle-label">{isLight ? "Светлая" : "Тёмная"}</span>
    </button>
  );
}
