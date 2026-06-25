import Card from "../components/Card";
import PrimaryButton from "../components/PrimaryButton";
import SecondaryButton from "../components/SecondaryButton";
import Badge from "../components/Badge";
import type { MySubWebAppController } from "../types";

type Props = { ctrl: MySubWebAppController };

export default function FriendsTabNew({ ctrl }: Props) {
  const {
    data,
    copySubscription,
    shareReferralInTelegram,
    friendRewardId,
    setFriendRewardId,
    friendRewardBusy,
    claimFriendReward,
  } = ctrl;

  const ref = data.referral;
  if (!ref?.enabled) {
    return (
      <Card>
        <p className="mn-empty">Реферальная программа временно отключена.</p>
      </Card>
    );
  }

  const rewardGb = (ref as { inviter_reward_gb?: number }).inviter_reward_gb ?? ref.invited_friends[0]?.reward_gb ?? 0;
  const rewardDays = (ref as { inviter_reward_days?: number }).inviter_reward_days ?? ref.invited_friends[0]?.reward_days ?? 0;
  const inviteeDiscount = (ref as { invited_discount_percent?: number }).invited_discount_percent;

  return (
    <>
      <Card>
        <h2 className="mn-title">Приглашайте друзей</h2>
        <p className="mn-subtitle">
          Отправьте ссылку другу. Когда он откроет приложение и выполнит условия, вы получите награду.
        </p>
        <p className="mn-url">{ref.invite_link || "Ссылка недоступна"}</p>
        <PrimaryButton fullWidth disabled={!ref.invite_link} onClick={shareReferralInTelegram} style={{ marginTop: "0.65rem" }}>
          Отправить в Telegram
        </PrimaryButton>
        <SecondaryButton
          fullWidth
          disabled={!ref.invite_link}
          onClick={() => ref.invite_link && void copySubscription(ref.invite_link)}
          style={{ marginTop: "0.5rem" }}
        >
          Скопировать ссылку
        </SecondaryButton>
      </Card>

      {(rewardGb > 0 || rewardDays > 0 || inviteeDiscount) ? (
        <Card>
          <h3 className="mn-card-title">Награды</h3>
          {rewardGb > 0 || rewardDays > 0 ? (
            <p>
              Вы получите:{" "}
              <strong>
                {rewardGb > 0 ? `+${rewardGb} ГБ` : ""}
                {rewardGb > 0 && rewardDays > 0 ? " / " : ""}
                {rewardDays > 0 ? `+${rewardDays} дн.` : ""}
              </strong>
            </p>
          ) : null}
          {inviteeDiscount ? <p className="mn-muted">Друг получит: скидку {inviteeDiscount}%</p> : null}
        </Card>
      ) : null}

      <Card>
        <h3 className="mn-card-title">Приглашённые друзья</h3>
        {ref.invited_friends.length === 0 ? (
          <p className="mn-empty">Вы пока никого не пригласили.</p>
        ) : (
          <div className="mn-stack">
            {ref.invited_friends.map((f, idx) => (
              <div key={`${f.tg_user_id}-${idx}`} className="mn-friend-card">
                <div>
                  <strong>{f.name}</strong>
                  <p className="mn-muted">{new Date(f.created_at).toLocaleDateString("ru-RU")}</p>
                </div>
                {f.status === "claimed" ? (
                  <Badge tone="success">Награда выдана</Badge>
                ) : (
                  <>
                    <Badge tone="warning">Ожидает покупки</Badge>
                    <button type="button" className="mn-gift-btn" onClick={() => setFriendRewardId(f.reward_id)}>
                      🎁
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {friendRewardId ? (
        <div className="mn-modal-backdrop" onClick={() => !friendRewardBusy && setFriendRewardId("")}>
          <div className="mn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mn-modal__head">
              <h2>Выберите награду</h2>
            </div>
            <div className="mn-modal__foot">
              <SecondaryButton disabled={friendRewardBusy} onClick={() => void claimFriendReward("gb")}>
                +ГБ
              </SecondaryButton>
              <PrimaryButton disabled={friendRewardBusy} onClick={() => void claimFriendReward("days")}>
                +Дни
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
