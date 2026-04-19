import { useEffect, useRef } from "react";

export type LogLine = { t?: number; msg: string };

export default function LiveLogPanel({ lines, title }: { lines: LogLine[]; title: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div className="live-log">
      <div className="live-log-title">{title}</div>
      <pre ref={ref} className="live-log-body">
        {lines.map((l, i) => (
          <span key={i}>
            {l.msg}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}
