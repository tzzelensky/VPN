/** Единый helper отображения призов рулетки (Mini App + админ preview). */

export type PrizeDisplayInput = {
  type?: string;
  value?: number;
  title?: string;
  icon?: string;
  color?: string;
  chance_percent?: number;
};

export const PRIZE_ICON_BY_TYPE: Record<string, string> = {
  subscription_days: "📅",
  traffic_gb: "📶",
  tariff_upgrade: "🚀",
  promo_discount: "🏷️",
  extra_ticket: "😔",
  no_prize: "😔",
  custom: "🎁",
};

const TYPE_COLOR_PALETTE: Record<string, string[]> = {
  subscription_days: ["#22c55e", "#34d399", "#16a34a", "#15803d"],
  traffic_gb: ["#3b82f6", "#2563eb", "#6366f1", "#1d4ed8"],
  tariff_upgrade: ["#f59e0b", "#fbbf24", "#ea580c"],
  promo_discount: ["#f43f5e", "#e11d48", "#fb7185"],
  extra_ticket: ["#64748b", "#94a3b8", "#475569"],
  no_prize: ["#64748b", "#94a3b8", "#475569"],
  custom: ["#8b5cf6", "#6366f1"],
};

function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
}

export function isRarePrize(prize: PrizeDisplayInput): boolean {
  const type = String(prize.type ?? "");
  const value = Number(prize.value) || 0;
  if (type === "traffic_gb" && value >= 50) return true;
  if (type === "subscription_days" && value >= 10) return true;
  const chance = Number(prize.chance_percent);
  if (Number.isFinite(chance) && chance > 0 && chance <= 5 && type !== "extra_ticket" && type !== "no_prize")
    return true;
  return false;
}

function defaultIconForType(type: string, value: number): string {
  if (isRarePrize({ type, value })) return "💎";
  return PRIZE_ICON_BY_TYPE[type] ?? "🎁";
}

/** Кастомная иконка админа имеет приоритет, иначе — по типу (и 💎 для редких). */
export function getPrizeIcon(prize: PrizeDisplayInput): string {
  const custom = String(prize.icon ?? "").trim();
  const type = String(prize.type ?? "custom");
  const value = Number(prize.value) || 0;
  const typeIcon = defaultIconForType(type, value);
  if (type === "custom" && custom) return custom;
  if (custom && custom !== typeIcon) return custom;
  return typeIcon;
}

export function getPrizeShortTitle(prize: PrizeDisplayInput): string {
  const type = String(prize.type ?? "custom");
  const value = Number(prize.value) || 0;
  switch (type) {
    case "subscription_days":
      return `+${Math.max(1, value)} ${dayWord(Math.max(1, value))}`;
    case "traffic_gb":
      return `+${Math.max(1, value)} ГБ`;
    case "tariff_upgrade":
      return "Апгрейд";
    case "promo_discount":
      return value > 0 ? `Скидка ${value}%` : "Скидка";
    case "extra_ticket":
    case "no_prize":
      return "Мимо";
    default:
      return shortenLegacyTitle(String(prize.title ?? "Приз"));
  }
}

export function getPrizeFullTitle(prize: PrizeDisplayInput): string {
  const title = String(prize.title ?? "").trim();
  if (title) return title;
  return getPrizeShortTitle(prize);
}

export function getPrizeColor(prize: PrizeDisplayInput, shadeIndex = 0): string {
  const fromAdmin = String(prize.color ?? "").trim();
  if (fromAdmin) return fromAdmin;
  const type = String(prize.type ?? "custom");
  const palette = TYPE_COLOR_PALETTE[type] ?? TYPE_COLOR_PALETTE.custom!;
  return palette[shadeIndex % palette.length] ?? palette[0]!;
}

export function getPrizeLabelTextClass(hex: string): "roulette-game__label--on-dark" | "roulette-game__label--on-light" {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "roulette-game__label--on-dark";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "roulette-game__label--on-light" : "roulette-game__label--on-dark";
}

export function parsePrizeFromTitle(title: string): PrizeDisplayInput {
  const t = title.trim();
  const gb = t.match(/\+?\s*(\d+)\s*ГБ/i);
  if (gb) return { type: "traffic_gb", value: Number(gb[1]), title: t };
  const days = t.match(/\+?\s*(\d+)\s*(день|дня|дней)/i);
  if (days) return { type: "subscription_days", value: Number(days[1]), title: t };
  if (/скид/i.test(t)) {
    const pct = t.match(/(\d+)\s*%/);
    return { type: "promo_discount", value: pct ? Number(pct[1]) : 20, title: t };
  }
  if (/апгрейд|улучш|тариф/i.test(t)) return { type: "tariff_upgrade", value: 1, title: t };
  if (/билет|ещё раз|еще раз/i.test(t)) return { type: "extra_ticket", value: 1, title: t };
  return { type: "custom", title: t };
}

export function resolveHistoryPrize(
  prizeTitle: string,
  catalog: PrizeDisplayInput[],
): PrizeDisplayInput {
  const exact = catalog.find((p) => getPrizeFullTitle(p) === prizeTitle || p.title === prizeTitle);
  if (exact) return exact;
  return parsePrizeFromTitle(prizeTitle);
}

function shortenLegacyTitle(title: string): string {
  const parsed = parsePrizeFromTitle(title);
  if (parsed.type !== "custom") return getPrizeShortTitle(parsed);
  return title.length > 14 ? `${title.slice(0, 12)}…` : title;
}

export function historyStatusLabel(status: string): string {
  if (status === "success") return "начислено";
  if (status === "pending") return "ожидает";
  if (status === "failed") return "ошибка";
  return status;
}

export function isRouletteLosePrize(prize: PrizeDisplayInput): boolean {
  const t = String(prize.type ?? "");
  return t === "no_prize" || t === "extra_ticket";
}

export function getRouletteLoseMessage(): string {
  return "Увы, в этот раз не повезло. В другой раз точно повезёт!";
}

export function prizePreviewLine(prize: PrizeDisplayInput): string {
  return `${getPrizeIcon(prize)} ${getPrizeShortTitle(prize)}`;
}
