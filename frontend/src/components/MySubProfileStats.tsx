import type { MySubProfileDto } from "../api";

type SubStats = MySubProfileDto["subscriptions"][number]["stats"];
type Sub = MySubProfileDto["subscriptions"][number];
type Whitelist = NonNullable<MySubProfileDto["whitelist"]>;

function daysLabel(count: number): string {
  const n = Math.max(0, Math.floor(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} дней`;
  if (mod10 === 1) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} дня`;
  return `${n} дней`;
}

function formatWlDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

function ringPercentValue(percent: number | null, unlimited = false): number {
  if (unlimited) return 100;
  if (percent == null) return 0;
  return Math.max(0, Math.min(100, percent));
}

function TrafficBlock({ sub, st }: { sub: Sub; st: SubStats }) {
  return (
    <div className="mysub-profile-traffic">
      <div className="mysub-profile-traffic__labels">
        <span>Трафик</span>
        <span>
          {sub.used_text} / {sub.total_text}
        </span>
      </div>
      <div className="mysub-profile-traffic__bar">
        <div
          className="mysub-profile-traffic__fill"
          style={{
            width: st.unlimited_traffic ? "18%" : `${st.traffic_percent ?? 0}%`,
          }}
        />
      </div>
    </div>
  );
}

function RingGauge({
  valueLabel,
  subLabel,
  percent,
  tone,
  unlimited = false,
}: {
  valueLabel: string;
  subLabel: string;
  percent: number | null;
  tone: "ok" | "warn" | "bad" | "muted";
  unlimited?: boolean;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const p = ringPercentValue(percent, unlimited);
  const offset = c - (p / 100) * c;
  return (
    <div className={`mysub-ring-gauge mysub-ring-gauge--${tone}`}>
      <svg viewBox="0 0 100 100" className="mysub-ring-gauge__svg" aria-hidden>
        <circle className="mysub-ring-gauge__track" cx="50" cy="50" r={r} />
        <circle
          className="mysub-ring-gauge__fill"
          cx="50"
          cy="50"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="mysub-ring-gauge__center">
        <strong>{valueLabel}</strong>
        <span>{subLabel}</span>
      </div>
    </div>
  );
}

function fallbackSubStats(sub: Sub): SubStats {
  if (sub.stats) return sub.stats;
  const now = Date.now();
  const active = sub.enable && (sub.expiry_time <= 0 || sub.expiry_time > now);
  const remaining_ms = sub.expiry_time > 0 ? Math.max(0, sub.expiry_time - now) : null;
  const remaining_days =
    remaining_ms != null ? (remaining_ms > 0 ? Math.max(1, Math.ceil(remaining_ms / 86400000)) : 0) : null;
  let traffic_percent: number | null = null;
  if (sub.total_gb > 0) {
    const limit = sub.total_gb * 1073741824;
    traffic_percent = Math.min(100, Math.round(((sub.traffic_up + sub.traffic_down) / limit) * 100));
  }
  return {
    subscription_active: active,
    access_ok: sub.allowed,
    unlimited_time: sub.expiry_time <= 0,
    unlimited_traffic: sub.total_gb <= 0,
    remaining_ms,
    remaining_days,
    time_progress:
      remaining_ms == null ? null : remaining_ms <= 0 ? 0 : Math.min(100, Math.round((remaining_ms / (30 * 86400000)) * 100)),
    traffic_percent,
    expiry_label:
      sub.expiry_time > 0
        ? new Date(sub.expiry_time).toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })
        : null,
  };
}

function SubscriptionStatsCard({ sub, title }: { sub: Sub; title?: string }) {
  const st = fallbackSubStats(sub);
  const tone = st.subscription_active ? (st.access_ok ? "ok" : "warn") : "bad";
  const timeValue = st.unlimited_time
    ? "∞"
    : st.remaining_days != null && st.remaining_days > 0
      ? String(st.remaining_days)
      : "0";
  const timeSub = st.unlimited_time
    ? "без срока"
    : st.remaining_days != null && st.remaining_days > 0
      ? daysLabel(st.remaining_days)
      : "истекла";

  return (
    <article className={`mysub-profile-stat-card mysub-profile-stat-card--${tone}`}>
      <header className="mysub-profile-stat-card__head">
        <span className="mysub-profile-stat-card__icon" aria-hidden>
          📡
        </span>
        <div>
          <h4>{title?.trim() || "Основная подписка"}</h4>
          <p className="mysub-profile-stat-card__badge">
            {st.subscription_active ? (st.access_ok ? "Активна" : "Ограничена") : "Неактивна"}
          </p>
        </div>
      </header>
      <div className="mysub-profile-stat-card__body">
        <RingGauge
          valueLabel={timeValue}
          subLabel={timeSub}
          percent={st.time_progress}
          tone={tone}
          unlimited={st.unlimited_time}
        />
        <div className="mysub-profile-stat-card__meta">
          {st.expiry_label ? (
            <p>
              <span className="muted">До</span> <b>{st.expiry_label}</b>
            </p>
          ) : (
            <p>
              <b>Без срока</b>
            </p>
          )}
          <TrafficBlock sub={sub} st={st} />
        </div>
      </div>
    </article>
  );
}

function WhitelistStatsCard({ wl, sub }: { wl: Whitelist; sub?: Sub }) {
  if (!wl.visible || wl.status === "hidden") return null;

  const tone =
    wl.status === "connected"
      ? "ok"
      : wl.status === "suspended"
        ? "warn"
        : wl.status === "expired"
          ? "bad"
          : "muted";

  const statusLabel =
    wl.status === "connected"
      ? "Активны"
      : wl.status === "suspended"
        ? "Приостановлены"
        : wl.status === "expired"
          ? "Истекли"
          : "Не подключены";

  const days =
    wl.remaining_days != null && wl.remaining_days > 0 ? String(wl.remaining_days) : wl.status === "connected" ? "∞" : "—";
  const daysSub =
    wl.remaining_days != null && wl.remaining_days > 0
      ? daysLabel(wl.remaining_days)
      : wl.active_until
        ? "осталось"
        : wl.status === "connected"
          ? "без срока"
          : statusLabel.toLowerCase();

  const wlUnlimitedTime =
    wl.status === "connected" && !wl.active_until && (wl.remaining_days == null || wl.remaining_days <= 0);

  const ringPercent =
    wlUnlimitedTime
      ? 100
      : wl.remaining_days != null && wl.remaining_days > 0
        ? Math.min(100, (wl.remaining_days / 30) * 100)
        : null;

  const until = formatWlDate(wl.active_until);
  const subSt = sub ? fallbackSubStats(sub) : null;

  return (
    <article className={`mysub-profile-stat-card mysub-profile-stat-card--wl mysub-profile-stat-card--${tone}`}>
      <header className="mysub-profile-stat-card__head">
        <span className="mysub-profile-stat-card__icon" aria-hidden>
          ⬜
        </span>
        <div>
          <h4>Белые списки</h4>
          <p className="mysub-profile-stat-card__badge">{statusLabel}</p>
        </div>
      </header>
      <div className="mysub-profile-stat-card__body">
        {(wl.status === "connected" || wl.status === "suspended" || wl.status === "expired") && (
          <RingGauge
            valueLabel={days}
            subLabel={daysSub}
            percent={ringPercent}
            tone={tone}
            unlimited={wlUnlimitedTime}
          />
        )}
        <div className="mysub-profile-stat-card__meta">
          {until ? (
            <p>
              <span className="muted">До</span> <b>{until}</b>
            </p>
          ) : wl.status === "connected" ? (
            <p>
              <b>Без срока</b>
            </p>
          ) : null}
          {sub && subSt ? <TrafficBlock sub={sub} st={subSt} /> : null}
          {wl.status === "suspended" ? (
            <p className="mysub-profile-stat-hint">
              Продлите основную подписку, чтобы снова пользоваться белыми списками на оставшийся период.
            </p>
          ) : null}
          {wl.status === "not_connected" && wl.can_buy ? (
            <p className="mysub-profile-stat-hint">Можно подключить в разделе «Оплата».</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function MySubProfileStats({
  subscription,
  whitelist,
  subscriptionTitle,
}: {
  subscription: Sub | undefined;
  whitelist: Whitelist | undefined;
  subscriptionTitle?: string;
}) {
  if (!subscription && (!whitelist || whitelist.status === "hidden")) {
    return (
      <div className="mysub-profile-stats-empty">
        <p>Нет активной подписки для отображения статистики.</p>
      </div>
    );
  }

  return (
    <div className="mysub-profile-stats">
      {subscription ? <SubscriptionStatsCard sub={subscription} title={subscriptionTitle} /> : null}
      {whitelist ? <WhitelistStatsCard wl={whitelist} sub={subscription} /> : null}
    </div>
  );
}
