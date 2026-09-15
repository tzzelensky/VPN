import { useEffect, useState, type ReactNode, type SVGProps } from "react";
import { improveCommunicationText } from "../../api";
import AdminModalBackdrop from "../AdminModalBackdrop";
import Spinner from "../Spinner";
import { MESSAGE_BUTTON_OPTIONS, type MessageButtonId } from "./commsTypes";

type Props = {
  busy: boolean;
  title: string;
  onTitleChange: (v: string) => void;
  text: string;
  onTextChange: (v: string) => void;
  photo: File | null;
  onPhotoChange: (file: File | null) => void;
  markEnabled: boolean;
  onMarkEnabledChange: (v: boolean) => void;
  markText: string;
  onMarkTextChange: (v: string) => void;
  buttons: MessageButtonId[];
  onButtonsChange: (buttons: MessageButtonId[]) => void;
};

function IconSparkle(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden {...p}>
      <path d="M12 3l1.15 4.55L18 8.7l-4.85 1.15L12 14.4l-1.15-4.55L6 8.7l4.85-1.15L12 3z" />
      <path d="M19.2 14.2l.55 2.15L22 16.9l-2.25.55L19.2 19.6l-.55-2.15L16.4 16.9l2.25-.55.55-2.15z" />
    </svg>
  );
}

function IconUpload(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden {...p}>
      <path d="M12 16.2V7.2" />
      <path d="M8.4 10.6L12 7l3.6 3.6" />
      <path d="M6.2 17.4v1.1A1.5 1.5 0 007.7 20h8.6a1.5 1.5 0 001.5-1.5v-1.1" />
    </svg>
  );
}

function IconClipboard(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden {...p}>
      <rect x="7" y="5.2" width="10" height="13.6" rx="2" />
      <path d="M9.2 5.2h5.6v2.3H9.2z" />
    </svg>
  );
}

function IconClose(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  );
}

function AiChip({
  label,
  disabled,
  busy = false,
  expand = "right",
  tone = "accent",
  file,
  onFile,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  busy?: boolean;
  expand?: "left" | "right";
  tone?: "accent" | "danger";
  file?: boolean;
  onFile?: (file: File) => void;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className = [
    "comms-wiz-ai-chip",
    `comms-wiz-ai-chip--${expand}`,
    `comms-wiz-ai-chip--${tone}`,
    busy ? "is-busy" : "",
    disabled ? "is-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inner = (
    <>
      <span className="comms-wiz-ai-chip-ico">{busy ? <Spinner /> : children}</span>
      <span className="comms-wiz-ai-chip-label">{label}</span>
    </>
  );
  if (file) {
    return (
      <label className={className} aria-label={label}>
        <input
          type="file"
          accept="image/*"
          disabled={disabled}
          className="comms-file-input"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) onFile?.(picked);
          }}
        />
        {inner}
      </label>
    );
  }
  return (
    <button type="button" className={className} disabled={disabled} aria-label={label} onClick={onClick}>
      {inner}
    </button>
  );
}

function fileFromClipboardBlob(blob: Blob): File {
  const type = blob.type || "image/png";
  const ext = type.includes("jpeg") || type.includes("jpg") ? "jpg" : type.includes("webp") ? "webp" : "png";
  return new File([blob], `clipboard-photo.${ext}`, { type });
}

export default function MessageComposer({
  busy,
  title,
  onTitleChange,
  text,
  onTextChange,
  photo,
  onPhotoChange,
  markEnabled,
  onMarkEnabledChange,
  markText,
  onMarkTextChange,
  buttons,
  onButtonsChange,
}: Props) {
  const [aiBusy, setAiBusy] = useState(false);
  const [textBeforeAi, setTextBeforeAi] = useState<string | null>(null);
  const [aiError, setAiError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      setPhotoOpen(false);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (busy) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const fromFiles = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      const fromItems = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
      const next = fromFiles ?? fromItems;
      if (!next) return;
      e.preventDefault();
      applyPhoto(next);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy]);

  function applyPhoto(file: File) {
    setPhotoError("");
    onPhotoChange(file);
    setPhotoOpen(true);
  }

  function toggleButton(id: MessageButtonId) {
    onButtonsChange(buttons.includes(id) ? buttons.filter((x) => x !== id) : [...buttons, id]);
  }

  async function runImprove() {
    const draft = text.trim();
    if (!draft || busy || aiBusy) return;
    setAiError("");
    setAiBusy(true);
    const snapshot = text;
    try {
      const { improved } = await improveCommunicationText(draft);
      const next = improved.trim();
      if (!next) {
        setAiError("ИИ вернул пустой текст.");
        return;
      }
      setTextBeforeAi(snapshot);
      onTextChange(next);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  async function runPasteClipboard() {
    if (busy) return;
    setPhotoError("");
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith("image/"));
          if (!type) continue;
          applyPhoto(fileFromClipboardBlob(await item.getType(type)));
          return;
        }
        setPhotoError("В буфере обмена нет изображения.");
        return;
      }
      setPhotoError("Этот браузер не читает картинки из буфера по кнопке. Нажмите Ctrl+V.");
    } catch {
      setPhotoError("Не удалось прочитать буфер. Разрешите доступ или нажмите Ctrl+V.");
    }
  }

  const canRevert = textBeforeAi != null && text !== textBeforeAi;

  return (
    <div className="comms-wiz-compose-stack">
      <section className="comms-wiz-card">
        <h2 className="comms-wiz-h2">Сообщение</h2>

        <div className="form-field">
          <label>Название</label>
          <input
            className="comms-wiz-input"
            value={title}
            disabled={busy}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Например: Обновление серверов"
          />
          <p className="field-hint">Только для вас в сводке отправки — в Telegram не уходит.</p>
        </div>

        <div className="form-field">
          <div className="shop-toggle-row">
            <div>
              <label>Заголовок сообщения</label>
              <p className="field-hint" style={{ marginTop: "0.2rem" }}>
                Жирная строка над текстом в Telegram
              </p>
            </div>
            <button
              type="button"
              className={`toggle ${markEnabled ? "on" : ""}`}
              aria-pressed={markEnabled}
              disabled={busy}
              onClick={() => onMarkEnabledChange(!markEnabled)}
            />
          </div>
          {markEnabled ? (
            <input
              className="comms-wiz-input"
              value={markText}
              disabled={busy}
              onChange={(e) => onMarkTextChange(e.target.value)}
              placeholder="Заголовок сообщения"
            />
          ) : null}
        </div>

        <div className="form-field">
          <label>Текст</label>
          <div className="comms-wiz-textarea-wrap">
            <textarea
              className="comms-textarea comms-wiz-textarea"
              value={text}
              disabled={busy || aiBusy}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="Введите сообщение для отправки…"
            />
            <AiChip
              label="Улучшить текст"
              expand="left"
              busy={aiBusy}
              disabled={busy || aiBusy || !text.trim()}
              onClick={() => void runImprove()}
            >
              <IconSparkle />
            </AiChip>
          </div>
          {canRevert ? (
            <button
              type="button"
              className="ghost btn-sm comms-wiz-ai-revert"
              disabled={busy || aiBusy}
              onClick={() => {
                if (textBeforeAi != null) onTextChange(textBeforeAi);
              }}
            >
              Вернуть до обработки
            </button>
          ) : null}
          {aiError ? <p className="field-hint err">{aiError}</p> : null}
        </div>

        <div className="form-field">
          <label>Фото</label>
          <div className="comms-file-row">
            <AiChip
              file
              label="Загрузить фото"
              disabled={busy}
              onFile={applyPhoto}
            >
              <IconUpload />
            </AiChip>
            <AiChip
              label="Загрузить фото из буфера обмена"
              disabled={busy}
              onClick={() => void runPasteClipboard()}
            >
              <IconClipboard />
            </AiChip>
            {photo ? (
              <AiChip
                label="Удалить фото"
                tone="danger"
                disabled={busy}
                onClick={() => onPhotoChange(null)}
              >
                <IconClose />
              </AiChip>
            ) : null}
          </div>
          {photo && photoUrl ? (
            <button
              type="button"
              className="comms-wiz-photo-open"
              disabled={busy}
              onClick={() => setPhotoOpen(true)}
            >
              <img src={photoUrl} alt="" />
              <span>{photo.name}</span>
            </button>
          ) : (
            <span className="comms-file-name">Не выбрано</span>
          )}
          {photoError ? <p className="field-hint err">{photoError}</p> : null}
        </div>
      </section>

      <section className="comms-wiz-card">
        <h2 className="comms-wiz-h2">Кнопки</h2>
        <p className="comms-wiz-hint">Добавьте inline-кнопки под сообщением</p>

        {buttons.length > 0 ? (
          <div className="comms-wiz-btn-chips">
            {buttons.map((id) => {
              const opt = MESSAGE_BUTTON_OPTIONS.find((b) => b.id === id);
              return (
                <span key={id} className="comms-wiz-btn-chip is-on">
                  ✓ {opt?.short ?? id}
                  <button
                    type="button"
                    className="comms-wiz-btn-chip-x"
                    aria-label={`Убрать ${opt?.label ?? id}`}
                    disabled={busy}
                    onClick={() => toggleButton(id)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}

        <div className="comms-wiz-btn-add">
          <span className="field-hint">Добавить кнопку</span>
          <div className="comms-wiz-btn-chips">
            {MESSAGE_BUTTON_OPTIONS.filter((b) => !buttons.includes(b.id)).map((b) => (
              <button
                key={b.id}
                type="button"
                className="comms-wiz-btn-chip"
                disabled={busy}
                onClick={() => toggleButton(b.id)}
              >
                + {b.short}
              </button>
            ))}
          </div>
        </div>
      </section>

      {photoOpen && photoUrl ? (
        <AdminModalBackdrop className="comms-photo-modal-backdrop" onClose={() => setPhotoOpen(false)}>
          <div
            className="modal comms-photo-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Фото рассылки"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>Фото</h3>
              <button
                type="button"
                className="ghost modal-close"
                aria-label="Закрыть"
                onClick={() => setPhotoOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body comms-photo-modal-body">
              <img src={photoUrl} alt={photo?.name || "Фото рассылки"} className="comms-photo-modal-img" />
            </div>
          </div>
        </AdminModalBackdrop>
      ) : null}
    </div>
  );
}
