import { useEffect, useMemo, useState, type SVGProps } from "react";
import {
  deleteCommunicationHistory,
  fetchCommunicationHistoryPhoto,
  getCommunicationHistoryItem,
  listCommunicationHistory,
  type CommunicationMessageLogDto,
} from "../../api";
import AdminModalBackdrop from "../AdminModalBackdrop";
import Spinner from "../Spinner";
import type { AudienceCard, MessageButtonId } from "./commsTypes";
import { MESSAGE_BUTTON_OPTIONS } from "./commsTypes";

export type SentCopyDraft = {
  audience: AudienceCard;
  selectedIds: number[];
  segmentId: string;
  title: string;
  text: string;
  photo: File | null;
  messageButtons: MessageButtonId[];
  markEnabled?: boolean;
  markText?: string;
  photoMissing?: boolean;
};

type Props = {
  busy?: boolean;
  onCopy: (draft: SentCopyDraft) => void;
  onFlash: (msg: { type: "ok" | "err"; text: string } | null) => void;
};

const PREVIEW_VISIBLE = 5;
const BUTTON_IDS = new Set(MESSAGE_BUTTON_OPTIONS.map((b) => b.id));

function IconCopy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconTrash(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buttonLabel(id: string): string {
  return MESSAGE_BUTTON_OPTIONS.find((b) => b.id === id)?.short ?? id;
}

export default function SentMailingsPanel({ busy, onCopy, onFlash }: Props) {
  const [items, setItems] = useState<CommunicationMessageLogDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<"copy" | "delete" | null>(null);
  const [recipientsModal, setRecipientsModal] = useState<CommunicationMessageLogDto | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const data = await listCommunicationHistory({ limit: 200, manualOnly: true });
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const photoUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.photo_path || item.has_photo) {
        map.set(item.id, `/api/communications/history/${encodeURIComponent(item.id)}/photo`);
      }
    }
    return map;
  }, [items]);

  async function handleCopy(item: CommunicationMessageLogDto) {
    setActionBusyId(item.id);
    setActionKind("copy");
    onFlash(null);
    try {
      const full = await getCommunicationHistoryItem(item.id);
      let photo: File | null = null;
      let photoMissing = false;
      if (full.photo_path || full.has_photo) {
        try {
          photo = await fetchCommunicationHistoryPhoto(full.id);
          if (!photo) photoMissing = Boolean(full.has_photo);
        } catch {
          photoMissing = Boolean(full.has_photo);
        }
      }

      const mode = full.mode;
      let audience: AudienceCard = "global";
      let selectedIds: number[] = [];
      let segmentId = "";
      if (mode === "selected" || mode === "single") {
        audience = "users";
        selectedIds =
          full.user_ids && full.user_ids.length > 0
            ? full.user_ids
            : full.recipients.map((r) => r.user_id).filter((id) => id > 0);
      } else if (mode === "segment") {
        audience = "segment";
        segmentId = full.segment_id ?? "";
      } else {
        audience = "global";
      }

      const messageButtons = (full.buttons ?? []).filter((b): b is MessageButtonId =>
        BUTTON_IDS.has(b as MessageButtonId),
      );

      onCopy({
        audience,
        selectedIds,
        segmentId,
        title: full.title ?? "",
        text: (full.body_text || full.text || "").trim(),
        photo,
        messageButtons,
        markEnabled: full.mark_enabled,
        markText: full.mark_text,
        photoMissing,
      });
      onFlash({
        type: "ok",
        text: photoMissing
          ? "Рассылка скопирована. Фото в старой записи недоступно — приложите заново."
          : "Рассылка скопирована в форму.",
      });
    } catch (e) {
      onFlash({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setActionBusyId(null);
      setActionKind(null);
    }
  }

  async function handleDelete(item: CommunicationMessageLogDto) {
    if (!window.confirm("Удалить эту сохранённую рассылку?")) return;
    setActionBusyId(item.id);
    setActionKind("delete");
    onFlash(null);
    try {
      await deleteCommunicationHistory(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      if (recipientsModal?.id === item.id) setRecipientsModal(null);
      onFlash({ type: "ok", text: "Рассылка удалена." });
    } catch (e) {
      onFlash({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setActionBusyId(null);
      setActionKind(null);
    }
  }

  if (loading) {
    return <p className="field-hint">Загрузка отправленных рассылок…</p>;
  }

  if (items.length === 0) {
    return (
      <div className="comms-wiz-card">
        <p className="field-hint" style={{ margin: 0 }}>
          Пока нет отправленных рассылок из панели.
        </p>
      </div>
    );
  }

  return (
    <div className="comms-sent-list">
      {items.map((item) => {
        const recipients = item.recipients ?? [];
        const visible = recipients.slice(0, PREVIEW_VISIBLE);
        const hasMore = recipients.length > PREVIEW_VISIBLE;
        const photoUrl = photoUrls.get(item.id);
        const rowBusy = actionBusyId === item.id;
        return (
          <article key={item.id} className="comms-sent-card">
            <div className="comms-sent-card-head">
              <time dateTime={item.sent_at}>{formatWhen(item.sent_at)}</time>
              <span className="comms-sent-source">{item.source_label}</span>
              {item.segment_name ? <span className="field-hint">· {item.segment_name}</span> : null}
              <span className="comms-sent-stats">
                {item.sent}/{item.attempted}
                {item.failed > 0 ? ` · ошибок: ${item.failed}` : ""}
              </span>
              <div className="comms-sent-card-actions">
                <button
                  type="button"
                  className="comms-sent-icon-btn"
                  title="Копировать в форму"
                  aria-label="Копировать"
                  disabled={busy || rowBusy}
                  onClick={() => void handleCopy(item)}
                >
                  {rowBusy && actionKind === "copy" ? <Spinner /> : <IconCopy />}
                </button>
                <button
                  type="button"
                  className="comms-sent-icon-btn comms-sent-icon-btn--danger"
                  title="Удалить"
                  aria-label="Удалить"
                  disabled={busy || rowBusy}
                  onClick={() => void handleDelete(item)}
                >
                  {rowBusy && actionKind === "delete" ? <Spinner /> : <IconTrash />}
                </button>
              </div>
            </div>
            <div className="comms-sent-card-body">
              {photoUrl ? (
                <div className="comms-sent-photo-wrap">
                  <img
                    className="comms-sent-photo"
                    src={photoUrl}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
              ) : item.has_photo ? (
                <span className="comms-chip">фото (нет файла)</span>
              ) : null}
              <p className="comms-sent-text">{item.body_text || item.text}</p>
            </div>
            <div className="comms-segment-preview-list">
              {visible.map((r) => (
                <span key={`${item.id}-${r.user_id}-${r.user_name}`} className="comms-chip">
                  {r.user_name}
                </span>
              ))}
              {hasMore ? (
                <button
                  type="button"
                  className="comms-chip comms-chip--more"
                  onClick={() => setRecipientsModal(item)}
                  aria-label="Все получатели"
                >
                  …
                </button>
              ) : null}
            </div>
            {(item.buttons?.length ?? 0) > 0 ? (
              <div className="comms-sent-buttons">
                {item.buttons!.map((b) => (
                  <span key={b} className="comms-chip">
                    {buttonLabel(b)}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}

      {recipientsModal ? (
        <AdminModalBackdrop onClose={() => setRecipientsModal(null)}>
          <div
            className="modal comms-recipients-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3>
                Получатели{" "}
                <span className="comms-recipients-modal-count">{recipientsModal.recipients.length}</span>
              </h3>
              <button type="button" className="ghost modal-close" onClick={() => setRecipientsModal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="comms-recipients-modal-list">
                {recipientsModal.recipients.map((r) => (
                  <span key={`${recipientsModal.id}-${r.user_id}-${r.user_name}`} className="comms-chip">
                    #{r.user_id} {r.user_name}
                  </span>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setRecipientsModal(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </AdminModalBackdrop>
      ) : null}
    </div>
  );
}
