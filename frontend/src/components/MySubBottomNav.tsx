import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type MySubNavTabId = "home" | "subscription" | "game" | "friends" | "profile";

export type MySubNavItem = {
  id: MySubNavTabId;
  label: string;
  icon: ReactNode;
  gameTickets?: number;
  gameEnabled?: boolean;
};

type BubbleRect = { left: number; width: number };

type Props = {
  items: MySubNavItem[];
  active: MySubNavTabId;
  onChange: (tab: MySubNavTabId) => void;
  fiveColumns?: boolean;
};

function nearestIndex(items: MySubNavItem[], centers: number[], x: number): number {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < items.length; i++) {
    const d = Math.abs(centers[i]! - x);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

export default function MySubBottomNav({ items, active, onChange, fiveColumns }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [bubble, setBubble] = useState<BubbleRect>({ left: 0, width: 0 });
  const [dragging, setDragging] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const draggingRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    moved: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const centersRef = useRef<number[]>([]);
  const rectsRef = useRef<BubbleRect[]>([]);

  const activeIndex = Math.max(0, items.findIndex((it) => it.id === active));
  const visualIndex = dragging ? previewIndex : activeIndex;

  useEffect(() => {
    setPreviewIndex(activeIndex);
  }, [activeIndex]);

  const measure = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const barRect = bar.getBoundingClientRect();
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
    const target = rects[activeIndex] ?? rects[0];
    if (target && !draggingRef.current) setBubble(target);
  }, [items.length, activeIndex]);

  useLayoutEffect(() => {
    measure();
  }, [measure, active, items]);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(bar);
    return () => ro.disconnect();
  }, [measure]);

  const snapToIndex = useCallback(
    (index: number) => {
      const rect = rectsRef.current[index];
      if (rect) setBubble(rect);
      const item = items[index];
      if (item && item.id !== active) onChange(item.id);
    },
    [items, active, onChange],
  );

  const DRAG_THRESHOLD_PX = 6;

  const onPointerDown = (e: React.PointerEvent) => {
    const bar = barRef.current;
    if (!bar || rectsRef.current.length === 0) return;
    const barRect = bar.getBoundingClientRect();
    const x = e.clientX - barRect.left;
    const idx = nearestIndex(items, centersRef.current, x);
    const rect = rectsRef.current[idx] ?? bubble;
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: x - (rect.left + rect.width / 2),
      moved: 0,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    setBubble(rect);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const bar = barRef.current;
    if (!bar) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const dist = Math.hypot(dx, dy);
    drag.moved = Math.max(drag.moved, dist);

    if (!drag.active && dist < DRAG_THRESHOLD_PX) return;

    if (!drag.active) {
      drag.active = true;
      draggingRef.current = true;
      setDragging(true);
      setPreviewIndex(activeIndex);
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    const barRect = bar.getBoundingClientRect();
    const centerX = e.clientX - barRect.left - drag.offsetX;
    const idx = nearestIndex(items, centersRef.current, centerX);
    setPreviewIndex(idx);
    const targetRect = rectsRef.current[idx];
    const w = targetRect?.width || bubble.width || rectsRef.current[0]?.width || 48;
    const half = w / 2;
    const min = half;
    const max = barRect.width - half;
    const clamped = Math.max(min, Math.min(max, centerX));
    setBubble({ left: clamped - half, width: w });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const bar = barRef.current;
    if (bar && drag.active) {
      try {
        bar.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    const wasDrag = drag.active;
    draggingRef.current = false;
    setDragging(false);
    dragRef.current = null;
    if (!wasDrag) return;
    const barRect = bar?.getBoundingClientRect();
    if (!barRect) return;
    const centerX = e.clientX - barRect.left - drag.offsetX;
    const idx = nearestIndex(items, centersRef.current, centerX);
    snapToIndex(idx);
  };

  return (
    <nav
      ref={barRef}
      className={`mysub-bottom-nav ${fiveColumns ? "mysub-bottom-nav--5" : ""} ${dragging ? "mysub-bottom-nav--dragging" : ""}`.trim()}
      aria-label="Навигация"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className={`mysub-nav-bubble ${dragging ? "is-dragging" : ""} ${items[visualIndex]?.id === "game" ? "mysub-nav-bubble--game" : ""}`.trim()}
        style={{ left: bubble.left, width: bubble.width }}
        aria-hidden
      />
      {items.map((item, i) => {
        const isActive = i === visualIndex;
        const gameClass =
          item.id === "game"
            ? item.gameEnabled && (item.gameTickets ?? 0) > 0
              ? "mysub-nav-btn--game"
              : "mysub-nav-btn--game-muted"
            : "";
        return (
          <button
            key={item.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            className={`mysub-nav-btn ${isActive ? "active" : ""} ${gameClass}`.trim()}
            onClick={() => onChange(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
