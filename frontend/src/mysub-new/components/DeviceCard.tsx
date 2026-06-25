import type { MySubDevicesInfoDto } from "../../api";
import SecondaryButton from "./SecondaryButton";
import PrimaryButton from "./PrimaryButton";
import Card from "./Card";

type Device = MySubDevicesInfoDto["devices"][number];

type Props = {
  device: Device;
  purchasePriceRub?: number;
  onRename: () => void;
  onRemove: () => void;
  onAddSlot?: () => void;
};

function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (sameDay) return "сегодня";
  return d.toLocaleDateString("ru-RU");
}

export default function DeviceCard({ device, purchasePriceRub, onRename, onRemove, onAddSlot }: Props) {
  const disabled = device.status === "over_limit";

  if (disabled) {
    return (
      <Card className="mn-device-card mn-device-card--disabled" padding="compact">
        <div className="mn-device-card__status-row">
          <span className="mn-device-card__badge mn-device-card__badge--warn">Отключено</span>
          <span className="mn-device-card__status-hint">Превышен лимит</span>
        </div>
        <div className="mn-device-card__head">
          <span className="mn-device-card__icon mn-device-card__icon--muted">{device.device_icon || "📱"}</span>
          <div>
            <strong className="mn-device-card__name--muted">{device.device_name}</strong>
            <p className="mn-muted">Последняя активность: {formatLastSeen(device.last_seen_at)}</p>
          </div>
        </div>
        <p className="mn-device-card__disabled-text">
          Это устройство отключено из‑за снижения лимита. Удалите его или добавьте место, чтобы снова подключиться.
        </p>
        <div className="mn-device-card__actions mn-device-card__actions--disabled">
          <button type="button" className="mn-link-danger" onClick={onRemove}>
            Удалить устройство
          </button>
          {onAddSlot && purchasePriceRub ? (
            <PrimaryButton onClick={onAddSlot}>Добавить место · {purchasePriceRub} ₽</PrimaryButton>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card className="mn-device-card" padding="compact">
      <div className="mn-device-card__head">
        <span className="mn-device-card__icon">{device.device_icon || "📱"}</span>
        <div>
          <strong>{device.device_name}</strong>
          <p className="mn-muted">Последняя активность: {formatLastSeen(device.last_seen_at)}</p>
        </div>
      </div>
      <div className="mn-device-card__actions">
        <SecondaryButton onClick={onRename}>Переименовать</SecondaryButton>
        <button type="button" className="mn-link-danger" onClick={onRemove}>
          Удалить
        </button>
      </div>
    </Card>
  );
}
