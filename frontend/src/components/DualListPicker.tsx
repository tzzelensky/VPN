import { useEffect, useMemo, useRef, useState } from "react";

export type DualListItem = { id: number; label: string };

type Props = {
  open: boolean;
  title: string;
  leftLabel: string;
  rightLabel: string;
  items: DualListItem[];
  selectedIds: number[];
  /** Всегда справа, нельзя убрать (например купившие продукт). */
  lockedRightIds?: number[];
  /** Блокировать «Ок», если справа никого не выбрано. */
  requireSelection?: boolean;
  onClose: () => void;
  onSave: (ids: number[]) => void;
};

export default function DualListPicker({
  open,
  title,
  leftLabel,
  rightLabel,
  items,
  selectedIds,
  lockedRightIds = [],
  requireSelection = false,
  onClose,
  onSave,
}: Props) {
  const [pickerLeft, setPickerLeft] = useState<number[]>([]);
  const [pickerRight, setPickerRight] = useState<number[]>([]);
  const [leftSel, setLeftSel] = useState<number[]>([]);
  const [rightSel, setRightSel] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const initializedForOpen = useRef(false);

  const byId = useMemo(() => new Map(items.map((x) => [x.id, x])), [items]);

  const lockedSet = useMemo(
    () => new Set((lockedRightIds ?? []).filter((id) => byId.has(id))),
    [lockedRightIds, byId],
  );

  useEffect(() => {
    if (!open) {
      initializedForOpen.current = false;
      return;
    }
    if (initializedForOpen.current) return;
    initializedForOpen.current = true;

    const chosen = selectedIds.filter((id) => byId.has(id) && !lockedSet.has(id));
    const right = [...new Set([...chosen, ...lockedSet])];
    const rightSet = new Set(right);
    const left = items.map((x) => x.id).filter((id) => !rightSet.has(id));
    setPickerRight(right);
    setPickerLeft(left);
    setLeftSel([]);
    setRightSel([]);
    setQuery("");
  }, [open, selectedIds, items, byId, lockedSet]);

  const q = query.trim().toLowerCase();
  const match = (label: string) => !q || label.toLowerCase().includes(q);

  const pickerLeftList = useMemo(() => {
    const rows: DualListItem[] = [];
    for (const id of pickerLeft) {
      const row = byId.get(id);
      if (row && match(row.label)) rows.push(row);
    }
    return rows;
  }, [pickerLeft, byId, q]);

  const pickerRightList = useMemo(() => {
    const rows: DualListItem[] = [];
    for (const id of pickerRight) {
      const row = byId.get(id);
      if (row && match(row.label)) rows.push(row);
    }
    return rows;
  }, [pickerRight, byId, q]);

  function moveToRight(ids: number[]) {
    const s = new Set(ids.filter((id) => byId.has(id)));
    if (s.size === 0) return;
    setPickerLeft((prev) => prev.filter((id) => !s.has(id)));
    setPickerRight((prev) => [...prev, ...[...s].filter((id) => !prev.includes(id))]);
    setLeftSel((prev) => prev.filter((id) => !s.has(id)));
  }

  function moveToLeft(ids: number[]) {
    const movable = ids.filter((id) => byId.has(id) && !lockedSet.has(id));
    const s = new Set(movable);
    if (s.size === 0) return;
    setPickerRight((prev) => prev.filter((id) => !s.has(id)));
    setPickerLeft((prev) => [...prev, ...movable.filter((id) => !prev.includes(id))]);
    setRightSel((prev) => prev.filter((id) => !s.has(id)));
  }

  function moveRightSelection() {
    const ids = leftSel.length > 0 ? leftSel : pickerLeftList.map((r) => r.id);
    moveToRight(ids);
  }

  function moveLeftSelection() {
    const ids = rightSel.length > 0 ? rightSel : pickerRightList.map((r) => r.id);
    moveToLeft(ids);
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal comms-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
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
              <label>{leftLabel}</label>
              <select
                multiple
                size={14}
                className="comms-picker-list"
                value={leftSel.map(String)}
                onChange={(e) => {
                  setLeftSel(Array.from(e.currentTarget.selectedOptions).map((o) => Number(o.value)));
                }}
                onDoubleClick={(e) => {
                  const id = Number((e.target as HTMLOptionElement).value);
                  if (Number.isFinite(id) && id > 0) moveToRight([id]);
                }}
              >
                {pickerLeftList.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="comms-picker-actions">
              <button type="button" className="ghost" title="Добавить выбранных" onClick={moveRightSelection}>
                {">>"}
              </button>
              <button type="button" className="ghost" title="Убрать выбранных" onClick={moveLeftSelection}>
                {"<<"}
              </button>
            </div>
            <div className="comms-picker-col">
              <label>{rightLabel}</label>
              <select
                multiple
                size={14}
                className="comms-picker-list"
                value={rightSel.map(String)}
                onChange={(e) => {
                  setRightSel(Array.from(e.currentTarget.selectedOptions).map((o) => Number(o.value)));
                }}
                onDoubleClick={(e) => {
                  const id = Number((e.target as HTMLOptionElement).value);
                  if (Number.isFinite(id) && id > 0 && !lockedSet.has(id)) moveToLeft([id]);
                }}
              >
                {pickerRightList.map((row) => (
                  <option key={row.id} value={row.id} disabled={lockedSet.has(row.id)}>
                    {row.label}
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
          <button
            type="button"
            className="primary"
            disabled={requireSelection && pickerRight.length === 0}
            onClick={() => onSave(pickerRight.filter((id) => byId.has(id) && !lockedSet.has(id)))}
          >
            Ок
          </button>
        </div>
      </div>
    </div>
  );
}
