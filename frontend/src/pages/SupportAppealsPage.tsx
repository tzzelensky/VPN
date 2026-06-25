import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import Spinner from "../components/Spinner";
import {
  completeSupportAppeal,
  deleteSupportAppeal,
  loadSupportAppeals,
  saveSupportAppealsConfig,
  supportAppealPhotoUrl,
  supportAppealReplyPhotoUrl,
  takeSupportAppeal,
  type SupportAppealDto,
  type SupportAppealsConfigDto,
} from "../api";

type PhotoViewerState = {
  appealId: string;
  kind: "user" | "reply";
  index: number;
  total: number;
};

function statusLabel(s: SupportAppealDto["status"]): string {
  if (s === "new") return "Новое";
  if (s === "in_progress") return "В работе";
  return "Закрыто";
}

function userLabel(a: SupportAppealDto): string {
  if (a.tg_username) return `@${a.tg_username.replace(/^@/, "")}`;
  if (a.tg_first_name) return a.tg_first_name;
  return `TG ${a.tg_user_id}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function photoCount(a: SupportAppealDto): number {
  return a.photo_count ?? a.photo_file_ids.length + (a.photo_paths?.length ?? 0);
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Не удалось прочитать фото"));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsDataURL(file);
  });
}

async function compressImage(file: File): Promise<{ base64: string; mime: string; name: string }> {
  if (!file.type.startsWith("image/")) {
    return { base64: await fileToDataUrl(file), mime: file.type || "application/octet-stream", name: file.name };
  }
  const imageBitmap = await createImageBitmap(file);
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(imageBitmap.width, imageBitmap.height));
  const w = Math.max(1, Math.round(imageBitmap.width * scale));
  const h = Math.max(1, Math.round(imageBitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать фото.");
  ctx.drawImage(imageBitmap, 0, 0, w, h);
  imageBitmap.close();
  return { base64: canvas.toDataURL("image/jpeg", 0.72), mime: "image/jpeg", name: "reply.jpg" };
}

export default function SupportAppealsPage({ onLogout }: { onLogout: () => void }) {
  const [cfg, setCfg] = useState<SupportAppealsConfigDto | null>(null);
  const [appeals, setAppeals] = useState<SupportAppealDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [takingId, setTakingId] = useState<string | null>(null);
  const [viewAppeal, setViewAppeal] = useState<SupportAppealDto | null>(null);
  const [completeAppeal, setCompleteAppeal] = useState<SupportAppealDto | null>(null);
  const [completeText, setCompleteText] = useState("");
  const [completePhotos, setCompletePhotos] = useState<File[]>([]);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [photoViewer, setPhotoViewer] = useState<PhotoViewerState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const r = await loadSupportAppeals();
      setCfg(r.config);
      setAppeals(r.appeals ?? []);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!photoViewer) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPhotoViewer(null);
        return;
      }
      if (e.key === "ArrowLeft") {
        setPhotoViewer((v) => (v && v.index > 0 ? { ...v, index: v.index - 1 } : v));
      }
      if (e.key === "ArrowRight") {
        setPhotoViewer((v) => (v && v.index < v.total - 1 ? { ...v, index: v.index + 1 } : v));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photoViewer]);

  async function onSaveConfig() {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    try {
      const next = await saveSupportAppealsConfig(cfg);
      setCfg(next);
      setMsg({ type: "ok", text: "Настройки сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function onTake(id: string) {
    setTakingId(id);
    setMsg(null);
    try {
      const r = await takeSupportAppeal(id);
      setAppeals((prev) => prev.map((a) => (a.id === id ? r.appeal : a)));
      setMsg({ type: "ok", text: "Обращение взято в работу. Пользователю отправлено уведомление." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setTakingId(null);
    }
  }

  function openComplete(a: SupportAppealDto) {
    setCompleteAppeal(a);
    setCompleteText("");
    setCompletePhotos([]);
  }

  async function submitComplete() {
    if (!completeAppeal) return;
    const reply_text = completeText.trim();
    if (!reply_text) {
      setMsg({ type: "err", text: "Введите текст ответа пользователю." });
      return;
    }
    setCompleteBusy(true);
    setMsg(null);
    try {
      const photos: Array<{ base64: string; mime?: string; name?: string }> = [];
      for (const f of completePhotos.slice(0, 5)) {
        const c = await compressImage(f);
        photos.push({ base64: c.base64, mime: c.mime, name: c.name });
      }
      const r = await completeSupportAppeal(completeAppeal.id, { reply_text, photos });
      setAppeals((prev) => prev.map((a) => (a.id === completeAppeal.id ? r.appeal : a)));
      setCompleteAppeal(null);
      setMsg({ type: "ok", text: "Обращение завершено. Пользователю отправлен ответ в Telegram." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setCompleteBusy(false);
    }
  }

  function photoUrlFor(view: PhotoViewerState): string {
    return view.kind === "user"
      ? supportAppealPhotoUrl(view.appealId, view.index)
      : supportAppealReplyPhotoUrl(view.appealId, view.index);
  }

  function openPhotoViewer(a: SupportAppealDto, kind: "user" | "reply", index: number) {
    const total = kind === "user" ? photoCount(a) : (a.admin_reply_photo_paths?.length ?? 0);
    if (total <= 0) return;
    setPhotoViewer({ appealId: a.id, kind, index: Math.min(index, total - 1), total });
  }

  async function onDeleteAppeal(id: string) {
    if (!window.confirm("Удалить это обращение? Данные и вложения будут удалены безвозвратно.")) return;
    setDeletingId(id);
    setMsg(null);
    try {
      await deleteSupportAppeal(id);
      setAppeals((prev) => prev.filter((a) => a.id !== id));
      if (viewAppeal?.id === id) setViewAppeal(null);
      if (photoViewer?.appealId === id) setPhotoViewer(null);
      setMsg({ type: "ok", text: "Обращение удалено." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setDeletingId(null);
    }
  }

  function statusBadgeClass(status: SupportAppealDto["status"]): string {
    if (status === "new") return "badge warn";
    if (status === "in_progress") return "badge ok";
    return "badge muted";
  }

  function renderAppealActions(a: SupportAppealDto) {
    return (
      <div className="appeals-row-actions">
        <button
          type="button"
          className="ghost appeals-icon-btn"
          title="Просмотреть обращение"
          aria-label="Просмотреть обращение"
          onClick={() => setViewAppeal(a)}
        >
          <EyeIcon />
          {photoCount(a) > 0 ? <span className="appeals-photo-badge">{photoCount(a)}</span> : null}
        </button>
        {a.status === "new" ? (
          <button type="button" className="primary" disabled={takingId === a.id} onClick={() => void onTake(a.id)}>
            {takingId === a.id ? "…" : "Взять в работу"}
          </button>
        ) : a.status === "in_progress" ? (
          <button type="button" className="ghost" onClick={() => openComplete(a)}>
            Завершить
          </button>
        ) : null}
        <button
          type="button"
          className="ghost appeals-delete-btn"
          disabled={deletingId === a.id}
          onClick={() => void onDeleteAppeal(a.id)}
        >
          {deletingId === a.id ? "…" : "Удалить"}
        </button>
      </div>
    );
  }

  function renderPhotoGrid(a: SupportAppealDto, kind: "user" | "reply") {
    const count =
      kind === "user"
        ? photoCount(a)
        : (a.admin_reply_photo_paths?.length ?? 0);
    if (count <= 0) return <p className="sub">Нет вложений.</p>;
    return (
      <div className="appeals-photo-grid">
        {Array.from({ length: count }, (_, i) => {
          const src =
            kind === "user" ? supportAppealPhotoUrl(a.id, i) : supportAppealReplyPhotoUrl(a.id, i);
          return (
            <button
              key={`${kind}-${i}`}
              type="button"
              className="appeals-photo-thumb"
              title="Открыть фото"
              onClick={() => openPhotoViewer(a, kind, i)}
            >
              <img src={src} alt="" loading="lazy" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <div className="users-hero-top">
          <div>
            <h1>Обращения</h1>
            <p className="sub users-hero-sub">Поддержка в боте и WebApp. Просмотр вложений и ответ пользователю.</p>
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={loading || saving} onClick={() => void refresh()}>
              Обновить
            </button>
            <button type="button" className="primary" disabled={!cfg || saving} onClick={() => void onSaveConfig()}>
              {saving ? (
                <>
                  <Spinner /> Сохранение…
                </>
              ) : (
                "Сохранить"
              )}
            </button>
          </div>
        </div>
        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
        {cfg ? (
          <div className="shop-toggle-row" style={{ marginTop: "1rem" }}>
            <span>Кнопка «Сообщить о проблеме» в боте и WebApp</span>
            <button
              type="button"
              className={`toggle ${cfg.enabled ? "on" : ""}`}
              onClick={() => setCfg({ ...cfg, enabled: !cfg.enabled })}
              aria-pressed={cfg.enabled}
            />
          </div>
        ) : null}
      </section>

      <section className="panel appeals-panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Список обращений</h2>
        {loading ? (
          <p className="sub">Загрузка…</p>
        ) : appeals.length === 0 ? (
          <p className="sub">Обращений пока нет.</p>
        ) : (
          <>
            <div className="appeals-mobile-list" aria-label="Список обращений">
              {appeals.map((a) => (
                <article key={a.id} className="appeals-mobile-card">
                  <div className="appeals-mobile-card-head">
                    <time className="appeals-mobile-date">{formatWhen(a.created_at)}</time>
                    <span className={statusBadgeClass(a.status)}>{statusLabel(a.status)}</span>
                  </div>
                  <div className="appeals-user-cell">{userLabel(a)}</div>
                  <p className="appeals-mobile-text">{a.text_preview ?? a.text}</p>
                  <div className="appeals-mobile-meta">
                    <span>{a.source === "webapp" ? "WebApp" : "Бот"}</span>
                    {photoCount(a) > 0 ? <span className="appeals-mobile-photos">📷 {photoCount(a)}</span> : null}
                  </div>
                  {renderAppealActions(a)}
                </article>
              ))}
            </div>
            <div className="table-wrap appeals-table-wrap">
              <table className="data-table appeals-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Пользователь</th>
                    <th>Источник</th>
                    <th>Статус</th>
                    <th aria-label="Просмотр" />
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {appeals.map((a) => (
                    <tr key={a.id}>
                      <td className="appeals-td-nowrap">{formatWhen(a.created_at)}</td>
                      <td>
                        <div className="appeals-user-cell">{userLabel(a)}</div>
                        <div className="appeals-text-preview" title={a.text}>
                          {a.text_preview ?? (a.text.length > 80 ? `${a.text.slice(0, 80)}…` : a.text)}
                        </div>
                      </td>
                      <td className="appeals-td-nowrap">{a.source === "webapp" ? "WebApp" : "Бот"}</td>
                      <td className="appeals-td-nowrap">
                        <span className={statusBadgeClass(a.status)}>{statusLabel(a.status)}</span>
                      </td>
                      <td className="appeals-td-actions">
                        <button
                          type="button"
                          className="ghost appeals-icon-btn"
                          title="Просмотреть обращение"
                          aria-label="Просмотреть обращение"
                          onClick={() => setViewAppeal(a)}
                        >
                          <EyeIcon />
                          {photoCount(a) > 0 ? <span className="appeals-photo-badge">{photoCount(a)}</span> : null}
                        </button>
                      </td>
                      <td className="appeals-td-actions">
                        <div className="appeals-row-actions appeals-row-actions-inline">
                          {a.status === "new" ? (
                            <button
                              type="button"
                              className="primary"
                              disabled={takingId === a.id}
                              onClick={() => void onTake(a.id)}
                            >
                              {takingId === a.id ? "…" : "Взять в работу"}
                            </button>
                          ) : a.status === "in_progress" ? (
                            <button type="button" className="ghost" onClick={() => openComplete(a)}>
                              Завершить
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ghost appeals-delete-btn"
                            disabled={deletingId === a.id}
                            onClick={() => void onDeleteAppeal(a.id)}
                          >
                            {deletingId === a.id ? "…" : "Удалить"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {viewAppeal ? (
        <div className="modal-backdrop" onClick={() => setViewAppeal(null)}>
          <div className="modal appeals-view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Обращение</h2>
              <button type="button" className="ghost modal-close" onClick={() => setViewAppeal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="sub" style={{ marginTop: 0 }}>
                {userLabel(viewAppeal)} · {viewAppeal.source === "webapp" ? "WebApp" : "Бот"} · {formatWhen(viewAppeal.created_at)}
              </p>
              <div className="appeals-view-text">{viewAppeal.text}</div>
              <h3 className="appeals-view-subtitle">Вложения пользователя</h3>
              {renderPhotoGrid(viewAppeal, "user")}
              {viewAppeal.status === "closed" && viewAppeal.admin_reply_text ? (
                <>
                  <h3 className="appeals-view-subtitle">Ответ администратора</h3>
                  <div className="appeals-view-text">{viewAppeal.admin_reply_text}</div>
                  {renderPhotoGrid(viewAppeal, "reply")}
                </>
              ) : null}
            </div>
            <div className="modal-footer appeals-modal-footer">
              {viewAppeal.status === "in_progress" ? (
                <button type="button" className="primary" onClick={() => { setViewAppeal(null); openComplete(viewAppeal); }}>
                  Завершить обращение
                </button>
              ) : null}
              <button
                type="button"
                className="ghost appeals-delete-btn"
                disabled={deletingId === viewAppeal.id}
                onClick={() => void onDeleteAppeal(viewAppeal.id)}
              >
                {deletingId === viewAppeal.id ? "Удаление…" : "Удалить обращение"}
              </button>
              <button type="button" className="ghost" onClick={() => setViewAppeal(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {completeAppeal ? (
        <div className="modal-backdrop" onClick={() => !completeBusy && setCompleteAppeal(null)}>
          <div className="modal appeals-complete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Завершить обращение</h2>
              <button type="button" className="ghost modal-close" disabled={completeBusy} onClick={() => setCompleteAppeal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="sub" style={{ marginTop: 0 }}>
                Сообщение уйдёт пользователю {userLabel(completeAppeal)} в Telegram.
              </p>
              <div className="form-field" style={{ marginTop: "0.75rem" }}>
                <label>Ответ пользователю</label>
                <textarea
                  rows={6}
                  value={completeText}
                  onChange={(e) => setCompleteText(e.target.value)}
                  placeholder="Текст ответа…"
                  maxLength={8000}
                  disabled={completeBusy}
                />
              </div>
              <div className="form-field" style={{ marginTop: "0.65rem" }}>
                <label>Фото к ответу (необязательно)</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={completeBusy || completePhotos.length >= 5}
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    setCompletePhotos((prev) => [...prev, ...list].slice(0, 5));
                    e.target.value = "";
                  }}
                />
                <p className="field-hint">{completePhotos.length ? `Файлов: ${completePhotos.length}` : "До 5 изображений"}</p>
              </div>
            </div>
            <div className="modal-footer appeals-modal-footer">
              <button type="button" className="ghost" disabled={completeBusy} onClick={() => setCompleteAppeal(null)}>
                Отмена
              </button>
              <button type="button" className="primary" disabled={completeBusy} onClick={() => void submitComplete()}>
                {completeBusy ? "Отправка…" : "Завершить и отправить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {photoViewer ? (
        <div className="modal-backdrop appeals-photo-backdrop" onClick={() => setPhotoViewer(null)}>
          <div className="appeals-photo-viewer" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="ghost appeals-photo-viewer-close" aria-label="Закрыть" onClick={() => setPhotoViewer(null)}>
              ×
            </button>
            <div className="appeals-photo-viewer-stage">
              {photoViewer.index > 0 ? (
                <button
                  type="button"
                  className="ghost appeals-photo-nav appeals-photo-nav-prev"
                  aria-label="Предыдущее фото"
                  onClick={() => setPhotoViewer({ ...photoViewer, index: photoViewer.index - 1 })}
                >
                  ‹
                </button>
              ) : null}
              <img
                key={`${photoViewer.appealId}-${photoViewer.kind}-${photoViewer.index}`}
                src={photoUrlFor(photoViewer)}
                alt=""
                className="appeals-photo-viewer-img"
              />
              {photoViewer.index < photoViewer.total - 1 ? (
                <button
                  type="button"
                  className="ghost appeals-photo-nav appeals-photo-nav-next"
                  aria-label="Следующее фото"
                  onClick={() => setPhotoViewer({ ...photoViewer, index: photoViewer.index + 1 })}
                >
                  ›
                </button>
              ) : null}
            </div>
            <div className="appeals-photo-viewer-bar">
              <span className="sub">
                {photoViewer.index + 1} / {photoViewer.total}
              </span>
              <a
                className="ghost appeals-photo-download"
                href={photoUrlFor(photoViewer)}
                download={`appeal-${photoViewer.appealId}-${photoViewer.kind}-${photoViewer.index + 1}.jpg`}
              >
                Скачать
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
