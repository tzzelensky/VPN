import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCommunicationSegment,
  deleteCommunicationSegment,
  listCommunicationSegmentUsers,
  listCommunicationSegments,
  patchCommunicationSegment,
  refreshTestSubscriptionSegment,
  sendCommunication,
  type CommunicationSegmentDto,
  type CommunicationTargetDto,
  type SendCommunicationResult,
} from "../../api";
import ClientPickerModal from "../ClientPickerModal";
import AudienceStep from "./AudienceStep";
import MessageComposer from "./MessageComposer";
import TelegramPreview from "./TelegramPreview";
import SendConfirmBar from "./SendConfirmBar";
import SegmentsWorkspace, { type SegmentFormState } from "./SegmentsWorkspace";
import SentMailingsPanel, { type SentCopyDraft } from "./SentMailingsPanel";
import { prepareCompressedPhoto } from "./photoUtils";
import {
  isSystemCommunicationSegment,
  type AudienceCard,
  type BroadcastMode,
  type MessageButtonId,
} from "./commsTypes";

const LS_KEY_MARK_ENABLED = "comms_mark_enabled";
const LS_KEY_MARK_TEXT = "comms_mark_text";

type SubTab = "send" | "segments" | "sent";

type Props = {
  targets: CommunicationTargetDto[];
  segments: CommunicationSegmentDto[];
  onSegmentsChange: (segments: CommunicationSegmentDto[]) => void;
  brandName: string;
  onFlash: (msg: { type: "ok" | "err"; text: string } | null) => void;
  onPhotoNotice: (text: string) => void;
  onHistoryReload: () => Promise<void>;
};

export default function BroadcastWizard({
  targets,
  segments,
  onSegmentsChange,
  brandName,
  onFlash,
  onPhotoNotice,
  onHistoryReload,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>("send");
  const [forceNewSegment, setForceNewSegment] = useState(false);

  const [audience, setAudience] = useState<AudienceCard>("global");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [segmentId, setSegmentId] = useState("");
  const [segmentQuery, setSegmentQuery] = useState("");
  const [segmentPreviewUsers, setSegmentPreviewUsers] = useState<Array<{ id: number; name: string; tg_id: string }>>(
    [],
  );
  const [segmentPreviewLoading, setSegmentPreviewLoading] = useState(false);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [messageButtons, setMessageButtons] = useState<MessageButtonId[]>([]);
  const [markEnabled, setMarkEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(LS_KEY_MARK_ENABLED) !== "0";
  });
  const [markText, setMarkText] = useState<string>(() => {
    if (typeof window === "undefined") return "Сообщение от администратора";
    return window.localStorage.getItem(LS_KEY_MARK_TEXT) || "Сообщение от администратора";
  });

  const [busy, setBusy] = useState(false);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<SendCommunicationResult | null>(null);
  const [formFlash, setFormFlash] = useState(false);

  const reachable = useMemo(
    () => targets.filter((u) => Number.isFinite(Number(u.tg_id)) && Number(u.tg_id) > 0),
    [targets],
  );
  const chatReachable = useMemo(() => reachable.filter((u) => u.has_chat === true), [reachable]);
  const reachableById = useMemo(() => new Map(reachable.map((u) => [u.id, u])), [reachable]);
  const selectedUsers = useMemo(
    () => selectedIds.map((id) => reachableById.get(id)).filter((x): x is CommunicationTargetDto => Boolean(x)),
    [reachableById, selectedIds],
  );

  const mode: BroadcastMode | null =
    audience === "global" ? "global" : audience === "users" ? "selected" : audience === "segment" ? "segment" : null;

  const recipientCount = useMemo(() => {
    if (audience === "global") return reachable.length;
    if (audience === "users") return selectedUsers.length;
    if (audience === "segment") return segmentPreviewUsers.length;
    return 0;
  }, [audience, reachable.length, selectedUsers.length, segmentPreviewUsers.length]);

  const needsConfirm = audience === "global" || audience === "segment" || selectedUsers.length >= 5;
  const canSend =
    Boolean(text.trim()) &&
    mode != null &&
    (mode !== "selected" || selectedUsers.length > 0) &&
    (mode !== "segment" || Boolean(segmentId));

  useEffect(() => {
    window.localStorage.setItem(LS_KEY_MARK_ENABLED, markEnabled ? "1" : "0");
  }, [markEnabled]);

  useEffect(() => {
    window.localStorage.setItem(LS_KEY_MARK_TEXT, markText);
  }, [markText]);

  useEffect(() => {
    if (audience !== "segment" || !segmentId) {
      setSegmentPreviewUsers([]);
      setSegmentPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setSegmentPreviewLoading(true);
    void (async () => {
      try {
        const data = await listCommunicationSegmentUsers(segmentId);
        if (!cancelled) setSegmentPreviewUsers(data.users);
      } catch {
        if (!cancelled) setSegmentPreviewUsers([]);
      } finally {
        if (!cancelled) setSegmentPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audience, segmentId]);

  function handleAudienceChange(card: AudienceCard) {
    setAudience(card);
    setConfirmOpen(false);
    if (card === "new_segment") {
      setForceNewSegment(true);
      setSubTab("segments");
    }
  }

  function handleSegmentSelect(id: string) {
    setSegmentId(id);
    const picked = segments.find((s) => s.id === id);
    if (picked?.preset_enabled && picked.preset_text.trim()) {
      setText(picked.preset_text);
    }
  }

  async function reloadSegments() {
    const segs = await listCommunicationSegments();
    onSegmentsChange(segs.segments);
  }

  function resetSendForm() {
    setAudience("global");
    setSelectedIds([]);
    setSegmentId("");
    setSegmentQuery("");
    setSegmentPreviewUsers([]);
    setTitle("");
    setText("");
    setPhoto(null);
    setMessageButtons([]);
    setConfirmOpen(false);
    setLastResult(null);
    setPickerOpen(false);
  }

  function applyCopyDraft(draft: SentCopyDraft) {
    setAudience(draft.audience);
    setSelectedIds(draft.selectedIds);
    setSegmentId(draft.segmentId);
    setTitle(draft.title);
    setText(draft.text);
    setPhoto(draft.photo);
    setMessageButtons(draft.messageButtons);
    if (draft.markEnabled !== undefined) setMarkEnabled(draft.markEnabled);
    if (draft.markText !== undefined && draft.markText.trim()) setMarkText(draft.markText);
    setConfirmOpen(false);
    setLastResult(null);
    setSubTab("send");
  }

  async function doSend() {
    if (!mode) return;
    setConfirmOpen(false);
    onFlash(null);
    onPhotoNotice("");
    setLastResult(null);
    const cleanText = text.trim();
    if (!cleanText) {
      onFlash({ type: "err", text: "Введите текст сообщения." });
      return;
    }
    if (mode === "selected" && selectedUsers.length === 0) {
      onFlash({ type: "err", text: "Выберите клиентов." });
      return;
    }
    if (mode === "segment" && !segmentId) {
      onFlash({ type: "err", text: "Выберите сегмент для рассылки." });
      return;
    }

    setBusy(true);
    try {
      let photoBase64 = "";
      let photoMime = "";
      let photoName = "";
      if (photo) {
        const prepared = await prepareCompressedPhoto(photo);
        photoBase64 = prepared.base64;
        photoMime = prepared.mime;
        photoName = prepared.name;
        if (prepared.note) onPhotoNotice(prepared.note);
      }
      const result = await sendCommunication({
        mode,
        text: cleanText,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(mode === "selected" ? { user_ids: selectedUsers.map((u) => u.id) } : {}),
        ...(mode === "segment" ? { segment_id: segmentId } : {}),
        mark_enabled: markEnabled,
        mark_text: markText.trim(),
        ...(messageButtons.length > 0 ? { buttons: messageButtons } : {}),
        ...(photoBase64
          ? { photo_base64: photoBase64, photo_mime: photoMime, photo_name: photoName }
          : {}),
      });
      setLastResult(result);
      await onHistoryReload();
      if (result.ok) {
        onFlash({
          type: "ok",
          text:
            mode === "global"
              ? `Глобальная рассылка завершена: ${result.sent}/${result.attempted}.`
              : `Сообщение отправлено: ${result.sent}/${result.attempted}.`,
        });
        setFormFlash(true);
        window.setTimeout(() => {
          resetSendForm();
          setFormFlash(false);
        }, 280);
      } else {
        onFlash({
          type: "err",
          text: `Отправка завершена с ошибками: ${result.sent}/${result.attempted}, ошибок: ${result.failed}.`,
        });
      }
    } catch (e) {
      onFlash({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  function onRequestSend() {
    if (!canSend || busy) return;
    if (needsConfirm) {
      setConfirmOpen(true);
      return;
    }
    void doSend();
  }

  async function saveSegment(editingId: string, form: SegmentFormState) {
    setSegmentBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        user_ids: form.userIds,
        days_mode: form.daysMode,
        days_exact: form.daysExact,
        days_from: form.daysFrom,
        days_to: form.daysTo,
        gb_mode: form.gbMode,
        gb_exact: form.gbExact,
        gb_from: form.gbFrom,
        gb_to: form.gbTo,
        preset_enabled: form.presetEnabled,
        preset_text: form.presetText.trim(),
      };
      if (editingId) await patchCommunicationSegment(editingId, payload);
      else await createCommunicationSegment(payload);
      await reloadSegments();
      onFlash({ type: "ok", text: "Сегмент сохранён." });
    } catch (e) {
      onFlash({ type: "err", text: String(e) });
    } finally {
      setSegmentBusy(false);
    }
  }

  async function removeSegment(id: string) {
    const seg = segments.find((s) => s.id === id);
    if (seg && isSystemCommunicationSegment(seg)) {
      onFlash({ type: "err", text: "Системный сегмент нельзя удалить." });
      return;
    }
    setSegmentBusy(true);
    try {
      await deleteCommunicationSegment(id);
      await reloadSegments();
      if (segmentId === id) setSegmentId("");
      onFlash({ type: "ok", text: "Сегмент удалён." });
    } catch (e) {
      onFlash({ type: "err", text: String(e) });
    } finally {
      setSegmentBusy(false);
    }
  }

  async function duplicateSegment(s: CommunicationSegmentDto) {
    setSegmentBusy(true);
    try {
      await createCommunicationSegment({
        name: `${s.name} (копия)`,
        user_ids: s.user_ids ?? [],
        days_mode: s.days_mode,
        days_exact: s.days_exact ?? 0,
        days_from: s.days_from ?? 0,
        days_to: s.days_to ?? 0,
        gb_mode: s.gb_mode,
        gb_exact: s.gb_exact ?? 0,
        gb_from: s.gb_from ?? 0,
        gb_to: s.gb_to ?? 0,
        preset_enabled: s.preset_enabled === true,
        preset_text: s.preset_text ?? "",
      });
      await reloadSegments();
      onFlash({ type: "ok", text: "Сегмент продублирован." });
    } catch (e) {
      onFlash({ type: "err", text: String(e) });
    } finally {
      setSegmentBusy(false);
    }
  }

  async function refreshSystem(id: string) {
    setSegmentBusy(true);
    try {
      const updated = await refreshTestSubscriptionSegment(id);
      await reloadSegments();
      onFlash({
        type: "ok",
        text: `Сегмент обновлён. В списке ${updated.user_ids?.length ?? 0} пользователей.`,
      });
    } catch (e) {
      onFlash({ type: "err", text: String(e) });
    } finally {
      setSegmentBusy(false);
    }
  }

  const onForceNewConsumed = useCallback(() => setForceNewSegment(false), []);

  return (
    <div className={`comms-wiz${formFlash ? " comms-wiz--flash" : ""}`}>
      <div className="survey-segmented comms-wiz-subtabs" role="tablist" aria-label="Раздел рассылок">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "send"}
          className={`survey-segmented-btn${subTab === "send" ? " active" : ""}`}
          onClick={() => setSubTab("send")}
        >
          Рассылки
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "segments"}
          className={`survey-segmented-btn${subTab === "segments" ? " active" : ""}`}
          onClick={() => setSubTab("segments")}
        >
          Сегменты
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "sent"}
          className={`survey-segmented-btn${subTab === "sent" ? " active" : ""}`}
          onClick={() => setSubTab("sent")}
        >
          Отправлено
        </button>
      </div>

      {subTab === "send" ? (
        <div className="comms-wiz-send-layout">
          <div className="comms-wiz-main">
            <AudienceStep
              audience={audience}
              onAudienceChange={handleAudienceChange}
              busy={busy}
              globalRecipients={reachable}
              selectedUsers={selectedUsers}
              onOpenPicker={() => setPickerOpen(true)}
              onClearSelected={() => setSelectedIds([])}
              segments={segments}
              segmentId={segmentId}
              segmentQuery={segmentQuery}
              onSegmentQueryChange={setSegmentQuery}
              onSegmentSelect={handleSegmentSelect}
              segmentPreviewUsers={segmentPreviewUsers}
              segmentPreviewLoading={segmentPreviewLoading}
            />

            {audience !== "new_segment" ? (
              <>
                <MessageComposer
                  busy={busy}
                  title={title}
                  onTitleChange={setTitle}
                  text={text}
                  onTextChange={setText}
                  photo={photo}
                  onPhotoChange={setPhoto}
                  markEnabled={markEnabled}
                  onMarkEnabledChange={setMarkEnabled}
                  markText={markText}
                  onMarkTextChange={setMarkText}
                  buttons={messageButtons}
                  onButtonsChange={setMessageButtons}
                />

                <SendConfirmBar
                  busy={busy}
                  recipientCount={recipientCount}
                  hasPhoto={Boolean(photo)}
                  buttonCount={messageButtons.length}
                  title={title}
                  text={text}
                  photo={photo}
                  buttons={messageButtons}
                  markEnabled={markEnabled}
                  markText={markText}
                  canSend={canSend}
                  needsConfirm={needsConfirm}
                  confirmOpen={confirmOpen}
                  onRequestSend={onRequestSend}
                  onConfirm={() => void doSend()}
                  onCancelConfirm={() => setConfirmOpen(false)}
                />

                {lastResult && lastResult.failures.length > 0 ? (
                  <div className="comms-failures comms-wiz-card">
                    <h3>Ошибки доставки</h3>
                    <ul>
                      {lastResult.failures.map((f) => (
                        <li key={`${f.user_id}:${f.error}`}>
                          {f.user_name}: {f.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {audience !== "new_segment" ? (
            <aside className="comms-wiz-aside">
              <TelegramPreview
                brandName={brandName}
                markEnabled={markEnabled}
                markText={markText}
                text={text}
                photo={photo}
                buttons={messageButtons}
              />
            </aside>
          ) : null}
        </div>
      ) : null}

      {subTab === "segments" ? (
        <SegmentsWorkspace
          segments={segments}
          chatReachable={chatReachable}
          busy={segmentBusy}
          forceNew={forceNewSegment}
          onForceNewConsumed={onForceNewConsumed}
          onSave={saveSegment}
          onDelete={removeSegment}
          onDuplicate={duplicateSegment}
          onRefreshSystem={refreshSystem}
          onMessage={(type, textMsg) => onFlash({ type, text: textMsg })}
        />
      ) : null}

      {subTab === "sent" ? (
        <SentMailingsPanel busy={busy} onCopy={applyCopyDraft} onFlash={onFlash} />
      ) : null}

      <ClientPickerModal
        open={pickerOpen}
        users={reachable}
        selectedIds={selectedIds}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => {
          setSelectedIds(ids);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
