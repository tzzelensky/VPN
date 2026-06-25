import MySubProfileStats from "../../components/MySubProfileStats";
import { subscriptionProfileHeading } from "../../subscriptionLabel";
import Card from "../components/Card";
import PrimaryButton from "../components/PrimaryButton";
import SecondaryButton from "../components/SecondaryButton";
import type { MySubWebAppController, MySubTheme } from "../types";

type Props = { ctrl: MySubWebAppController };

export default function ProfileTabNew({ ctrl }: Props) {
  const {
    data,
    profileSub,
    pickedSubId,
    setPickedSubId,
    setShowInstruction,
    copySubscription,
    theme,
    applyMySubTheme,
    openSupportProfile,
  } = ctrl;

  const sub = profileSub;

  return (
    <>
      {sub ? (
        <Card>
          <h3 className="mn-card-title">{subscriptionProfileHeading(sub, data.plans)}</h3>
          {data.subscriptions.length > 1 ? (
            <select
              className="mn-select"
              value={pickedSubId > 0 ? String(pickedSubId) : String(sub.id)}
              onChange={(e) => setPickedSubId(Number(e.target.value) || 0)}
              style={{ marginBottom: "0.65rem" }}
            >
              {data.subscriptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {subscriptionProfileHeading(s, data.plans)}
                  {s.stats.subscription_active ? " · активна" : ""}
                </option>
              ))}
            </select>
          ) : null}
          <MySubProfileStats
            subscription={sub}
            whitelist={data.whitelist}
            subscriptionTitle={subscriptionProfileHeading(sub, data.plans)}
          />
          <div className="mn-row-actions" style={{ marginTop: "0.65rem" }}>
            <PrimaryButton onClick={() => void copySubscription(sub.subscription_url)}>Скопировать ссылку</PrimaryButton>
            <SecondaryButton onClick={() => setShowInstruction(true)}>Инструкция</SecondaryButton>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="mn-empty">Подписок пока нет.</p>
        </Card>
      )}

      <Card>
        <h3 className="mn-card-title">Оформление</h3>
        <div className="mn-segment">
          {(["light", "dark"] as MySubTheme[]).map((t) => (
            <button key={t} type="button" className={theme === t ? "is-active" : ""} onClick={() => applyMySubTheme(t)}>
              {t === "light" ? "Светлая" : "Тёмная"}
            </button>
          ))}
        </div>
      </Card>

      {data.support_appeals?.enabled ? (
        <SecondaryButton fullWidth className="mn-support-btn" onClick={openSupportProfile}>
          Сообщить о проблеме
        </SecondaryButton>
      ) : null}
    </>
  );
}
