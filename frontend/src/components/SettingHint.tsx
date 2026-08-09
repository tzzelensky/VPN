import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type PopoverPos = {
  top: number;
  left: number;
  placement: "above" | "below";
  arrowLeft: number;
  width: number;
};

const VIEW_MARGIN = 8;
const GAP = 10;
const MAX_WIDTH = 300;
const ARROW_EDGE = 14;

function computePopoverPos(anchor: HTMLElement, popoverHeight = 96): PopoverPos {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(MAX_WIDTH, window.innerWidth - VIEW_MARGIN * 2);
  const anchorCenterX = rect.left + rect.width / 2;

  // Держим попап у кнопки, сдвигаем только чтобы не уехать за край экрана.
  let left = anchorCenterX - width / 2;
  left = Math.max(VIEW_MARGIN, Math.min(left, window.innerWidth - width - VIEW_MARGIN));

  const arrowLeft = Math.max(
    ARROW_EDGE,
    Math.min(anchorCenterX - left, width - ARROW_EDGE),
  );

  const spaceBelow = window.innerHeight - rect.bottom - GAP;
  const spaceAbove = rect.top - GAP;
  const placement =
    spaceBelow >= Math.min(popoverHeight, 110) || spaceBelow >= spaceAbove ? "below" : "above";

  let top: number;
  if (placement === "below") {
    top = rect.bottom + GAP;
    const maxTop = window.innerHeight - VIEW_MARGIN - Math.min(popoverHeight, spaceBelow);
    if (top > maxTop && spaceAbove > spaceBelow) {
      // мало места снизу — перекидываем вверх
      top = Math.max(VIEW_MARGIN, rect.top - GAP - popoverHeight);
      return { top, left, placement: "above", arrowLeft, width };
    }
  } else {
    top = rect.top - GAP - popoverHeight;
    if (top < VIEW_MARGIN) top = VIEW_MARGIN;
  }

  return { top, left, placement, arrowLeft, width };
}

function HintIcon() {
  return (
    <svg className="setting-hint-btn__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="5.1" r="1" fill="currentColor" />
      <path
        d="M8 7.35v4.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SettingHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }

    const update = () => {
      if (!btnRef.current) return;
      const measured = popRef.current?.offsetHeight ?? 96;
      setPos(computePopoverPos(btnRef.current, measured));
    };

    update();
    // второй проход после отрисовки — точная высота, стрелка к кнопке
    requestAnimationFrame(update);

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof Node && btnRef.current?.contains(t)) return;
      const pop = popRef.current ?? document.getElementById(id);
      if (pop && t instanceof Node && pop.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, id]);

  const popover =
    open && pos
      ? createPortal(
          <span
            ref={popRef}
            id={id}
            className={`setting-hint-popover setting-hint-popover--${pos.placement}`}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              ["--hint-arrow-left" as string]: `${pos.arrowLeft}px`,
            }}
          >
            <span className="setting-hint-popover__arrow" aria-hidden />
            <span className="setting-hint-popover__text">{text}</span>
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
          className={`setting-hint-btn${open ? " is-open" : ""}`}
          aria-label="Что делает эта настройка"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          title="Подсказка"
          onClick={() => setOpen((v) => !v)}
        >
          <HintIcon />
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
