import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

type HoldRepeatOpts = {
  onTick: () => void;
  disabled?: boolean;
  initialDelayMs?: number;
  intervalMs?: number;
};

export function useHoldRepeatHandlers({
  onTick,
  disabled = false,
  initialDelayMs = 380,
  intervalMs = 75,
}: HoldRepeatOpts) {
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (disabled) return;
    stop();
    tickRef.current();
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => tickRef.current(), intervalMs);
    }, initialDelayMs);
  }, [disabled, stop, initialDelayMs, intervalMs]);

  useEffect(() => () => stop(), [stop]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      start();
    },
    [disabled, start],
  );

  return {
    onPointerDown,
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    onLostPointerCapture: stop,
  };
}
