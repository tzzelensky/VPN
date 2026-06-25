import { useEffect, useRef, type ReactNode } from "react";

const THRESHOLD = 72;
const MAX_PULL = 120;
const ACTIVATE_PX = 6;

type Props = {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  children: ReactNode;
};

function scrollTop(): number {
  return Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0);
}

function isAtTop(): boolean {
  return scrollTop() <= 4;
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("button, input, textarea, select, a, label, .mn-bottom-nav, [contenteditable='true']"),
  );
}

function findTouch(touches: TouchList, id: number): Touch | null {
  for (let i = 0; i < touches.length; i++) {
    const t = touches[i]!;
    if (t.identifier === id) return t;
  }
  return null;
}

export default function PullToRefresh({ onRefresh, disabled, children }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const spinnerRef = useRef<HTMLSpanElement>(null);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const pullRef = useRef(0);
  const rafRef = useRef(0);
  const dragRef = useRef<{ startY: number; startX: number; id: number } | null>(null);
  const probeMoveRef = useRef<(e: TouchEvent) => void>(() => {});
  const activeMoveRef = useRef<(e: TouchEvent) => void>(() => {});
  const endHandlerRef = useRef<(e: TouchEvent) => void>(() => {});

  const applyPull = (px: number, dragging: boolean) => {
    pullRef.current = px;
    const ind = indicatorRef.current;
    const body = bodyRef.current;
    const hint = hintRef.current;
    const spinner = spinnerRef.current;
    if (ind) {
      ind.style.transition = dragging ? "none" : "height 0.28s ease, opacity 0.2s ease";
      ind.style.height = `${px}px`;
      ind.style.opacity = px > 0 || refreshingRef.current ? "1" : "0";
    }
    if (body) {
      body.style.transition = dragging ? "none" : "transform 0.28s cubic-bezier(0.33, 1.2, 0.55, 1)";
      body.style.transform = px > 0 ? `translate3d(0,${px}px,0)` : "";
    }
    if (hint && !refreshingRef.current) {
      hint.textContent = px >= THRESHOLD ? "Отпустите" : "Потяните вниз";
    }
    if (spinner && !refreshingRef.current) {
      spinner.style.transform = `rotate(${Math.min(1, px / THRESHOLD) * 180}deg)`;
    }
  };

  const schedulePull = (px: number) => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      applyPull(px, true);
    });
  };

  const detachListeners = () => {
    document.removeEventListener("touchmove", probeMoveRef.current);
    document.removeEventListener("touchmove", activeMoveRef.current);
    document.removeEventListener("touchend", endHandlerRef.current);
    document.removeEventListener("touchcancel", endHandlerRef.current);
  };

  const resetPull = () => {
    pullingRef.current = false;
    dragRef.current = null;
    rootRef.current?.classList.remove("mn-ptr--dragging");
    detachListeners();
    applyPull(0, false);
  };

  useEffect(() => {
    if (disabled) return;

    const runRefresh = async () => {
      refreshingRef.current = true;
      rootRef.current?.classList.add("mn-ptr--refreshing");
      spinnerRef.current?.classList.add("is-spinning");
      if (hintRef.current) hintRef.current.textContent = "Обновление…";
      applyPull(THRESHOLD, false);
      try {
        await onRefresh();
      } finally {
        refreshingRef.current = false;
        rootRef.current?.classList.remove("mn-ptr--refreshing");
        spinnerRef.current?.classList.remove("is-spinning");
        resetPull();
      }
    };

    activeMoveRef.current = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag || refreshingRef.current || !pullingRef.current) return;
      const t = findTouch(e.touches, drag.id);
      if (!t) return;
      const dy = t.clientY - drag.startY;
      if (dy <= 0) {
        resetPull();
        return;
      }
      e.preventDefault();
      schedulePull(Math.min(MAX_PULL, dy * 0.52));
    };

    probeMoveRef.current = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag || refreshingRef.current || pullingRef.current) return;
      const t = findTouch(e.touches, drag.id);
      if (!t) return;

      const dy = t.clientY - drag.startY;
      const dx = t.clientX - drag.startX;
      if (dy < -4 || !isAtTop()) {
        resetPull();
        return;
      }
      if (Math.abs(dx) > Math.abs(dy) * 1.15) {
        resetPull();
        return;
      }
      if (dy > 0 && dy < ACTIVATE_PX) {
        schedulePull(Math.min(MAX_PULL, dy * 0.45));
        return;
      }
      if (dy < ACTIVATE_PX) return;

      pullingRef.current = true;
      rootRef.current?.classList.add("mn-ptr--dragging");
      document.removeEventListener("touchmove", probeMoveRef.current);
      document.addEventListener("touchmove", activeMoveRef.current, { passive: false });
      activeMoveRef.current(e);
    };

    endHandlerRef.current = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!findTouch(e.changedTouches, drag.id)) return;

      const wasPulling = pullingRef.current;
      detachListeners();
      dragRef.current = null;
      pullingRef.current = false;
      rootRef.current?.classList.remove("mn-ptr--dragging");

      if (!wasPulling) return;
      if (pullRef.current >= THRESHOLD) {
        void runRefresh();
      } else {
        applyPull(0, false);
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || !isAtTop() || shouldIgnoreTarget(e.target)) return;
      const t = e.touches[0];
      if (!t) return;
      dragRef.current = { startY: t.clientY, startX: t.clientX, id: t.identifier };
      document.addEventListener("touchmove", probeMoveRef.current, { passive: true });
      document.addEventListener("touchend", endHandlerRef.current, { passive: true });
      document.addEventListener("touchcancel", endHandlerRef.current, { passive: true });
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      detachListeners();
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [disabled, onRefresh]);

  return (
    <div ref={rootRef} className="mn-ptr">
      <div ref={indicatorRef} className="mn-ptr__indicator" style={{ height: 0, opacity: 0 }} aria-hidden>
        <div className="mn-ptr__indicator-inner">
          <span ref={spinnerRef} className="mn-ptr__spinner" />
          <span ref={hintRef} className="mn-ptr__hint">
            Потяните вниз
          </span>
        </div>
      </div>
      <div ref={bodyRef} className="mn-ptr__body">
        {children}
      </div>
    </div>
  );
}
