import { randomBytes } from "node:crypto";

export type DailyGiftPrizeType = "gb" | "days" | "promo" | "discount";
export type DailyGiftSelectionMode = "random" | "scheduled" | "queue";

export type DailyGiftPrizeRow = {
  id: string;
  title: string;
  type: DailyGiftPrizeType;
  /** GB count, days count, promo code text, or discount percent. */
  value: string;
  description: string;
  active: boolean;
  weight: number;
  valid_from: string | null;
  valid_until: string | null;
  max_total_claims: number | null;
  max_per_user: number | null;
  claims_count: number;
  /** Редкий «золотой» подарок — особое оформление в WebApp. */
  golden: boolean;
  created_at: string;
  updated_at: string;
};

export type DailyGiftScheduleRow = {
  day_key: string;
  prize_id: string;
};

export type DailyGiftConfig = {
  enabled: boolean;
  selection_mode: DailyGiftSelectionMode;
  queue_prize_ids: string[];
  queue_index: number;
  banner_image_url: string | null;
  reset_hour: number;
  reset_minute: number;
  notify_hour: number;
  notify_minute: number;
};

export type DailyGiftClaimStatus = "pending" | "applied" | "failed";

export type DailyGiftClaimRow = {
  id: string;
  tg_user_id: number;
  /** Telegram @username без «@». */
  tg_username?: string | null;
  /** Название подписки (берётся по user_id в панели). */
  subscription_name?: string | null;
  user_id: number | null;
  day_key: string;
  prize_id: string;
  prize_type: DailyGiftPrizeType;
  prize_title: string;
  prize_value: string;
  prize_description: string;
  prize_golden?: boolean;
  status: DailyGiftClaimStatus;
  error_message: string | null;
  credit_mode?: "direct" | "piggy" | null;
  opened_at: string;
  applied_at: string | null;
};

export type DailyGiftReminderRow = {
  tg_user_id: number;
  enabled: boolean;
  updated_at: string;
  last_notify_day_key: string | null;
};

export type DailyGiftEventRow = {
  id: string;
  tg_user_id: number | null;
  event: string;
  detail: string | null;
  created_at: string;
};

export type DailyGiftDayAssignment = {
  day_key: string;
  prize_id: string;
};

export type DailyGiftStoreFile = {
  config: DailyGiftConfig;
  prizes: DailyGiftPrizeRow[];
  schedules: DailyGiftScheduleRow[];
  day_assignments: DailyGiftDayAssignment[];
  claims: DailyGiftClaimRow[];
  reminders: DailyGiftReminderRow[];
  events: DailyGiftEventRow[];
};

export function newDailyGiftId(): string {
  return randomBytes(8).toString("hex");
}

export function defaultDailyGiftConfig(): DailyGiftConfig {
  return {
    enabled: false,
    selection_mode: "random",
    queue_prize_ids: [],
    queue_index: 0,
    banner_image_url: null,
    reset_hour: 11,
    reset_minute: 59,
    notify_hour: 12,
    notify_minute: 0,
  };
}

export function normalizeDailyGiftPrizeType(raw: unknown): DailyGiftPrizeType | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "gb" || v === "days" || v === "promo" || v === "discount") return v;
  return null;
}

export function normalizeDailyGiftSelectionMode(raw: unknown): DailyGiftSelectionMode {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "scheduled" || v === "queue") return v;
  return "random";
}

export function normalizeDailyGiftPrize(raw: unknown, fallback?: Partial<DailyGiftPrizeRow>): DailyGiftPrizeRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = normalizeDailyGiftPrizeType(o.type);
  if (!type) return null;
  const title = String(o.title ?? fallback?.title ?? "").trim();
  const value = String(o.value ?? fallback?.value ?? "").trim();
  const description = String(o.description ?? fallback?.description ?? "").trim();
  if (!title || !value) return null;
  const now = new Date().toISOString();
  const id = String(o.id ?? fallback?.id ?? newDailyGiftId()).trim();
  return {
    id,
    title,
    type,
    value,
    description,
    active: o.active !== false,
    weight: Math.max(0, Math.floor(Number(o.weight ?? fallback?.weight ?? 1) || 0)) || 1,
    valid_from: o.valid_from ? String(o.valid_from) : null,
    valid_until: o.valid_until ? String(o.valid_until) : null,
    max_total_claims:
      o.max_total_claims == null || o.max_total_claims === ""
        ? null
        : (() => {
            const n = Math.max(0, Math.floor(Number(o.max_total_claims) || 0));
            return n > 0 ? n : null;
          })(),
    max_per_user:
      o.max_per_user == null || o.max_per_user === ""
        ? null
        : (() => {
            const n = Math.max(0, Math.floor(Number(o.max_per_user) || 0));
            // Раньше в панели по умолчанию сохранялось 1, хотя лимита в UI не было.
            if (n <= 1) return null;
            return n;
          })(),
    claims_count: Math.max(0, Math.floor(Number(o.claims_count ?? fallback?.claims_count ?? 0) || 0)),
    golden: o.golden === true || fallback?.golden === true,
    created_at: String(o.created_at ?? fallback?.created_at ?? now),
    updated_at: String(o.updated_at ?? now),
  };
}

export function normalizeDailyGiftConfig(raw: unknown): DailyGiftConfig {
  const d = defaultDailyGiftConfig();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  const queue = Array.isArray(o.queue_prize_ids)
    ? o.queue_prize_ids.map((x) => String(x).trim()).filter(Boolean)
    : d.queue_prize_ids;
  return {
    enabled: o.enabled === true,
    selection_mode: normalizeDailyGiftSelectionMode(o.selection_mode),
    queue_prize_ids: queue,
    queue_index: Math.max(0, Math.floor(Number(o.queue_index ?? d.queue_index) || 0)),
    banner_image_url: o.banner_image_url ? String(o.banner_image_url).trim() || null : null,
    reset_hour: Math.min(23, Math.max(0, Math.floor(Number(o.reset_hour ?? d.reset_hour) || d.reset_hour))),
    reset_minute: Math.min(59, Math.max(0, Math.floor(Number(o.reset_minute ?? d.reset_minute) || d.reset_minute))),
    notify_hour: Math.min(23, Math.max(0, Math.floor(Number(o.notify_hour ?? d.notify_hour) || d.notify_hour))),
    notify_minute: Math.min(59, Math.max(0, Math.floor(Number(o.notify_minute ?? d.notify_minute) || d.notify_minute))),
  };
}
