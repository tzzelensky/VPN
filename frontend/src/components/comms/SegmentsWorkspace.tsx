import { useEffect, useMemo, useRef, useState } from "react";
import type { CommunicationSegmentDto, CommunicationTargetDto } from "../../api";
import { isTestSubscriptionSystemSegment } from "./commsTypes";
import SegmentEditor, { type SegmentFormState } from "./SegmentEditor";

function emptyForm(): SegmentFormState {
  return {
    name: "",
    userIds: [],
    daysMode: "any",
    daysExact: 3,
    daysFrom: 0,
    daysTo: 3,
    gbMode: "any",
    gbExact: 10,
    gbFrom: 0,
    gbTo: 10,
    presetEnabled: false,
    presetText: "",
  };
}

function formFromSegment(s: CommunicationSegmentDto): SegmentFormState {
  return {
    name: s.name,
    userIds: s.user_ids ?? [],
    daysMode: s.days_mode,
    daysExact: s.days_exact ?? 0,
    daysFrom: s.days_from ?? 0,
    daysTo: s.days_to ?? 0,
    gbMode: s.gb_mode,
    gbExact: s.gb_exact ?? 0,
    gbFrom: s.gb_from ?? 0,
    gbTo: s.gb_to ?? 0,
    presetEnabled: s.preset_enabled === true,
    presetText: s.preset_text ?? "",
  };
}

type Props = {
  segments: CommunicationSegmentDto[];
  chatReachable: CommunicationTargetDto[];
  busy: boolean;
  forceNew?: boolean;
  onForceNewConsumed?: () => void;
  onSave: (editingId: string, form: SegmentFormState) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDuplicate: (s: CommunicationSegmentDto) => Promise<void>;
  onRefreshSystem: (id: string) => Promise<void>;
  onMessage: (type: "ok" | "err", text: string) => void;
};

export default function SegmentsWorkspace({
  segments,
  chatReachable,
  busy,
  forceNew,
  onForceNewConsumed,
  onSave,
  onDelete,
  onDuplicate,
  onRefreshSystem,
  onMessage,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<SegmentFormState>(emptyForm);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!forceNew) return;
    setSelectedId("");
    setEditingId("");
    setForm(emptyForm());
    onForceNewConsumed?.();
  }, [forceNew, onForceNewConsumed]);

  useEffect(() => {
    if (!menuId) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuId(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((s) => s.name.toLowerCase().includes(q));
  }, [segments, query]);

  const selected = segments.find((s) => s.id === selectedId) ?? null;
  const isSystem = selected ? isTestSubscriptionSystemSegment(selected) : false;

  function startCreate() {
    setSelectedId("");
    setEditingId("");
    setForm(emptyForm());
    setMenuId(null);
  }

  function startEdit(s: CommunicationSegmentDto) {
    setSelectedId(s.id);
    setEditingId(s.id);
    setForm(formFromSegment(s));
    setMenuId(null);
  }

  function selectRow(s: CommunicationSegmentDto) {
    setSelectedId(s.id);
    setEditingId(s.id);
    setForm(formFromSegment(s));
    setMenuId(null);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      onMessage("err", "Введите название сегмента.");
      return;
    }
    await onSave(editingId, form);
    setEditingId("");
    setForm(emptyForm());
    setSelectedId("");
  }

  return (
    <div className="comms-seg-workspace">
      <aside className="comms-seg-list-pane">
        <div className="comms-seg-list-head">
          <input
            className="comms-wiz-input"
            type="search"
            placeholder="Поиск сегмента"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="primary" disabled={busy} onClick={startCreate}>
            + Новый
          </button>
        </div>
        <div className="comms-seg-list">
          {filtered.length === 0 ? (
            <p className="field-hint">Сегментов пока нет.</p>
          ) : (
            filtered.map((s) => {
              const sys = isTestSubscriptionSystemSegment(s);
              return (
                <div
                  key={s.id}
                  className={`comms-seg-row${selectedId === s.id ? " is-active" : ""}`}
                  onClick={() => selectRow(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectRow(s);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="comms-seg-row-main">
                    <div className="comms-seg-row-name">
                      {s.name}
                      {sys ? <span className="comms-seg-badge">системный</span> : null}
                    </div>
                    <div className="field-hint">
                      Пользователей: {s.user_ids.length > 0 ? s.user_ids.length : "по фильтрам"}
                    </div>
                  </div>
                  <div className="comms-seg-row-menu" ref={menuId === s.id ? menuRef : undefined}>
                    <button
                      type="button"
                      className="ghost comms-seg-menu-btn"
                      aria-label="Меню сегмента"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId((cur) => (cur === s.id ? null : s.id));
                      }}
                    >
                      ⋮
                    </button>
                    {menuId === s.id ? (
                      <div className="comms-seg-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(s);
                          }}
                        >
                          Редактировать
                        </button>
                        {!sys ? (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuId(null);
                              void onDuplicate(s);
                            }}
                          >
                            Дублировать
                          </button>
                        ) : null}
                        {sys ? (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuId(null);
                              void onRefreshSystem(s.id);
                            }}
                          >
                            Обновить
                          </button>
                        ) : (
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuId(null);
                              if (window.confirm(`Удалить сегмент «${s.name}»?`)) void onDelete(s.id);
                            }}
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <div className="comms-seg-editor-pane">
        <SegmentEditor
          form={form}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          busy={busy}
          editingId={editingId}
          isSystem={isSystem}
          chatReachable={chatReachable}
          pickerOpen={pickerOpen}
          onPickerOpen={setPickerOpen}
          onSave={() => void handleSave()}
          onCancel={startCreate}
          onRefreshSystem={
            selected && isSystem ? () => void onRefreshSystem(selected.id) : undefined
          }
        />
      </div>
    </div>
  );
}

export { emptyForm, formFromSegment };
export type { SegmentFormState };
