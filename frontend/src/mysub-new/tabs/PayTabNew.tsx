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

function formatComboSectionSubtitle(offers: Array<{ addon_labels: string[] }>): string {
  const labels = [...new Set(offers.flatMap((o) => o.addon_labels.filter(Boolean)))];
  if (labels.length === 0) return "Комбо-пакеты со скидкой.";
  if (labels.length === 1) return `Комбо-пакеты: подписка + ${labels[0]} со скидкой.`;
  const last = labels[labels.length - 1]!;
  const rest = labels.slice(0, -1).join(", ");
  return `Комбо-пакеты: подписка + ${rest} и ${last} со скидкой.`;
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
    payComboOfferId,
    selectComboOffer,
    selectedComboOffer,
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
    payProduct === "combo"
      ? selectedComboOffer?.final_rub ?? 0
      : payProduct === "device_slot"
      ? payTargetSub?.devices?.purchase_price_rub ?? data.device_limit?.purchase_price_rub ?? 0
      : payProduct === "white_lists"
      ? data.whitelist?.price_rub ?? 0
      : payProduct === "topup"
        ? selectedTopUpPlan?.price_rub ?? 0
        : payIsTest
          ? data.test_plan?.price_rub ?? 0
          : selectedPlan?.price_rub ?? 0;
  const comboOriginalPrice = selectedComboOffer?.original_rub ?? 0;
  const comboDiscountPercent = selectedComboOffer?.discount_percent ?? 0;
  const finalPrice =
    payProduct === "combo"
      ? priceBase
      : discountedPriceForPlan(priceBase);
  const showPromo =
    !payIsTest && payProduct !== "white_lists" && payProduct !== "device_slot" && payProduct !== "combo";
  const eligibleCombos = (data.combo_offers ?? []).filter((o) => o.eligible);
  const topupTargetUnlimited =
    payProduct === "topup" &&
    Boolean(payTargetSub && (payTargetSub.total_gb <= 0 || payTargetSub.stats.unlimited_traffic));
  const hasLimitedSubs = data.subscriptions.some((s) => s.total_gb > 0 && !s.stats.unlimited_traffic);
  const limitedSubs = data.subscriptions.filter((s) => s.devices?.enabled);
  const wlAnyCanBuy = data.subscriptions.some((s) => s.whitelist?.can_buy);
  const wlTargetBlocked = payProduct === "white_lists" && !payTargetSub?.whitelist?.can_buy;

  return (
    <>
      <Card className="mn-hero mn-hero--compact">
        <h2 className="mn-title">Оплата</h2>
        <p className="mn-subtitle">Выберите тариф и оплатите удобным способом.</p>
      </Card>

      {eligibleCombos.length > 0 ? (
        <Card className="mn-combo-section">
          <div className="mn-combo-section__head">
            <h3 className="mn-card-title">Спец-предложения</h3>
            <span className="mn-combo-badge">−{eligibleCombos[0]?.discount_percent ?? 15}%</span>
          </div>
          <p className="mn-muted">{formatComboSectionSubtitle(eligibleCombos)}</p>
          <div className="mn-combo-list">
            {eligibleCombos.map((offer) => {
              const selected = payProduct === "combo" && payComboOfferId === offer.id;
              const addonText = offer.addon_labels.join(" + ");
              return (
                <button
                  key={offer.id}
                  type="button"
                  className={`mn-combo-card ${selected ? "is-selected" : ""}`}
                  onClick={() => selectComboOffer(offer.id)}
                >
                  <div className="mn-combo-card__shine" aria-hidden />
                  <div className="mn-combo-card__body">
                    <div className="mn-combo-card__title">{offer.title}</div>
                    <div className="mn-combo-card__meta">
                      {offer.plan_title}
                      {addonText ? ` + ${addonText}` : ""}
                    </div>
                    {offer.for_subscription_hint ? (
                      <div className="mn-combo-card__hint">{offer.for_subscription_hint}</div>
                    ) : null}
                    <div className="mn-combo-card__price">
                      <s>{offer.original_rub} ₽</s>
                      <strong>{offer.final_rub} ₽</strong>
                      <span className="mn-combo-card__disc">−{offer.discount_percent}%</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card>
        <h3 className="mn-card-title">Что оплачиваете</h3>
        {payProduct === "device_slot" ? (
          <p className="mn-muted">Докупка места для дополнительного устройства.</p>
        ) : (
          <>
            <div className="mn-segment">
              <button
                type="button"
                className={payProduct === "subscription" || payProduct === "combo" ? "is-active" : ""}
                onClick={() => switchPayProduct("subscription")}
              >
                Тариф
              </button>
              <button
                type="button"
                className={payProduct === "topup" ? "is-active" : ""}
                disabled={!hasLimitedSubs}
                onClick={() => switchPayProduct("topup")}
              >
                Докупка ГБ
              </button>
              {data.whitelist?.visible ? (
                <button
                  type="button"
                  className={payProduct === "white_lists" ? "is-active" : ""}
                  disabled={!data.subscriptions.length || !wlAnyCanBuy}
                  onClick={() => switchPayProduct("white_lists")}
                >
                  Белые списки
                </button>
              ) : null}
            </div>
            {payProduct === "combo" && selectedComboOffer ? (
              <p className="mn-muted" style={{ marginTop: "0.55rem", marginBottom: 0 }}>
                Выбрано комбо: {selectedComboOffer.title}. Нажмите «Тариф», чтобы вернуться к обычным тарифам.
              </p>
            ) : null}
          </>
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

      {payProduct === "white_lists" && data.subscriptions.length > 0 ? (
        <Card>
          <h3 className="mn-card-title">Подписка для белых списков</h3>
          <p className="mn-muted">Выберите подписку, к которой подключить белые списки.</p>
          <div className="mn-stack" style={{ marginTop: "0.5rem" }}>
            {data.subscriptions.map((s) => {
              const wl = s.whitelist;
              const wlConnected = wl?.status === "active";
              const wlDisabled = !wl?.can_buy;
              return (
                <SecondaryButton
                  key={`wl-${s.id}`}
                  fullWidth
                  disabled={wlDisabled}
                  className={payTargetId === s.id ? "mn-selected-outline" : ""}
                  onClick={() => setPayTargetId(s.id)}
                >
                  {subscriptionLabel(s)}
                  {wlConnected ? " · БС подключены" : s.allowed ? " · активна" : ""}
                </SecondaryButton>
              );
            })}
          </div>
          {wlTargetBlocked && payTargetSub?.whitelist?.block_reason ? (
            <p className="mn-muted" style={{ marginTop: "0.5rem", color: "var(--danger, #f87171)" }}>
              {payTargetSub.whitelist.block_reason}
            </p>
          ) : null}
        </Card>
      ) : null}

      {payProduct === "combo" && data.subscriptions.length > 0 ? (
        <Card>
          <h3 className="mn-card-title">Подписка для комбо</h3>
          {selectedComboOffer?.for_subscription_hint ? (
            <p className="mn-combo-card__hint" style={{ marginBottom: "0.5rem" }}>
              {selectedComboOffer.for_subscription_hint}
            </p>
          ) : (
            <p className="mn-muted">Выберите подписку, к которой применить комбо.</p>
          )}
          <SecondaryButton fullWidth className={payTargetId === 0 ? "mn-selected-outline" : ""} onClick={() => setPayTargetId(0)}>
            Оформить новую
          </SecondaryButton>
          <div className="mn-stack" style={{ marginTop: "0.5rem" }}>
            {data.subscriptions.map((s) => {
              const comboIds = selectedComboOffer?.eligible_subscription_ids;
              const allowed =
                !comboIds || comboIds.length === 0 || comboIds.includes(s.id);
              return (
                <SecondaryButton
                  key={s.id}
                  fullWidth
                  disabled={!allowed}
                  className={payTargetId === s.id ? "mn-selected-outline" : ""}
                  onClick={() => setPayTargetId(s.id)}
                >
                  {subscriptionLabel(s)}
                  {!allowed
                    ? " · недоступно для комбо"
                    : s.allowed
                      ? " · активна"
                      : ""}
                </SecondaryButton>
              );
            })}
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

      <Card>
        <h3 className="mn-card-title">
          {payProduct === "device_slot"
            ? "Докупка места"
            : payProduct === "combo"
              ? "Комбо-пакет"
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
        ) : payProduct === "combo" ? (
          selectedComboOffer ? (
            <div className="mn-combo-summary">
              <p className="mn-combo-summary__title">{selectedComboOffer.title}</p>
              <p className="mn-muted">
                {selectedComboOffer.plan_title}
                {selectedComboOffer.addon_labels.length > 0
                  ? ` + ${selectedComboOffer.addon_labels.join(" + ")}`
                  : ""}
              </p>
              <p className="mn-combo-summary__price">
                <s>{selectedComboOffer.original_rub} ₽</s>{" "}
                <strong>{selectedComboOffer.final_rub} ₽</strong>
                <span className="mn-combo-card__disc">−{selectedComboOffer.discount_percent}%</span>
              </p>
            </div>
          ) : (
            <p className="mn-muted">Выберите комбо-предложение в блоке выше.</p>
          )
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
                  switchPayProduct("subscription");
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
                  switchPayProduct("subscription");
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
          {payProduct === "combo" && comboDiscountPercent > 0 ? (
            <>
              <s className="mn-price-old">{comboOriginalPrice} ₽</s> <strong>{finalPrice} ₽</strong>
              <span className="mn-price-discount-tag">−{comboDiscountPercent}%</span>
            </>
          ) : activeDiscountPercent ? (
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
            : payProduct === "combo"
              ? "В комментарии к переводу укажите: combo."
            : payProduct === "white_lists"
            ? "В комментарии к переводу укажите: white_lists."
            : payProduct === "topup"
              ? `В комментарии укажите номер пакета: ${payPlanId}.`
              : payIsTest
                ? "В комментарии укажите слово «тест»."
                : `В комментарии укажите номер тарифа: ${payPlanId}.`}
        </p>
        <a
          className={`mn-btn mn-btn--full mn-link-btn ${payProduct === "combo" ? "mn-combo-pay-btn" : "mn-btn--primary"}`}
          href={data.payment_url}
          target="_blank"
          rel="noreferrer"
        >
          {payProduct === "combo" ? "Оплатить комбо со скидкой" : "Перейти к оплате"}
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
            wlTargetBlocked ||
            (payProduct === "device_slot" && payTargetId <= 0) ||
            (payProduct === "device_slot" && limitedSubs.length === 0) ||
            (payProduct === "white_lists" && payTargetId <= 0) ||
            (payProduct === "combo" && !selectedComboOffer) ||
            Boolean(payProduct === "combo" && selectedComboOffer && !selectedComboOffer.eligible)
          }
          onClick={() => void submitPaymentProof()}
          style={{ marginTop: "0.75rem" }}
          className={payProduct === "combo" ? "mn-combo-submit-btn" : undefined}
        >
          {busyPay
            ? "Отправка…"
            : topupTargetUnlimited
              ? "Безлимит — докупка недоступна"
              : payProduct === "combo"
                ? "Отправить чек за комбо"
              : payProduct === "device_slot"
                ? "Отправить чек за место"
                : "Отправить чек на проверку"}
        </PrimaryButton>
      </Card>
    </>
  );
}
