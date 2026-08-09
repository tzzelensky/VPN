import { useEffect, useState } from "react";
import AdminModalBackdrop from "../AdminModalBackdrop";
import { buttonLabel, type MessageButtonId } from "./commsTypes";

type Props = {
  busy: boolean;
  recipientCount: number;
  hasPhoto: boolean;
  buttonCount: number;
  title: string;
  text: string;
  photo: File | null;
  buttons: MessageButtonId[];
  markEnabled: boolean;
  markText: string;
  canSend: boolean;
  needsConfirm: boolean;
  confirmOpen: boolean;
  onRequestSend: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
};

function recipientsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "пользователю";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "пользователям";
  return "пользователям";
}

export default function SendConfirmBar({
  busy,
  recipientCount,
  hasPhoto,
  buttonCount,
  title,
  text,
  photo,
  buttons,
  markEnabled,
  markText,
  canSend,
  needsConfirm,
  confirmOpen,
  onRequestSend,
  onConfirm,
  onCancelConfirm,
}: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const showPreviewBlock = hasPhoto || text.trim().length > 160;

  useEffect(() => {
    if (!confirmOpen) setPreviewOpen(false);
  }, [confirmOpen]);

  useEffect(() => {
    if (!photo || !confirmOpen) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo, confirmOpen]);

  return (
    <>
      <section className="comms-wiz-card comms-wiz-send">
        <div className="comms-wiz-send-row">
          <div className="comms-wiz-send-main">
            <h2 className="comms-wiz-h2">Отправка</h2>
            <div className="comms-wiz-send-hero">
              <span className="comms-wiz-send-hero-label">Будет отправлено</span>
              <strong className="comms-wiz-send-hero-count">
                {recipientCount} {recipientsLabel(recipientCount)}
              </strong>
            </div>
            <ul className="comms-wiz-props">
              <li>
                <span>Название</span>
                <span>{title.trim() || "—"}</span>
              </li>
              <li>
                <span>Фото</span>
                <span>{hasPhoto ? "Есть" : "Нет"}</span>
              </li>
              <li>
                <span>Кнопок</span>
                <span>{buttonCount}</span>
              </li>
            </ul>
          </div>
          <div className="comms-wiz-send-actions">
            <button type="button" className="primary" disabled={busy || !canSend} onClick={onRequestSend}>
              {busy ? "Отправка…" : "Отправить"}
            </button>
          </div>
        </div>
      </section>

      {confirmOpen && needsConfirm ? (
        <AdminModalBackdrop onClose={onCancelConfirm}>
          <div
            className="modal comms-wiz-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="comms-wiz-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="comms-wiz-confirm-title" className="comms-wiz-confirm-title">
              Подтверждение отправки
            </h3>

            <div className="comms-wiz-confirm-hero">
              <span className="comms-wiz-confirm-hero-label">Будет отправлено</span>
              <strong className="comms-wiz-confirm-hero-count">
                {recipientCount} {recipientsLabel(recipientCount)}
              </strong>
            </div>

            {recipientCount > 100 ? (
              <p className="comms-wiz-confirm-warn" role="alert">
                Сообщение будет отправлено {recipientCount} пользователям. После отправки отменить
                рассылку будет невозможно.
              </p>
            ) : (
              <p className="comms-wiz-confirm-note">После отправки отменить рассылку будет невозможно.</p>
            )}

            <ul className="comms-wiz-props">
              <li>
                <span>Название</span>
                <span>{title.trim() || "—"}</span>
              </li>
              <li>
                <span>Фото</span>
                <span>{hasPhoto ? "Есть" : "Нет"}</span>
              </li>
              <li>
                <span>Кнопок</span>
                <span>{buttonCount}</span>
              </li>
            </ul>

            {showPreviewBlock ? (
              <div className="comms-wiz-confirm-preview-wrap">
                <button
                  type="button"
                  className="comms-wiz-confirm-preview-toggle"
                  aria-expanded={previewOpen}
                  onClick={() => setPreviewOpen((v) => !v)}
                >
                  {previewOpen ? "▼" : "▶"} Предпросмотр сообщения
                </button>
                {previewOpen ? (
                  <div className="comms-tg-preview comms-tg-preview--compact">
                    <div className="comms-tg-preview__bubble">
                      {photoUrl ? <img className="comms-tg-preview__photo" src={photoUrl} alt="" /> : null}
                      {markEnabled && markText.trim() ? (
                        <div className="comms-tg-preview__mark">{markText.trim()}</div>
                      ) : null}
                      {text.trim() ? (
                        <div className="comms-tg-preview__text">{text.trim()}</div>
                      ) : null}
                      {buttons.length > 0 ? (
                        <div className="comms-tg-preview__buttons">
                          {buttons.map((id) => (
                            <span key={id} className="comms-tg-preview__btn">
                              {buttonLabel(id)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="comms-wiz-confirm-actions">
              <button type="button" className="ghost" disabled={busy} onClick={onCancelConfirm}>
                Отмена
              </button>
              <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
                {busy ? "Отправка…" : "Отправить"}
              </button>
            </div>
          </div>
        </AdminModalBackdrop>
      ) : null}
    </>
  );
}
