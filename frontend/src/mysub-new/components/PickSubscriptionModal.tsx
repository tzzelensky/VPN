import { subscriptionLabel } from "../../subscriptionLabel";
import type { MySubProfileDto } from "../../api";
import type { MySubTheme } from "../types";
import MySubModalBackdrop from "./MySubModalBackdrop";
import PrimaryButton from "./PrimaryButton";
import SecondaryButton from "./SecondaryButton";

type Props = {
  open: boolean;
  theme: MySubTheme;
  subscriptions: MySubProfileDto["subscriptions"];
  pickedSubId: number;
  onPick: (id: number) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export default function PickSubscriptionModal({
  open,
  theme,
  subscriptions,
  pickedSubId,
  onPick,
  onClose,
  onConfirm,
}: Props) {
  return (
    <MySubModalBackdrop open={open} theme={theme} onClose={onClose}>
      <div className="mn-modal mn-modal--solid" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="mn-modal__head">
          <h2>Выбор подписки</h2>
          <button type="button" className="mn-modal__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="mn-modal__body">
          <div className="mn-stack">
            {subscriptions.map((s) => (
              <SecondaryButton
                key={s.id}
                fullWidth
                className={pickedSubId === s.id ? "mn-selected-outline" : ""}
                onClick={() => onPick(s.id)}
              >
                {subscriptionLabel(s)}
              </SecondaryButton>
            ))}
          </div>
        </div>
        <div className="mn-modal__foot">
          <PrimaryButton fullWidth onClick={onConfirm}>
            Скопировать ссылку
          </PrimaryButton>
        </div>
      </div>
    </MySubModalBackdrop>
  );
}
