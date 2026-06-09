import { FormEvent, useEffect, useState } from "react";

type Props = {
  open: boolean;
  /** Режим редактирования: предзаполнить поле и сохранить с тем же id. */
  editLink?: { id: string; uri: string } | null;
  onClose: () => void;
  onSave: (uri: string, editId?: string) => void;
};

export default function AddVlessKeyModal({ open, editLink, onClose, onSave }: Props) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const isEdit = Boolean(editLink?.id);

  useEffect(() => {
    if (!open) {
      setText("");
      setErr(null);
      return;
    }
    setText(editLink?.uri ?? "");
    setErr(null);
  }, [open, editLink?.id, editLink?.uri]);

  if (!open) return null;

  function validateUri(raw: string): string | null {
    const s = raw.trim();
    if (!s) return "Вставьте VLESS-ссылку.";
    if (!/^vless:\/\//i.test(s)) return "Ссылка должна начинаться с vless://";
    try {
      const u = new URL(s);
      if (u.protocol !== "vless:" || !u.hostname) return "Некорректный формат VLESS URL.";
    } catch {
      return "Не удалось разобрать ссылку.";
    }
    return null;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const line = text.trim().split(/\r?\n/).find((l) => l.trim().startsWith("vless://")) ?? text.trim();
    const v = validateUri(line);
    if (v) {
      setErr(v);
      return;
    }
    onSave(line.trim(), editLink?.id);
    onClose();
  }

  return (
    <div
      className="modal-backdrop modal-backdrop--nested"
      role="presentation"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div className="modal modal--sm" role="dialog" aria-labelledby="add-vless-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="add-vless-title">{isEdit ? "Редактировать VLESS ключ" : "Добавить VLESS ключ"}</h2>
          <button type="button" className="modal-close ghost" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <form className="modal-body stack-sm" onSubmit={submit}>
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
            {isEdit
              ? "Измените ссылку vless://… — после сохранения карточки клиента она попадёт в подписку."
              : "Вставьте готовую ссылку vless://… — она появится в подписке клиента вместе с узлами панели."}
          </p>
          <label className="field">
            <span className="field-label">VLESS ключ</span>
            <textarea
              className="mono"
              rows={5}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setErr(null);
              }}
              placeholder="vless://uuid@host:port?type=tcp&security=reality&..."
              spellCheck={false}
            />
          </label>
          {err ? <p className="err-text" style={{ margin: 0 }}>{err}</p> : null}
          <div className="modal-footer" style={{ padding: 0, border: 0 }}>
            <button type="button" className="ghost" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="primary">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
