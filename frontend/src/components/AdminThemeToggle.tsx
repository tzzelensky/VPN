import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  getAdminTheme,
  initAdminTheme,
  setAdminThemeSetting,
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
  variant?: "sidebar" | "icon";
};

type DragPreview = {
  offset: number;
  travel: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startOffset: number;
  travel: number;
  moved: boolean;
};

export default function AdminThemeToggle({ className, variant = "sidebar" }: Props) {
  const panel = usePanelSettings();
  const [theme, setTheme] = useState<AdminTheme>(() => getAdminTheme());
  const [busy, setBusy] = useState(false);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  const syncTheme = useCallback(() => {
    initAdminTheme();
    setTheme(getAdminTheme());
  }, []);

  useEffect(() => {
    syncTheme();
    const onThemeChange = (event: Event) => {
      const next = (event as CustomEvent<AdminTheme>).detail;
      if (next === "light" || next === "dark") {
        setTheme(next);
        return;
      }
      syncTheme();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "vpn-admin-theme" || event.key === "vpn-admin-theme-setting") {
        syncTheme();
      }
    };
    window.addEventListener("admin-theme-change", onThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("admin-theme-change", onThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncTheme]);

  const applyTheme = useCallback(async (next: AdminTheme) => {
    if (busy || next === theme) return;
    setBusy(true);
    try {
      setAdminThemeSetting(next);
      setTheme(next);
      if (panel.settings) {
        await panel.applyPatch({
          settings: { ui: { ...panel.settings.ui, theme: next } },
        });
      }
    } catch {
      // The theme is already applied locally even if the panel request fails.
    } finally {
      setBusy(false);
    }
  }, [busy, panel, theme]);

  const toggle = useCallback(async () => {
    const next: AdminTheme = theme === "dark" ? "light" : "dark";
    await applyTheme(next);
  }, [applyTheme, theme]);

  const finishDrag = useCallback((pointerId: number, cancelled = false) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== pointerId) return;

    dragStateRef.current = null;
    const preview = dragPreview;
    const moved = dragState.moved;
    setDragPreview(null);

    if (!moved) return;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (cancelled || !preview) return;

    const nextTheme: AdminTheme = preview.offset >= preview.travel / 2 ? "light" : "dark";
    if (nextTheme !== theme) {
      void applyTheme(nextTheme);
    }
  }, [applyTheme, dragPreview, theme]);

  const onTrackPointerDown = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    if (busy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const travel = Math.max(rect.width - rect.height, 1);
    const startOffset = theme === "light" ? travel : 0;

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset,
      travel,
      moved: false,
    };
    suppressClickRef.current = false;
    setDragPreview({ offset: startOffset, travel });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [busy, theme]);

  const onTrackPointerMove = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 4) {
      dragState.moved = true;
      suppressClickRef.current = true;
    }

    const offset = Math.min(Math.max(dragState.startOffset + deltaX, 0), dragState.travel);
    setDragPreview({ offset, travel: dragState.travel });
  }, []);

  const onTrackPointerUp = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    finishDrag(event.pointerId);
  }, [finishDrag]);

  const onTrackPointerCancel = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    finishDrag(event.pointerId, true);
  }, [finishDrag]);

  const isLight = theme === "light";
  const displayIsLight = dragPreview ? dragPreview.offset >= dragPreview.travel / 2 : isLight;
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
      className={`admin-theme-toggle ${dragPreview ? "is-dragging" : ""} ${className ?? ""}`.trim()}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        void toggle();
      }}
      disabled={busy}
      aria-pressed={isLight}
      aria-label={nextLabel}
      title={nextLabel}
    >
      <span
        className={`admin-theme-toggle-track ${displayIsLight ? "on" : ""} ${dragPreview ? "dragging" : ""}`.trim()}
        aria-hidden
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerCancel}
      >
        <span
          className="admin-theme-toggle-thumb"
          style={dragPreview ? { transform: `translateX(${dragPreview.offset}px)` } : undefined}
        >
          <span className="admin-theme-toggle-icon admin-theme-toggle-icon--sun">
            <IconSun />
          </span>
          <span className="admin-theme-toggle-icon admin-theme-toggle-icon--moon">
            <IconMoon />
          </span>
        </span>
      </span>
      <span className="admin-theme-toggle-label">{displayIsLight ? "Светлая" : "Тёмная"}</span>
    </button>
  );
}
