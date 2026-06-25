import { useState } from "react";
import { mySubRemoveDevice, mySubRenameDevice } from "../../api";
import { subscriptionLabel } from "../../subscriptionLabel";
import Card from "../components/Card";
import PrimaryButton from "../components/PrimaryButton";
import SecondaryButton from "../components/SecondaryButton";
import DeviceCard from "../components/DeviceCard";
import DailyGiftBlock from "../components/DailyGiftBlock";
import { formatMySubError } from "../formatMySubError";
import type { MySubWebAppController } from "../types";

type Props = { ctrl: MySubWebAppController };

export default function HomeTabNew({ ctrl }: Props) {
  const {
    data,
    homeSub,
    setHomeSubId,
    setPickedSubId,
    salesDisabledForNew,
    testPlanAvailable,
    copySubscription,
    setShowInstruction,
    setTab,
    openTestPay,
    openPickForCopy,
    initData,
    setMsg,
    refreshProfile,
    openDeviceSlotPay,
  } = ctrl;

  const [copied, setCopied] = useState(false);
  const showDevices = Boolean(homeSub?.devices?.enabled);
  const subUrl = homeSub?.subscription_url?.trim() ?? "";
  const multiSub = data.subscriptions.length > 1;
  const homeGift = homeSub?.daily_gift;
  const showDailyGift = Boolean(homeGift?.enabled && homeSub?.stats.subscription_active);

  async function handleCopy(url: string) {
    await copySubscription(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      {multiSub ? (
        <Card>
          <h3 className="mn-card-title">Подписка</h3>
          <p className="mn-muted mn-card-desc">Выберите подписку — подарок и начисление будут для неё.</p>
          <select
            className="mn-select"
            value={homeSub?.id ? String(homeSub.id) : ""}
            onChange={(e) => {
              const id = Number(e.target.value) || 0;
              setHomeSubId(id);
              setPickedSubId(id);
            }}
          >
            {data.subscriptions.map((s) => (
              <option key={s.id} value={s.id}>
                {subscriptionLabel(s)}
                {!s.stats.subscription_active ? " (неактивна)" : ""}
              </option>
            ))}
          </select>
        </Card>
      ) : null}
      {showDailyGift && homeGift ? (
        <DailyGiftBlock
          key={homeSub?.id ?? 0}
          ctrl={ctrl}
          gift={homeGift}
          multiSub={multiSub}
          subscriptionName={homeSub ? subscriptionLabel(homeSub) : undefined}
        />
      ) : null}
      {data.subscriptions.length === 0 ? (
        <Card>
          {salesDisabledForNew ? (
            <p className="mn-muted">Оформление новых подписок сейчас недоступно.</p>
          ) : (
            <>
              <h3 className="mn-card-title">Подписка не активна</h3>
              <p className="mn-muted">Оформите подписку, чтобы получить ссылку для подключения.</p>
              <PrimaryButton fullWidth onClick={() => setTab("subscription")} style={{ marginTop: "0.75rem" }}>
                Купить подписку
              </PrimaryButton>
              {testPlanAvailable ? (
                <SecondaryButton fullWidth onClick={openTestPay} style={{ marginTop: "0.5rem" }}>
                  Получить тестовую подписку
                </SecondaryButton>
              ) : null}
            </>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <h3 className="mn-card-title">Ссылка для подключения</h3>
            <p className="mn-muted mn-card-desc">Используйте эту ссылку в приложении Happ или V2Ray.</p>
            {subUrl ? (
              <>
                <p className="mn-config-name">Подписка: {homeSub ? subscriptionLabel(homeSub) : "—"}</p>
                <p className="mn-url" title={subUrl}>
                  {subUrl}
                </p>
                <PrimaryButton
                  fullWidth
                  success={copied}
                  disabled={!homeSub}
                  onClick={() => {
                    if (!homeSub) return;
                    if (data.subscriptions.length > 1) {
                      openPickForCopy();
                      return;
                    }
                    void handleCopy(homeSub.subscription_url);
                  }}
                >
                  {copied ? "Скопировано" : "Скопировать ссылку"}
                </PrimaryButton>
                <SecondaryButton fullWidth onClick={() => setShowInstruction(true)} style={{ marginTop: "0.5rem" }}>
                  Инструкция
                </SecondaryButton>
                <p className="mn-helper">Не знаете, куда вставить ссылку? Откройте инструкцию.</p>
              </>
            ) : (
              <>
                <p className="mn-empty">Ссылка пока недоступна</p>
                <p className="mn-muted">Обновите страницу или напишите в поддержку.</p>
              </>
            )}
          </Card>

          {showDevices && homeSub?.devices ? (
            <Card>
              <h3 className="mn-card-title">Устройства</h3>
              {(() => {
                const dev = homeSub.devices!;
                const limitN = dev.limit;
                const usedN = dev.used;
                const pct = limitN > 0 ? Math.min(100, Math.round((usedN / limitN) * 100)) : 0;
                const hasOverLimit = (dev.over_limit ?? 0) > 0;
                return (
                  <>
                    <p className="mn-muted">
                      Используется: {usedN} из {limitN}
                    </p>
                    <div className="mn-progress" aria-hidden>
                      <div
                        className={`mn-progress__bar${hasOverLimit ? " mn-progress__bar--warn" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {hasOverLimit ? (
                      <div className="mn-device-limit-banner">
                        <span className="mn-device-limit-banner__icon">⚠️</span>
                        <p>
                          Лимит устройств снижен. Одно или несколько устройств отключены — удалите лишние или добавьте
                          место.
                        </p>
                      </div>
                    ) : null}
                    {dev.devices.length === 0 ? (
                      <p className="mn-empty">
                        Пока нет подключенных устройств.
                        <br />
                        Первое устройство привяжется автоматически после обновления подписки.
                      </p>
                    ) : (
                      <div className="mn-stack">
                        {dev.devices.map((d) => (
                          <DeviceCard
                            key={d.id}
                            device={d}
                            purchasePriceRub={dev.purchase_price_rub}
                            onAddSlot={
                              homeSub.devices?.can_buy_slot && homeSub.devices.purchase_enabled
                                ? () => openDeviceSlotPay(homeSub.id)
                                : undefined
                            }
                            onRename={() => {
                              const name = window.prompt("Название устройства", d.device_name);
                              if (!name) return;
                              void mySubRenameDevice({
                                init_data: initData,
                                user_id: homeSub.id,
                                device_id: d.id,
                                name,
                              })
                                .then(refreshProfile)
                                .catch((e) => setMsg(formatMySubError(e instanceof Error ? e.message : String(e))));
                            }}
                            onRemove={() => {
                              if (!window.confirm(`Удалить ${d.device_name}?`)) return;
                              void mySubRemoveDevice({ init_data: initData, user_id: homeSub.id, device_id: d.id })
                                .then(refreshProfile)
                                .catch((e) => setMsg(formatMySubError(e instanceof Error ? e.message : String(e))));
                            }}
                          />
                        ))}
                      </div>
                    )}
                    <div className="mn-row-actions">
                      {homeSub.devices.can_buy_slot && homeSub.devices.purchase_enabled ? (
                        <PrimaryButton fullWidth onClick={() => openDeviceSlotPay(homeSub.id)}>
                          Добавить место · {dev.purchase_price_rub} ₽
                        </PrimaryButton>
                      ) : null}
                    </div>
                  </>
                );
              })()}
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
