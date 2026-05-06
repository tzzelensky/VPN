import { useEffect, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import ExpiryDateTimePicker from "../components/ExpiryDateTimePicker";
import {
  createPromoCode,
  deletePromoCode,
  listPromoCodeUsages,
  listPromoCodes,
  patchPromoCode,
  type PromoCodeDto,
  type PromoCodeUsageDto,
} from "../api";

function toExpiryIsoFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const base = new Date(ms);
  const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toISOString();
}

function IconPencil() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PromoCodesPage({ onLogout }: { onLogout: () => void }) {
  const [promos, setPromos] = useState<PromoCodeDto[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState(10);
  const [oneTime, setOneTime] = useState(true);
  const [active, setActive] = useState(true);
  const [validUntilMs, setValidUntilMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [statsPromoId, setStatsPromoId] = useState<string | null>(null);
  const [statsById, setStatsById] = useState<Record<string, PromoCodeUsageDto[]>>({});
  const [statsLoadingId, setStatsLoadingId] = useState<string | null>(null);

  const [editPromo, setEditPromo] = useState<PromoCodeDto | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editDiscount, setEditDiscount] = useState(10);
  const [editOneTime, setEditOneTime] = useState(true);
  const [editActive, setEditActive] = useState(true);
  const [editValidUntilMs, setEditValidUntilMs] = useState(0);

  async function reload() {
    const data = await listPromoCodes();
    setPromos(data.promos);
  }

  useEffect(() => {
    void reload().catch((e) => setMsg({ type: "err", text: String(e) }));
  }, []);

  async function onCreate() {
    setBusy(true);
    setMsg(null);
    try {
      await createPromoCode({
        name: name.trim(),
        code: code.trim().toLocaleUpperCase("ru-RU"),
        discount_percent: Math.max(1, Math.min(99, Math.floor(Number(discount) || 0))),
        one_time_per_user: oneTime,
        active,
        valid_until: toExpiryIsoFromMs(validUntilMs),
      });
      setName("");
      setCode("");
      setDiscount(10);
      setOneTime(true);
      setActive(true);
      setValidUntilMs(0);
      setMsg({ type: "ok", text: "Промокод создан." });
      await reload();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStats(p: PromoCodeDto) {
    if (statsPromoId === p.id) {
      setStatsPromoId(null);
      return;
    }
    setStatsPromoId(p.id);
    if (statsById[p.id]) return;
    setStatsLoadingId(p.id);
    try {
      const data = await listPromoCodeUsages(p.id);
      setStatsById((prev) => ({ ...prev, [p.id]: data.usages }));
    } catch {
      setStatsById((prev) => ({ ...prev, [p.id]: [] }));
    } finally {
      setStatsLoadingId(null);
    }
  }

  function openEdit(p: PromoCodeDto) {
    setEditPromo(p);
    setEditName(p.name);
    setEditCode(p.code);
    setEditDiscount(p.discount_percent);
    setEditOneTime(p.one_time_per_user);
    setEditActive(p.active !== false);
    setEditValidUntilMs(Number.isFinite(Date.parse(p.valid_until)) ? Date.parse(p.valid_until) : 0);
  }

  async function onSaveEdit() {
    if (!editPromo) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated = await patchPromoCode(editPromo.id, {
        name: editName.trim(),
        code: editCode.trim().toLocaleUpperCase("ru-RU"),
        discount_percent: Math.max(1, Math.min(99, Math.floor(Number(editDiscount) || 0))),
        one_time_per_user: editOneTime,
        active: editActive,
        valid_until: toExpiryIsoFromMs(editValidUntilMs),
      });
      setEditPromo(null);
      setMsg({ type: "ok", text: "Промокод обновлен." });
      setStatsById((prev) => {
        const next = { ...prev };
        delete next[updated.id];
        return next;
      });
      if (statsPromoId === updated.id) setStatsPromoId(null);
      await reload();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePromo(p: PromoCodeDto) {
    if (!window.confirm(`Удалить промокод «${p.name}» (${p.code})?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await deletePromoCode(p.id);
      setStatsById((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      if (statsPromoId === p.id) setStatsPromoId(null);
      if (editPromo?.id === p.id) setEditPromo(null);
      setMsg({ type: "ok", text: "Промокод удален." });
      await reload();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <h1>Промокоды</h1>
        <p className="sub users-hero-sub">Создание промокодов и просмотр, кто и сколько раз их применял.</p>
        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
      </section>

      <section className="panel">
        <div className="promos-layout">
          <div className="promos-create">
            <div className="form-field">
              <label>Название промокода</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Майская акция" />
            </div>
            <div className="form-field">
              <label>Текст промокода</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toLocaleUpperCase("ru-RU").replace(/\s+/g, ""))}
                placeholder="МАЙСКИДКА25"
              />
            </div>
            <div className="form-field">
              <label>Процент скидки</label>
              <input
                inputMode="numeric"
                value={discount}
                onChange={(e) => setDiscount(Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 0))))}
              />
            </div>
            <div className="form-field shop-toggle-row">
              <div>
                <label>Промокод активен</label>
                <p className="field-hint">Неактивный промокод нельзя применить.</p>
              </div>
              <button type="button" className={`toggle ${active ? "on" : ""}`} onClick={() => setActive((v) => !v)} />
            </div>
            <div className="form-field">
              <label>Действует до (дата)</label>
              <ExpiryDateTimePicker valueMs={validUntilMs} onChangeMs={setValidUntilMs} disabled={busy} />
              <p className="field-hint">Пусто = без ограничения срока.</p>
            </div>
            <div className="form-field shop-toggle-row">
              <div>
                <label>Использовать 1 раз с 1 пользователем</label>
                <p className="field-hint">Если включено, один и тот же пользователь не сможет применить код повторно.</p>
              </div>
              <button type="button" className={`toggle ${oneTime ? "on" : ""}`} onClick={() => setOneTime((v) => !v)} />
            </div>
            <button type="button" className="primary" disabled={busy} onClick={() => void onCreate()}>
              {busy ? "Создание..." : "Создать"}
            </button>
          </div>

          <aside className="promos-list" aria-label="Список промокодов">
            <label className="referral-feed-label">Созданные промокоды</label>
            <div className="promos-list-scroll">
              {promos.length === 0 ? (
                <p className="sub promo-list-empty">Промокодов пока нет.</p>
              ) : (
                <div className="promo-cards">
                  {promos.map((p) => {
                    const statsOpen = statsPromoId === p.id;
                    const usages = statsById[p.id];
                    return (
                      <div key={p.id} className={`promo-card ${statsOpen ? "promo-card--open" : ""}`}>
                        <div className="promo-card-main">
                          <div className="promo-card-text">
                            <div className="promo-card-title">
                              <span className="promo-card-name">{p.name}</span>
                              <span className="promo-card-code mono">({p.code})</span>
                            </div>
                            <div className="promo-card-meta">
                              {p.discount_percent}% • {p.active ? "активен" : "неактивен"} • применений: {p.usages_count}
                            </div>
                          </div>
                          <div className="promo-card-actions">
                            <button
                              type="button"
                              className={`promo-icon-btn ${statsOpen ? "active" : ""}`}
                              title={statsOpen ? "Скрыть статистику" : "Показать статистику"}
                              aria-expanded={statsOpen}
                              disabled={busy}
                              onClick={() => void toggleStats(p)}
                            >
                              <IconEye />
                            </button>
                            <button
                              type="button"
                              className="promo-icon-btn"
                              title="Редактировать"
                              disabled={busy}
                              onClick={() => openEdit(p)}
                            >
                              <IconPencil />
                            </button>
                            <button
                              type="button"
                              className="promo-icon-btn danger"
                              title="Удалить"
                              disabled={busy}
                              onClick={() => void onDeletePromo(p)}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </div>
                        {statsOpen ? (
                          <div className="promo-card-stats">
                            {statsLoadingId === p.id ? (
                              <p className="field-hint">Загрузка…</p>
                            ) : !usages || usages.length === 0 ? (
                              <p className="field-hint">Этот промокод ещё не применяли.</p>
                            ) : (
                              <ul className="promo-stats-list">
                                {usages.map((u) => (
                                  <li key={u.id}>
                                    {u.tg_username ? `@${u.tg_username}` : u.tg_first_name || "Пользователь"} • tg:{u.tg_user_id} •{" "}
                                    {new Date(u.applied_at).toLocaleString("ru-RU")}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      {editPromo ? (
        <div className="modal-backdrop" onClick={() => !busy && setEditPromo(null)}>
          <div className="modal promo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Редактирование: {editPromo.name}</h2>
              <button type="button" className="ghost modal-close" disabled={busy} onClick={() => setEditPromo(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="promos-create">
                <div className="form-field">
                  <label>Название промокода</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={busy} />
                </div>
                <div className="form-field">
                  <label>Текст промокода</label>
                  <input
                    value={editCode}
                    disabled={busy}
                    onChange={(e) => setEditCode(e.target.value.toLocaleUpperCase("ru-RU").replace(/\s+/g, ""))}
                  />
                </div>
                <div className="form-field">
                  <label>Процент скидки</label>
                  <input
                    inputMode="numeric"
                    disabled={busy}
                    value={editDiscount}
                    onChange={(e) => setEditDiscount(Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 0))))}
                  />
                </div>
                <div className="form-field shop-toggle-row">
                  <div>
                    <label>Использовать 1 раз с 1 пользователем</label>
                  </div>
                  <button
                    type="button"
                    className={`toggle ${editOneTime ? "on" : ""}`}
                    disabled={busy}
                    onClick={() => setEditOneTime((v) => !v)}
                  />
                </div>
                <div className="form-field shop-toggle-row">
                  <div>
                    <label>Промокод активен</label>
                  </div>
                  <button
                    type="button"
                    className={`toggle ${editActive ? "on" : ""}`}
                    disabled={busy}
                    onClick={() => setEditActive((v) => !v)}
                  />
                </div>
                <div className="form-field">
                  <label>Действует до (дата)</label>
                  <ExpiryDateTimePicker valueMs={editValidUntilMs} onChangeMs={setEditValidUntilMs} disabled={busy} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="ghost" disabled={busy} onClick={() => setEditPromo(null)}>
                Отмена
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void onSaveEdit()}>
                {busy ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
