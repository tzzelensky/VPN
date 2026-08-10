import { useMemo, useState, type SVGProps } from "react";

function IconCopy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

type Props = {
  profileJson: Record<string, unknown> | null;
  loading?: boolean;
  onCopied?: () => void;
  onCopyError?: () => void;
};

export default function VaultKeyJsonPanel({ profileJson, loading, onCopied, onCopyError }: Props) {
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => {
    if (!profileJson) return "";
    try {
      return JSON.stringify(profileJson, null, 2);
    } catch {
      return "";
    }
  }, [profileJson]);

  async function copyJson() {
    if (!pretty) return;
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      onCopyError?.();
    }
  }

  if (loading) {
    return <p className="muted">Загрузка JSON…</p>;
  }
  if (!pretty) {
    return <p className="muted">JSON-профиль недоступен</p>;
  }

  return (
    <div className="vault-json-panel">
      <div className="vault-json-panel__toolbar">
        <button
          type="button"
          className="btn btn-sm vault-json-panel__copy"
          onClick={() => void copyJson()}
          title={copied ? "Скопировано" : "Копировать JSON"}
          aria-label={copied ? "Скопировано" : "Копировать JSON"}
        >
          {copied ? "✓" : <IconCopy />}
        </button>
      </div>
      <pre className="vault-json-panel__pre">{pretty}</pre>
    </div>
  );
}
