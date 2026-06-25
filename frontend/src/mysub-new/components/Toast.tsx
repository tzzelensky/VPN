import { useEffect } from "react";

type Props = {
  message: string;
  onDismiss: () => void;
  tone?: "ok" | "err";
};

export default function Toast({ message, onDismiss, tone = "ok" }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, 3200);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className={`mn-toast mn-toast--${tone}`} role="status">
      {message}
    </div>
  );
}
