import { useEffect, useRef, useState } from "react";

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Плавный count-up при смене числа; при prefers-reduced-motion — мгновенно. */
export function useAnimatedNumber(target: number | null | undefined, durationMs = 520): number | null {
  const [display, setDisplay] = useState<number | null>(() =>
    target == null || !Number.isFinite(target) ? null : Math.round(target),
  );
  const fromRef = useRef(display ?? 0);
  const reducedRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;
    const onChange = () => {
      reducedRef.current = mq.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (target == null || !Number.isFinite(target)) {
      setDisplay(null);
      return;
    }
    const to = Math.round(target);
    if (reducedRef.current || durationMs <= 0) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }
    const from = fromRef.current ?? 0;
    if (from === to) {
      setDisplay(to);
      return;
    }
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      const value = Math.round(from + (to - from) * easeOutCubic(t));
      setDisplay(value);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return display;
}
