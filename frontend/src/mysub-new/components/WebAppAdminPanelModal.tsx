import MySubModalBackdrop from "./MySubModalBackdrop";
import PrimaryButton from "./PrimaryButton";
import SecondaryButton from "./SecondaryButton";
import type { MySubTheme } from "../types";

type Props = {
  open: boolean;
  busy: boolean;
  theme: MySubTheme;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function WebAppAdminPanelModal({ open, busy, theme, onConfirm, onCancel }: Props) {
  return (
    <MySubModalBackdrop open={open} theme={theme} onClose={onCancel} closeOnBackdrop={!busy}>
      <div className="mn-modal mn-modal--solid" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mn-modal__head">
          <h2>Панель управления</h2>
        </div>
        <div className="mn-modal__body">
          <p className="mn-muted" style={{ margin: 0 }}>
            Перейти в панель управления?
          </p>
        </div>
        <div className="mn-modal__foot mn-modal__foot--split">
          <SecondaryButton disabled={busy} onClick={onCancel}>
            Нет
          </SecondaryButton>
          <PrimaryButton disabled={busy} onClick={onConfirm}>
            {busy ? "Входим…" : "Да"}
          </PrimaryButton>
        </div>
      </div>
    </MySubModalBackdrop>
  );
}
