import { useEffect } from "react";

/** Закрытие модалки по Escape. Не трогает клик по фону. */
export function useModalEscape(onClose: (() => void) | undefined, enabled = true): void {
  useEffect(() => {
    if (!enabled || !onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onClose]);
}
