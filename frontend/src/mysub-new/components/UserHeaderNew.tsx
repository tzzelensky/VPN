import type { MySubProfileDto } from "../../api";
import Badge from "./Badge";

type Props = {
  data: MySubProfileDto;
  subscription: MySubProfileDto["subscriptions"][number] | null;
  onOpenProfile?: () => void;
  onAvatarTap?: () => void;
};

function subscriptionStatusLabel(sub: MySubProfileDto["subscriptions"][number] | null): { text: string; tone: "success" | "warning" | "muted" } {
  if (!sub) return { text: "Подписка не активна", tone: "warning" };
  if (sub.stats.unlimited_time) return { text: "Без срока", tone: "success" };
  if (sub.stats.subscription_active) {
    if (sub.stats.expiry_label) return { text: `До ${sub.stats.expiry_label}`, tone: "success" };
    return { text: "Активна", tone: "success" };
  }
  return { text: "Подписка не активна", tone: "warning" };
}

function HeaderContent({ data, status }: { data: MySubProfileDto; status: ReturnType<typeof subscriptionStatusLabel> }) {
  return (
    <>
      {data.avatar_url ? (
        <img src={data.avatar_url} alt="" className="mn-user-header__avatar" />
      ) : (
        <div className="mn-user-header__avatar mn-user-header__avatar--fallback">
          {(data.name || "U").trim().slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="mn-user-header__meta">
        <h1 className="mn-user-header__name">{data.name}</h1>
        <div className="mn-user-header__badges">
          <Badge tone="accent">Ultra Secure</Badge>
          <Badge tone={status.tone}>{status.text}</Badge>
        </div>
      </div>
    </>
  );
}

function AvatarBlock({ data, onTap }: { data: MySubProfileDto; onTap?: () => void }) {
  const inner = data.avatar_url ? (
    <img src={data.avatar_url} alt="" className="mn-user-header__avatar" />
  ) : (
    <div className="mn-user-header__avatar mn-user-header__avatar--fallback">
      {(data.name || "U").trim().slice(0, 1).toUpperCase()}
    </div>
  );
  if (!onTap) return inner;
  return (
    <button type="button" className="mn-user-header__avatar-hit" onClick={onTap} aria-label="Профиль">
      {inner}
    </button>
  );
}

export default function UserHeaderNew({ data, subscription, onOpenProfile, onAvatarTap }: Props) {
  const status = subscriptionStatusLabel(subscription);

  if (onAvatarTap) {
    return (
      <header className="mn-user-header">
        <AvatarBlock data={data} onTap={onAvatarTap} />
        {onOpenProfile ? (
          <button type="button" className="mn-user-header__meta-hit" onClick={onOpenProfile}>
            <div className="mn-user-header__meta">
              <h1 className="mn-user-header__name">{data.name}</h1>
              <div className="mn-user-header__badges">
                <Badge tone="accent">Ultra Secure</Badge>
                <Badge tone={status.tone}>{status.text}</Badge>
              </div>
            </div>
          </button>
        ) : (
          <div className="mn-user-header__meta">
            <h1 className="mn-user-header__name">{data.name}</h1>
            <div className="mn-user-header__badges">
              <Badge tone="accent">Ultra Secure</Badge>
              <Badge tone={status.tone}>{status.text}</Badge>
            </div>
          </div>
        )}
      </header>
    );
  }

  if (onOpenProfile) {
    return (
      <button type="button" className="mn-user-header mn-user-header--interactive" onClick={onOpenProfile}>
        <HeaderContent data={data} status={status} />
      </button>
    );
  }

  return (
    <header className="mn-user-header">
      <HeaderContent data={data} status={status} />
    </header>
  );
}
