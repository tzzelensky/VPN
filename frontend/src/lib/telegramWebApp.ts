/** Telegram Mini App SDK helpers (telegram-web-app.js). */

export type TelegramWebApp = {
  initData?: string;
  platform?: string;
  isExpanded?: boolean;
  isFullscreen?: boolean;
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (event: string, cb: (...args: unknown[]) => void) => void;
  offEvent?: (event: string, cb: (...args: unknown[]) => void) => void;
};

const SCRIPT_ID = "tg-webapp-script";
const SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js";

export function getTelegramWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

/** iPad / iPadOS (часто маскируется под Macintosh). */
export function isIpadClient(): boolean {
  const ua = String(navigator.userAgent ?? "");
  if (/iPad/i.test(ua)) return true;
  const platform = String(navigator.platform ?? "");
  if (platform === "MacIntel" && Number(navigator.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

/** Десктоп Telegram (Windows/macOS) и Web-клиенты. */
export function isDesktopTelegramPlatform(wa?: TelegramWebApp): boolean {
  const p = String(wa?.platform ?? "").toLowerCase();
  return p === "tdesktop" || p === "macos" || p === "weba" || p === "webk" || p === "web" || p === "unigram";
}

export function shouldRequestWebAppFullscreen(wa?: TelegramWebApp): boolean {
  if (isIpadClient()) return true;
  if (isDesktopTelegramPlatform(wa)) return true;
  const p = String(wa?.platform ?? "").toLowerCase();
  if (p.startsWith("android") && Math.min(window.innerWidth, window.innerHeight) >= 600) return true;
  return false;
}

function applyMiniAppViewportMeta(): void {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  meta.setAttribute(
    "content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
  );
}

export function maximizeTelegramWebApp(wa = getTelegramWebApp()): void {
  if (!wa) return;
  try {
    wa.ready?.();
  } catch {
    /* ignore */
  }
  try {
    wa.expand?.();
  } catch {
    /* ignore */
  }
  try {
    wa.disableVerticalSwipes?.();
  } catch {
    /* ignore */
  }
  if (shouldRequestWebAppFullscreen(wa) && typeof wa.requestFullscreen === "function" && wa.isFullscreen !== true) {
    try {
      wa.requestFullscreen();
    } catch {
      /* ignore */
    }
  }
  if (shouldRequestWebAppFullscreen(wa)) {
    document.documentElement.classList.add("tg-webapp-large");
    applyMiniAppViewportMeta();
  }
}

export function loadTelegramWebAppScript(): Promise<TelegramWebApp | undefined> {
  const existing = getTelegramWebApp();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const done = () => resolve(getTelegramWebApp());
    const found = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (found) {
      if (getTelegramWebApp()) {
        done();
        return;
      }
      found.addEventListener("load", () => done(), { once: true });
      found.addEventListener("error", () => done(), { once: true });
      setTimeout(done, 1500);
      return;
    }
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.addEventListener("load", () => done(), { once: true });
    s.addEventListener("error", () => done(), { once: true });
    document.head.appendChild(s);
    setTimeout(done, 2500);
  });
}

/** Разворачивает Mini App: expand + fullscreen на iPad/Windows/desktop. */
export function startTelegramWebAppMaximize(): () => void {
  let stopped = false;
  const timers: number[] = [];
  let wa: TelegramWebApp | undefined;
  const onViewport = () => {
    if (stopped) return;
    maximizeTelegramWebApp(wa);
  };

  void loadTelegramWebAppScript().then((loaded) => {
    if (stopped) return;
    wa = loaded ?? getTelegramWebApp();
    maximizeTelegramWebApp(wa);
    wa?.onEvent?.("viewportChanged", onViewport);
    wa?.onEvent?.("fullscreenChanged", onViewport);
    wa?.onEvent?.("activated", onViewport);
    for (const delay of [80, 280, 800, 1600]) {
      timers.push(
        window.setTimeout(() => {
          if (!stopped) maximizeTelegramWebApp(getTelegramWebApp());
        }, delay),
      );
    }
  });

  const onFirstGesture = () => {
    maximizeTelegramWebApp(getTelegramWebApp());
  };
  window.addEventListener("pointerdown", onFirstGesture, { capture: true, once: true });

  return () => {
    stopped = true;
    timers.forEach((id) => window.clearTimeout(id));
    wa?.offEvent?.("viewportChanged", onViewport);
    wa?.offEvent?.("fullscreenChanged", onViewport);
    wa?.offEvent?.("activated", onViewport);
    window.removeEventListener("pointerdown", onFirstGesture, true);
  };
}
