import { useCallback, useEffect, useState } from "react";
import {
  loadSubscriptionShopActivity,
  loadSubscriptionShop,
  saveSubscriptionShop,
  type SubscriptionShopActivityEntry,
  type SubscriptionShopDto,
  type SubscriptionShopPlanDto,
  type TopUpShopPlanDto,
} from "../api";
import DashboardLayout from "../components/DashboardLayout";
import Spinner from "../components/Spinner";

function cloneShop(s: SubscriptionShopDto): SubscriptionShopDto {
  return {
    sales_disabled: s.sales_disabled,
    payment_url: s.payment_url,
    plans: s.plans.map((p) => ({ ...p })),
    topup_plans: s.topup_plans.map((p) => ({ ...p })),
  };
}

export default function SubscriptionShopPage({ onLogout }: { onLogout: () => void }) {
  const [shop, setShop] = useState<SubscriptionShopDto | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activity, setActivity] = useState<{ subscriptions: SubscriptionShopActivityEntry[]; topups: SubscriptionShopActivityEntry[] }>({
    subscriptions: [],
    topups: [],
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [s, a] = await Promise.all([loadSubscriptionShop(), loadSubscriptionShopActivity()]);
      setShop(cloneShop(s));
      setActivity({
        subscriptions: a.subscriptions ?? [],
        topups: a.topups ?? [],
      });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function updatePlan(id: number, patch: Partial<SubscriptionShopPlanDto>) {
    setShop((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        plans: prev.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      };
    });
  }

  function updateTopUpPlan(id: number, patch: Partial<TopUpShopPlanDto>) {
    setShop((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        topup_plans: prev.topup_plans.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      };
    });
  }

  async function onSave() {
    if (!shop) return;
    setSaving(true);
    setMsg(null);
    try {
      const s = await saveSubscriptionShop(shop);
      setShop(cloneShop(s));
      setMsg({ type: "ok", text: "Настройки сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <div className="users-hero-top">
          <div>
            <h1>Настройка подписок</h1>
            <p className="sub users-hero-sub">
              Тарифы и ссылка на оплату в Telegram-боте. «Отключение продажи» — новым без привязки нельзя купить, только
              продлить уже привязанный аккаунт.
            </p>
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={loading} onClick={() => void refresh()}>
              Обновить
            </button>
            <button type="button" className="primary" disabled={saving || !shop} onClick={() => void onSave()}>
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
      </section>

      {loading || !shop ? (
        <section className="panel">
          <Spinner /> Загрузка…
        </section>
      ) : (
        <>
          <section className="panel">
            <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Общие</h2>
            <div className="user-form-grid" style={{ maxWidth: "40rem" }}>
              <div className="form-field form-field-span-2">
                <label>Ссылка на оплату</label>
                <input
                  value={shop.payment_url}
                  onChange={(e) => setShop({ ...shop, payment_url: e.target.value })}
                  placeholder="Пусто — из .env (TELEGRAM_PAYMENT_URL) или дефолт Т-Банка"
                  autoComplete="off"
                />
                <p className="field-hint">Если пусто, бот использует переменную окружения или встроенную ссылку.</p>
              </div>
              <div className="form-field form-field-span-2 shop-toggle-row">
                <div>
                  <label>Отключение продажи</label>
                  <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                    Включено — у пользователей без привязки к панели скрыта покупка; оплата продления доступна только с
                    привязанным Telegram Chat ID.
                  </p>
                </div>
                <button
                  type="button"
                  className={`toggle ${shop.sales_disabled ? "on" : ""}`}
                  title={shop.sales_disabled ? "Продажи новым отключены" : "Продажи новым включены"}
                  aria-pressed={shop.sales_disabled}
                  onClick={() => setShop({ ...shop, sales_disabled: !shop.sales_disabled })}
                />
              </div>
            </div>
          </section>

          <section className="panel shop-section-gap">
            <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Тарифы (кнопки 1, 2, 3 в боте)</h2>
            <div className="shop-layout-with-feed">
              <div className="shop-plans-grid">
                {shop.plans.map((p) => (
                  <div key={p.id} className="user-modal-card shop-plan-card">
                    <h3 className="user-modal-section-title">Тариф #{p.id}</h3>
                    <div className="user-form-grid">
                      <div className="form-field form-field-span-2">
                        <label>Название</label>
                        <input value={p.title} onChange={(e) => updatePlan(p.id, { title: e.target.value })} />
                      </div>
                      <div className="form-field">
                        <label>ГБ / мес (0 = безлимит)</label>
                        <input
                          inputMode="numeric"
                          value={p.total_gb}
                          onChange={(e) => updatePlan(p.id, { total_gb: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                        />
                      </div>
                      <div className="form-field">
                        <label>Дней</label>
                        <input
                          inputMode="numeric"
                          value={p.days}
                          onChange={(e) => updatePlan(p.id, { days: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                        />
                      </div>
                      <div className="form-field form-field-span-2">
                        <label>Цена, ₽</label>
                        <input
                          inputMode="numeric"
                          value={p.price_rub}
                          onChange={(e) => updatePlan(p.id, { price_rub: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <aside className="shop-feed" aria-label="Текущие тарифы пользователей">
                <label className="referral-feed-label">Тарифы у пользователей сейчас</label>
                <p className="field-hint referral-feed-hint">Клиент и его текущий тариф/лимит.</p>
                <div className="ref-ios-wheel" role="log">
                  <div className="ref-ios-wheel-mask" aria-hidden="true" />
                  <div className="ref-ios-wheel-scroll">
                    {activity.subscriptions.length === 0 ? (
                      <p className="sub ref-ios-empty">Пока нет записей.</p>
                    ) : (
                      activity.subscriptions.map((e, idx) => (
                        <div key={`${e.created_at}-${idx}`} className="ref-ios-row">
                          <span className="ref-ios-line">{e.line}</span>
                          <span className="ref-ios-date">
                            {e.created_at
                              ? new Date(e.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
                              : ""}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </section>

          <section className="panel shop-section-gap">
            <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Докупить ГБ (кнопки 1, 2, 3 в боте)</h2>
            <p className="sub" style={{ marginTop: 0 }}>
              Эти пакеты используются в действии бота «Докупить ГБ». После подтверждения оплаты ГБ прибавляются к текущему
              лимиту клиента.
            </p>
            <div className="shop-layout-with-feed">
              <div className="shop-plans-grid">
                {shop.topup_plans.map((p) => (
                  <div key={p.id} className="user-modal-card shop-plan-card">
                    <h3 className="user-modal-section-title">Докупка #{p.id}</h3>
                    <div className="user-form-grid">
                      <div className="form-field form-field-span-2">
                        <label>Название</label>
                        <input value={p.title} onChange={(e) => updateTopUpPlan(p.id, { title: e.target.value })} />
                      </div>
                      <div className="form-field">
                        <label>Добавить ГБ</label>
                        <input
                          inputMode="numeric"
                          value={p.add_gb}
                          onChange={(e) => updateTopUpPlan(p.id, { add_gb: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                        />
                      </div>
                      <div className="form-field">
                        <label>Цена, ₽</label>
                        <input
                          inputMode="numeric"
                          value={p.price_rub}
                          onChange={(e) => updateTopUpPlan(p.id, { price_rub: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <aside className="shop-feed" aria-label="Кто и сколько ГБ докупил">
                <label className="referral-feed-label">Докупки ГБ</label>
                <p className="field-hint referral-feed-hint">Клиент и объём докупки.</p>
                <div className="ref-ios-wheel" role="log">
                  <div className="ref-ios-wheel-mask" aria-hidden="true" />
                  <div className="ref-ios-wheel-scroll">
                    {activity.topups.length === 0 ? (
                      <p className="sub ref-ios-empty">Пока нет записей.</p>
                    ) : (
                      activity.topups.map((e, idx) => (
                        <div key={`${e.created_at}-${idx}`} className="ref-ios-row">
                          <span className="ref-ios-line">{e.line}</span>
                          <span className="ref-ios-date">
                            {e.created_at
                              ? new Date(e.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
                              : ""}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </section>
        </>
      )}
    </DashboardLayout>
  );
}
