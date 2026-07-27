import type { CommunicationTargetDto } from "../../api";
import { subscriptionLabel } from "../../subscriptionLabel";
import ClientPickerModal from "../ClientPickerModal";

export type SegmentFormState = {
  name: string;
  userIds: number[];
  daysMode: "any" | "exact" | "range";
  daysExact: number;
  daysFrom: number;
  daysTo: number;
  gbMode: "any" | "exact" | "range";
  gbExact: number;
  gbFrom: number;
  gbTo: number;
  presetEnabled: boolean;
  presetText: string;
};

type Props = {
  form: SegmentFormState;
  onChange: (patch: Partial<SegmentFormState>) => void;
  busy: boolean;
  editingId: string;
  isSystem: boolean;
  chatReachable: CommunicationTargetDto[];
  pickerOpen: boolean;
  onPickerOpen: (open: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  onRefreshSystem?: () => void;
};

export default function SegmentEditor({
  form,
  onChange,
  busy,
  editingId,
  isSystem,
  chatReachable,
  pickerOpen,
  onPickerOpen,
  onSave,
  onCancel,
  onRefreshSystem,
}: Props) {
  const selectedUsers = chatReachable.filter((u) => form.userIds.includes(u.id));

  function insertToken(token: string) {
    onChange({
      presetEnabled: true,
      presetText: form.presetText.trim() ? `${form.presetText.trim()} ${token}` : token,
    });
  }

  return (
    <div className="comms-seg-editor">
      <section className="comms-wiz-card">
        <h2 className="comms-wiz-h2">{editingId ? "Редактирование сегмента" : "Новый сегмент"}</h2>
        <div className="form-field">
          <label>Название</label>
          <input
            className="comms-wiz-input"
            value={form.name}
            disabled={busy || isSystem}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Например: Подписка заканчивается"
          />
        </div>
      </section>

      <section className="comms-wiz-card">
        <h2 className="comms-wiz-h2">Фильтры</h2>

        <div className="comms-seg-filter-card">
          <div className="comms-seg-filter-head">Подписка</div>
          <select
            className="comms-wiz-input"
            value={form.daysMode}
            disabled={busy || isSystem}
            onChange={(e) => onChange({ daysMode: e.target.value as SegmentFormState["daysMode"] })}
          >
            <option value="any">Не фильтровать</option>
            <option value="exact">Заканчивается ровно через</option>
            <option value="range">Заканчивается в интервале</option>
          </select>
          {form.daysMode === "exact" ? (
            <label className="comms-seg-inline-field">
              <span>Дней</span>
              <input
                className="comms-wiz-input"
                inputMode="numeric"
                value={form.daysExact}
                disabled={busy || isSystem}
                onChange={(e) => onChange({ daysExact: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              />
            </label>
          ) : null}
          {form.daysMode === "range" ? (
            <div className="comms-range-row">
              <label className="comms-range-label">
                <span>От</span>
                <input
                  inputMode="numeric"
                  value={form.daysFrom}
                  disabled={busy || isSystem}
                  onChange={(e) => onChange({ daysFrom: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </label>
              <label className="comms-range-label">
                <span>До</span>
                <input
                  inputMode="numeric"
                  value={form.daysTo}
                  disabled={busy || isSystem}
                  onChange={(e) => onChange({ daysTo: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="comms-seg-filter-card">
          <div className="comms-seg-filter-head">Остаток ГБ</div>
          <select
            className="comms-wiz-input"
            value={form.gbMode}
            disabled={busy || isSystem}
            onChange={(e) => onChange({ gbMode: e.target.value as SegmentFormState["gbMode"] })}
          >
            <option value="any">Не фильтровать</option>
            <option value="exact">Ровно столько ГБ</option>
            <option value="range">Меньше / интервал</option>
          </select>
          {form.gbMode === "exact" ? (
            <label className="comms-seg-inline-field">
              <span>ГБ</span>
              <input
                className="comms-wiz-input"
                inputMode="numeric"
                value={form.gbExact}
                disabled={busy || isSystem}
                onChange={(e) => onChange({ gbExact: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              />
            </label>
          ) : null}
          {form.gbMode === "range" ? (
            <div className="comms-range-row">
              <label className="comms-range-label">
                <span>От</span>
                <input
                  inputMode="numeric"
                  value={form.gbFrom}
                  disabled={busy || isSystem}
                  onChange={(e) => onChange({ gbFrom: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </label>
              <label className="comms-range-label">
                <span>До</span>
                <input
                  inputMode="numeric"
                  value={form.gbTo}
                  disabled={busy || isSystem}
                  onChange={(e) => onChange({ gbTo: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="comms-seg-filter-card">
          <div className="comms-seg-filter-head">Пользователи</div>
          <p className="field-hint">Если пусто — все с чатом (с учётом фильтров выше)</p>
          <div className="comms-wiz-row">
            <button type="button" className="ghost" disabled={busy || isSystem} onClick={() => onPickerOpen(true)}>
              Выбор клиентов
            </button>
            <span className="field-hint">Выбрано: {form.userIds.length}</span>
          </div>
          {selectedUsers.length > 0 ? (
            <div className="comms-selected-chips">
              {selectedUsers.slice(0, 10).map((u) => (
                <span key={u.id} className="comms-chip">
                  {subscriptionLabel(u)}
                </span>
              ))}
              {selectedUsers.length > 10 ? <span className="comms-chip">+{selectedUsers.length - 10}</span> : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="comms-wiz-card">
        <h2 className="comms-wiz-h2">Автотекст</h2>
        <div className="survey-segmented comms-seg-autotext-toggle" role="group" aria-label="Автотекст">
          <button
            type="button"
            className={`survey-segmented-btn${!form.presetEnabled ? " active" : ""}`}
            disabled={busy || isSystem}
            onClick={() => onChange({ presetEnabled: false })}
          >
            Выкл
          </button>
          <button
            type="button"
            className={`survey-segmented-btn${form.presetEnabled ? " active" : ""}`}
            disabled={busy || isSystem}
            onClick={() => onChange({ presetEnabled: true })}
          >
            Вкл
          </button>
        </div>
        {form.presetEnabled ? (
          <>
            <textarea
              className="comms-textarea comms-wiz-textarea"
              style={{ minHeight: "100px", marginTop: "0.75rem" }}
              disabled={busy || isSystem}
              value={form.presetText}
              onChange={(e) => onChange({ presetText: e.target.value })}
              placeholder="Текст подставится при выборе сегмента в рассылке"
            />
            <p className="field-hint">
              Плейсхолдеры: <code>{"{days_before_end}"}</code>, <code>{"{gb_before_end}"}</code>
            </p>
            <div className="comms-wiz-btn-chips" style={{ marginTop: "0.5rem" }}>
              <button type="button" className="comms-wiz-btn-chip" disabled={busy || isSystem} onClick={() => insertToken("{days_before_end}")}>
                + {"{days_before_end}"}
              </button>
              <button type="button" className="comms-wiz-btn-chip" disabled={busy || isSystem} onClick={() => insertToken("{gb_before_end}")}>
                + {"{gb_before_end}"}
              </button>
            </div>
          </>
        ) : null}
      </section>

      <div className="comms-seg-editor-actions">
        {isSystem && onRefreshSystem ? (
          <button type="button" className="ghost" disabled={busy} onClick={onRefreshSystem}>
            Обновить список
          </button>
        ) : null}
        {!isSystem ? (
          <button type="button" className="primary" disabled={busy} onClick={onSave}>
            {busy ? "Сохранение…" : editingId ? "Сохранить" : "Создать сегмент"}
          </button>
        ) : null}
        {editingId ? (
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
            Отмена
          </button>
        ) : null}
      </div>

      <ClientPickerModal
        open={pickerOpen}
        users={chatReachable}
        selectedIds={form.userIds}
        onClose={() => onPickerOpen(false)}
        onConfirm={(ids) => {
          onChange({ userIds: ids });
          onPickerOpen(false);
        }}
      />
    </div>
  );
}
