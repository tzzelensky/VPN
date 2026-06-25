import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import type { MySubNavTabId } from "../../components/MySubBottomNav";
import type { SwipeVisualState } from "../headerCollapse";
import type { BottomNavHandle } from "./bottomNavHandle";

type NavItem = { id: MySubNavTabId; label: string };

type Props = {
  items: NavItem[];
  active: MySubNavTabId;
  onChange: (tab: MySubNavTabId) => void;
  disabled?: boolean;
  navRef?: React.RefObject<BottomNavHandle | null>;
  gameIndex?: number;
  onVisualUpdate?: (visual: SwipeVisualState) => void;
  onSwipeEnd?: () => void;
  onTabTransitionStart?: (toIndex: number, fromIndex: number, onComplete?: () => void) => void;
  renderPanel: (id: MySubNavTabId) => ReactNode;
};

const ACTIVATE_PX = 10;
const COMMIT_RATIO = 0.18;
const SNAP_MS = 260;

function findTouch(touches: TouchList, id: number): Touch | null {
  for (let i = 0; i < touches.length; i++) {
    const t = touches[i]!;
    if (t.identifier === id) return t;
  }
  return null;
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".mn-bottom-nav, .mn-modal-backdrop, canvas, [data-no-tab-swipe]"));
}

function prefersDesktopTabs(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: fine)").matches;
}

function dampDrag(index: number, max: number, dragPx: number): number {
  let d = dragPx;
  if (index <= 0 && d > 0) d *= 0.22;
  if (index >= max && d < 0) d *= 0.22;
  return d;
}

function shouldUpdateHeader(index: number, dragPx: number, gameIndex: number): boolean {
  if (gameIndex < 0 || dragPx === 0) return false;
  if (index === gameIndex) return true;
  if (index === gameIndex - 1 && dragPx < 0) return true;
  if (index === gameIndex + 1 && dragPx > 0) return true;
  return false;
}

export default function TabSwipeViews({
  items,
  active,
  onChange,
  disabled,
  navRef,
  gameIndex = -1,
  onVisualUpdate,
  onSwipeEnd,
  onTabTransitionStart,
  renderPanel,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const widthRef = useRef(0);
  const itemsRef = useRef(items);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const navRefRef = useRef(navRef);
  const onVisualUpdateRef = useRef(onVisualUpdate);
  const onSwipeEndRef = useRef(onSwipeEnd);
  const onTabTransitionStartRef = useRef(onTabTransitionStart);
  const dragRef = useRef<{ startX: number; startY: number; lastX: number; id: number; index: number } | null>(null);
  const draggingRef = useRef(false);
  const animatingRef = useRef(false);
  const snapTimerRef = useRef(0);
  const frameRafRef = useRef(0);
  const pendingFrameRef = useRef<{ index: number; dragPx: number } | null>(null);
  const trackDoneRef = useRef(false);
  const headerDoneRef = useRef(false);
  const gameIndexRef = useRef(gameIndex);
  const indexRef = useRef(0);
  const settledIndexRef = useRef(0);
  const desktopTabsRef = useRef(prefersDesktopTabs());

  const activeIndex = Math.max(0, items.findIndex((it) => it.id === active));
  const activeIndexRef = useRef(activeIndex);

  itemsRef.current = items;
  onChangeRef.current = onChange;
  disabledRef.current = disabled;
  navRefRef.current = navRef;
  onVisualUpdateRef.current = onVisualUpdate;
  onSwipeEndRef.current = onSwipeEnd;
  onTabTransitionStartRef.current = onTabTransitionStart;
  activeIndexRef.current = activeIndex;
  gameIndexRef.current = gameIndex;

  const clearSnapTimer = () => {
    if (snapTimerRef.current) {
      window.clearTimeout(snapTimerRef.current);
      snapTimerRef.current = 0;
    }
  };

  const clearFrameRaf = () => {
    if (frameRafRef.current) {
      window.cancelAnimationFrame(frameRafRef.current);
      frameRafRef.current = 0;
    }
    pendingFrameRef.current = null;
  };

  const pageWidth = () => widthRef.current || rootRef.current?.getBoundingClientRect().width || 0;

  const measureWidth = useCallback(() => {
    const root = rootRef.current;
    if (!root) return 0;
    const w = Math.round(root.getBoundingClientRect().width);
    if (w > 0) {
      widthRef.current = w;
      root.style.setProperty("--mn-swipe-page-w", `${w}px`);
    }
    return w;
  }, []);

  const applyDesktopPanels = useCallback(
    (index: number) => {
      pageRefs.current.forEach((panel, i) => {
        if (!panel) return;
        panel.style.display = i === index ? "block" : "none";
      });
    },
    [],
  );

  const updatePanelAria = useCallback((index: number) => {
    settledIndexRef.current = index;
    pageRefs.current.forEach((panel, i) => {
      if (!panel) return;
      if (i === index) {
        panel.setAttribute("aria-hidden", "false");
        panel.setAttribute("data-tab-active", "true");
        if (desktopTabsRef.current) panel.style.display = "block";
      } else {
        panel.setAttribute("aria-hidden", "true");
        panel.removeAttribute("data-tab-active");
        if (desktopTabsRef.current) panel.style.display = "none";
      }
    });
  }, []);

  const syncHeight = useCallback((index: number) => {
    const root = rootRef.current;
    if (!root || draggingRef.current || animatingRef.current) return;
    const h = pageRefs.current[index]?.offsetHeight ?? 0;
    root.style.height = h > 0 ? `${Math.ceil(h)}px` : "";
  }, []);

  const lockHeight = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const h = root.offsetHeight;
    if (h > 0) root.style.height = `${h}px`;
  }, []);

  const applyTransform = useCallback((index: number, dragPx: number) => {
    const track = trackRef.current;
    const root = rootRef.current;
    if (!track || !root) return;

    measureWidth();
    const w = pageWidth();
    if (w <= 0) return;

    if (desktopTabsRef.current) {
      track.style.transform = "none";
      applyDesktopPanels(index);
      return;
    }

    const max = itemsRef.current.length - 1;
    const d = dampDrag(index, max, dragPx);
    track.style.transform = `translate3d(${-index * w + d}px,0,0)`;
  }, [applyDesktopPanels, measureWidth]);

  const flushFrame = useCallback(
    (index: number, dragPx: number) => {
      applyTransform(index, dragPx);
      const w = pageWidth();
      if (w <= 0) return;
      const max = itemsRef.current.length - 1;
      const d = dampDrag(index, max, dragPx);
      navRefRef.current?.current?.setSwipeProgress(index, d, w);
      if (shouldUpdateHeader(index, dragPx, gameIndexRef.current)) {
        onVisualUpdateRef.current?.({ index, dragPx, pageWidth: w });
      }
    },
    [applyTransform],
  );

  const scheduleFrame = useCallback(
    (index: number, dragPx: number) => {
      pendingFrameRef.current = { index, dragPx };
      if (frameRafRef.current) return;
      frameRafRef.current = window.requestAnimationFrame(() => {
        frameRafRef.current = 0;
        const pending = pendingFrameRef.current;
        if (!pending) return;
        pendingFrameRef.current = null;
        flushFrame(pending.index, pending.dragPx);
      });
    },
    [flushFrame],
  );

  const goTo = useCallback(
    (index: number, animate: boolean, onDone?: () => void) => {
      if (desktopTabsRef.current) animate = false;
      clearSnapTimer();
      clearFrameRaf();
      const fromIdx = indexRef.current;
      indexRef.current = index;

      const track = trackRef.current;
      const root = rootRef.current;
      if (!track) {
        onDone?.();
        return;
      }

      const gameIdx = gameIndexRef.current;
      const involvesGame = gameIdx >= 0 && (index === gameIdx || fromIdx === gameIdx);
      const snapBack = fromIdx === index;
      const needsHeaderSync = animate && (involvesGame || snapBack);

      const tryFinishTransition = () => {
        if (!trackDoneRef.current) return;
        if (needsHeaderSync && !headerDoneRef.current) return;
        syncHeight(index);
        onDone?.();
      };

      trackDoneRef.current = !animate;
      headerDoneRef.current = !needsHeaderSync;

      if (animate) {
        updatePanelAria(index);
        lockHeight();
      }

      if (animate && needsHeaderSync) {
        onTabTransitionStartRef.current?.(index, fromIdx, () => {
          headerDoneRef.current = true;
          tryFinishTransition();
        });
      }

      track.classList.remove("is-dragging");
      applyTransform(index, 0);
      navRefRef.current?.current?.snapToIndex(index, animate);

      if (!animate) {
        animatingRef.current = false;
        updatePanelAria(index);
        syncHeight(index);
        onDone?.();
        return;
      }

      animatingRef.current = true;
      root?.classList.add("mn-tab-swipe--snapping");

      const finishTrack = () => {
        clearSnapTimer();
        animatingRef.current = false;
        root?.classList.remove("mn-tab-swipe--snapping");
        trackDoneRef.current = true;
        tryFinishTransition();
      };

      const onEnd = (ev: TransitionEvent) => {
        if (ev.propertyName !== "transform") return;
        track.removeEventListener("transitionend", onEnd);
        finishTrack();
      };
      track.addEventListener("transitionend", onEnd);
      snapTimerRef.current = window.setTimeout(() => {
        track.removeEventListener("transitionend", onEnd);
        finishTrack();
      }, SNAP_MS + 50);
    },
    [applyTransform, lockHeight, syncHeight, updatePanelAria],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const mq = window.matchMedia("(pointer: fine)");
    const onMq = () => {
      desktopTabsRef.current = mq.matches;
      root.classList.toggle("mn-tab-swipe--desktop", desktopTabsRef.current);
      measureWidth();
      applyTransform(indexRef.current, 0);
      updatePanelAria(indexRef.current);
      syncHeight(indexRef.current);
    };
    onMq();
    mq.addEventListener("change", onMq);

    const ro = new ResizeObserver(() => {
      if (draggingRef.current || animatingRef.current) return;
      measureWidth();
      applyTransform(indexRef.current, 0);
      syncHeight(indexRef.current);
    });
    ro.observe(root);
    measureWidth();

    return () => {
      mq.removeEventListener("change", onMq);
      ro.disconnect();
    };
  }, [applyTransform, measureWidth, syncHeight, updatePanelAria]);

  useLayoutEffect(() => {
    if (draggingRef.current || animatingRef.current) return;
    if (indexRef.current === activeIndex) {
      updatePanelAria(activeIndex);
      syncHeight(activeIndex);
      applyTransform(activeIndex, 0);
      navRefRef.current?.current?.snapToIndex(activeIndex, false);
      return;
    }
    goTo(activeIndex, true);
  }, [activeIndex, applyTransform, goTo, syncHeight, updatePanelAria]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const detach = () => {
      root.removeEventListener("touchmove", onProbeMove);
      root.removeEventListener("touchmove", onActiveMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };

    const finishGesture = (commit: boolean) => {
      detach();
      clearFrameRaf();
      root.classList.remove("mn-tab-swipe--dragging");
      trackRef.current?.classList.remove("is-dragging");

      const drag = dragRef.current;
      const wasDragging = draggingRef.current;
      draggingRef.current = false;
      dragRef.current = null;
      onSwipeEndRef.current?.();

      if (!drag || !wasDragging || !commit) {
        goTo(indexRef.current, true);
        return;
      }

      const idx = drag.index;
      const w = pageWidth();
      const offset = drag.lastX - drag.startX;

      let targetIdx = idx;
      const threshold = w * COMMIT_RATIO;
      if (offset < -threshold && idx < itemsRef.current.length - 1) targetIdx = idx + 1;
      else if (offset > threshold && idx > 0) targetIdx = idx - 1;

      goTo(targetIdx, true, () => {
        if (targetIdx !== idx) {
          onChangeRef.current(itemsRef.current[targetIdx]!.id);
        }
      });
    };

    const onActiveMove = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag || !draggingRef.current) return;
      const t = findTouch(e.touches, drag.id);
      if (!t) return;
      e.preventDefault();
      drag.lastX = t.clientX;
      scheduleFrame(drag.index, t.clientX - drag.startX);
    };

    const onProbeMove = (e: TouchEvent) => {
      const drag = dragRef.current;
      if (!drag || draggingRef.current) return;
      const t = findTouch(e.touches, drag.id);
      if (!t) return;

      const dx = t.clientX - drag.startX;
      const dy = t.clientY - drag.startY;
      if (Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > ACTIVATE_PX) {
        finishGesture(false);
        return;
      }
      if (Math.abs(dx) < ACTIVATE_PX) return;
      if (Math.abs(dx) <= Math.abs(dy)) return;

      draggingRef.current = true;
      root.classList.add("mn-tab-swipe--dragging");
      trackRef.current?.classList.add("is-dragging");
      lockHeight();
      root.removeEventListener("touchmove", onProbeMove);
      root.addEventListener("touchmove", onActiveMove, { passive: false });
      onActiveMove(e);
    };

    const onTouchEnd = () => {
      if (!dragRef.current) return;
      finishGesture(draggingRef.current);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (desktopTabsRef.current) return;
      if (disabledRef.current || animatingRef.current || shouldIgnoreTarget(e.target)) return;
      const t = e.touches[0];
      if (!t) return;

      widthRef.current = root.getBoundingClientRect().width;
      measureWidth();
      const idx = activeIndexRef.current;
      indexRef.current = idx;
      applyTransform(idx, 0);

      dragRef.current = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, id: t.identifier, index: idx };
      root.addEventListener("touchmove", onProbeMove, { passive: true });
      root.addEventListener("touchend", onTouchEnd, { passive: true });
      root.addEventListener("touchcancel", onTouchEnd, { passive: true });
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      detach();
      clearSnapTimer();
      clearFrameRaf();
    };
  }, [applyTransform, goTo, lockHeight, scheduleFrame]);

  useLayoutEffect(() => {
    indexRef.current = activeIndex;
    measureWidth();
    updatePanelAria(activeIndex);
    applyTransform(activeIndex, 0);
    syncHeight(activeIndex);
    navRefRef.current?.current?.snapToIndex(activeIndex, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const gameIdx = gameIndexRef.current;
    if (activeIndex !== gameIdx || gameIdx < 0) return;
    const panel = pageRefs.current[gameIdx];
    const root = rootRef.current;
    if (!panel || !root) return;

    let raf = 0;
    const apply = () => {
      if (draggingRef.current || animatingRef.current) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = panel.offsetHeight;
        if (h > 0) root.style.height = `${Math.ceil(h)}px`;
      });
    };

    const ro = new ResizeObserver(apply);
    ro.observe(panel);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [activeIndex, gameIndex]);

  return (
    <div
      ref={rootRef}
      className={`mn-tab-swipe${desktopTabsRef.current ? " mn-tab-swipe--desktop" : ""}`}
    >
      <div className="mn-tab-swipe__viewport">
        <div ref={trackRef} className="mn-tab-swipe__track">
          {items.map((item, i) => (
            <div
              key={item.id}
              ref={(el) => {
                pageRefs.current[i] = el;
                if (!el) return;
                const active = i === settledIndexRef.current;
                el.setAttribute("aria-hidden", active ? "false" : "true");
                if (active) el.setAttribute("data-tab-active", "true");
                else el.removeAttribute("data-tab-active");
              }}
              className="mn-tab-swipe__panel"
              data-tab={item.id}
            >
              {renderPanel(item.id)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
