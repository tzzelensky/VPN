import { useEffect, useRef } from "react";

const ACTIVITY_KEY = "vpn-admin-last-activity";

function touchActivity(): void {
  try {
    sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function useAutoLogout(
  minutes: number | null | undefined,
  onIdle: () => void,
): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    const limit = minutes ?? 0;
    if (!Number.isFinite(limit) || limit <= 0) return;

    touchActivity();
    const ms = limit * 60_000;

    const onActivity = () => touchActivity();
    const events: Array<keyof WindowEventMap> = ["mousedown", "keydown", "touchstart", "scroll"];
    for (const ev of events) {
      window.addEventListener(ev, onActivity, { passive: true });
    }

    const tick = () => {
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(ACTIVITY_KEY) || 0);
      } catch {
        return;
      }
      if (!last) return;
      if (Date.now() - last >= ms) {
        try {
          sessionStorage.removeItem(ACTIVITY_KEY);
        } catch {
          /* ignore */
        }
        onIdleRef.current();
      }
    };

    const id = window.setInterval(tick, 15_000);
    tick();

    return () => {
      window.clearInterval(id);
      for (const ev of events) {
        window.removeEventListener(ev, onActivity);
      }
    };
  }, [minutes]);
}
