import { useEffect, useMemo, useState } from "react";
import { subscriptionLabel } from "../subscriptionLabel";
import DashboardLayout from "../components/DashboardLayout";
import SurveysPanel from "../components/SurveysPanel";
import {
  createCommunicationSegment,
  deleteCommunicationSegment,
  refreshTestSubscriptionSegment,
  listCommunicationHistory,
  listCommunicationSegmentUsers,
  listCommunicationSegments,
  listCommunicationTargets,
  type CommunicationMessageLogDto,
  patchCommunicationSegment,
  sendCommunication,
  type CommunicationSegmentDto,
  type CommunicationTargetDto,
  type SendCommunicationResult,
} from "../api";

type Mode = "global" | "single" | "selected" | "segment";
const MAX_REQUEST_IMAGE_BYTES = 750_000;
const LS_KEY_MARK_ENABLED = "comms_mark_enabled";
const LS_KEY_MARK_TEXT = "comms_mark_text";

function isTestSubscriptionSystemSegment(s: Pick<CommunicationSegmentDto, "id" | "system_key">): boolean {
  return s.system_key === "test_subscriptions" || s.id === "sys_test_subscriptions";
}

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
  if (dataUrlApproxBytes(best) > MAX_REQUEST_IMAGE_BYTES) {
    best = canvas.toDataURL("image/jpeg", 0.62);
  }
  if (dataUrlApproxBytes(best) > MAX_REQUEST_IMAGE_BYTES) {
    canvas.width = Math.max(1, Math.round(w * 0.78));
    canvas.height = Math.max(1, Math.round(h * 0.78));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    best = canvas.toDataURL("image/jpeg", 0.58);
  }
  if (dataUrlApproxBytes(best) > MAX_REQUEST_IMAGE_BYTES) {
    throw new Error("Фото слишком большое. Выберите изображение меньшего размера.");
  }

  const cleanName = (file.name || "photo")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 64);
  return {
    base64: best,
    mime: "image/jpeg",
    name: `${cleanName || "photo"}-compressed.jpg`,
    note: "Фото было автоматически сжато для отправки через сервер.",
  };
}

type CommsTab = "broadcasts" | "surveys";

export default function CommunicationsPage({ onLogout }: { onLogout: () => void }) {
  const [commsTab, setCommsTab] = useState<CommsTab>("broadcasts");
  const [targets, setTargets] = useState<CommunicationTargetDto[]>([]);
  const [segments, setSegments] = useState<CommunicationSegmentDto[]>([]);
  const [mode, setMode] = useState<Mode>("global");
  const [userId, setUserId] = useState<number>(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLeft, setPickerLeft] = useState<number[]>([]);
  const [pickerRight, setPickerRight] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [usersQuery, setUsersQuery] = useState("");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [lastResult, setLastResult] = useState<SendCommunicationResult | null>(null);
  const [photoNotice, setPhotoNotice] = useState("");
  const [markEnabled, setMarkEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(LS_KEY_MARK_ENABLED) !== "0";
  });
  const [markText, setMarkText] = useState<string>(() => {
    if (typeof window === "undefined") return "Сообщение от администратора";
    return window.localStorage.getItem(LS_KEY_MARK_TEXT) || "Сообщение от администратора";
  });
  const [segmentId, setSegmentId] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [segmentUserIds, setSegmentUserIds] = useState<number[]>([]);
  const [daysMode, setDaysMode] = useState<"any" | "exact" | "range">("any");
  const [daysExact, setDaysExact] = useState(3);
  const [daysFrom, setDaysFrom] = useState(0);
  const [daysTo, setDaysTo] = useState(3);
  const [gbMode, setGbMode] = useState<"any" | "exact" | "range">("any");
  const [gbExact, setGbExact] = useState(10);
  const [gbFrom, setGbFrom] = useState(0);
  const [gbTo, setGbTo] = useState(10);
  const [segmentBusy, setSegmentBusy] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState("");
  const [segmentPresetEnabled, setSegmentPresetEnabled] = useState(false);
  const [segmentPresetText, setSegmentPresetText] = useState("");
  const [messageButtons, setMessageButtons] = useState<Array<"pay" | "ref" | "sub" | "buygb" | "webapp">>([]);
  const [segmentPreviewUsers, setSegmentPreviewUsers] = useState<Array<{ id: number; name: string; tg_id: string }>>([]);
  const [segmentPreviewLoading, setSegmentPreviewLoading] = useState(false);
  const [autoTextMenuOpen, setAutoTextMenuOpen] = useState(false);
  const [history, setHistory] = useState<CommunicationMessageLogDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRecipients, setHistoryRecipients] = useState<CommunicationMessageLogDto | null>(null);

  async function reloadHistory() {
    setHistoryLoading(true);
    try {
      const data = await listCommunicationHistory(100);
      setHistory(data.items);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [data, segs] = await Promise.all([listCommunicationTargets(), listCommunicationSegments()]);
        setTargets(data.users);
        setSegments(segs.segments);
        if (segs.segments[0]) setSegmentId(segs.segments[0].id);
      } catch (e) {
        setMsg({ type: "err", text: String(e) });
      }
    })();
    void reloadHistory();
  }, []);

  const reachable = useMemo(() => {
    return targets.filter((u) => Number.isFinite(Number(u.tg_id)) && Number(u.tg_id) > 0);
  }, [targets]);
  const chatReachable = useMemo(() => {
    return reachable.filter((u) => u.has_chat === true);
  }, [reachable]);
  const reachableById = useMemo(() => new Map(reachable.map((u) => [u.id, u])), [reachable]);
  const selectedUsers = useMemo(
    () => selectedIds.map((id) => reachableById.get(id)).filter((x): x is CommunicationTargetDto => Boolean(x)),
    [reachableById, selectedIds],
  );
  const pickerLeftList = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = pickerLeft.map((id) => reachableById.get(id)).filter((x): x is CommunicationTargetDto => Boolean(x));
    if (!q) return rows;
    return rows.filter((u) => `${u.id} ${u.name}`.toLowerCase().includes(q));
  }, [pickerLeft, reachableById, query]);
  const pickerRightList = useMemo(() => {
    return pickerRight.map((id) => reachableById.get(id)).filter((x): x is CommunicationTargetDto => Boolean(x));
  }, [pickerRight, reachableById]);
  const usersRightList = useMemo(() => {
    const q = usersQuery.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((u) => `${u.id} ${u.name} ${u.tg_id}`.toLowerCase().includes(q));
  }, [targets, usersQuery]);

  function resetSegmentForm() {
    setSegmentName("");
    setSegmentUserIds([]);
    setDaysMode("any");
    setDaysExact(3);
    setDaysFrom(0);
    setDaysTo(3);
    setGbMode("any");
    setGbExact(10);
    setGbFrom(0);
    setGbTo(10);
    setSegmentPresetEnabled(false);
    setSegmentPresetText("");
    setEditingSegmentId("");
  }

  function segmentPayload() {
    return {
      name: segmentName.trim(),
      user_ids: segmentUserIds,
      days_mode: daysMode,
      days_exact: daysExact,
      days_from: daysFrom,
      days_to: daysTo,
      gb_mode: gbMode,
      gb_exact: gbExact,
      gb_from: gbFrom,
      gb_to: gbTo,
      preset_enabled: segmentPresetEnabled,
      preset_text: segmentPresetText.trim(),
    };
  }

  async function reloadSegments() {
    const segs = await listCommunicationSegments();
    setSegments(segs.segments);
    if (!segmentId && segs.segments[0]) setSegmentId(segs.segments[0].id);
  }

  async function saveSegment() {
    if (!segmentName.trim()) {
      setMsg({ type: "err", text: "Введите название сегмента." });
      return;
    }
    setSegmentBusy(true);
    try {
      if (editingSegmentId) await patchCommunicationSegment(editingSegmentId, segmentPayload());
      else await createCommunicationSegment(segmentPayload());
      await reloadSegments();
      resetSegmentForm();
      setMsg({ type: "ok", text: "Сегмент сохранен." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSegmentBusy(false);
    }
  }

  function editSegment(s: CommunicationSegmentDto) {
    setEditingSegmentId(s.id);
    setSegmentName(s.name);
    setSegmentUserIds(s.user_ids ?? []);
    setDaysMode(s.days_mode);
    setDaysExact(s.days_exact ?? 0);
    setDaysFrom(s.days_from ?? 0);
    setDaysTo(s.days_to ?? 0);
    setGbMode(s.gb_mode);
    setGbExact(s.gb_exact ?? 0);
    setGbFrom(s.gb_from ?? 0);
    setGbTo(s.gb_to ?? 0);
    setSegmentPresetEnabled(s.preset_enabled === true);
    setSegmentPresetText(s.preset_text ?? "");
  }

  async function removeSegment(id: string) {
    const seg = segments.find((s) => s.id === id);
    if (seg && isTestSubscriptionSystemSegment(seg)) {
      setMsg({ type: "err", text: "Системный сегмент нельзя удалить." });
      return;
    }
    setSegmentBusy(true);
    try {
      await deleteCommunicationSegment(id);
      await reloadSegments();
      if (segmentId === id) setSegmentId("");
      if (editingSegmentId === id) resetSegmentForm();
      setMsg({ type: "ok", text: "Сегмент удален." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSegmentBusy(false);
    }
  }

  async function refreshTestSubSegment(id: string) {
    setSegmentBusy(true);
    setMsg(null);
    try {
      const updated = await refreshTestSubscriptionSegment(id);
      await reloadSegments();
      if (editingSegmentId === id) {
        setSegmentUserIds(updated.user_ids ?? []);
      }
      setMsg({ type: "ok", text: `Сегмент обновлён. В списке ${updated.user_ids?.length ?? 0} пользователей.` });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSegmentBusy(false);
    }
  }

  function insertAutoTextToken(token: string) {
    setSegmentPresetEnabled(true);
    setSegmentPresetText((prev) => {
      const next = prev.trim();
      if (!next) return token;
      return `${next} ${token}`.trim();
    });
    setAutoTextMenuOpen(false);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_KEY_MARK_ENABLED, markEnabled ? "1" : "0");
  }, [markEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_KEY_MARK_TEXT, markText);
  }, [markText]);

  useEffect(() => {
    if (!segmentId) {
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
  }, [segmentId]);

  function openPicker() {
    const chosen = selectedIds.filter((id) => reachableById.has(id));
    const chosenSet = new Set(chosen);
    const left = reachable.map((u) => u.id).filter((id) => !chosenSet.has(id));
    setPickerRight(chosen);
    setPickerLeft(left);
    setQuery("");
    setPickerOpen(true);
  }

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

  function savePicker() {
    setSelectedIds(pickerRight.filter((id) => reachableById.has(id)));
    setPickerOpen(false);
  }

  async function submit() {
    setMsg(null);
    setPhotoNotice("");
    setLastResult(null);
    const cleanText = text.trim();
    if (!cleanText) {
      setMsg({ type: "err", text: "Введите текст сообщения." });
      return;
    }
    if (mode === "single" && (!userId || userId <= 0)) {
      setMsg({ type: "err", text: "Выберите клиента." });
      return;
    }
    if (mode === "selected" && selectedUsers.length === 0) {
      setMsg({ type: "err", text: "Выберите клиентов через кнопку «Выбор клиентов»." });
      return;
    }
    if (mode === "segment" && !segmentId) {
      setMsg({ type: "err", text: "Выберите сегмент для рассылки." });
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
        setPhotoNotice(prepared.note);
      }
      const result = await sendCommunication({
        mode,
        text: cleanText,
        ...(mode === "single" ? { user_id: userId } : {}),
        ...(mode === "selected" ? { user_ids: selectedUsers.map((u) => u.id) } : {}),
        ...(mode === "segment" ? { segment_id: segmentId } : {}),
        mark_enabled: markEnabled,
        mark_text: markText.trim(),
        ...(messageButtons.length > 0 ? { buttons: messageButtons } : {}),
        ...(photoBase64
          ? {
              photo_base64: photoBase64,
              photo_mime: photoMime,
              photo_name: photoName,
            }
          : {}),
      });
      setLastResult(result);
      await reloadHistory();
      if (result.ok) {
        setMsg({
          type: "ok",
          text:
            mode === "global"
              ? `Глобальная рассылка завершена: ${result.sent}/${result.attempted}.`
              : `Сообщение отправлено: ${result.sent}/${result.attempted}.`,
        });
      } else {
        setMsg({
          type: "err",
          text: `Отправка завершена с ошибками: ${result.sent}/${result.attempted}, ошибок: ${result.failed}.`,
        });
      }
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <h1>Коммуникации</h1>
        <p className="sub users-hero-sub">
          Рассылки и опросы в Telegram: глобально, выборочно или по сегменту.
        </p>
        <div className="comms-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={commsTab === "broadcasts"}
            className={commsTab === "broadcasts" ? "primary" : "ghost"}
            onClick={() => setCommsTab("broadcasts")}
          >
            Рассылки
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={commsTab === "surveys"}
            className={commsTab === "surveys" ? "primary" : "ghost"}
            onClick={() => setCommsTab("surveys")}
          >
            Опросы
          </button>
        </div>
        {commsTab === "broadcasts" && msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
        {commsTab === "broadcasts" && photoNotice ? <div className="flash ok">{photoNotice}</div> : null}
      </section>

      {commsTab === "surveys" ? (
        <section className="panel comms-panel">
          <SurveysPanel />
        </section>
      ) : null}

      {commsTab === "broadcasts" ? (
      <>
      <section className="panel comms-panel">
        <div className="comms-layout">
          <div className="comms-left">
            <div className="comms-mode-row">
              <button
                type="button"
                className={mode === "global" ? "primary" : "ghost"}
                disabled={busy}
                onClick={() => setMode("global")}
              >
                Глобально всем клиентам
              </button>
              <button
                type="button"
                className={mode === "single" ? "primary" : "ghost"}
                disabled={busy}
                onClick={() => setMode("single")}
              >
                Сообщение выбранному клиенту
              </button>
              <button
                type="button"
                className={mode === "selected" ? "primary" : "ghost"}
                disabled={busy}
                onClick={() => setMode("selected")}
              >
                Выбор клиентов
              </button>
              <button
                type="button"
                className={mode === "segment" ? "primary" : "ghost"}
                disabled={busy}
                onClick={() => setMode("segment")}
              >
                Выбор сегмента
              </button>
            </div>

            <div className="form-field" style={{ marginTop: "0.75rem" }}>
              <div className="shop-toggle-row">
                <div>
                  <label>Пометка сообщения</label>
                  <p className="field-hint" style={{ marginTop: "0.2rem" }}>
                    Автосохранение включено. По умолчанию используется «Сообщение от администратора».
                  </p>
                </div>
                <button
                  type="button"
                  className={`toggle ${markEnabled ? "on" : ""}`}
                  aria-pressed={markEnabled}
                  disabled={busy}
                  onClick={() => setMarkEnabled((v) => !v)}
                />
              </div>
              {markEnabled ? (
                <input
                  value={markText}
                  disabled={busy}
                  onChange={(e) => setMarkText(e.target.value)}
                  placeholder="Сообщение от администратора"
                />
              ) : null}
            </div>

            {mode === "single" ? (
              <div className="form-field" style={{ marginTop: "0.9rem" }}>
                <label>Клиент</label>
                <select
                  value={userId > 0 ? String(userId) : ""}
                  disabled={busy}
                  onChange={(e) => setUserId(Number(e.target.value) || 0)}
                >
                  <option value="">Выберите клиента</option>
                  {reachable.map((u) => (
                    <option key={u.id} value={u.id}>
                      {subscriptionLabel(u)} ({u.enable ? "вкл" : "выкл"})
                    </option>
                  ))}
                </select>
              </div>
            ) : mode === "selected" ? (
              <div className="form-field" style={{ marginTop: "0.9rem" }}>
                <label>Выбранные клиенты</label>
                <div className="comms-selected-row">
                  <button type="button" className="ghost" disabled={busy} onClick={openPicker}>
                    Выбор клиентов
                  </button>
                  <span className="field-hint">Выбрано: {selectedUsers.length}</span>
                </div>
                {selectedUsers.length > 0 ? (
                  <div className="comms-selected-chips">
                    {selectedUsers.slice(0, 8).map((u) => (
                      <span key={u.id} className="comms-chip">
                        {subscriptionLabel(u)}
                      </span>
                    ))}
                    {selectedUsers.length > 8 ? <span className="comms-chip">+{selectedUsers.length - 8}</span> : null}
                  </div>
                ) : null}
              </div>
            ) : mode === "segment" ? (
              <div className="form-field" style={{ marginTop: "0.9rem" }}>
                <label>Сегмент для рассылки</label>
                <select
                  value={segmentId}
                  disabled={busy}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSegmentId(nextId);
                    const picked = segments.find((s) => s.id === nextId);
                    if (picked?.preset_enabled && picked.preset_text.trim()) {
                      setText(picked.preset_text);
                    }
                  }}
                >
                  <option value="">Выберите сегмент</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {segmentPreviewLoading ? <div className="comms-segment-loading-line" aria-hidden /> : null}
                {!segmentPreviewLoading && segmentId ? (
                  <div className="comms-segment-preview-list">
                    {segmentPreviewUsers.length === 0 ? (
                      <p className="field-hint">В сегменте нет пользователей с чатом.</p>
                    ) : (
                      segmentPreviewUsers.map((u) => (
                        <span key={u.id} className="comms-chip">
                          {subscriptionLabel(u)}
                        </span>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="sub" style={{ marginTop: "0.9rem", marginBottom: "0.6rem" }}>
                Будет отправлено по {reachable.length} Telegram chat id.
              </p>
            )}

            <div className="form-field">
              <label>Текст сообщения</label>
              <textarea
                className="comms-textarea"
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                placeholder="Введите сообщение для отправки..."
              />
            </div>

            <div className="form-field" style={{ marginTop: "0.8rem" }}>
              <label>Фото (опционально)</label>
              <div className="comms-file-row">
                <label className={`ghost comms-file-btn ${busy ? "disabled" : ""}`}>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    className="comms-file-input"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  />
                  Выбор файла
                </label>
                <span className="comms-file-name">{photo ? photo.name : "Не выбран ни один файл"}</span>
              </div>
              <p className="field-hint">{photo ? `Фото: ${photo.name}` : "Фото не выбрано."}</p>
            </div>

            <div className="form-field" style={{ marginTop: "0.5rem" }}>
              <label>Кнопки под сообщением</label>
              <div className="comms-buttons-grid">
                {([
                  ["pay", "Оплата подписки"],
                  ["ref", "Пригласи друга"],
                  ["sub", "Подписка"],
                  ["buygb", "Докупить ГБ"],
                  ["webapp", "Открыть приложение"],
                ] as const).map(([id, label]) => {
                  const active = messageButtons.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={active ? "primary" : "ghost"}
                      onClick={() =>
                        setMessageButtons((prev) =>
                          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                        )
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="row-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
                {busy ? "Отправка..." : "Отправить"}
              </button>
            </div>

            {lastResult && lastResult.failures.length > 0 ? (
              <div className="comms-failures">
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

            <div className="comms-segments-bottom">
              <h3 className="user-modal-section-title">Сегменты</h3>
              <div className="comms-segments-grid">
                <div className="comms-segment-builder">
                  <div className="form-field">
                    <label>Название сегмента</label>
                    <input
                      value={segmentName}
                      onChange={(e) => setSegmentName(e.target.value)}
                      placeholder="Например: Заканчиваются через 5 дней"
                    />
                  </div>
                  <div className="form-field">
                    <label>Выбор пользователей (если пусто — все)</label>
                    <select
                      multiple
                      size={7}
                      value={segmentUserIds.map(String)}
                      onChange={(e) => {
                        const ids = Array.from(e.currentTarget.selectedOptions).map((o) => Number(o.value));
                        setSegmentUserIds(ids.filter((n) => Number.isFinite(n) && n > 0));
                      }}
                    >
                      {chatReachable.map((u) => (
                        <option key={u.id} value={u.id}>
                          {subscriptionLabel(u)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Дней до конца подписки</label>
                    <select value={daysMode} onChange={(e) => setDaysMode(e.target.value as "any" | "exact" | "range")}>
                      <option value="any">Не имеет значения</option>
                      <option value="exact">Ровно столько дней</option>
                      <option value="range">Интервал дней</option>
                    </select>
                    {daysMode === "exact" ? (
                      <input inputMode="numeric" value={daysExact} onChange={(e) => setDaysExact(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                    ) : null}
                    {daysMode === "range" ? (
                      <div className="comms-range-row">
                        <label className="comms-range-label">
                          <span>От</span>
                          <input inputMode="numeric" value={daysFrom} onChange={(e) => setDaysFrom(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                        </label>
                        <label className="comms-range-label">
                          <span>До</span>
                          <input inputMode="numeric" value={daysTo} onChange={(e) => setDaysTo(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                        </label>
                      </div>
                    ) : null}
                  </div>
                  <div className="form-field">
                    <label>ГБ осталось</label>
                    <select value={gbMode} onChange={(e) => setGbMode(e.target.value as "any" | "exact" | "range")}>
                      <option value="any">Не имеет значения</option>
                      <option value="exact">Ровно столько ГБ</option>
                      <option value="range">Интервал ГБ</option>
                    </select>
                    {gbMode === "exact" ? (
                      <input inputMode="numeric" value={gbExact} onChange={(e) => setGbExact(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                    ) : null}
                    {gbMode === "range" ? (
                      <div className="comms-range-row">
                        <label className="comms-range-label">
                          <span>От</span>
                          <input inputMode="numeric" value={gbFrom} onChange={(e) => setGbFrom(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                        </label>
                        <label className="comms-range-label">
                          <span>До</span>
                          <input inputMode="numeric" value={gbTo} onChange={(e) => setGbTo(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                        </label>
                      </div>
                    ) : null}
                  </div>
                  <div className="form-field">
                    <div className="shop-toggle-row">
                      <div>
                        <label>Готовый текст для рассылки</label>
                        <p className="field-hint">По умолчанию выключено. Если включить, текст сегмента подставится в сообщение.</p>
                      </div>
                      <button
                        type="button"
                        className={`toggle ${segmentPresetEnabled ? "on" : ""}`}
                        onClick={() => setSegmentPresetEnabled((v) => !v)}
                      />
                    </div>
                    <textarea
                      className="comms-textarea"
                      style={{ minHeight: "90px" }}
                      disabled={!segmentPresetEnabled}
                      value={segmentPresetText}
                      onChange={(e) => setSegmentPresetText(e.target.value)}
                      placeholder="Например: Пользователь, ваша подписка заканчивается через {days_before_end}. Остаток: {gb_before_end}."
                    />
                    <p className="field-hint">
                      Поддерживаются персональные плейсхолдеры: <code>{"{days_before_end}"}</code> и <code>{"{gb_before_end}"}</code>.
                    </p>
                    <div className="comms-autotext-wrap">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setAutoTextMenuOpen((v) => !v)}
                        disabled={!segmentPresetEnabled}
                      >
                        Автотекст
                      </button>
                      {autoTextMenuOpen ? (
                        <div className="comms-autotext-menu">
                          <button type="button" className="ghost" onClick={() => insertAutoTextToken("{days_before_end}")}>
                            {"{days_before_end}"}
                          </button>
                          <button type="button" className="ghost" onClick={() => insertAutoTextToken("{gb_before_end}")}>
                            {"{gb_before_end}"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="primary" disabled={segmentBusy} onClick={() => void saveSegment()}>
                      {segmentBusy ? "Сохранение..." : editingSegmentId ? "Сохранить изменения" : "Создать сегмент"}
                    </button>
                    {editingSegmentId ? (
                      <button type="button" className="ghost" disabled={segmentBusy} onClick={resetSegmentForm}>
                        Отменить редактирование
                      </button>
                    ) : null}
                  </div>
                </div>
                <aside className="comms-segment-list">
                  <label className="referral-feed-label">Сегменты</label>
                  <div className="mysub-stat-list">
                    {segments.map((s) => (
                      <div key={s.id}>
                        <b>{s.name}</b>
                        <div className="field-hint">Пользователи: {s.user_ids.length > 0 ? s.user_ids.length : "все с чатом"}</div>
                        <div className="row-actions" style={{ marginTop: "0.4rem" }}>
                          <button type="button" className="ghost" onClick={() => editSegment(s)}>
                            Редактировать
                          </button>
                          {isTestSubscriptionSystemSegment(s) ? (
                            <button
                              type="button"
                              className="ghost"
                              disabled={segmentBusy}
                              onClick={() => void refreshTestSubSegment(s.id)}
                            >
                              Обновить
                            </button>
                          ) : (
                            <button type="button" className="ghost" disabled={segmentBusy} onClick={() => void removeSegment(s.id)}>
                              Удалить
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            </div>
          </div>
          <aside className="comms-right" aria-label="Список клиентов и статус чата">
            <label className="referral-feed-label">Все пользователи</label>
            <input
              className="comms-users-search"
              value={usersQuery}
              onChange={(e) => setUsersQuery(e.target.value)}
              placeholder="Поиск: id, имя, tg-id"
            />
            <div className="ref-ios-wheel" role="log">
              <div className="ref-ios-wheel-mask" aria-hidden="true" />
              <div className="ref-ios-wheel-scroll">
                {usersRightList.length === 0 ? (
                  <p className="sub ref-ios-empty">Пользователей пока нет.</p>
                ) : (
                  usersRightList.map((u) => {
                    const hasChat = u.has_chat === true;
                    return (
                      <div key={u.id} className="ref-ios-row">
                        <span className="ref-ios-line">
                          {subscriptionLabel(u)}
                        </span>
                        <span className="ref-ios-date comms-chat-meta">
                          <span className={`comms-chat-dot ${hasChat ? "ok" : "no"}`} aria-hidden />
                          tg-id: {u.tg_id || "—"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        </div>
      </section>

      {pickerOpen ? (
        <div className="modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="modal comms-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Выбор клиентов</h2>
              <button type="button" className="ghost modal-close" onClick={() => setPickerOpen(false)}>
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
                        {subscriptionLabel(u)}
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
                        {subscriptionLabel(u)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="ghost" onClick={() => setPickerOpen(false)}>
                Отмена
              </button>
              <button type="button" className="primary" onClick={savePicker}>
                Ок
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="panel comms-history-panel">
        <h2 className="user-modal-section-title">История отправок</h2>
        <p className="field-hint" style={{ marginTop: "0.25rem", marginBottom: "0.75rem" }}>
          Все исходящие сообщения в Telegram: рассылки из панели и автоматические уведомления.
        </p>
        {historyLoading ? (
          <p className="sub">Загрузка истории…</p>
        ) : history.length === 0 ? (
          <p className="sub">Пока нет записей — отправьте сообщение или дождитесь автоматического уведомления.</p>
        ) : (
          <div className="comms-history-list" role="log">
            {history.map((item) => {
              const when = new Date(item.sent_at);
              const whenLabel = Number.isFinite(when.getTime())
                ? when.toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : item.sent_at;
              const many = item.recipients.length > 3;
              return (
                <article key={item.id} className="comms-history-item">
                  <div className="comms-history-head">
                    <time className="comms-history-time" dateTime={item.sent_at}>
                      {whenLabel}
                    </time>
                    {item.automatic ? <span className="comms-history-badge">Авто</span> : null}
                    <span className="comms-history-source">{item.source_label}</span>
                    {item.segment_name ? (
                      <span className="comms-history-segment" title={item.segment_id}>
                        · {item.segment_name}
                      </span>
                    ) : null}
                    {item.has_photo ? <span className="comms-history-photo" title="С фото">фото</span> : null}
                    <span className="comms-history-stats">
                      {item.sent}/{item.attempted}
                      {item.failed > 0 ? ` · ошибок: ${item.failed}` : ""}
                    </span>
                  </div>
                  <p className="comms-history-text">{item.text}</p>
                  <div className="comms-history-recipients">
                    {item.recipients.length === 0 ? (
                      <span className="field-hint">Получатели не указаны</span>
                    ) : many ? (
                      <>
                        <span className="comms-history-recipients-summary">
                          {item.recipients.length} получателей
                        </span>
                        <button
                          type="button"
                          className="comms-recipients-eye"
                          title="Показать список получателей"
                          aria-label="Показать список получателей"
                          onClick={() => setHistoryRecipients(item)}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path
                              d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"
                              stroke="currentColor"
                              strokeWidth="1.6"
                            />
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      item.recipients.map((r) => (
                        <span key={`${item.id}-${r.user_id}-${r.user_name}`} className="comms-chip">
                          {r.user_name}
                        </span>
                      ))
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {historyRecipients ? (
        <div className="modal-backdrop" onClick={() => setHistoryRecipients(null)}>
          <div className="modal comms-recipients-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Получатели</h2>
              <button type="button" className="ghost modal-close" onClick={() => setHistoryRecipients(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="field-hint" style={{ marginBottom: "0.65rem" }}>
                {historyRecipients.source_label} · {historyRecipients.recipients.length} чел.
              </p>
              <div className="comms-recipients-modal-list">
                {historyRecipients.recipients.map((r) => (
                  <div key={`${historyRecipients.id}-${r.user_id}`} className="comms-recipients-modal-row">
                    {r.user_name}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={() => setHistoryRecipients(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </>
      ) : null}

    </DashboardLayout>
  );
}
