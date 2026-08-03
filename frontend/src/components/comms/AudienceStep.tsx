import { useMemo, useState, type ReactNode } from "react";
import { subscriptionLabel } from "../../subscriptionLabel";
import type { CommunicationSegmentDto, CommunicationTargetDto } from "../../api";
import AdminModalBackdrop from "../AdminModalBackdrop";
import type { AudienceCard } from "./commsTypes";

export type SegmentPreviewUser = { id: number; name: string; tg_id: string };

type Props = {
  audience: AudienceCard;
  onAudienceChange: (card: AudienceCard) => void;
  busy: boolean;
  /** Все получатели для режима «Всем пользователям». */
  globalRecipients: CommunicationTargetDto[];
  selectedUsers: CommunicationTargetDto[];
  onOpenPicker: () => void;
  onClearSelected: () => void;
  segments: CommunicationSegmentDto[];
  segmentId: string;
  segmentQuery: string;
  onSegmentQueryChange: (q: string) => void;
  onSegmentSelect: (id: string) => void;
  segmentPreviewUsers: SegmentPreviewUser[];
  segmentPreviewLoading: boolean;
};

const CARDS: { id: AudienceCard; title: string; desc: string }[] = [
  { id: "global", title: "Всем пользователям", desc: "Рассылка по всем клиентам с Telegram" },
  { id: "users", title: "Конкретным пользователям", desc: "Поиск и выбор клиентов" },
  { id: "segment", title: "Готовому сегменту", desc: "Аудитория из сохранённого сегмента" },
  { id: "new_segment", title: "Новому сегменту", desc: "Создать сегмент и затем отправить" },
];

const PREVIEW_VISIBLE = 5;

type PreviewUser = { id: number; name: string; tg_id?: string };

function RecipientsPreview({
  users,
  emptyHint,
  countLabel,
  loading,
}: {
  users: PreviewUser[];
  emptyHint: string;
  countLabel: ReactNode;
  loading?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const visible = users.slice(0, PREVIEW_VISIBLE);
  const hasMore = users.length > PREVIEW_VISIBLE;

  if (loading) {
    return (
      <>
        <p className="comms-wiz-stat">Считаем получателей…</p>
        <div className="comms-segment-loading-line" aria-hidden />
      </>
    );
  }

  return (
    <>
      <p className="comms-wiz-stat">{countLabel}</p>
      <div className="comms-segment-preview-list">
        {users.length === 0 ? (
          <p className="field-hint">{emptyHint}</p>
        ) : (
          <>
            {visible.map((u) => (
              <span key={u.id} className="comms-chip">
                #{u.id} {subscriptionLabel(u)}
              </span>
            ))}
            {hasMore ? (
              <button
                type="button"
                className="comms-chip comms-chip--more"
                onClick={() => setModalOpen(true)}
                aria-label="Показать всех получателей"
              >
                …
              </button>
            ) : null}
          </>
        )}
      </div>

      {modalOpen ? (
        <AdminModalBackdrop onClick={() => setModalOpen(false)}>
          <div
            className="modal comms-recipients-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="comms-recipients-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3 id="comms-recipients-title">
                Получатели <span className="comms-recipients-modal-count">{users.length}</span>
              </h3>
              <button
                type="button"
                className="ghost modal-close"
                aria-label="Закрыть"
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="comms-recipients-modal-list">
                {users.map((u) => (
                  <span key={u.id} className="comms-chip" title={u.tg_id ? String(u.tg_id) : undefined}>
                    #{u.id} {subscriptionLabel(u)}
                  </span>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </AdminModalBackdrop>
      ) : null}
    </>
  );
}

export default function AudienceStep({
  audience,
  onAudienceChange,
  busy,
  globalRecipients,
  selectedUsers,
  onOpenPicker,
  onClearSelected,
  segments,
  segmentId,
  segmentQuery,
  onSegmentQueryChange,
  onSegmentSelect,
  segmentPreviewUsers,
  segmentPreviewLoading,
}: Props) {
  const q = segmentQuery.trim().toLowerCase();
  const filteredSegments = useMemo(
    () => (q ? segments.filter((s) => s.name.toLowerCase().includes(q)) : segments),
    [q, segments],
  );

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
          <RecipientsPreview
            users={globalRecipients}
            emptyHint="Нет пользователей с Telegram chat id."
            countLabel={
              <>
                Будет отправлено по <strong>{globalRecipients.length}</strong> Telegram chat id
              </>
            }
          />
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
            <RecipientsPreview
              users={selectedUsers}
              emptyHint="Откройте поиск и отметьте нужных клиентов."
              countLabel={
                <>
                  Выбрано получателей: <strong>{selectedUsers.length}</strong>
                </>
              }
            />
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
            <RecipientsPreview
              users={segmentPreviewUsers}
              loading={segmentPreviewLoading}
              emptyHint="В сегменте нет пользователей с чатом."
              countLabel={
                <>
                  Получателей с чатом: <strong>{segmentPreviewUsers.length}</strong>
                </>
              }
            />
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
