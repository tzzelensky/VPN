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
  function toggleButton(id: MessageButtonId) {
    onButtonsChange(buttons.includes(id) ? buttons.filter((x) => x !== id) : [...buttons, id]);
  }

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
          <label>Текст</label>
          <textarea
            className="comms-textarea comms-wiz-textarea"
            value={text}
            disabled={busy}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Введите сообщение для отправки…"
          />
        </div>

        <div className="form-field">
          <label>Фото</label>
          <div className="comms-file-row">
            <label className={`ghost comms-file-btn ${busy ? "disabled" : ""}`}>
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                className="comms-file-input"
                onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
              />
              Загрузить
            </label>
            {photo ? (
              <button type="button" className="ghost" disabled={busy} onClick={() => onPhotoChange(null)}>
                Убрать
              </button>
            ) : null}
            <span className="comms-file-name">{photo ? photo.name : "Не выбрано"}</span>
          </div>
        </div>

        <div className="form-field">
          <div className="shop-toggle-row">
            <div>
              <label>Пометка администратора</label>
              <p className="field-hint" style={{ marginTop: "0.2rem" }}>
                Строка над текстом в Telegram
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
              placeholder="Сообщение от администратора"
            />
          ) : null}
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
    </div>
  );
}
