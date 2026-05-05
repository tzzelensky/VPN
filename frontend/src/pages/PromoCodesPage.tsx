import { useEffect, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { createPromoCode, deletePromoCode, listPromoCodeUsages, listPromoCodes, type PromoCodeDto, type PromoCodeUsageDto } from "../api";

export default function PromoCodesPage({ onLogout }: { onLogout: () => void }) {
  const [promos, setPromos] = useState<PromoCodeDto[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState(10);
  const [oneTime, setOneTime] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [openedPromo, setOpenedPromo] = useState<PromoCodeDto | null>(null);
  const [usages, setUsages] = useState<PromoCodeUsageDto[]>([]);
  const [deleting, setDeleting] = useState(false);

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
      });
      setName("");
      setCode("");
      setDiscount(10);
      setOneTime(true);
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
                <label>Использовать 1 раз с 1 пользователем</label>
                <p className="field-hint">Если включено, один и тот же пользователь не сможет применить код повторно.</p>
              </div>
              <button type="button" className={`toggle ${oneTime ? "on" : ""}`} onClick={() => setOneTime((v) => !v)} />
            </div>
            <button type="button" className="primary" disabled={busy} onClick={() => void onCreate()}>
              {busy ? "Создание..." : "Создать"}
            </button>
          </div>

          <aside className="promos-list">
            <label className="referral-feed-label">Созданные промокоды</label>
            <div className="mysub-stat-list">
              {promos.length === 0 ? (
                <div>Промокодов пока нет.</div>
              ) : (
                promos.map((p) => (
                  <button key={p.id} type="button" className="ghost" onClick={() => void openPromo(p)}>
                    {p.name} ({p.code}) • {p.discount_percent}% • применений: {p.usages_count}
                  </button>
                ))
              )}
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
              <p className="sub">
                Код: <b>{openedPromo.code}</b> • Скидка: <b>{openedPromo.discount_percent}%</b>
              </p>
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
