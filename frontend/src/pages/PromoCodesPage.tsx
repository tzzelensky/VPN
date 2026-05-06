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
  const [openedPromo, setOpenedPromo] = useState<PromoCodeDto | null>(null);
  const [usages, setUsages] = useState<PromoCodeUsageDto[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
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

  async function openPromo(p: PromoCodeDto) {
    setOpenedPromo(p);
    setEditing(false);
    setEditName(p.name);
    setEditCode(p.code);
    setEditDiscount(p.discount_percent);
    setEditOneTime(p.one_time_per_user);
    setEditActive(p.active !== false);
    setEditValidUntilMs(Number.isFinite(Date.parse(p.valid_until)) ? Date.parse(p.valid_until) : 0);
    try {
      const data = await listPromoCodeUsages(p.id);
      setUsages(data.usages);
    } catch {
      setUsages([]);
    }
  }

  async function onDeletePromo() {
    if (!openedPromo || deleting) return;
    setDeleting(true);
    setMsg(null);
    try {
      await deletePromoCode(openedPromo.id);
      setOpenedPromo(null);
      setUsages([]);
      setMsg({ type: "ok", text: "Промокод удален." });
      await reload();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setDeleting(false);
    }
  }

  async function onSavePromo() {
    if (!openedPromo) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated = await patchPromoCode(openedPromo.id, {
        name: editName.trim(),
        code: editCode.trim().toLocaleUpperCase("ru-RU"),
        discount_percent: Math.max(1, Math.min(99, Math.floor(Number(editDiscount) || 0))),
        one_time_per_user: editOneTime,
        active: editActive,
        valid_until: toExpiryIsoFromMs(editValidUntilMs),
      });
      setOpenedPromo(updated);
      setEditing(false);
      setMsg({ type: "ok", text: "Промокод обновлен." });
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
              <div className="mysub-stat-list">
                {promos.length === 0 ? (
                  <div>Промокодов пока нет.</div>
                ) : (
                  promos.map((p) => (
                    <button key={p.id} type="button" className="ghost" onClick={() => void openPromo(p)}>
                      {p.name} ({p.code}) • {p.discount_percent}% • {p.active ? "активен" : "неактивен"} • применений:{" "}
                      {p.usages_count}
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </section>

      {openedPromo ? (
        <div className="modal-backdrop" onClick={() => setOpenedPromo(null)}>
          <div className="modal promo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{openedPromo.name}</h2>
              <button type="button" className="ghost modal-close" onClick={() => setOpenedPromo(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {editing ? (
                <div className="promos-create">
                  <div className="form-field">
                    <label>Название промокода</label>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label>Текст промокода</label>
                    <input value={editCode} onChange={(e) => setEditCode(e.target.value.toLocaleUpperCase("ru-RU").replace(/\s+/g, ""))} />
                  </div>
                  <div className="form-field">
                    <label>Процент скидки</label>
                    <input
                      inputMode="numeric"
                      value={editDiscount}
                      onChange={(e) => setEditDiscount(Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 0))))}
                    />
                  </div>
                  <div className="form-field shop-toggle-row">
                    <div>
                      <label>Использовать 1 раз с 1 пользователем</label>
                    </div>
                    <button type="button" className={`toggle ${editOneTime ? "on" : ""}`} onClick={() => setEditOneTime((v) => !v)} />
                  </div>
                  <div className="form-field shop-toggle-row">
                    <div>
                      <label>Промокод активен</label>
                    </div>
                    <button type="button" className={`toggle ${editActive ? "on" : ""}`} onClick={() => setEditActive((v) => !v)} />
                  </div>
                  <div className="form-field">
                    <label>Действует до (дата)</label>
                    <ExpiryDateTimePicker valueMs={editValidUntilMs} onChangeMs={setEditValidUntilMs} disabled={busy} />
                  </div>
                </div>
              ) : (
                <p className="sub">
                  Код: <b>{openedPromo.code}</b> • Скидка: <b>{openedPromo.discount_percent}%</b> •{" "}
                  <b>{openedPromo.active ? "активен" : "неактивен"}</b>
                  {openedPromo.valid_until ? <> • До: <b>{new Date(openedPromo.valid_until).toLocaleDateString("ru-RU")}</b></> : null}
                </p>
              )}
              <p className="sub">Применений: {usages.length}</p>
              <div className="mysub-stat-list">
                {usages.length === 0 ? (
                  <div>Этот промокод ещё не применяли.</div>
                ) : (
                  usages.map((u) => (
                    <div key={u.id}>
                      {u.tg_username ? `@${u.tg_username}` : u.tg_first_name || "Пользователь"} • tg:{u.tg_user_id} •{" "}
                      {new Date(u.applied_at).toLocaleString("ru-RU")}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="modal-footer">
              {editing ? (
                <>
                  <button type="button" className="ghost" disabled={busy} onClick={() => setEditing(false)}>
                    Отмена
                  </button>
                  <button type="button" className="primary" disabled={busy} onClick={() => void onSavePromo()}>
                    {busy ? "Сохранение..." : "Сохранить"}
                  </button>
                </>
              ) : (
                <button type="button" className="ghost" onClick={() => setEditing(true)}>
                  Редактировать
                </button>
              )}
              <button type="button" className="ghost" disabled={deleting} onClick={() => void onDeletePromo()}>
                {deleting ? "Удаление..." : "Удалить промокод"}
              </button>
              <button type="button" className="primary" onClick={() => setOpenedPromo(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
