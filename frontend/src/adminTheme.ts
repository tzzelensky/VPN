export type AdminTheme = "dark" | "light";
export type AdminThemeSetting = AdminTheme | "system";

const STORAGE_KEY = "vpn-admin-theme";
const STORAGE_KEY_SETTING = "vpn-admin-theme-setting";

const FILL_BG: Record<AdminTheme, string> = {
  dark: "#0c0f14",
  light: "#f1f5f9",
};

const FILL_COMMIT_RATIO = 0.42;
const TAP_MOVE_PX = 14;

export function getAdminThemeSetting(): AdminThemeSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY_SETTING);
    if (v === "system" || v === "light" || v === "dark") return v;
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {
    /* ignore */
  }
  return "system";
}

export function setAdminThemeSetting(setting: AdminThemeSetting): void {
  const resolved = resolveThemeSetting(setting);
  try {
    localStorage.setItem(STORAGE_KEY_SETTING, setting);
    localStorage.setItem(STORAGE_KEY, resolved);
  } catch {
    /* ignore */
  }
  applyAdminTheme(resolved);
  emitThemeChange(resolved);
}

export function resolveThemeSetting(setting: AdminThemeSetting): AdminTheme {
  if (setting === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return setting;
}

export function getAdminTheme(): AdminTheme {
  return resolveThemeSetting(getAdminThemeSetting());
}

export function applyAdminTheme(theme: AdminTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

function cleanupThemeEffects(): void {
  document.documentElement.classList.remove("admin-theme-animating");
  document.querySelectorAll(".admin-theme-fill, .admin-theme-reveal, .admin-theme-flash").forEach((el) => el.remove());
}

/** Вызывать до первого рендера React (см. main.tsx и index.html). */
export function initAdminTheme(): void {
  cleanupThemeEffects();
  applyAdminTheme(getAdminTheme());
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function emitThemeChange(theme: AdminTheme): void {
  window.dispatchEvent(new CustomEvent("admin-theme-change", { detail: theme }));
}

function persist(theme: AdminTheme, setting?: AdminThemeSetting): void {
  applyAdminTheme(theme);
  const storedSetting: AdminThemeSetting = setting ?? theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    localStorage.setItem(STORAGE_KEY_SETTING, storedSetting);
  } catch {
    /* ignore */
  }
  emitThemeChange(theme);
}

function progressFromClientY(clientY: number): number {
  const vh = window.innerHeight || 1;
  return Math.max(0, Math.min(1, (vh - clientY) / vh));
}

export type ThemeFillSession = {
  next: AdminTheme;
  move: (clientY: number) => void;
  end: (clientY: number, movedPx: number) => Promise<boolean>;
  abort: () => void;
};

/** Сессия «наливания»: высота воды следует за пальцем. */
export function createThemeFillSession(next: AdminTheme): ThemeFillSession | null {
  if (getAdminTheme() === next) return null;

  cleanupThemeEffects();
  document.documentElement.classList.add("admin-theme-animating");

  const root = document.createElement("div");
  root.className = "admin-theme-fill admin-theme-fill--drag";
  root.setAttribute("aria-hidden", "true");

  const liquid = document.createElement("div");
  liquid.className = "admin-theme-fill-liquid";
  liquid.style.setProperty("--fill-bg", FILL_BG[next]);

  const meniscus = document.createElement("div");
  meniscus.className = "admin-theme-fill-meniscus";
  liquid.appendChild(meniscus);
  root.appendChild(liquid);
  document.body.appendChild(root);

  let themeApplied = false;
  let removed = false;

  const removeOverlay = () => {
    if (removed) return;
    removed = true;
    root.remove();
    document.documentElement.classList.remove("admin-theme-animating");
  };

  const setHeight = (ratio: number, animate: boolean) => {
    liquid.style.transition = animate ? "height 0.38s cubic-bezier(0.33, 1, 0.52, 1)" : "none";
    liquid.style.height = `${ratio * 108}%`;
  };

  const waitHeight = (ratio: number) =>
    new Promise<void>((resolve) => {
      const done = () => resolve();
      liquid.addEventListener("transitionend", done, { once: true });
      setHeight(ratio, true);
      window.setTimeout(done, 480);
    });

  const dissolve = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        removeOverlay();
        resolve();
      };
      root.addEventListener("transitionend", done, { once: true });
      root.classList.add("admin-theme-fill--dissolve");
      window.setTimeout(done, 650);
    });

  return {
    next,
    move(clientY: number) {
      setHeight(progressFromClientY(clientY), false);
    },
    async end(clientY: number, movedPx: number) {
      let ratio = progressFromClientY(clientY);
      if (movedPx < TAP_MOVE_PX) ratio = 1;

      const commit = ratio >= FILL_COMMIT_RATIO;

      if (commit) {
        await waitHeight(1);
        if (!themeApplied) {
          themeApplied = true;
          persist(next, next);
        }
        await dissolve();
        return true;
      }

      await waitHeight(0);
      removeOverlay();
      return false;
    },
    abort() {
      removeOverlay();
    },
  };
}

/**
 * Переключение темы без жеста (клавиатура / reduced motion).
 */
export async function transitionAdminTheme(next: AdminTheme, _origin?: HTMLElement | null): Promise<void> {
  if (getAdminTheme() === next) return;

  cleanupThemeEffects();

  if (prefersReducedMotion()) {
    persist(next, next);
    return;
  }

  const session = createThemeFillSession(next);
  if (!session) return;

  session.move(window.innerHeight * 0.35);
  await session.end(0, TAP_MOVE_PX + 1);
}

export function toggleAdminTheme(origin?: HTMLElement | null): Promise<void> {
  const next: AdminTheme = getAdminTheme() === "dark" ? "light" : "dark";
  setAdminThemeSetting(next);
  return transitionAdminTheme(next, origin);
}

/** Синхронизация с настройками панели (без анимации). */
export function syncThemeFromPanelSetting(setting: AdminThemeSetting): void {
  setAdminThemeSetting(setting);
}
