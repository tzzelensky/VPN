import { useEffect, useRef, useState } from "react";
import type { UserDto } from "../api";

const BYTES_PER_GB = 1073741824;

function usedGbFromUser(u: UserDto): number {
  const bytes = (Number(u.traffic_up) || 0) + (Number(u.traffic_down) || 0);
  return Math.round((bytes / BYTES_PER_GB) * 100) / 100;
}

function clampUsedGb(value: number, maxGb: number): number {
  const v = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(maxGb, v);
}

export default function TrafficUsedSlider({
  user,
  disabled,
  className,
  onCommit,
}: {
  user: UserDto;
  disabled?: boolean;
  className?: string;
  onCommit: (usedGb: number) => Promise<void>;
}) {
  const maxGb = Math.max(0.01, Number(user.total_gb) || 0);
  const serverGb = usedGbFromUser(user);
  const [draftGb, setDraftGb] = useState(serverGb);
  const [busy, setBusy] = useState(false);
  const draggingRef = useRef(false);
  const draftRef = useRef(draftGb);

  useEffect(() => {
    if (draggingRef.current || busy) return;
    setDraftGb(serverGb);
    draftRef.current = serverGb;
  }, [serverGb, busy, user.id]);

  const pct = Math.min(100, (draftGb / maxGb) * 100);

  const commit = async () => {
    draggingRef.current = false;
    const next = clampUsedGb(draftRef.current, maxGb);
    setDraftGb(next);
    draftRef.current = next;
    if (Math.abs(next - serverGb) < 0.005) return;
    setBusy(true);
    try {
      await onCommit(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`ud-traffic-slider ${className ?? ""}`.trim()}>
      <div className="ud-traffic-used">{draftGb.toFixed(2)} GB</div>
      <div className="ud-traffic-slider-track-wrap" title={`Лимит ${maxGb} GB · шаг 0.01`}>
        <div className="ud-traffic-bar-fill ud-traffic-slider-fill" style={{ width: `${pct}%` }} />
        <input
          type="range"
          className="ud-traffic-slider-input"
          min={0}
          max={maxGb}
          step={0.01}
          value={Math.min(maxGb, draftGb)}
          disabled={disabled || busy || maxGb <= 0}
          aria-label={`Потрачено трафика, ГБ, клиент ${user.name}`}
          onPointerDown={() => {
            draggingRef.current = true;
          }}
          onChange={(e) => {
            const v = clampUsedGb(Number(e.target.value), maxGb);
            draftRef.current = v;
            setDraftGb(v);
          }}
          onPointerUp={() => void commit()}
          onKeyUp={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
              void commit();
            }
          }}
          onBlur={() => void commit()}
        />
      </div>
      <div className="ud-traffic-cap muted">{maxGb} GB</div>
    </div>
  );
}
