import { useCallback, useEffect, useState } from "react";
import { getLoginAccent, LOGIN_ACCENTS, setLoginAccent, type LoginAccent } from "../loginTheme";
import AdminThemeToggle from "./AdminThemeToggle";

export default function AdminSidebarThemeDock({ className }: { className?: string }) {
  const [accent, setAccent] = useState<LoginAccent>(() => getLoginAccent());

  const syncAccent = useCallback(() => setAccent(getLoginAccent()), []);

  useEffect(() => {
    syncAccent();
    const onAccent = () => syncAccent();
    window.addEventListener("login-accent-change", onAccent);
    window.addEventListener("storage", onAccent);
    return () => {
      window.removeEventListener("login-accent-change", onAccent);
      window.removeEventListener("storage", onAccent);
    };
  }, [syncAccent]);

  function pickAccent(next: LoginAccent) {
    if (next === accent) return;
    setLoginAccent(next);
    setAccent(next);
  }

  const accentLabel = LOGIN_ACCENTS.find((a) => a.id === accent)?.label ?? "Аврора";

  return (
    <div className={`admin-sidebar-theme-dock${className ? ` ${className}` : ""}`} aria-label="Тема и оформление">
      <div className="admin-sidebar-theme-dock__popover">
        <span className="admin-sidebar-theme-dock__popover-label">Оформление</span>
        <div className="admin-sidebar-theme-dock__swatches" role="group" aria-label="Цветовое оформление">
          {LOGIN_ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`admin-sidebar-theme-dock__swatch admin-sidebar-theme-dock__swatch--${a.id}${accent === a.id ? " is-active" : ""}`}
              aria-pressed={accent === a.id}
              title={a.label}
              onClick={() => pickAccent(a.id)}
            >
              <span className="sr-only">{a.label}</span>
            </button>
          ))}
        </div>
        <span className="admin-sidebar-theme-dock__hint">{accentLabel}</span>
      </div>
      <AdminThemeToggle />
    </div>
  );
}
