import { useEffect, useState, type ReactNode } from "react";
import type { ServerDto } from "../api";
import { COUNTRY_CODES_ALPHA2 } from "../countryCodes";
import { countryFlagEmoji } from "../flagEmoji";
import Spinner from "./Spinner";

type Props = {
  server: ServerDto;
  disabled: boolean;
  onSave: (name: string, countryCode: string) => Promise<void>;
  children: ReactNode;
};

export default function ServerSettingsCard({ server: s, disabled, onSave, children }: Props) {
  const [name, setName] = useState(s.name);
  const [cc, setCc] = useState(s.country_code || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(s.name);
    setCc(s.country_code || "");
  }, [s.id, s.updated_at, s.name, s.country_code]);

  const dirty =
    name.trim() !== (s.name || "").trim() || (cc || "").toUpperCase() !== (s.country_code || "").toUpperCase();
  const previewFlag = countryFlagEmoji(cc) || "🏳️";

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave(name.trim() || s.host, cc);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="server-card">
      <div className="server-card-top">
        <div className="server-card-flag-block" title={cc ? `Страна: ${cc}` : "Флаг не выбран"}>
          <span className="server-card-flag-emoji" aria-hidden>
            {previewFlag}
          </span>
        </div>
        <div className="server-card-fields">
          <label className="server-card-label">Название в подписке</label>
          <input
            className="server-card-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={s.host}
            disabled={disabled || saving}
          />
          <label className="server-card-label">Страна (флаг)</label>
          <select value={cc} onChange={(e) => setCc(e.target.value)} disabled={disabled || saving}>
            <option value="">Без флага</option>
            {COUNTRY_CODES_ALPHA2.map((code) => (
              <option key={code} value={code}>
                {countryFlagEmoji(code)} {code}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary server-card-save"
            disabled={disabled || saving || !dirty}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <>
                <Spinner /> Сохранение…
              </>
            ) : (
              "Сохранить имя и флаг"
            )}
          </button>
        </div>
      </div>

      <div className="server-card-meta mono">
        <div>
          {s.ssh_user}@{s.host}:{s.ssh_port}
        </div>
        <div>
          VLESS порт {s.vless_port}
          {s.vless_deployed ? (
            <span className="pill ok" style={{ marginLeft: "0.5rem" }}>
              развёрнут
            </span>
          ) : (
            <span className="pill" style={{ marginLeft: "0.5rem" }}>
              не развёрнут
            </span>
          )}
        </div>
        {s.vless_uuid ? <div className="server-card-uuid">{s.vless_uuid}</div> : null}
        {s.xray_config_path ? <div style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>{s.xray_config_path}</div> : null}
        <div style={{ marginTop: "0.35rem" }}>
          <span className={`pill ${s.last_ssh_ok ? "ok" : "bad"}`}>{s.last_ssh_ok ? "SSH OK" : "SSH не ок"}</span>
        </div>
        {s.last_error ? <div className="server-card-err">{s.last_error}</div> : null}
      </div>

      <div className="server-card-actions">{children}</div>
    </article>
  );
}
