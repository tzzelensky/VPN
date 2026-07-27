import { subscriptionLabel } from "../../subscriptionLabel";
import type { CommunicationSegmentDto, CommunicationTargetDto } from "../../api";
import type { AudienceCard } from "./commsTypes";

type Props = {
  audience: AudienceCard;
  onAudienceChange: (card: AudienceCard) => void;
  busy: boolean;
  reachableCount: number;
  selectedUsers: CommunicationTargetDto[];
  onOpenPicker: () => void;
  onClearSelected: () => void;
  segments: CommunicationSegmentDto[];
  segmentId: string;
  segmentQuery: string;
  onSegmentQueryChange: (q: string) => void;
  onSegmentSelect: (id: string) => void;
  segmentPreviewCount: number | null;
  segmentPreviewLoading: boolean;
};

const CARDS: { id: AudienceCard; title: string; desc: string }[] = [
  { id: "global", title: "Всем пользователям", desc: "Рассылка по всем клиентам с Telegram" },
  { id: "users", title: "Конкретным пользователям", desc: "Поиск и выбор клиентов" },
  { id: "segment", title: "Готовому сегменту", desc: "Аудитория из сохранённого сегмента" },
  { id: "new_segment", title: "Новому сегменту", desc: "Создать сегмент и затем отправить" },
];

export default function AudienceStep({
  audience,
  onAudienceChange,
  busy,
  reachableCount,
  selectedUsers,
  onOpenPicker,
  onClearSelected,
  segments,
  segmentId,
  segmentQuery,
  onSegmentQueryChange,
  onSegmentSelect,
  segmentPreviewCount,
  segmentPreviewLoading,
}: Props) {
  const q = segmentQuery.trim().toLowerCase();
  const filteredSegments = q
    ? segments.filter((s) => s.name.toLowerCase().includes(q))
    : segments;

  return (
    <section className="comms-wiz-card">
      <h2 className="comms-wiz-h2">Кому отправить</h2>
      <p className="comms-wiz-hint">Выберите аудиторию — появятся только нужные поля</p>

      <div className="comms-wiz-audience-grid" role="radiogroup" aria-label="Аудитория">
        {CARDS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={audience === c.id}
            className={`comms-wiz-audience-card${audience === c.id ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => onAudienceChange(c.id)}
          >
            <span className="comms-wiz-audience-radio" aria-hidden />
            <span className="comms-wiz-audience-title">{c.title}</span>
            <span className="comms-wiz-audience-desc">{c.desc}</span>
          </button>
        ))}
      </div>

      {audience === "global" ? (
        <div className="comms-wiz-audience-detail">
          <p className="comms-wiz-stat">
            Будет отправлено по <strong>{reachableCount}</strong> Telegram chat id
          </p>
        </div>
      ) : null}

      {audience === "users" ? (
        <div className="comms-wiz-audience-detail">
          <div className="comms-wiz-row">
            <button type="button" className="ghost" disabled={busy} onClick={onOpenPicker}>
              Выбрать клиентов
            </button>
            {selectedUsers.length > 0 ? (
              <button type="button" className="ghost" disabled={busy} onClick={onClearSelected}>
                Сбросить
              </button>
            ) : null}
            <span className="field-hint">Выбрано: {selectedUsers.length}</span>
          </div>
          {selectedUsers.length > 0 ? (
            <div className="comms-selected-chips">
              {selectedUsers.slice(0, 12).map((u) => (
                <span key={u.id} className="comms-chip">
                  {subscriptionLabel(u)}
                </span>
              ))}
              {selectedUsers.length > 12 ? <span className="comms-chip">+{selectedUsers.length - 12}</span> : null}
            </div>
          ) : (
            <p className="field-hint">Откройте поиск и отметьте нужных клиентов.</p>
          )}
        </div>
      ) : null}

      {audience === "segment" ? (
        <div className="comms-wiz-audience-detail">
          <input
            className="comms-wiz-input"
            type="search"
            placeholder="Поиск сегмента"
            value={segmentQuery}
            disabled={busy}
            onChange={(e) => onSegmentQueryChange(e.target.value)}
          />
          <div className="comms-wiz-segment-pick-list" role="listbox" aria-label="Сегменты">
            {filteredSegments.length === 0 ? (
              <p className="field-hint">Сегменты не найдены.</p>
            ) : (
              filteredSegments.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={segmentId === s.id}
                  className={`comms-wiz-segment-pick${segmentId === s.id ? " is-active" : ""}`}
                  disabled={busy}
                  onClick={() => onSegmentSelect(s.id)}
                >
                  <span className="comms-wiz-segment-pick-name">{s.name}</span>
                  <span className="field-hint">
                    {s.user_ids.length > 0 ? `${s.user_ids.length} в списке` : "по фильтрам"}
                  </span>
                </button>
              ))
            )}
          </div>
          {segmentId ? (
            <p className="comms-wiz-stat">
              {segmentPreviewLoading
                ? "Считаем получателей…"
                : segmentPreviewCount == null
                  ? null
                  : (
                      <>
                        Получателей с чатом: <strong>{segmentPreviewCount}</strong>
                      </>
                    )}
            </p>
          ) : null}
        </div>
      ) : null}

      {audience === "new_segment" ? (
        <div className="comms-wiz-audience-detail">
          <p className="field-hint">
            Перейдите во вкладку «Сегменты», создайте аудиторию, затем вернитесь и выберите её для рассылки.
          </p>
        </div>
      ) : null}
    </section>
  );
}
