import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import Spinner from "../components/Spinner";
import {
  loadReferralProgram,
  loadSubscriptionShop,
  saveReferralProgram,
  type ReferralProgramDto,
  type SubscriptionShopDto,
} from "../api";

export default function ReferralProgramPage({ onLogout }: { onLogout: () => void }) {
  const [cfg, setCfg] = useState<ReferralProgramDto | null>(null);
  const [shop, setShop] = useState<SubscriptionShopDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [c, s] = await Promise.all([loadReferralProgram(), loadSubscriptionShop()]);
      setCfg(c);
      setShop(s);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const discounted = useMemo(() => {
    if (!cfg || !shop) return [];
    return shop.plans.map((p) => ({
      id: p.id,
      title: p.title,
      oldPrice: p.price_rub,
      newPrice: Math.max(0, Math.floor(p.price_rub - (p.price_rub * cfg.invited_discount_percent) / 100)),
    }));
  }, [cfg, shop]);

  async function onSave() {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    try {
      const next = await saveReferralProgram(cfg);
      setCfg(next);
      setMsg({ type: "ok", text: "Реферальная программа сохранена." });
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
            <h1>Реферальная программая</h1>
            <p className="sub users-hero-sub">Настройка кнопки в боте, скидки приглашенному и награды пригласившему.</p>
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={loading || saving} onClick={() => void refresh()}>
              Обновить
            </button>
            <button type="button" className="primary" disabled={!cfg || saving} onClick={() => void onSave()}>
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

      {loading || !cfg ? (
        <section className="panel">
          <Spinner /> Загрузка…
        </section>
      ) : (
        <section className="panel">
          <div className="user-form-grid" style={{ maxWidth: "52rem" }}>
            <div className="form-field form-field-span-2 shop-toggle-row">
              <div>
                <label>Реферальная программа</label>
                <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                  Если выключено — кнопка «Пригласи друга» скрыта из Telegram-бота.
                </p>
              </div>
              <button
                type="button"
                className={`toggle ${cfg.enabled ? "on" : ""}`}
                aria-pressed={cfg.enabled}
                onClick={() => setCfg({ ...cfg, enabled: !cfg.enabled })}
              />
            </div>

            <div className="form-field">
              <label>Награда пригласившему: ГБ</label>
              <input
                inputMode="numeric"
                value={cfg.inviter_reward_gb}
                onChange={(e) => setCfg({ ...cfg, inviter_reward_gb: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              />
            </div>
            <div className="form-field">
              <label>Награда пригласившему: Дней</label>
              <input
                inputMode="numeric"
                value={cfg.inviter_reward_days}
                onChange={(e) => setCfg({ ...cfg, inviter_reward_days: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              />
            </div>

            <div className="form-field">
              <label>Скидка приглашенному, %</label>
              <input
                inputMode="numeric"
                value={cfg.invited_discount_percent}
                onChange={(e) =>
                  setCfg({ ...cfg, invited_discount_percent: Math.min(90, Math.max(0, Math.floor(Number(e.target.value) || 0))) })
                }
              />
            </div>
            <div className="form-field">
              <label>Превью скидки</label>
              <div className="field-hint">
                {discounted.map((p) => (
                  <div key={p.id}>
                    #{p.id} {p.title}: {p.oldPrice} ₽ → {p.newPrice} ₽
                  </div>
                ))}
              </div>
            </div>

            <div className="form-field form-field-span-2">
              <label>Копирайт сообщения</label>
              <textarea
                className="comms-textarea"
                value={cfg.invite_copy_text}
                onChange={(e) => setCfg({ ...cfg, invite_copy_text: e.target.value })}
                placeholder="Я пользуюсь этим VPN, вот тебе скидка на первую покупку."
              />
            </div>
          </div>
        </section>
      )}
    </DashboardLayout>
  );
}
