import { useEffect, useMemo, useState } from "react";
import { subscriptionLabel } from "../subscriptionLabel";

export type ClientPickerUser = {
  id: number;
  name: string;
  tg_id?: string;
};

type Props = {
  open: boolean;
  users: ClientPickerUser[];
  selectedIds: number[];
  onClose: () => void;
  onConfirm: (ids: number[]) => void;
  formatLabel?: (user: ClientPickerUser) => string;
};

export default function ClientPickerModal({
  open,
  users,
  selectedIds,
  onClose,
  onConfirm,
  formatLabel,
}: Props) {
  const label = formatLabel ?? ((u) => subscriptionLabel(u));
  const [pickerLeft, setPickerLeft] = useState<number[]>([]);
  const [pickerRight, setPickerRight] = useState<number[]>([]);
  const [query, setQuery] = useState("");

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  useEffect(() => {
    if (!open) return;
    const chosen = selectedIds.filter((id) => usersById.has(id));
    const chosenSet = new Set(chosen);
    const left = users.map((u) => u.id).filter((id) => !chosenSet.has(id));
    setPickerRight(chosen);
    setPickerLeft(left);
    setQuery("");
  }, [open, selectedIds, users, usersById]);

  const pickerLeftList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = pickerLeft.map((id) => usersById.get(id)).filter((x): x is ClientPickerUser => Boolean(x));
    if (!q) return rows;
    return rows.filter((u) => `${u.id} ${u.name} ${u.tg_id ?? ""}`.toLowerCase().includes(q));
  }, [pickerLeft, usersById, query]);

  const pickerRightList = useMemo(() => {
    return pickerRight.map((id) => usersById.get(id)).filter((x): x is ClientPickerUser => Boolean(x));
  }, [pickerRight, usersById]);

  function moveToRight(ids: number[]) {
    const s = new Set(ids);
    if (s.size === 0) return;
    setPickerLeft((prev) => prev.filter((id) => !s.has(id)));
    setPickerRight((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
  }

  function moveToLeft(ids: number[]) {
    const s = new Set(ids);
    if (s.size === 0) return;
    setPickerRight((prev) => prev.filter((id) => !s.has(id)));
    setPickerLeft((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]);
  }

  function save() {
    onConfirm(pickerRight.filter((id) => usersById.has(id)));
    onClose();
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal comms-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Выбор клиентов</h2>
          <button type="button" className="ghost modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="comms-picker-search"
          />
          <div className="comms-picker-grid">
            <div className="comms-picker-col">
              <label>Доступные клиенты</label>
              <select
                multiple
                size={14}
                className="comms-picker-list"
                onChange={(e) => {
                  const ids = Array.from(e.currentTarget.selectedOptions).map((o) => Number(o.value));
                  moveToRight(ids);
                }}
              >
                {pickerLeftList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {label(u)}
                  </option>
                ))}
              </select>
            </div>
            <div className="comms-picker-actions">
              <button type="button" className="ghost" onClick={() => moveToRight(pickerLeftList.map((u) => u.id))}>
                {">>"}
              </button>
              <button type="button" className="ghost" onClick={() => moveToLeft(pickerRightList.map((u) => u.id))}>
                {"<<"}
              </button>
            </div>
            <div className="comms-picker-col">
              <label>Выбранные клиенты</label>
              <select
                multiple
                size={14}
                className="comms-picker-list"
                onChange={(e) => {
                  const ids = Array.from(e.currentTarget.selectedOptions).map((o) => Number(o.value));
                  moveToLeft(ids);
                }}
              >
                {pickerRightList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {label(u)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="primary" onClick={save}>
            Ок
          </button>
        </div>
      </div>
    </div>
  );
}
