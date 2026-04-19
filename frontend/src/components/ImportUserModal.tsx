import { useState } from "react";
import { importUserJson, importUserJsonStream, type NdjsonEvent } from "../api";
import LiveLogPanel, { type LogLine } from "./LiveLogPanel";
import Spinner from "./Spinner";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void>;
  onMessage: (msg: { type: "ok" | "err"; text: string }) => void;
};

export default function ImportUserModal({ open, onClose, onSuccess, onMessage }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "stream" | "plain">(null);
  const [activity, setActivity] = useState<{ title: string; lines: LogLine[] } | null>(null);

  if (!open) return null;

  function appendLog(line: string) {
    setActivity((a) =>
      a ? { ...a, lines: [...a.lines, { msg: line }] } : { title: "Импорт x-ui", lines: [{ msg: line }] },
    );
  }

  async function runImport(stream: boolean) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      onMessage({ type: "err", text: "Некорректный JSON." });
      return;
    }
    setBusy(stream ? "stream" : "plain");
    if (stream) setActivity({ title: "Импорт x-ui", lines: [] });
    try {
      if (stream) {
        await importUserJsonStream(parsed, (ev: NdjsonEvent) => {
          if (ev.type === "log") appendLog(ev.msg);
          else if (ev.type === "error") {
            appendLog(`Ошибка: ${ev.message}`);
            onMessage({ type: "err", text: ev.message });
          } else if (ev.type === "done" && ev.user) {
            appendLog(`Подписка: ${ev.user.subscription_url}`);
            onMessage({ type: "ok", text: `Импорт: «${ev.user.name}».` });
          }
        });
      } else {
        const { user } = await importUserJson(parsed);
        onMessage({ type: "ok", text: `Импорт: «${user.name}».` });
      }
      setText("");
      await onSuccess();
      onClose();
    } catch (e) {
      onMessage({ type: "err", text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  const importBusy = busy !== null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget && !importBusy) onClose();
      }}
    >
      <div className="modal modal-import" role="dialog" aria-labelledby="import-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="import-modal-title">Импорт клиента из x-ui</h2>
          <button type="button" className="modal-close ghost" onClick={() => !importBusy && onClose()} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="sub user-modal-hint" style={{ marginTop: 0 }}>
            Вставьте JSON одного inbound (экспорт панели): поля <span className="mono">settings</span> и{" "}
            <span className="mono">streamSettings</span> — строки JSON.
          </p>
          <textarea
            className="import-json-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="{ ... }"
            disabled={importBusy}
            rows={12}
          />
          {activity ? <LiveLogPanel title={activity.title} lines={activity.lines} /> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="ghost" disabled={importBusy} onClick={() => onClose()}>
            Закрыть
          </button>
          <button type="button" className="ghost" disabled={importBusy || !text.trim()} onClick={() => void runImport(true)}>
            {busy === "stream" ? (
              <>
                <Spinner /> Импорт…
              </>
            ) : (
              "Импорт с логом"
            )}
          </button>
          <button type="button" className="primary" disabled={importBusy || !text.trim()} onClick={() => void runImport(false)}>
            {busy === "plain" ? (
              <>
                <Spinner /> Импорт…
              </>
            ) : (
              "Импорт"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
