import type { MySubProfileDto } from "../../api";
import Badge from "./Badge";

type Props = {
  data: MySubProfileDto;
  subscription: MySubProfileDto["subscriptions"][number] | null;
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

export default function UserHeaderNew({ data, subscription }: Props) {
  const status = subscriptionStatusLabel(subscription);

  return (
    <header className="mn-user-header">
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
          <Badge tone="muted">Reality VPN</Badge>
          <Badge tone={status.tone}>{status.text}</Badge>
        </div>
      </div>
    </header>
  );
}
