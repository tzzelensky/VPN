import { useEffect, useState } from "react";
import {
  loadSubscriptionShop,
  saveSubscriptionShop,
  type ComboSubscriptionOfferDto,
  type SubscriptionShopDto,
} from "../api";
import PageLoadingState from "./PageLoadingState";
import Spinner from "./Spinner";

function newComboId(): string {
  return `combo_${Date.now().toString(36)}`;
}

function cloneOffers(offers: ComboSubscriptionOfferDto[]): ComboSubscriptionOfferDto[] {
  return offers.map((o) => ({ ...o }));
}

function previewPricing(
  shop: SubscriptionShopDto,
  offer: ComboSubscriptionOfferDto,
  devicePriceRub: number,
): { original: number; final: number; discount: number } {
  const plan = shop.plans.find((p) => p.id === offer.plan_id);
  let original = plan?.price_rub ?? 0;
  if (offer.include_white_lists) original += 0; // price from backend at runtime
  if (offer.include_topup) {
    const top = shop.topup_plans.find((p) => p.id === offer.topup_plan_id);
    original += top?.price_rub ?? 0;
  }
  if (offer.include_device_slot) original += devicePriceRub;
  const discount = Math.min(50, Math.max(1, Math.floor(offer.discount_percent || 15)));
  const discountRub = Math.floor((original * discount) / 100);
  return { original, final: Math.max(0, original - discountRub), discount };
}

type Props = {
  devicePriceRub?: number;
};

export default function ComboSubscriptionsPanel({ devicePriceRub = 0 }: Props) {
  const [shop, setShop] = useState<SubscriptionShopDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      const s = await loadSubscriptionShop();
      setShop({
        ...s,
        combo_offers: cloneOffers(s.combo_offers ?? []),
      });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function updateOffer(id: string, patch: Partial<ComboSubscriptionOfferDto>) {
    setShop((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        combo_offers: (prev.combo_offers ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
      };
    });
  }

  function addOffer() {
    setShop((prev) => {
      if (!prev) return prev;
      const offers = prev.combo_offers ?? [];
      const next: ComboSubscriptionOfferDto = {
        id: newComboId(),
        enabled: false,
        title: "Комбо-предложение",
        plan_id: prev.plans[0]?.id ?? 1,
        include_white_lists: false,
        include_topup: false,
        topup_plan_id: prev.topup_plans[0]?.id ?? 1,
        include_device_slot: false,
        discount_percent: 15,
      };
      return { ...prev, combo_offers: [...offers, next] };
    });
  }

  function removeOffer(id: string) {
    if (!window.confirm("Удалить это комбо-предложение?")) return;
    setShop((prev) => {
      if (!prev) return prev;
      return { ...prev, combo_offers: (prev.combo_offers ?? []).filter((o) => o.id !== id) };
    });
  }

  async function onSave() {
    if (!shop) return;
    setSaving(true);
    setMsg(null);
    try {
      const s = await saveSubscriptionShop(shop);
      setShop({ ...s, combo_offers: cloneOffers(s.combo_offers ?? []) });
      setMsg({ type: "ok", text: "Комбо-подписки сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !shop) {
    return (
      <section className="panel">
        <PageLoadingState />
      </section>
    );
  }

  const offers = shop.combo_offers ?? [];

  return (
    <>
      <section className="panel">
        <div className="users-hero" style={{ marginBottom: "1rem" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Комбо-подписки</h2>
            <p className="field-hint" style={{ marginTop: "0.35rem", maxWidth: "42rem" }}>
              Конструктор спец-предложений: тариф + доп. продукты со скидкой. Цена = (подписка + аддоны) − скидка%.
              Активные комбо показываются в боте и WebApp в разделе «Оплата».
            </p>
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={loading} onClick={() => void refresh()}>
              Обновить
            </button>
            <button type="button" className="primary" disabled={saving} onClick={() => void onSave()}>
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
        <button type="button" className="ghost" onClick={addOffer}>
          + Добавить комбо
        </button>
      </section>

      {offers.length === 0 ? (
        <section className="panel">
          <p className="field-hint">Комбо-предложений пока нет. Нажмите «Добавить комбо».</p>
        </section>
      ) : (
        offers.map((offer) => {
          const pricing = previewPricing(shop, offer, devicePriceRub);
          const addonCount =
            Number(offer.include_white_lists) +
            Number(offer.include_topup) +
            Number(offer.include_device_slot);
          return (
            <section className="panel shop-section-gap" key={offer.id}>
              <div className="shop-toggle-row" style={{ marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>{offer.title || "Без названия"}</h3>
                  <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                    ID: <code>{offer.id}</code>
                    {addonCount === 0 ? " · выберите хотя бы один продукт в комбо" : ""}
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span className="field-hint">{offer.enabled ? "Активна" : "Выключена"}</span>
                  <button
                    type="button"
                    className={`toggle ${offer.enabled ? "on" : ""}`}
                    title={offer.enabled ? "Активна" : "Выключена"}
                    aria-pressed={offer.enabled}
                    onClick={() => updateOffer(offer.id, { enabled: !offer.enabled })}
                  />
                </div>
              </div>

              <div className="user-form-grid" style={{ maxWidth: "48rem" }}>
                <div className="form-field form-field-span-2">
                  <label>Название (для клиента)</label>
                  <input
                    value={offer.title}
                    onChange={(e) => updateOffer(offer.id, { title: e.target.value.slice(0, 120) })}
                    placeholder="Например: Безлимит + Белые списки"
                  />
                </div>
                <div className="form-field">
                  <label>Тариф подписки</label>
                  <select
                    value={offer.plan_id}
                    onChange={(e) => updateOffer(offer.id, { plan_id: Number(e.target.value) })}
                  >
                    {shop.plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}. {p.title} — {p.price_rub} ₽
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label>Скидка, %</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={offer.discount_percent}
                    onChange={(e) =>
                      updateOffer(offer.id, {
                        discount_percent: Math.min(50, Math.max(1, Math.floor(Number(e.target.value) || 15))),
                      })
                    }
                  />
                </div>

                <div className="form-field form-field-span-2 shop-toggle-row">
                  <div>
                    <label>Белые списки в комбо</label>
                  </div>
                  <button
                    type="button"
                    className={`toggle ${offer.include_white_lists ? "on" : ""}`}
                    aria-pressed={offer.include_white_lists}
                    onClick={() => updateOffer(offer.id, { include_white_lists: !offer.include_white_lists })}
                  />
                </div>

                <div className="form-field form-field-span-2 shop-toggle-row">
                  <div>
                    <label>Докупка ГБ в комбо</label>
                  </div>
                  <button
                    type="button"
                    className={`toggle ${offer.include_topup ? "on" : ""}`}
                    aria-pressed={offer.include_topup}
                    onClick={() => updateOffer(offer.id, { include_topup: !offer.include_topup })}
                  />
                </div>
                {offer.include_topup ? (
                  <div className="form-field form-field-span-2">
                    <label>Пакет докупки ГБ</label>
                    <select
                      value={offer.topup_plan_id}
                      onChange={(e) => updateOffer(offer.id, { topup_plan_id: Number(e.target.value) })}
                    >
                      {shop.topup_plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} (+{p.add_gb} ГБ) — {p.price_rub} ₽
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="form-field form-field-span-2 shop-toggle-row">
                  <div>
                    <label>Доп. устройство в комбо</label>
                  </div>
                  <button
                    type="button"
                    className={`toggle ${offer.include_device_slot ? "on" : ""}`}
                    aria-pressed={offer.include_device_slot}
                    onClick={() => updateOffer(offer.id, { include_device_slot: !offer.include_device_slot })}
                  />
                </div>

                <div className="form-field form-field-span-2">
                  <p className="field-hint">
                    Ориентировочная цена (без БС):{" "}
                    <strong>
                      {pricing.original} ₽ → {pricing.final} ₽
                    </strong>{" "}
                    (−{pricing.discount}%)
                  </p>
                </div>
              </div>

              <button type="button" className="ghost danger-text" style={{ marginTop: "0.75rem" }} onClick={() => removeOffer(offer.id)}>
                Удалить комбо
              </button>
            </section>
          );
        })
      )}
    </>
  );
}
