import { subscriptionLabel } from "../../subscriptionLabel";
import Card from "../components/Card";
import PrimaryButton from "../components/PrimaryButton";
import SecondaryButton from "../components/SecondaryButton";
import TariffCard from "../components/TariffCard";
import type { MySubWebAppController } from "../types";

function formatPlanMeta(p: { total_gb: number; days: number }): string {
  const gb = p.total_gb > 0 ? `${p.total_gb} ГБ` : "безлимит";
  return `${gb} · ${p.days} дн.`;
}

function formatTopUpMeta(p: { add_gb: number }): string {
  return `+${p.add_gb} ГБ`;
}

function priceCardProps(
  priceRub: number,
  activeDiscountPercent: number,
  discountedPriceForPlan: (priceRub: number) => number,
) {
  if (!activeDiscountPercent) return { price: `${priceRub} ₽` };
  return {
    price: `${discountedPriceForPlan(priceRub)} ₽`,
    oldPrice: `${priceRub} ₽`,
    discountPercent: activeDiscountPercent,
  };
}

type Props = { ctrl: MySubWebAppController };

export default function PayTabNew({ ctrl }: Props) {
  const {
    data,
    payProduct,
    switchPayProduct,
    payPlanId,
    setPayPlanId,
    payIsTest,
    setPayIsTest,
    payPhoto,
    setPayPhoto,
    busyPay,
    payTargetId,
    setPayTargetId,
    payTargetSub,
    newSubName,
    setNewSubName,
    suggestedNewSubName,
    selectedPlan,
    selectedTopUpPlan,
    testPlanAvailable,
    salesDisabledForNew,
    submitPaymentProof,
    promoCodeInput,
    setPromoCodeInput,
    promoApplied,
    promoFeedback,
    applyPromoCode,
    activeDiscountPercent,
    autoDiscountPercent,
    discountedPriceForPlan,
  } = ctrl;

  const priceBase =
    payProduct === "device_slot"
      ? payTargetSub?.devices?.purchase_price_rub ?? data.device_limit?.purchase_price_rub ?? 0
      : payProduct === "white_lists"
      ? data.whitelist?.price_rub ?? 0
      : payProduct === "topup"
        ? selectedTopUpPlan?.price_rub ?? 0
        : payIsTest
          ? data.test_plan?.price_rub ?? 0
          : selectedPlan?.price_rub ?? 0;
  const finalPrice = discountedPriceForPlan(priceBase);
  const showPromo = !payIsTest && payProduct !== "white_lists" && payProduct !== "device_slot";
  const topupTargetUnlimited =
    payProduct === "topup" &&
    Boolean(payTargetSub && (payTargetSub.total_gb <= 0 || payTargetSub.stats.unlimited_traffic));
  const limitedSubs = data.subscriptions.filter((s) => s.devices?.enabled);

  return (
    <>
      <Card className="mn-hero mn-hero--compact">
        <h2 className="mn-title">Оплата</h2>
        <p className="mn-subtitle">Выберите тариф и оплатите удобным способом.</p>
      </Card>

      <Card>
        <h3 className="mn-card-title">Что оплачиваете</h3>
        {payProduct === "device_slot" ? (
          <p className="mn-muted">Докупка места для дополнительного устройства.</p>
        ) : (
        <div className="mn-segment">
          <button type="button" className={payProduct === "subscription" ? "is-active" : ""} onClick={() => switchPayProduct("subscription")}>
            Тариф
          </button>
          <button
            type="button"
            className={payProduct === "topup" ? "is-active" : ""}
            disabled={!data.subscriptions.length}
            onClick={() => switchPayProduct("topup")}
          >
            Докупка ГБ
          </button>
          {data.whitelist?.visible ? (
            <button
              type="button"
              className={payProduct === "white_lists" ? "is-active" : ""}
              disabled={!data.subscriptions.length || data.whitelist.status === "connected" || !data.whitelist.can_buy}
              onClick={() => switchPayProduct("white_lists")}
            >
              Белые списки
            </button>
          ) : null}
        </div>
        )}
      </Card>

      {payProduct === "device_slot" && limitedSubs.length > 0 ? (
        <Card>
          <h3 className="mn-card-title">Подписка</h3>
          <p className="mn-muted">Выберите подписку, для которой докупить место под устройство.</p>
          <div className="mn-stack" style={{ marginTop: "0.5rem" }}>
            {limitedSubs.map((s) => (
              <SecondaryButton
                key={s.id}
                fullWidth
                className={payTargetId === s.id ? "mn-selected-outline" : ""}
                onClick={() => setPayTargetId(s.id)}
              >
                {subscriptionLabel(s)}
                {s.allowed ? " · активна" : ""}
              </SecondaryButton>
            ))}
          </div>
        </Card>
      ) : payProduct === "device_slot" ? (
        <Card>
          <p className="mn-muted">Нет подписок с ограничением по устройствам.</p>
        </Card>
      ) : null}

      {payProduct === "subscription" && data.subscriptions.length > 0 ? (
        <Card>
          <h3 className="mn-card-title">Подписка</h3>
          <SecondaryButton fullWidth className={payTargetId === 0 ? "mn-selected-outline" : ""} onClick={() => setPayTargetId(0)}>
            Оформить ещё одну
          </SecondaryButton>
          <div className="mn-stack" style={{ marginTop: "0.5rem" }}>
            {data.subscriptions.map((s) => (
              <SecondaryButton
                key={s.id}
                fullWidth
                className={payTargetId === s.id ? "mn-selected-outline" : ""}
                onClick={() => setPayTargetId(s.id)}
              >
                {subscriptionLabel(s)}
                {s.allowed ? " · активна" : ""}
              </SecondaryButton>
            ))}
          </div>
          {payTargetId === 0 ? (
            <input
              className="mn-input"
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value.slice(0, 25))}
              placeholder={suggestedNewSubName || "Название подписки"}
              style={{ marginTop: "0.65rem" }}
            />
          ) : null}
        </Card>
      ) : null}

      {payProduct === "topup" && data.subscriptions.length > 0 ? (
        <Card>
          <h3 className="mn-card-title">Подписка для докупки ГБ</h3>
          <p className="mn-muted">Выберите подписку, к которой добавить трафик.</p>
          <div className="mn-stack" style={{ marginTop: "0.5rem" }}>
            {data.subscriptions.map((s) => {
              const unlimited = s.total_gb <= 0 || s.stats.unlimited_traffic;
              return (
                <SecondaryButton
                  key={s.id}
                  fullWidth
                  disabled={unlimited}
                  className={payTargetId === s.id ? "mn-selected-outline" : ""}
                  onClick={() => setPayTargetId(s.id)}
                >
                  {subscriptionLabel(s)}
                  {unlimited ? " · безлимит" : s.allowed ? " · активна" : ""}
                </SecondaryButton>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card>
        <h3 className="mn-card-title">
          {payProduct === "device_slot"
            ? "Докупка места"
            : payProduct === "topup"
              ? "Докупка ГБ"
              : payProduct === "white_lists"
                ? "Белые списки"
                : "Тарифы"}
        </h3>
        {payProduct === "device_slot" ? (
          <TariffCard
            title="Дополнительное место"
            meta="Ещё одно устройство для подписки"
            price={`${priceBase} ₽`}
            selected
            onSelect={() => {}}
          />
        ) : payProduct === "white_lists" ? (
          <TariffCard
            title="Белые списки"
            meta="Дополнение к подписке"
            price={`${data.whitelist?.price_rub ?? 0} ₽`}
            selected
            onSelect={() => {}}
          />
        ) : payProduct === "topup" ? (
          <div className="mn-tariff-grid">
            {(data.topup_plans ?? []).map((p) => (
              <TariffCard
                key={p.id}
                title={p.title.trim() || `Пакет ${p.id}`}
                meta={formatTopUpMeta(p)}
                {...priceCardProps(p.price_rub, activeDiscountPercent, discountedPriceForPlan)}
                selected={payPlanId === p.id}
                onSelect={() => setPayPlanId(p.id)}
              />
            ))}
          </div>
        ) : (
          <div className="mn-tariff-grid">
            {testPlanAvailable && data.subscriptions.length === 0 && data.test_plan ? (
              <TariffCard
                title={data.test_plan.title.trim() || "Тестовая подписка"}
                meta={formatPlanMeta(data.test_plan)}
                price={`${data.test_plan.price_rub} ₽`}
                selected={payIsTest}
                onSelect={() => {
                  setPayIsTest(true);
                }}
              />
            ) : null}
            {data.plans.map((p, i) => (
              <TariffCard
                key={p.id}
                title={p.title.trim() || `Тариф ${p.id}`}
                meta={formatPlanMeta(p)}
                {...priceCardProps(p.price_rub, activeDiscountPercent, discountedPriceForPlan)}
                selected={!payIsTest && payPlanId === p.id}
                popular={i === 1}
                onSelect={() => {
                  setPayIsTest(false);
                  setPayPlanId(p.id);
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {showPromo ? (
        <Card>
          <h3 className="mn-card-title">Промокод</h3>
          <div className="mn-promo-row">
            <input
              className="mn-input"
              value={promoCodeInput}
              onChange={(e) => setPromoCodeInput(e.target.value.replace(/\s+/g, "").toLocaleUpperCase("ru-RU"))}
              placeholder="Введите промокод"
            />
            <SecondaryButton onClick={() => void applyPromoCode()}>Применить</SecondaryButton>
          </div>
          {promoApplied ? (
            <p className="mn-feedback ok">Скидка {promoApplied.discount_percent}%. К оплате {finalPrice} ₽</p>
          ) : autoDiscountPercent > 0 ? (
            <p className="mn-feedback ok">Скидка за игру {autoDiscountPercent}%. К оплате {finalPrice} ₽</p>
          ) : promoFeedback ? (
            <p className="mn-feedback err">{promoFeedback.text}</p>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h3 className="mn-card-title">Оплата</h3>
        <p className="mn-price-total">
          Итого:{" "}
          {activeDiscountPercent ? (
            <>
              <s className="mn-price-old">{priceBase} ₽</s> <strong>{finalPrice} ₽</strong>
              <span className="mn-price-discount-tag">−{activeDiscountPercent}%</span>
            </>
          ) : (
            <strong>{finalPrice} ₽</strong>
          )}
        </p>
        <p className="mn-muted">
          {payProduct === "device_slot"
            ? "В комментарии к переводу укажите: device_slot."
            : payProduct === "white_lists"
            ? "В комментарии к переводу укажите: white_lists."
            : payProduct === "topup"
              ? `В комментарии укажите номер пакета: ${payPlanId}.`
              : payIsTest
                ? "В комментарии укажите слово «тест»."
                : `В комментарии укажите номер тарифа: ${payPlanId}.`}
        </p>
        <a className="mn-btn mn-btn--primary mn-btn--full mn-link-btn" href={data.payment_url} target="_blank" rel="noreferrer">
          Перейти к оплате
        </a>

        <div className="mn-upload" style={{ marginTop: "0.85rem" }}>
          <p className="mn-card-title">Прикрепите чек</p>
          <label className="mn-upload__btn">
            <input type="file" accept="image/*" hidden onChange={(e) => setPayPhoto(e.target.files?.[0] ?? null)} />
            {payPhoto ? "Заменить фото" : "Выбрать фото"}
          </label>
          <p className="mn-muted">{payPhoto ? payPhoto.name : "Файл не выбран"}</p>
        </div>

        <PrimaryButton
          fullWidth
          disabled={
            busyPay ||
            (salesDisabledForNew && data.subscriptions.length === 0) ||
            topupTargetUnlimited ||
            (payProduct === "device_slot" && payTargetId <= 0) ||
            (payProduct === "device_slot" && limitedSubs.length === 0)
          }
          onClick={() => void submitPaymentProof()}
          style={{ marginTop: "0.75rem" }}
        >
          {busyPay
            ? "Отправка…"
            : topupTargetUnlimited
              ? "Безлимит — докупка недоступна"
              : payProduct === "device_slot"
                ? "Отправить чек за место"
                : "Отправить чек на проверку"}
        </PrimaryButton>
      </Card>
    </>
  );
}
