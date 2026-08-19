export type VpnDisplayKind = "vless" | "hy2" | "trojan" | "vault" | "whitelist";

export type VpnDisplayItem = {
  key: string;
  kind: VpnDisplayKind;
  id: number;
  title: string;
  subtitle: string;
  badge: string;
  flag?: string;
};

function GripIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
      <circle cx="4" cy="3" r="1.4" fill="currentColor" />
      <circle cx="10" cy="3" r="1.4" fill="currentColor" />
      <circle cx="4" cy="8" r="1.4" fill="currentColor" />
      <circle cx="10" cy="8" r="1.4" fill="currentColor" />
      <circle cx="4" cy="13" r="1.4" fill="currentColor" />
      <circle cx="10" cy="13" r="1.4" fill="currentColor" />
    </svg>
  );
}

export default function VpnServerOrderList({
  items,
  dragKey,
  overKey,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  emptyText = "Нет элементов для отображения.",
}: {
  items: VpnDisplayItem[];
  dragKey: string | null;
  overKey: string | null;
  onDragStart: (key: string) => void;
  onDragEnd: () => void;
  onDragOver: (key: string) => void;
  onDragLeave: (key: string) => void;
  onDrop: (key: string) => void;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="vpn-display-empty muted">{emptyText}</p>;
  }

  return (
    <ol className="vpn-display-list" aria-label="Порядок элементов в подписке">
      {items.map((item, index) => (
        <li
          key={item.key}
          className={[
            "vpn-display-card",
            `vpn-display-card--${item.kind}`,
            dragKey === item.key ? "vpn-display-card--dragging" : "",
            overKey === item.key && dragKey !== item.key ? "vpn-display-card--over" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          draggable
          onDragStart={() => onDragStart(item.key)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            e.preventDefault();
            onDragOver(item.key);
          }}
          onDragLeave={() => onDragLeave(item.key)}
          onDrop={(e) => {
            e.preventDefault();
            onDrop(item.key);
          }}
        >
          <span className="vpn-display-grip" title="Перетащите">
            <GripIcon />
          </span>
          <span className="vpn-display-index">{index + 1}</span>
          <div className="vpn-display-card-body">
            <div className="vpn-display-card-title">
              {item.flag ? (
                <span className="vpn-display-flag" aria-hidden>
                  {item.flag}
                </span>
              ) : null}
              <span className="vpn-display-name">{item.title}</span>
              <span className={`vpn-display-badge vpn-display-badge--${item.kind}`}>{item.badge}</span>
            </div>
            <div className="vpn-display-card-meta">
              <span>{item.subtitle}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
