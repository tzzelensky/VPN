import { useCallback, useEffect, useId, useRef, useState } from "react";

const pad2 = (n: number) => String(n).padStart(2, "0");

const DAY_MS = 86_400_000;

function atNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function noonAfterDays(days: number): Date {
  return atNoon(new Date(Date.now() + days * DAY_MS));
}

function formatDdMmYyyy(d: Date): string {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function formatIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function buildGridCells(viewYear: number, viewMonth: number): Date[] {
  const first = new Date(viewYear, viewMonth, 1);
  const lead = first.getDay();
  const start = new Date(viewYear, viewMonth, 1 - lead);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type Props = {
  valueMs: number;
  onChangeMs: (ms: number) => void;
  disabled?: boolean;
};

export default function ExpiryDateTimePicker({ valueMs, onChangeMs, disabled }: Props) {
  const uid = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => new Date());
  const [draft, setDraft] = useState(() => atNoon(new Date()));

  const openPop = useCallback(() => {
    if (disabled) return;
    const base = valueMs > 0 ? new Date(valueMs) : new Date();
    const noon = atNoon(base);
    setDraft(noon);
    setCursor(new Date(noon.getFullYear(), noon.getMonth(), 1));
    setOpen(true);
  }, [disabled, valueMs]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const vy = cursor.getFullYear();
  const vm = cursor.getMonth();
  const cells = buildGridCells(vy, vm);
  const today = new Date();

  function pickDay(d: Date) {
    setDraft(atNoon(d));
  }

  function applyTodayNoon() {
    const n = atNoon(new Date());
    setDraft(n);
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
  }

  function applyOk() {
    onChangeMs(draft.getTime());
    setOpen(false);
  }

  function applyClear() {
    onChangeMs(0);
    setOpen(false);
  }

  function applyPlusDays(days: number) {
    const n = noonAfterDays(days);
    onChangeMs(n.getTime());
    setOpen(false);
  }

  const monthTitle = new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric" }).format(
    new Date(vy, vm, 1),
  );

  return (
    <div className="expiry-picker-wrap" ref={wrapRef}>
      <div className="expiry-picker-trigger-row">
        <input
          id={uid}
          className="expiry-picker-display"
          readOnly
          value={valueMs > 0 ? formatDdMmYyyy(new Date(valueMs)) : ""}
          placeholder="без ограничения"
          disabled={disabled}
          onClick={() => openPop()}
        />
        <button
          type="button"
          className="expiry-picker-cal-btn ghost"
          title="Выбрать дату окончания (12:00 этого дня)"
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openPop())}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="expiry-picker-cal-icon" aria-hidden>
            📅
          </span>
        </button>
      </div>

      {open ? (
        <div className="expiry-picker-pop" role="dialog" aria-label="Дата окончания">
          <p className="expiry-picker-noon-hint">Окончание всегда в <b>12:00</b> выбранного дня.</p>
          <input className="expiry-picker-top-input" readOnly value={formatIsoDate(draft)} />

          <>
            <div className="expiry-picker-nav">
              <button type="button" className="expiry-picker-navbtn" onClick={() => setCursor(new Date(vy - 1, vm, 1))}>
                «
              </button>
              <button type="button" className="expiry-picker-navbtn" onClick={() => setCursor(new Date(vy, vm - 1, 1))}>
                ‹
              </button>
              <span className="expiry-picker-month">{monthTitle}</span>
              <button type="button" className="expiry-picker-navbtn" onClick={() => setCursor(new Date(vy, vm + 1, 1))}>
                ›
              </button>
              <button type="button" className="expiry-picker-navbtn" onClick={() => setCursor(new Date(vy + 1, vm, 1))}>
                »
              </button>
            </div>
            <div className="expiry-picker-dow">
              {["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="expiry-picker-grid">
              {cells.map((d, i) => {
                const inMonth = d.getMonth() === vm;
                const isToday = sameDay(d, today);
                const isSel = sameDay(d, draft);
                return (
                  <button
                    key={i}
                    type="button"
                    className={[
                      "expiry-picker-cell",
                      !inMonth ? "muted" : "",
                      isToday ? "today" : "",
                      isSel ? "selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => pickDay(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </>

          <div className="expiry-picker-footer">
            <button type="button" className="expiry-picker-link" onClick={applyTodayNoon}>
              Сегодня
            </button>
            <button type="button" className="expiry-picker-link" onClick={() => applyPlusDays(30)}>
              30 дней
            </button>
            <button type="button" className="expiry-picker-link subtle" onClick={applyClear}>
              Без срока
            </button>
            <button type="button" className="expiry-picker-ok" onClick={applyOk}>
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
