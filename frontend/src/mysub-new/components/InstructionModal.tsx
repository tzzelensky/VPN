import { createPortal } from "react-dom";
import PrimaryButton from "./PrimaryButton";
import SecondaryButton from "./SecondaryButton";
import type { MySubTheme } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCopyLink?: () => void;
  copyUrl?: string;
  theme: MySubTheme;
};

export default function InstructionModal({ open, onClose, onCopyLink, copyUrl, theme }: Props) {
  if (!open) return null;

  const light = theme === "light";

  return createPortal(
    <div
      className={`mn-modal-backdrop mn-modal-backdrop--portal mn-app mn-app--${theme}${light ? " mysub-wrap--light" : ""}`}
      onClick={onClose}
    >
      <div className="mn-modal mn-modal--solid" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mn-modal__head">
          <h2>Инструкция по подключению</h2>
          <button type="button" className="mn-modal__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="mn-modal__body">
          <ol className="mn-steps">
            <li>Скопируйте ссылку VPN.</li>
            <li>Откройте Happ / V2Ray.</li>
            <li>Добавьте подписку по ссылке.</li>
            <li>Нажмите «Обновить».</li>
            <li>Подключитесь к серверу.</li>
          </ol>
          <p className="mn-muted">Также можно использовать V2rayTun или V2rayBox.</p>
        </div>
        <div className="mn-modal__foot mn-modal__foot--stack">
          {copyUrl && onCopyLink ? (
            <SecondaryButton fullWidth onClick={onCopyLink}>
              Скопировать ссылку
            </SecondaryButton>
          ) : null}
          <PrimaryButton fullWidth onClick={onClose}>
            Понятно
          </PrimaryButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
