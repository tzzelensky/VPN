import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  getAdminTheme,
  getAdminThemeSetting,
  setAdminThemeSetting,
  transitionAdminTheme,
  type AdminTheme,
  type AdminThemeSetting,
} from "../adminTheme";
import { getLoginAccent, LOGIN_ACCENTS, setLoginAccent, type LoginAccent } from "../loginTheme";

const THEME_OPTIONS: Array<{ id: AdminThemeSetting; label: string }> = [
  { id: "dark", label: "Тёмная" },
  { id: "light", label: "Светлая" },
  { id: "system", label: "Авто" },
];

type Props = {
  onThemeResolved?: (theme: AdminTheme) => void | Promise<void>;
};

function IconSun() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function AmbientThemeDock({ onThemeResolved }: Props) {
  const [themeSetting, setThemeSetting] = useState<AdminThemeSetting>(() => getAdminThemeSetting());
  const [resolvedTheme, setResolvedTheme] = useState<AdminTheme>(() => getAdminTheme());
  const [accent, setAccent] = useState<LoginAccent>(() => getLoginAccent());
  const [busy, setBusy] = useState(false);

  const sync = useCallback(() => {
    setThemeSetting(getAdminThemeSetting());
    setResolvedTheme(getAdminTheme());
    setAccent(getLoginAccent());
  }, []);

  useEffect(() => {
    sync();
    const onTheme = () => sync();
    const onAccent = () => setAccent(getLoginAccent());
    window.addEventListener("admin-theme-change", onTheme);
    window.addEventListener("login-accent-change", onAccent);
    window.addEventListener("storage", onTheme);
    return () => {
      window.removeEventListener("admin-theme-change", onTheme);
      window.removeEventListener("login-accent-change", onAccent);
      window.removeEventListener("storage", onTheme);
    };
  }, [sync]);

  async function pickTheme(setting: AdminThemeSetting) {
    if (busy || setting === themeSetting) return;
    setBusy(true);
    try {
      setAdminThemeSetting(setting);
      const resolved =
        setting === "system"
          ? window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark"
          : setting;
      await transitionAdminTheme(resolved);
      await onThemeResolved?.(resolved);
      sync();
    } finally {
      setBusy(false);
    }
  }

  function pickAccent(next: LoginAccent) {
    if (next === accent) return;
    setLoginAccent(next);
    setAccent(next);
  }

  return createPortal(
    <div className="ambient-theme-dock" aria-label="Тема и оформление">
      <button type="button" className="ambient-theme-dock__fab" aria-label="Тема и оформление">
        {resolvedTheme === "dark" ? <IconMoon /> : <IconSun />}
      </button>
      <div className="ambient-theme-dock__panel">
        <div className="ambient-theme-dock__block">
          <span className="ambient-theme-dock__label">Тема</span>
          <div className="ambient-theme-dock__seg" role="group">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`ambient-theme-dock__seg-btn${themeSetting === opt.id ? " is-active" : ""}`}
                aria-pressed={themeSetting === opt.id}
                disabled={busy}
                onClick={() => void pickTheme(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="ambient-theme-dock__block">
          <span className="ambient-theme-dock__label">Оформление</span>
          <div className="ambient-theme-dock__swatches" role="group">
            {LOGIN_ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`ambient-theme-dock__swatch ambient-theme-dock__swatch--${a.id}${accent === a.id ? " is-active" : ""}`}
                aria-pressed={accent === a.id}
                title={a.label}
                onClick={() => pickAccent(a.id)}
              >
                <span className="sr-only">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
        <span className="ambient-theme-dock__hint">
          {resolvedTheme === "dark" ? "Тёмный" : "Светлый"} · {LOGIN_ACCENTS.find((a) => a.id === accent)?.label}
        </span>
      </div>
    </div>,
    document.body,
  );
}
