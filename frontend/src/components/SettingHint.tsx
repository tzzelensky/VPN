import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type PopoverPos = { top: number; left: number; placement: "above" | "below" };

function computePopoverPos(anchor: HTMLElement): PopoverPos {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(280, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const placement = spaceBelow >= 100 || spaceBelow >= spaceAbove ? "below" : "above";
  const top = placement === "below" ? rect.bottom + 8 : rect.top - 8;
  return { top, left, placement };
}

export function SettingHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      if (btnRef.current) setPos(computePopoverPos(btnRef.current));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof Node && btnRef.current?.contains(t)) return;
      const pop = document.getElementById(id);
      if (pop && t instanceof Node && pop.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, id]);

  const popover =
    open && pos
      ? createPortal(
          <span
            id={id}
            className={`setting-hint-popover setting-hint-popover--${pos.placement}`}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.placement === "below" ? pos.top : undefined,
              bottom: pos.placement === "above" ? window.innerHeight - pos.top : undefined,
              left: pos.left,
              width: "min(280px, calc(100vw - 16px))",
            }}
          >
            {text}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span className="setting-hint">
        <button
          ref={btnRef}
          type="button"
          className="setting-hint-btn"
          aria-label="Что делает эта настройка"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          i
        </button>
      </span>
      {popover}
    </>
  );
}

export function FieldLabel({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="form-label-with-hint">
      <span className="form-label-with-hint__text">{label}</span>
      <SettingHint text={hint} />
    </div>
  );
}
