/** Единый helper отображения призов рулетки (Mini App + админ preview). */

export type PrizeDisplayInput = {
  type?: string;
  value?: number;
  title?: string;
  icon?: string;
  color?: string;
  chance_percent?: number;
};

/** Спокойные цвета секторов по типу награды (колесо). */
const WHEEL_TYPE_BASE: Record<string, string> = {
  subscription_days: "#2f9e6a",
  traffic_gb: "#3b7fd4",
  tariff_upgrade: "#7c6bdf",
  promo_discount: "#c2782a",
  extra_ticket: "#8b95a8",
  no_prize: "#a85555",
  custom: "#5b6fd6",
};

const TYPE_SHADE_OFFSET: Record<string, number[]> = {
  subscription_days: [0, 8, -6, 12],
  traffic_gb: [0, 10, -8],
  tariff_upgrade: [0, 6],
  promo_discount: [0, 8],
  extra_ticket: [0],
  no_prize: [0],
  custom: [0, 6, -4],
};

export const PRIZE_ICON_BY_TYPE: Record<string, string> = {
  subscription_days: "📅",
  traffic_gb: "💎",
  tariff_upgrade: "🚀",
  promo_discount: "🏷",
  extra_ticket: "❌",
  no_prize: "❌",
  custom: "🎁",
};

function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
}

function shiftHex(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const r = clamp(parseInt(h.slice(0, 2), 16) + amount);
  const g = clamp(parseInt(h.slice(2, 4), 16) + amount);
  const b = clamp(parseInt(h.slice(4, 6), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
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

/** Иконка для emoji-контекстов — тип, без кастомных стикеров (кроме custom). */
export function getPrizeIcon(prize: PrizeDisplayInput): string {
  const custom = String(prize.icon ?? "").trim();
  const type = String(prize.type ?? "custom");
  if (type === "custom" && custom) return custom;
  return PRIZE_ICON_BY_TYPE[type] ?? PRIZE_ICON_BY_TYPE.custom!;
}

export function getPrizeShortTitle(prize: PrizeDisplayInput): string {
  const type = String(prize.type ?? "custom");
  const value = Number(prize.value) || 0;
  switch (type) {
    case "subscription_days": {
      const n = Math.max(1, value);
      return `+${n} ${dayWord(n)}`;
    }
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

/** Цвет сектора на колесе — по типу награды. */
export function getPrizeSectorColor(prize: PrizeDisplayInput, shadeIndex = 0): string {
  const type = String(prize.type ?? "custom");
  const base = WHEEL_TYPE_BASE[type] ?? WHEEL_TYPE_BASE.custom!;
  const offsets = TYPE_SHADE_OFFSET[type] ?? [0];
  const off = offsets[shadeIndex % offsets.length] ?? 0;
  return shiftHex(base, off);
}

export function getPrizeColor(prize: PrizeDisplayInput, shadeIndex = 0): string {
  const fromAdmin = String(prize.color ?? "").trim();
  if (fromAdmin) return fromAdmin;
  return getPrizeSectorColor(prize, shadeIndex);
}

export function getPrizeAccentClass(prize: PrizeDisplayInput): string {
  const type = String(prize.type ?? "custom");
  return `roulette-prize-accent--${type.replace(/[^a-z0-9_]/gi, "_")}`;
}

export function getPrizeLabelTextClass(_hex: string): "roulette-game__label--on-dark" | "roulette-game__label--on-light" {
  return "roulette-game__label--on-dark";
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
