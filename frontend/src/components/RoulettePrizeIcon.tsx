/** Единые flat-иконки призов рулетки (колесо, модалка, история). */

type Props = {
  type?: string;
  className?: string;
  size?: number;
};

const VIEW = 24;

export default function RoulettePrizeIcon({ type, className, size = 24 }: Props) {
  const t = String(type ?? "custom");
  const common = {
    width: size,
    height: size,
    viewBox: `0 0 ${VIEW} ${VIEW}`,
    className,
    "aria-hidden": true as const,
  };

  if (t === "subscription_days") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </svg>
    );
  }
  if (t === "traffic_gb") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 4l2.2 4.5 5 .7-3.6 3.5.85 5L12 15.8 7.55 17.7l.85-5L4.8 9.2l5-.7L12 4z" />
      </svg>
    );
  }
  if (t === "tariff_upgrade") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V9" />
        <path d="M7 14l5-5 5 5" />
        <path d="M5 21h14" />
      </svg>
    );
  }
  if (t === "promo_discount") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2.25" />
        <circle cx="16" cy="16" r="2.25" />
        <path d="M17 7L7 17" />
      </svg>
    );
  }
  if (t === "no_prize" || t === "extra_ticket") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.5H20l-4.6 3.3 1.8 5.5L12 14.2 7.8 17.3l1.8-5.5L5 8.5h6.2L12 3z" />
    </svg>
  );
}
