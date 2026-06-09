import { useCallback, useEffect, useMemo, useState } from "react";
import { subscriptionLabel } from "../subscriptionLabel";
import {
  archiveSurvey,
  deleteSurveyDraft,
  getSurveyDetail,
  listCommunicationSegmentUsers,
  listCommunicationSegments,
  listCommunicationTargets,
  listSurveys,
  saveSurvey,
  sendSurvey,
  surveyExportUrl,
  type CommunicationSegmentDto,
  type CommunicationTargetDto,
  type SaveSurveyPayload,
  type SurveyDto,
  type SurveyMode,
  type SurveyReportDto,
} from "../api";
import SurveyReportPanel from "./SurveyReportPanel";
import { fmtSurveyDate, parseApiError, surveyListTab, surveyStatusBadge, type SurveyListTab } from "./surveysUi";

const MAX_REQUEST_IMAGE_BYTES = 750_000;

type Toast = { type: "ok" | "err"; text: string };

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Не удалось прочитать файл"));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsDataURL(file);
  });
}

function dataUrlApproxBytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((b64.length * 3) / 4);
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось обработать изображение"));
    img.src = dataUrl;
  });
}

async function prepareCompressedPhoto(file: File): Promise<{ base64: string; mime: string; name: string; note: string }> {
  const original = await fileToDataUrl(file);
  if (dataUrlApproxBytes(original) <= MAX_REQUEST_IMAGE_BYTES) {
    return { base64: original, mime: file.type || "image/jpeg", name: file.name || "photo.jpg", note: "" };
  }
  const img = await loadImageFromDataUrl(original);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось подготовить фото");
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const maxSide = 1280;
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);
  let best = canvas.toDataURL("image/jpeg", 0.78);
  if (dataUrlApproxBytes(best) > MAX_REQUEST_IMAGE_BYTES) best = canvas.toDataURL("image/jpeg", 0.62);
  return { base64: best, mime: "image/jpeg", name: "survey-photo.jpg", note: "Фото сжато для отправки." };
}

function surveyErrorText(code: string): string {
  const map: Record<string, string> = {
    title_required: "Укажите название опроса.",
    message_required: "Укажите текст сообщения.",
    no_targets: "Нет получателей с Telegram.",
    invalid_photo: "Некорректное фото.",
    photo_too_large: "Фото слишком большое.",
    unsupported_photo_format: "Формат фото не поддерживается (JPEG, PNG, WebP).",
    telegram_not_configured: "Telegram-бот не настроен.",
    not_draft: "Можно удалить только черновик.",
    cannot_archive: "Нельзя архивировать этот опрос.",
  };
  return map[code] ?? code;
}

function SurveyTgPreview({
  messageText,
  photoPreview,
  allowFeedback,
}: {
  messageText: string;
  photoPreview: string | null;
  allowFeedback: boolean;
}) {
  return (
    <div className="survey-tg-mock">
      <div className="survey-tg-mock-label">Предпросмотр Telegram</div>
      <div className="survey-tg-bubble">
        {photoPreview ? <img src={photoPreview} alt="" className="survey-tg-bubble-photo" /> : null}
        <p className="survey-tg-bubble-text">{messageText.trim() || "Текст опроса"}</p>
        <div className="survey-tg-inline-keys">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="survey-tg-key">
              {n}
            </span>
          ))}
        </div>
      </div>
      {allowFeedback ? (
        <p className="field-hint survey-tg-mock-hint">После оценки клиент сможет оставить комментарий.</p>
      ) : (
        <p className="field-hint survey-tg-mock-hint">Только оценка, без комментария.</p>
      )}
    </div>
  );
}

export default function SurveysPanel() {
  const [targets, setTargets] = useState<CommunicationTargetDto[]>([]);
  const [segments, setSegments] = useState<CommunicationSegmentDto[]>([]);
  const [surveys, setSurveys] = useState<SurveyDto[]>([]);
  const [listTab, setListTab] = useState<SurveyListTab>("sent");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reportViewTab, setReportViewTab] = useState<"stats" | "answers">("stats");
  const [detailSurvey, setDetailSurvey] = useState<SurveyDto | null>(null);
  const [detailReport, setDetailReport] = useState<SurveyReportDto | null>(null);
  const [detailRecipients, setDetailRecipients] = useState<Awaited<ReturnType<typeof getSurveyDetail>>["recipients"]>([]);

  const [title, setTitle] = useState("");
  const [messageText, setMessageText] = useState("");
  const [allowFeedback, setAllowFeedback] = useState(true);
  const [mode, setMode] = useState<SurveyMode>("global");
  const [userId, setUserId] = useState(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [hasSavedPhoto, setHasSavedPhoto] = useState(false);
  const [draftId, setDraftId] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [segmentRecipientCount, setSegmentRecipientCount] = useState<number | null>(null);

  const showToast = useCallback((type: Toast["type"], text: string) => {
    setToast({ type, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const reloadList = useCallback(async () => {
    const data = await listSurveys();
    setSurveys(data.surveys);
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const d = await getSurveyDetail(id);
      setDetailSurvey({ ...d.survey, stats: d.stats ?? d.survey.stats });
      setDetailReport(d.report);
      setDetailRecipients(d.recipients);
    } catch {
      setDetailSurvey(null);
      setDetailReport(null);
      setDetailRecipients([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [t, segs] = await Promise.all([listCommunicationTargets(), listCommunicationSegments()]);
        setTargets(t.users);
        setSegments(segs.segments);
        if (segs.segments[0]) setSegmentId(segs.segments[0].id);
        if (t.users[0]) setUserId(t.users[0].id);
      } catch (e) {
        showToast("err", String(e));
      }
      await reloadList();
    })();
  }, [reloadList, showToast]);

  useEffect(() => {
    const sending = surveys.some((s) => s.status === "sending");
    if (!sending) return;
    const t = window.setInterval(() => void reloadList(), 3000);
    return () => window.clearInterval(t);
  }, [surveys, reloadList]);

  useEffect(() => {
    if (selectedId == null) {
      setDetailSurvey(null);
      setDetailReport(null);
      setDetailRecipients([]);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, surveys, loadDetail]);

  const reachable = useMemo(
    () => targets.filter((u) => Number.isFinite(Number(u.tg_id)) && Number(u.tg_id) > 0 && u.has_chat),
    [targets],
  );

  useEffect(() => {
    if (mode !== "segment" || !segmentId) {
      setSegmentRecipientCount(null);
      return;
    }
    let cancelled = false;
    void listCommunicationSegmentUsers(segmentId)
      .then((r) => {
        if (!cancelled) setSegmentRecipientCount(r.users.length);
      })
      .catch(() => {
        if (!cancelled) setSegmentRecipientCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, segmentId]);

  const recipientCountEstimate = useMemo(() => {
    if (mode === "global") return reachable.length;
    if (mode === "single") return userId > 0 ? 1 : 0;
    if (mode === "selected") return selectedIds.length;
    if (mode === "segment") return segmentRecipientCount ?? 0;
    return 0;
  }, [mode, reachable.length, userId, selectedIds.length, segmentRecipientCount]);

  const filteredSurveys = useMemo(() => surveys.filter((s) => surveyListTab(s) === listTab), [surveys, listTab]);

  const selectedSurvey = useMemo(() => surveys.find((s) => s.id === selectedId) ?? null, [surveys, selectedId]);
  const showReportPanel = selectedSurvey != null && selectedSurvey.status !== "draft" && detailReport != null && detailSurvey != null;

  function toggleAllowFeedback() {
    if (busy) return;
    setAllowFeedback((v) => !v);
  }

  function clearForm() {
    setTitle("");
    setMessageText("");
    setAllowFeedback(true);
    setMode("global");
    setSelectedIds([]);
    setPhoto(null);
    setPhotoPreview(null);
    setHasSavedPhoto(false);
    setDraftId(undefined);
    setConfirmSend(false);
  }

  async function loadDraftIntoForm(id: number) {
    setBusy(true);
    try {
      const d = await getSurveyDetail(id);
      const s = d.survey;
      setDraftId(s.id);
      setTitle(s.title);
      setMessageText(s.message_text);
      setAllowFeedback(s.allow_feedback);
      setMode(s.recipient_mode);
      setUserId(s.recipient_user_id && s.recipient_user_id > 0 ? s.recipient_user_id : userId);
      setSelectedIds(s.recipient_user_ids ?? []);
      if (s.recipient_segment_id) setSegmentId(s.recipient_segment_id);
      setPhoto(null);
      setPhotoPreview(null);
      setHasSavedPhoto(Boolean(s.photo_path));
      setSelectedId(id);
      showToast("ok", "Черновик загружен в форму.");
    } catch (e) {
      showToast("err", surveyErrorText(parseApiError(e)));
    } finally {
      setBusy(false);
    }
  }

  function selectSurvey(s: SurveyDto, opts?: { reportTab?: "stats" | "answers"; edit?: boolean }) {
    setSelectedId(s.id);
    if (opts?.reportTab) setReportViewTab(opts.reportTab);
    else if (s.status !== "draft") setReportViewTab("stats");
    if (s.status === "draft" || opts?.edit) {
      void loadDraftIntoForm(s.id);
      return;
    }
    if (listTab === "drafts") setListTab("sent");
  }

  async function buildPayload(send: boolean): Promise<SaveSurveyPayload> {
    let photo_base64: string | undefined;
    let photo_mime: string | undefined;
    let photo_name: string | undefined;
    if (photo) {
      const prep = await prepareCompressedPhoto(photo);
      photo_base64 = prep.base64;
      photo_mime = prep.mime;
      photo_name = prep.name;
      if (prep.note) showToast("ok", prep.note);
    }
    return {
      id: draftId,
      title,
      message_text: messageText,
      allow_feedback: allowFeedback,
      mode,
      user_id: mode === "single" ? userId : undefined,
      user_ids: mode === "selected" ? selectedIds : undefined,
      segment_id: mode === "segment" ? segmentId : undefined,
      photo_base64,
      photo_mime,
      photo_name,
      send,
    };
  }

  async function onSaveDraft() {
    setBusy(true);
    try {
      const res = await saveSurvey(await buildPayload(false));
      setDraftId(res.survey.id);
      setHasSavedPhoto(Boolean(res.survey.photo_path));
      showToast("ok", "Опрос сохранён как черновик.");
      await reloadList();
      setSelectedId(res.survey.id);
      setListTab("drafts");
    } catch (e) {
      showToast("err", surveyErrorText(parseApiError(e)));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteDraft(id: number) {
    if (!window.confirm("Удалить черновик опроса?")) return;
    setBusy(true);
    try {
      await deleteSurveyDraft(id);
      if (draftId === id) clearForm();
      if (selectedId === id) setSelectedId(null);
      showToast("ok", "Черновик удалён.");
      await reloadList();
    } catch (e) {
      showToast("err", surveyErrorText(parseApiError(e)));
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: number) {
    setBusy(true);
    try {
      await archiveSurvey(id);
      showToast("ok", "Опрос перенесён в архив.");
      await reloadList();
      setListTab("archived");
    } catch (e) {
      showToast("err", surveyErrorText(parseApiError(e)));
    } finally {
      setBusy(false);
    }
  }

  async function onSendDraftById(id: number) {
    if (!window.confirm("Отправить этот черновик получателям?")) return;
    setBusy(true);
    try {
      await sendSurvey(id);
      showToast("ok", "Опрос поставлен в очередь на отправку.");
      if (draftId === id) clearForm();
      setSelectedId(id);
      setListTab("sent");
      await reloadList();
    } catch (e) {
      showToast("err", surveyErrorText(parseApiError(e)));
    } finally {
      setBusy(false);
    }
  }

  async function onSendFromForm() {
    if (!confirmSend) {
      setConfirmSend(true);
      showToast("ok", `Подтвердите отправку: ${recipientCountEstimate} получателей.`);
      return;
    }
    setBusy(true);
    try {
      const res = await saveSurvey(await buildPayload(true));
      showToast("ok", "Опрос отправляется в Telegram.");
      setConfirmSend(false);
      clearForm();
      setSelectedId(res.survey.id);
      setListTab("sent");
      await reloadList();
    } catch (e) {
      showToast("err", surveyErrorText(parseApiError(e)));
    } finally {
      setBusy(false);
    }
  }

  const formTitle = draftId ? "Редактирование опроса" : "Новый опрос";

  return (
    <div className="surveys-page">
      {toast ? (
        <div className={`survey-toast flash ${toast.type === "ok" ? "ok" : "err"}`} role="status">
          <span>{toast.text}</span>
          <button type="button" className="survey-toast-close" onClick={() => setToast(null)} aria-label="Закрыть">
            ×
          </button>
        </div>
      ) : null}

      <div className="surveys-main-grid">
        <div className="survey-form-col">
          <h2 className="comms-section-title">{formTitle}</h2>
          <div className="survey-form-inner">
            <div className="survey-form-fields">
              <div className="form-field">
                <label>Название опроса</label>
                <input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="Оценка качества обслуживания" />
              </div>
              <div className="form-field">
                <label>Текст сообщения</label>
                <textarea
                  className="comms-textarea"
                  value={messageText}
                  disabled={busy}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Пожалуйста, оцените качество обслуживания от 1 до 5"
                />
              </div>

              <div
                className="survey-setting-card"
                role="button"
                tabIndex={busy ? -1 : 0}
                onClick={toggleAllowFeedback}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleAllowFeedback();
                  }
                }}
              >
                <div className="survey-setting-card-text">
                  <span className="survey-setting-card-title">Разрешить обратную связь</span>
                  <p className="field-hint">После оценки клиент сможет оставить текстовый комментарий</p>
                </div>
                <button
                  type="button"
                  className={`toggle ${allowFeedback ? "on" : ""}`}
                  aria-pressed={allowFeedback}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAllowFeedback();
                  }}
                />
              </div>

              <div className="survey-upload-card">
                <div className="survey-upload-head">
                  <span className="survey-upload-title">Фото к опросу</span>
                  <p className="field-hint">Можно прикрепить изображение к сообщению в Telegram</p>
                </div>
                {photo && photoPreview ? (
                  <div className="survey-upload-preview">
                    <img src={photoPreview} alt="" className="survey-photo-preview" />
                    <div className="survey-upload-meta">
                      <span className="survey-upload-filename">{photo.name}</span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => {
                          setPhoto(null);
                          setPhotoPreview(null);
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ) : hasSavedPhoto && draftId ? (
                  <p className="field-hint">К черновику уже прикреплено фото. Загрузите новое, чтобы заменить.</p>
                ) : null}
                <label className={`ghost survey-upload-btn ${busy ? "disabled" : ""}`}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    className="comms-file-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setPhoto(f);
                      setHasSavedPhoto(false);
                      if (f) void fileToDataUrl(f).then(setPhotoPreview).catch(() => setPhotoPreview(null));
                      else setPhotoPreview(null);
                    }}
                  />
                  Загрузить фото
                </label>
              </div>

              <div className="survey-recipients-block">
                <span className="survey-setting-card-title">Получатели</span>
                <div className="survey-segmented" role="tablist">
                  {(["global", "single", "selected", "segment"] as SurveyMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={mode === m}
                      className={`survey-segmented-btn ${mode === m ? "active" : ""}`}
                      disabled={busy}
                      onClick={() => setMode(m)}
                    >
                      {m === "global" ? "Всем с Telegram" : m === "single" ? "Один" : m === "selected" ? "Выбранные" : "Сегмент"}
                    </button>
                  ))}
                </div>
                <p className={`survey-recipients-count ${recipientCountEstimate === 0 ? "warn" : ""}`}>
                  Получателей: {mode === "segment" && segmentRecipientCount == null ? "…" : recipientCountEstimate}
                  {recipientCountEstimate === 0 ? " — нет получателей с Telegram" : ""}
                </p>
                {mode === "single" ? (
                  <div className="form-field">
                    <label>Клиент</label>
                    <select value={userId} disabled={busy} onChange={(e) => setUserId(Number(e.target.value))}>
                      {reachable.map((u) => (
                        <option key={u.id} value={u.id}>
                          {subscriptionLabel(u)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {mode === "selected" ? (
                  <div className="form-field">
                    <label>ID клиентов</label>
                    <input
                      value={selectedIds.join(", ")}
                      disabled={busy}
                      onChange={(e) => {
                        const ids = e.target.value
                          .split(/[,;\s]+/)
                          .map((x) => Math.floor(Number(x)))
                          .filter((n) => Number.isFinite(n) && n > 0);
                        setSelectedIds([...new Set(ids)]);
                      }}
                      placeholder="1, 2, 3"
                    />
                  </div>
                ) : null}
                {mode === "segment" ? (
                  <div className="form-field">
                    <label>Сегмент</label>
                    <select value={segmentId} disabled={busy} onChange={(e) => setSegmentId(e.target.value)}>
                      {segments.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>

              <div className="survey-form-actions">
                <button type="button" className="ghost" disabled={busy} onClick={clearForm}>
                  Очистить
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={() => void onSaveDraft()}>
                  Сохранить черновик
                </button>
                {draftId ? (
                  <button type="button" className="ghost danger" disabled={busy} onClick={() => void onDeleteDraft(draftId)}>
                    Удалить
                  </button>
                ) : null}
                <button type="button" className="primary" disabled={busy} onClick={() => void onSendFromForm()}>
                  {confirmSend ? `Подтвердить (${recipientCountEstimate})` : "Отправить опрос"}
                </button>
              </div>
            </div>

            <aside className="survey-preview-col">
              <SurveyTgPreview messageText={messageText} photoPreview={photoPreview} allowFeedback={allowFeedback} />
            </aside>
          </div>
        </div>

        <div className="survey-list-col">
          <h2 className="comms-section-title">Опросы</h2>
          <div className="survey-list-tabs" role="tablist">
            {(
              [
                ["drafts", "Черновики"],
                ["sent", "Отправленные"],
                ["archived", "Архив"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={listTab === tab}
                className={`survey-list-tab ${listTab === tab ? "active" : ""}`}
                onClick={() => setListTab(tab)}
              >
                {label}
                <span className="survey-list-tab-count">{surveys.filter((s) => surveyListTab(s) === tab).length}</span>
              </button>
            ))}
          </div>

          <div className="survey-cards-list">
            {filteredSurveys.length === 0 ? (
              <div className="survey-empty-state survey-empty-state--compact">
                <p className="survey-empty-title">
                  {listTab === "drafts"
                    ? "Нет черновиков"
                    : listTab === "archived"
                      ? "Архив пуст"
                      : "Пока нет отправленных опросов"}
                </p>
                <p className="survey-empty-hint">
                  {listTab === "drafts"
                    ? "Сохраните опрос как черновик, чтобы вернуться к нему позже."
                    : "После отправки здесь появятся результаты и статистика."}
                </p>
              </div>
            ) : (
              filteredSurveys.map((s) => {
                const badge = surveyStatusBadge(s);
                const answered = s.stats?.answered_count ?? s.answered_count ?? 0;
                const isSelected = selectedId === s.id;
                const avg = s.stats?.average_rating;
                return (
                  <article key={s.id} className={`survey-card ${isSelected ? "selected" : ""}`}>
                    <button
                      type="button"
                      className="survey-card-main"
                      onClick={() => selectSurvey(s, s.status === "draft" ? { edit: true } : { reportTab: "stats" })}
                    >
                      <div className="survey-card-top">
                        <strong className="survey-card-title">{s.title}</strong>
                        <span className={badge.className}>{badge.label}</span>
                      </div>
                      <p className="survey-card-dates sub">
                        {fmtSurveyDate(s.created_at)}
                        {s.sent_at ? ` → ${fmtSurveyDate(s.sent_at)}` : ""}
                      </p>
                      {s.status !== "draft" ? (
                        <div className="survey-card-metrics">
                          <div className="survey-card-metric">
                            <span className="survey-card-metric-val">{s.recipients_count}</span>
                            <span className="survey-card-metric-lbl">Получателей</span>
                          </div>
                          <div className="survey-card-metric">
                            <span className="survey-card-metric-val">{answered}</span>
                            <span className="survey-card-metric-lbl">Ответили</span>
                          </div>
                          <div className="survey-card-metric">
                            <span className="survey-card-metric-val">{avg != null ? avg : "—"}</span>
                            <span className="survey-card-metric-lbl">Средняя</span>
                          </div>
                        </div>
                      ) : (
                        <p className="sub survey-card-draft-hint">Получателей: {s.recipients_count}</p>
                      )}
                    </button>
                    <div className="survey-card-actions">
                      {s.status === "draft" ? (
                        <>
                          <button type="button" className="ghost" disabled={busy} onClick={() => void loadDraftIntoForm(s.id)}>
                            Редактировать
                          </button>
                          <button type="button" className="primary" disabled={busy} onClick={() => void onSendDraftById(s.id)}>
                            Отправить
                          </button>
                          <button type="button" className="ghost danger" disabled={busy} onClick={() => void onDeleteDraft(s.id)}>
                            Удалить
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`ghost ${isSelected && reportViewTab === "stats" && showReportPanel ? "active" : ""}`}
                            disabled={busy}
                            onClick={() => selectSurvey(s, { reportTab: "stats" })}
                          >
                            Отчёт
                          </button>
                          <button
                            type="button"
                            className={`ghost ${isSelected && reportViewTab === "answers" && showReportPanel ? "active" : ""}`}
                            disabled={busy}
                            onClick={() => selectSurvey(s, { reportTab: "answers" })}
                          >
                            Ответы
                          </button>
                          <a className="ghost" href={surveyExportUrl(s.id)} download onClick={(e) => e.stopPropagation()}>
                            Экспорт
                          </a>
                          {s.status !== "archived" ? (
                            <button type="button" className="ghost" disabled={busy} onClick={() => void onArchive(s.id)}>
                              В архив
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showReportPanel ? (
        <SurveyReportPanel
          survey={detailSurvey}
          report={detailReport}
          recipients={detailRecipients}
          activeTab={reportViewTab}
          onTabChange={setReportViewTab}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}
