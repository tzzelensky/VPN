import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Ripple = { id: number; x: number; y: number };

type Props = {
  interactive?: boolean;
  className?: string;
};

export default function AmbientBackdrop({ interactive = true, className = "" }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);
  const rafId = useRef(0);
  const lastPointer = useRef({ x: -1, y: -1 });

  const spawnRipple = useCallback((clientX: number, clientY: number) => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const id = ++rippleId.current;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    setRipples((prev) => [...prev.slice(-11), { id, x, y }]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 1100);
  }, []);

  useEffect(() => {
    if (!interactive) return;

    const applyPointer = (clientX: number, clientY: number) => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = ((clientX - rect.left) / rect.width) * 100;
      const y = ((clientY - rect.top) / rect.height) * 100;
      if (Math.abs(x - lastPointer.current.x) < 0.35 && Math.abs(y - lastPointer.current.y) < 0.35) {
        return;
      }
      lastPointer.current = { x, y };
      el.style.setProperty("--ambient-cx", `${x}%`);
      el.style.setProperty("--ambient-cy", `${y}%`);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (rafId.current) return;
      rafId.current = window.requestAnimationFrame(() => {
        rafId.current = 0;
        applyPointer(e.clientX, e.clientY);
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      spawnRipple(e.clientX, e.clientY);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      if (rafId.current) {
        window.cancelAnimationFrame(rafId.current);
        rafId.current = 0;
      }
    };
  }, [interactive, spawnRipple]);

  return createPortal(
    <div
      ref={rootRef}
      className={`ambient-bg${interactive ? " ambient-bg--interactive" : ""} ${className}`.trim()}
      aria-hidden
    >
      <div className="ambient-bg__mesh" />
      <div className="ambient-bg__grid" />
      <div className="ambient-bg__lines" />
      <div className="ambient-bg__orb ambient-bg__orb--1" />
      <div className="ambient-bg__orb ambient-bg__orb--2" />
      <div className="ambient-bg__orb ambient-bg__orb--3" />
      <div className="ambient-bg__shimmer" />
      <div className="ambient-bg__cursor-glow" />
      <div className="ambient-bg__ripples">
        {ripples.map((r) => (
          <span
            key={r.id}
            className="ambient-bg__ripple"
            style={{ left: r.x, top: r.y }}
          />
        ))}
      </div>
      <div className="ambient-bg__vignette" />
    </div>,
    document.body,
  );
}
