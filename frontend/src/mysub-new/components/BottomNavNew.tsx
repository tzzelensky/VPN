import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { MySubNavTabId } from "../../components/MySubBottomNav";
import type { MySubWebAppController } from "../types";
import type { BottomNavHandle } from "./bottomNavHandle";

type Props = {
  items: MySubWebAppController["bottomNavItems"];
  active: MySubNavTabId;
  onChange: (tab: MySubNavTabId) => void;
};

type BubbleRect = { left: number; width: number };

const DRAG_THRESHOLD_PX = 6;

function findTouchById(touches: TouchList, id: number): Touch | null {
  for (let i = 0; i < touches.length; i++) {
    const t = touches[i]!;
    if (t.identifier === id) return t;
  }
  return null;
}

function nearestIndex(centers: number[], x: number): number {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(centers[i]! - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

const BottomNavNew = forwardRef<BottomNavHandle, Props>(function BottomNavNew({ items, active, onChange }, ref) {
  const innerRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const draggingRef = useRef(false);
  const previewIndexRef = useRef(0);
  const swipeProgressRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    startX: number;
    startY: number;
    active: boolean;
    barLeft: number;
    barWidth: number;
  } | null>(null);
  const centersRef = useRef<number[]>([]);
  const rectsRef = useRef<BubbleRect[]>([]);
  const rafRef = useRef(0);
  const pendingRef = useRef<{ left: number; width: number; index: number } | null>(null);
  const moveHandlerRef = useRef<(e: PointerEvent) => void>(() => {});
  const upHandlerRef = useRef<(e: PointerEvent) => void>(() => {});

  const activeIndex = Math.max(0, items.findIndex((it) => it.id === active));

  const applyBubble = useCallback((left: number, width: number, dragging: boolean) => {
    const el = bubbleRef.current;
    if (!el) return;
    el.classList.toggle("is-dragging", dragging);
    el.style.width = `${width}px`;
    el.style.transform = `translate3d(${left}px,0,0)`;
  }, []);

  const applyVisualIndex = useCallback((idx: number) => {
    if (previewIndexRef.current === idx) return;
    previewIndexRef.current = idx;
    for (let i = 0; i < itemRefs.current.length; i++) {
      itemRefs.current[i]?.classList.toggle("is-active", i === idx);
    }
  }, []);

  const measureRects = useCallback(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const barRect = inner.getBoundingClientRect();
    const rects: BubbleRect[] = [];
    const centers: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const btn = itemRefs.current[i];
      if (!btn) continue;
      const r = btn.getBoundingClientRect();
      const left = r.left - barRect.left;
      const width = r.width;
      rects.push({ left, width });
      centers.push(left + width / 2);
    }
    rectsRef.current = rects;
    centersRef.current = centers;
  }, [items.length]);

  const snapToIndex = useCallback(
    (index: number, animate: boolean) => {
      swipeProgressRef.current = false;
      measureRects();
      const rect = rectsRef.current[index];
      if (rect) applyBubble(rect.left, rect.width, !animate);
      applyVisualIndex(index);
    },
    [applyBubble, applyVisualIndex, measureRects],
  );

  const setSwipeProgress = useCallback(
    (index: number, dragPx: number, pageWidth: number) => {
      if (pageWidth <= 0) return;
      swipeProgressRef.current = true;
      if (!rectsRef.current.length) measureRects();
      if (!rectsRef.current.length) return;

      const max = rectsRef.current.length - 1;
      let d = dragPx;
      if (index <= 0 && d > 0) d *= 0.22;
      if (index >= max && d < 0) d *= 0.22;

      const progress = -d / pageWidth;
      const from = Math.max(0, Math.min(max, index));
      let to = from;
      if (progress > 0 && from < max) to = from + 1;
      else if (progress < 0 && from > 0) to = from - 1;

      const t = Math.min(1, Math.abs(progress));
      const a = rectsRef.current[from]!;
      const b = rectsRef.current[to]!;
      const left = a.left + (b.left - a.left) * t;
      const width = a.width + (b.width - a.width) * t;
      applyBubble(left, width, true);
      applyVisualIndex(t >= 0.5 ? to : from);
    },
    [applyBubble, applyVisualIndex, measureRects],
  );

  useImperativeHandle(ref, () => ({ setSwipeProgress, snapToIndex }), [setSwipeProgress, snapToIndex]);

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    applyBubble(pending.left, pending.width, true);
    applyVisualIndex(pending.index);
  }, [applyBubble, applyVisualIndex]);

  const scheduleVisual = useCallback(
    (left: number, width: number, index: number) => {
      pendingRef.current = { left, width, index };
      if (rafRef.current) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = 0;
        flushPending();
      });
    },
    [flushPending],
  );

  const measure = useCallback(() => {
    measureRects();
    if (draggingRef.current || swipeProgressRef.current) return;
    snapToIndex(activeIndex, false);
  }, [activeIndex, measureRects, snapToIndex]);

  useLayoutEffect(() => {
    measureRects();
    if (!draggingRef.current && !swipeProgressRef.current) {
      snapToIndex(activeIndex, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const detachWindowListeners = useCallback(() => {
    window.removeEventListener("pointermove", moveHandlerRef.current);
    window.removeEventListener("pointerup", upHandlerRef.current);
    window.removeEventListener("pointercancel", upHandlerRef.current);
  }, []);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(inner);
    return () => {
      ro.disconnect();
      detachWindowListeners();
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, [measure, detachWindowListeners]);

  const snapFromNavDrag = useCallback(
    (index: number) => {
      swipeProgressRef.current = false;
      const rect = rectsRef.current[index];
      if (rect) applyBubble(rect.left, rect.width, false);
      applyVisualIndex(index);
      const item = items[index];
      if (item && item.id !== active) onChange(item.id);
    },
    [active, applyBubble, applyVisualIndex, items, onChange],
  );

  const finishDrag = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      detachWindowListeners();
      innerRef.current?.classList.remove("mn-bottom-nav__inner--dragging");

      const wasDrag = drag.active;
      dragRef.current = null;
      draggingRef.current = false;

      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      pendingRef.current = null;

      if (!wasDrag) return;

      const centerX = e.clientX - drag.barLeft - drag.offsetX;
      const idx = nearestIndex(centersRef.current, centerX);
      snapFromNavDrag(idx);
    },
    [detachWindowListeners, snapFromNavDrag],
  );

  const cancelDrag = useCallback(() => {
    detachWindowListeners();
    innerRef.current?.classList.remove("mn-bottom-nav__inner--dragging");
    dragRef.current = null;
    draggingRef.current = false;
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    pendingRef.current = null;
  }, [detachWindowListeners]);

  moveHandlerRef.current = (e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const dist = Math.hypot(dx, dy);

    if (!drag.active && dist < DRAG_THRESHOLD_PX) return;

    if (!drag.active) {
      drag.active = true;
      draggingRef.current = true;
      swipeProgressRef.current = true;
      innerRef.current?.classList.add("mn-bottom-nav__inner--dragging");
      applyVisualIndex(activeIndex);
      e.preventDefault();
    }

    const centerX = e.clientX - drag.barLeft - drag.offsetX;
    const idx = nearestIndex(centersRef.current, centerX);
    const targetRect = rectsRef.current[idx] ?? rectsRef.current[0];
    const w = targetRect?.width ?? rectsRef.current[0]?.width ?? 48;
    const half = w / 2;
    const clamped = Math.max(half, Math.min(drag.barWidth - half, centerX));
    scheduleVisual(clamped - half, w, idx);
    e.preventDefault();
  };

  upHandlerRef.current = finishDrag;

  const onPointerDown = (e: React.PointerEvent) => {
    if (draggingRef.current || e.pointerType === "touch") return;
    measureRects();
    const inner = innerRef.current;
    if (!inner || rectsRef.current.length === 0) return;

    const barRect = inner.getBoundingClientRect();
    const x = e.clientX - barRect.left;
    const activeRect = rectsRef.current[activeIndex];
    if (!activeRect || x < activeRect.left || x > activeRect.left + activeRect.width) return;

    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: x - (activeRect.left + activeRect.width / 2),
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      barLeft: barRect.left,
      barWidth: barRect.width,
    };

    window.addEventListener("pointermove", moveHandlerRef.current, { passive: false });
    window.addEventListener("pointerup", upHandlerRef.current);
    window.addEventListener("pointercancel", upHandlerRef.current);
  };

  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;

    const onTouchStart = (e: TouchEvent) => {
      if (draggingRef.current || rectsRef.current.length === 0) return;
      const t = e.touches[0];
      if (!t) return;
      const target = e.target;
      if (!(target instanceof Element) || !target.closest(".mn-bottom-nav__btn.is-active")) return;

      measureRects();
      const barRect = inner.getBoundingClientRect();
      const x = t.clientX - barRect.left;
      const activeRect = rectsRef.current[activeIndex];
      if (!activeRect || x < activeRect.left || x > activeRect.left + activeRect.width) return;

      dragRef.current = {
        pointerId: t.identifier,
        offsetX: x - (activeRect.left + activeRect.width / 2),
        startX: t.clientX,
        startY: t.clientY,
        active: false,
        barLeft: barRect.left,
        barWidth: barRect.width,
      };

      const onTouchMove = (ev: TouchEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const touch = findTouchById(ev.touches, drag.pointerId);
        if (!touch) return;

        const dx = touch.clientX - drag.startX;
        const dy = touch.clientY - drag.startY;
        const dist = Math.hypot(dx, dy);
        if (!drag.active && dist < DRAG_THRESHOLD_PX) return;

        if (!drag.active) {
          drag.active = true;
          draggingRef.current = true;
          swipeProgressRef.current = true;
          inner.classList.add("mn-bottom-nav__inner--dragging");
          applyVisualIndex(activeIndex);
          ev.preventDefault();
        }

        const centerX = touch.clientX - drag.barLeft - drag.offsetX;
        const idx = nearestIndex(centersRef.current, centerX);
        const targetRect = rectsRef.current[idx] ?? rectsRef.current[0];
        const w = targetRect?.width ?? rectsRef.current[0]?.width ?? 48;
        const half = w / 2;
        const clamped = Math.max(half, Math.min(drag.barWidth - half, centerX));
        scheduleVisual(clamped - half, w, idx);
        ev.preventDefault();
      };

      const onTouchEnd = (ev: TouchEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const ended = findTouchById(ev.changedTouches, drag.pointerId);
        inner.removeEventListener("touchmove", onTouchMove);
        inner.removeEventListener("touchend", onTouchEnd);
        inner.removeEventListener("touchcancel", onTouchEnd);

        draggingRef.current = false;
        dragRef.current = null;
        inner.classList.remove("mn-bottom-nav__inner--dragging");
        if (rafRef.current) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        pendingRef.current = null;

        if (!ended || !drag.active) return;

        const centerX = ended.clientX - drag.barLeft - drag.offsetX;
        const idx = nearestIndex(centersRef.current, centerX);
        snapFromNavDrag(idx);
      };

      inner.addEventListener("touchmove", onTouchMove, { passive: false });
      inner.addEventListener("touchend", onTouchEnd, { passive: true });
      inner.addEventListener("touchcancel", onTouchEnd, { passive: true });
    };

    inner.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      inner.removeEventListener("touchstart", onTouchStart);
      cancelDrag();
    };
  }, [activeIndex, applyVisualIndex, cancelDrag, measureRects, scheduleVisual, snapFromNavDrag]);

  return (
    <nav className="mn-bottom-nav" aria-label="Навигация">
      <div
        ref={innerRef}
        className="mn-bottom-nav__inner"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, 1fr)` }}
        onPointerDown={onPointerDown}
      >
        <div ref={bubbleRef} className="mn-bottom-nav__bubble" aria-hidden />
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            className={`mn-bottom-nav__btn ${i === activeIndex ? "is-active" : ""}`.trim()}
            onClick={() => {
              if (item.id === active) return;
              onChange(item.id);
            }}
          >
            <span className="mn-bottom-nav__icon">{item.icon}</span>
            <span className="mn-bottom-nav__label">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
});

export default BottomNavNew;
