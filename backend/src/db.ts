import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import {
  defaultRealityFlow,
  defaultRealitySni,
  normalizeFlow,
  randomRealityShortId,
} from "./realityKeygen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

export type CreateUserInput = {
  name?: string;
  email?: string;
  vless_uuid?: string;
  sub_token?: string;
  flow?: string;
  total_gb?: number;
  expiry_time?: number;
  enable?: number;
  tg_id?: string;
  comment?: string;
  traffic_up?: number;
  traffic_down?: number;
  remote_port?: number | null;
  reality_pbk?: string;
  reality_fp?: string;
  reality_sni?: string;
  reality_sid?: string;
  reality_spx?: string;
  /** 0 = все развёрнутые серверы в подписке; иначе только первые N по порядку id. */
  subscription_server_count?: number;
  /** Ограничение по количеству одновременно подключённых устройств. */
  device_limit_enabled?: number;
  /** Максимум устройств при включённом device_limit_enabled. */
  device_limit_count?: number;
  /** 1 = к подписке дописать последние 4 узла + строка Happ (белые списки). По умолчанию выкл. */
  whitelist_happ_enabled?: number;
  /** Служебные поля синхронизации с Xray (не задавать из формы клиента). */
  online_snapshot?: number;
  /** Текущее число онлайн-подключений по UUID (снимок последнего опроса). */
  online_devices?: number;
  stats_synced_at?: number;
  /** Последний «сырой» снимок счётчиков Xray (для корректного инкремента после рестартов). */
  stats_raw_up?: number;
  stats_raw_down?: number;
  /** Антиспам-состояние авто-уведомлений о трафике в Telegram. */
  traffic_notify_state?: "" | "low30" | "empty";
  /** legacy = старый plain/tls; reality = использовать Reality-профиль в ссылках. */
  connection_profile?: "legacy" | "reality";
};

export type UserRow = {
  id: number;
  name: string;
  email: string;
  vless_uuid: string;
  sub_token: string;
  flow: string;
  total_gb: number;
  expiry_time: number;
  enable: number;
  tg_id: string;
  comment: string;
  traffic_up: number;
  traffic_down: number;
  remote_port: number | null;
  reality_pbk: string;
  reality_fp: string;
  reality_sni: string;
  reality_sid: string;
  reality_spx: string;
  subscription_server_count: number;
  /** 1 = при последнем опросе Xray сообщал online>0 для этого UUID. */
  online_snapshot: number;
  /** Число одновременных активных подключений по последнему опросу Xray. */
  online_devices: number;
  /** Ограничение устройств для подписки: 0=выкл, 1=вкл. */
  device_limit_enabled: number;
  /** Максимум устройств, когда ограничение включено. */
  device_limit_count: number;
  /** 1 = к подписке дописываются последние 4 сервера + happ-строка белых списков. */
  whitelist_happ_enabled: number;
  /** Время последнего успешного sync трафика с узлов (ms). */
  stats_synced_at: number;
  /** Последний «сырой» снимок uplink/downlink из Xray; -1 = ещё не инициализировано. */
  stats_raw_up: number;
  stats_raw_down: number;
  /** Антиспам-состояние авто-уведомлений о трафике в Telegram. */
  traffic_notify_state: "" | "low30" | "empty";
  connection_profile: "legacy" | "reality";
  created_at: string;
  updated_at: string;
};

export type PaymentPlanId = 1 | 2 | 3;

export type PaymentSessionRow = {
  id: string;
  tg_chat_id: number;
  tg_user_id: number;
  target_user_id?: number;
  new_subscription_name?: string;
  kind: "subscription" | "topup";
  plan_id: PaymentPlanId;
  created_at: string;
  status: "awaiting_proof" | "pending_admin";
  proof_file_id?: string;
  /** Снимок из Telegram при выборе тарифа — для имени клиента в панели. */
  tg_username?: string;
  tg_first_name?: string;
  referral_inviter_user_id?: number;
  referral_discount_percent?: number;
};

export type ShopActivityRow = {
  id: string;
  kind: "subscription" | "topup";
  user_id: number;
  user_name: string;
  plan_id: PaymentPlanId;
  plan_title: string;
  total_gb?: number;
  days?: number;
  add_gb?: number;
  created_at: string;
};

export type SubscriptionShopPlanRow = {
  id: PaymentPlanId;
  title: string;
  total_gb: number;
  days: number;
  price_rub: number;
};

export type TopUpShopPlanRow = {
  id: PaymentPlanId;
  title: string;
  add_gb: number;
  price_rub: number;
};

/** Магазин в боте: цены, ссылка на оплату, отключение продажи новым клиентам. */
export type SubscriptionShopConfig = {
  sales_disabled: boolean;
  /** Пусто — взять из TELEGRAM_PAYMENT_URL / дефолт. */
  payment_url: string;
  plans: SubscriptionShopPlanRow[];
  topup_plans: TopUpShopPlanRow[];
};

export type ReferralProgramConfig = {
  enabled: boolean;
  inviter_reward_gb: number;
  inviter_reward_days: number;
  invited_discount_percent: number;
  invite_copy_text: string;
};

export type ReferralInviteRow = {
  tg_user_id: number;
  inviter_user_id: number;
  created_at: string;
  consumed: 0 | 1;
};

export type ReferralRewardRow = {
  id: string;
  inviter_user_id: number;
  invitee_tg_user_id: number;
  invitee_name: string;
  reward_gb: number;
  reward_days: number;
  status: "pending" | "claimed";
  /** Заполняется при выборе награды в боте / WebApp (старые записи могут быть без поля). */
  claimed_kind?: "gb" | "days";
  created_at: string;
};

export type PromoCodeRow = {
  id: string;
  name: string;
  code: string;
  discount_percent: number;
  one_time_per_user: boolean;
  created_at: string;
  updated_at: string;
};

export type PromoCodeUsageRow = {
  id: string;
  promo_id: string;
  promo_code: string;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  applied_at: string;
  session_id?: string;
};

export type ServerRow = {
  id: number;
  name: string;
  /** ISO 3166-1 alpha-2 (NL, DE, …) — для флага в подписке; пусто = без флага. */
  country_code: string;
  host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_password_enc: string;
  vless_port: number;
  vless_uuid: string | null;
  xray_config_path: string | null;
  /** Снимок транспорта inbound tzadmin-vless для корректной подписки (заполняется при деплое). */
  sub_port: number;
  sub_network: string;
  sub_security: string;
  sub_type: string;
  sub_host: string;
  sub_path: string;
  sub_sni: string;
  sub_fp: string;
  sub_alpn: string;
  sub_allow_insecure: number;
  sub_reality_pbk: string;
  sub_reality_sid: string;
  sub_reality_spx: string;
  vless_deployed: number;
  last_ssh_ok: number;
  last_error: string | null;
  updated_at: string;
};

type FileStore = {
  subscription_token: string | null;
  next_server_id: number;
  next_user_id: number;
  servers: ServerRow[];
  users: UserRow[];
  payment_sessions: PaymentSessionRow[];
  shop_activity_log: ShopActivityRow[];
  subscription_shop: SubscriptionShopConfig;
  referral_program: ReferralProgramConfig;
  referral_invites: ReferralInviteRow[];
  referral_rewards: ReferralRewardRow[];
  promo_codes: PromoCodeRow[];
  promo_code_usages: PromoCodeUsageRow[];
};

function defaultSubscriptionShop(): SubscriptionShopConfig {
  return {
    sales_disabled: false,
    payment_url: "",
    plans: [
      { id: 1, title: "Трафик 100 ГБ/мес, 30 дней", total_gb: 100, days: 30, price_rub: 90 },
      { id: 2, title: "Трафик 250 ГБ/мес, 30 дней", total_gb: 250, days: 30, price_rub: 115 },
      { id: 3, title: "Трафик безлимит, 30 дней", total_gb: 0, days: 30, price_rub: 155 },
    ],
    topup_plans: [
      { id: 1, title: "Докупить 25 ГБ", add_gb: 25, price_rub: 35 },
      { id: 2, title: "Докупить 60 ГБ", add_gb: 60, price_rub: 75 },
      { id: 3, title: "Докупить 120 ГБ", add_gb: 120, price_rub: 140 },
    ],
  };
}

function defaultReferralProgram(): ReferralProgramConfig {
  return {
    enabled: false,
    inviter_reward_gb: 10,
    inviter_reward_days: 7,
    invited_discount_percent: 10,
    invite_copy_text: "Я пользуюсь этим VPN, вот тебе скидка на первую покупку.",
  };
}

function emptyStore(): FileStore {
  return {
    subscription_token: null,
    next_server_id: 1,
    next_user_id: 1,
    servers: [],
    users: [],
    payment_sessions: [],
    shop_activity_log: [],
    subscription_shop: defaultSubscriptionShop(),
    referral_program: defaultReferralProgram(),
    referral_invites: [],
    referral_rewards: [],
    promo_codes: [],
    promo_code_usages: [],
  };
}

function normalizePromoCode(raw: unknown): PromoCodeRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const code = String(o.code ?? "")
    .trim()
    .toUpperCase();
  if (!id || !code) return null;
  return {
    id,
    name: String(o.name ?? "").trim() || code,
    code,
    discount_percent: Math.min(99, Math.max(1, Math.floor(Number(o.discount_percent) || 0))),
    one_time_per_user: o.one_time_per_user === true || o.one_time_per_user === 1 || o.one_time_per_user === "1",
    created_at: String(o.created_at ?? new Date().toISOString()),
    updated_at: String(o.updated_at ?? o.created_at ?? new Date().toISOString()),
  };
}

function normalizePromoCodeUsage(raw: unknown): PromoCodeUsageRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const promo_id = String(o.promo_id ?? "").trim();
  const promo_code = String(o.promo_code ?? "")
    .trim()
    .toUpperCase();
  const tg_user_id = Number(o.tg_user_id);
  if (!id || !promo_id || !promo_code || !Number.isFinite(tg_user_id) || tg_user_id <= 0) return null;
  return {
    id,
    promo_id,
    promo_code,
    tg_user_id: Math.floor(tg_user_id),
    tg_username: String(o.tg_username ?? "").trim() || undefined,
    tg_first_name: String(o.tg_first_name ?? "").trim() || undefined,
    applied_at: String(o.applied_at ?? new Date().toISOString()),
    session_id: String(o.session_id ?? "").trim() || undefined,
  };
}

export function normalizeReferralProgram(raw: unknown): ReferralProgramConfig {
  const base = defaultReferralProgram();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const legacyKind = String(o.inviter_reward_kind ?? "").trim().toLowerCase();
  const legacyVal = Math.max(1, Math.floor(Number(o.inviter_reward_value) || 1));
  const rewardGb = Math.max(
    1,
    Math.floor(Number(o.inviter_reward_gb) || (legacyKind === "gb" ? legacyVal : base.inviter_reward_gb)),
  );
  const rewardDays = Math.max(
    1,
    Math.floor(Number(o.inviter_reward_days) || (legacyKind === "days" ? legacyVal : base.inviter_reward_days)),
  );
  const discount = Math.min(90, Math.max(0, Math.floor(Number(o.invited_discount_percent) || 0)));
  const copy = String(o.invite_copy_text ?? "").trim();
  return {
    enabled: o.enabled === true || o.enabled === 1 || o.enabled === "1",
    inviter_reward_gb: rewardGb,
    inviter_reward_days: rewardDays,
    invited_discount_percent: Number.isFinite(discount) ? discount : base.invited_discount_percent,
    invite_copy_text: copy || base.invite_copy_text,
  };
}

export function normalizeSubscriptionShop(raw: unknown): SubscriptionShopConfig {
  const base = defaultSubscriptionShop();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const sales_disabled = o.sales_disabled === true || o.sales_disabled === 1 || o.sales_disabled === "1";
  const payment_url = String(o.payment_url ?? "").trim();
  const plansIn = Array.isArray(o.plans) ? o.plans : [];
  const topupIn = Array.isArray(o.topup_plans) ? o.topup_plans : [];
  const byId = new Map<PaymentPlanId, SubscriptionShopPlanRow>();
  const topupById = new Map<PaymentPlanId, TopUpShopPlanRow>();
  for (const p of base.plans) byId.set(p.id, { ...p });
  for (const p of base.topup_plans) topupById.set(p.id, { ...p });
  for (const rawPlan of plansIn) {
    if (!rawPlan || typeof rawPlan !== "object") continue;
    const pl = rawPlan as Record<string, unknown>;
    const id = Number(pl.id) as PaymentPlanId;
    if (id !== 1 && id !== 2 && id !== 3) continue;
    const cur = byId.get(id)!;
    const title = pl.title != null ? String(pl.title).trim() : cur.title;
    const total_gb = pl.total_gb != null ? Math.max(0, Math.floor(Number(pl.total_gb))) : cur.total_gb;
    const days = pl.days != null ? Math.max(1, Math.floor(Number(pl.days))) : cur.days;
    const price_rub = pl.price_rub != null ? Math.max(0, Math.floor(Number(pl.price_rub))) : cur.price_rub;
    byId.set(id, {
      id,
      title: title || cur.title,
      total_gb,
      days,
      price_rub: Number.isFinite(price_rub) ? price_rub : cur.price_rub,
    });
  }
  for (const rawPlan of topupIn) {
    if (!rawPlan || typeof rawPlan !== "object") continue;
    const pl = rawPlan as Record<string, unknown>;
    const id = Number(pl.id) as PaymentPlanId;
    if (id !== 1 && id !== 2 && id !== 3) continue;
    const cur = topupById.get(id)!;
    const title = pl.title != null ? String(pl.title).trim() : cur.title;
    const add_gb = pl.add_gb != null ? Math.max(1, Math.floor(Number(pl.add_gb))) : cur.add_gb;
    const price_rub = pl.price_rub != null ? Math.max(0, Math.floor(Number(pl.price_rub))) : cur.price_rub;
    topupById.set(id, {
      id,
      title: title || cur.title,
      add_gb: Number.isFinite(add_gb) ? add_gb : cur.add_gb,
      price_rub: Number.isFinite(price_rub) ? price_rub : cur.price_rub,
    });
  }
  return {
    sales_disabled,
    payment_url,
    plans: ([1, 2, 3] as const).map((id) => byId.get(id)!),
    topup_plans: ([1, 2, 3] as const).map((id) => topupById.get(id)!),
  };
}

function normalizePaymentSession(raw: unknown): PaymentSessionRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const plan = Number(o.plan_id);
  if (!id || ![1, 2, 3].includes(plan)) return null;
  const chat = Number(o.tg_chat_id);
  const usr = Number(o.tg_user_id);
  if (!Number.isFinite(chat) || !Number.isFinite(usr)) return null;
  const st = o.status === "pending_admin" ? "pending_admin" : "awaiting_proof";
  const kind = o.kind === "topup" ? "topup" : "subscription";
  return {
    id,
    tg_chat_id: chat,
    tg_user_id: usr,
    target_user_id:
      Number.isFinite(Number(o.target_user_id)) && Number(o.target_user_id) > 0
        ? Math.floor(Number(o.target_user_id))
        : undefined,
    new_subscription_name:
      typeof o.new_subscription_name === "string" && o.new_subscription_name.trim()
        ? o.new_subscription_name.trim().slice(0, 25)
        : undefined,
    kind,
    plan_id: plan as PaymentPlanId,
    created_at: String(o.created_at ?? new Date().toISOString()),
    status: st,
    proof_file_id: o.proof_file_id != null ? String(o.proof_file_id) : undefined,
    tg_username: o.tg_username != null ? String(o.tg_username).trim() : undefined,
    tg_first_name: o.tg_first_name != null ? String(o.tg_first_name).trim() : undefined,
    referral_inviter_user_id:
      Number.isFinite(Number(o.referral_inviter_user_id)) && Number(o.referral_inviter_user_id) > 0
        ? Math.floor(Number(o.referral_inviter_user_id))
        : undefined,
    referral_discount_percent:
      Number.isFinite(Number(o.referral_discount_percent)) && Number(o.referral_discount_percent) >= 0
        ? Math.floor(Number(o.referral_discount_percent))
        : undefined,
  };
}

function normalizeShopActivity(raw: unknown): ShopActivityRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const userId = Number(o.user_id);
  const planId = Number(o.plan_id);
  const kind = o.kind === "topup" ? "topup" : o.kind === "subscription" ? "subscription" : "";
  if (!id || !Number.isFinite(userId) || userId <= 0 || ![1, 2, 3].includes(planId) || !kind) return null;
  const row: ShopActivityRow = {
    id,
    kind,
    user_id: Math.floor(userId),
    user_name: String(o.user_name ?? "").trim() || `#${Math.floor(userId)}`,
    plan_id: planId as PaymentPlanId,
    plan_title: String(o.plan_title ?? "").trim() || `План #${planId}`,
    created_at: String(o.created_at ?? new Date().toISOString()),
  };
  if (Number.isFinite(Number(o.total_gb))) row.total_gb = Math.max(0, Math.floor(Number(o.total_gb)));
  if (Number.isFinite(Number(o.days))) row.days = Math.max(0, Math.floor(Number(o.days)));
  if (Number.isFinite(Number(o.add_gb))) row.add_gb = Math.max(0, Math.floor(Number(o.add_gb)));
  return row;
}

function normalizeCountryCode(raw: unknown): string {
  const t = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return t.length === 2 ? t : "";
}

export function normalizeServer(s: ServerRow): ServerRow {
  const host = (s.host ?? "").trim() || "0.0.0.0";
  const name = (s.name ?? "").trim() || host;
  return {
    ...s,
    host,
    name,
    country_code: normalizeCountryCode(s.country_code),
    xray_config_path: s.xray_config_path ?? null,
    sub_port: Number(s.sub_port) > 0 ? Number(s.sub_port) : Number(s.vless_port) || 0,
    sub_network: String(s.sub_network ?? "").trim(),
    sub_security: String(s.sub_security ?? "").trim().toLowerCase(),
    sub_type: String(s.sub_type ?? "").trim(),
    sub_host: String(s.sub_host ?? "").trim(),
    sub_path: String(s.sub_path ?? "").trim(),
    sub_sni: String(s.sub_sni ?? "").trim(),
    sub_fp: String(s.sub_fp ?? "").trim(),
    sub_alpn: String(s.sub_alpn ?? "").trim(),
    sub_allow_insecure: s.sub_allow_insecure === 1 ? 1 : 0,
    sub_reality_pbk: String(s.sub_reality_pbk ?? "").trim(),
    sub_reality_sid: String(s.sub_reality_sid ?? "").trim(),
    sub_reality_spx: String(s.sub_reality_spx ?? "").trim() || "/",
  };
}

const BYTES_PER_GB = 1073741824;
/** Значения ниже ~1e10 считаем Unix seconds (x-ui и старые импорты), иначе — миллисекунды. */
const MAX_UNIX_SECONDS_AS_MS_THRESHOLD = 10_000_000_000;

/**
 * Окончание в 12:00:00 по **локальному времени сервера** на календарный день из `ms`.
 * Часовой пояс сервера и браузера админки лучше совместить (например `TZ=Europe/Moscow` в Docker/systemd).
 */
export function snapExpiryTimeToNoonLocal(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/** Приводит срок к миллисекундам для сравнения с Date.now(); время — полдень выбранного дня. */
export function coerceExpiryTimeMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ms = n < MAX_UNIX_SECONDS_AS_MS_THRESHOLD ? Math.round(n * 1000) : Math.round(n);
  return snapExpiryTimeToNoonLocal(ms);
}

/** Лимит в ГБ; если в поле попали байты (импорт), переводим в ГБ. */
function coerceTotalGbField(raw: unknown): number {
  let gb = Number(raw);
  if (!Number.isFinite(gb) || gb < 0) return 0;
  if (gb > BYTES_PER_GB) gb = Math.max(1, Math.ceil(gb / BYTES_PER_GB));
  return gb;
}

function normalizeUser(u: UserRow): UserRow {
  const mode = String((u as { connection_profile?: unknown }).connection_profile ?? "legacy").toLowerCase();
  return {
    id: u.id,
    name: u.name ?? "user",
    email: u.email ?? u.name ?? "user",
    vless_uuid: u.vless_uuid,
    sub_token: String(u.sub_token ?? "").trim(),
    flow: normalizeFlow(u.flow ?? ""),
    total_gb: coerceTotalGbField(u.total_gb),
    expiry_time: coerceExpiryTimeMs(u.expiry_time),
    enable: u.enable === 0 ? 0 : 1,
    tg_id: u.tg_id ?? "",
    comment: u.comment ?? "",
    traffic_up: Number(u.traffic_up) || 0,
    traffic_down: Number(u.traffic_down) || 0,
    remote_port: u.remote_port != null && u.remote_port > 0 ? u.remote_port : null,
    reality_pbk: u.reality_pbk ?? "",
    reality_fp: u.reality_fp ?? "chrome",
    reality_sni: (u.reality_sni ?? "").trim() || defaultRealitySni(),
    reality_sid: u.reality_sid ?? "",
    reality_spx: u.reality_spx ?? "/",
    subscription_server_count: Math.max(0, Math.floor(Number(u.subscription_server_count) || 0)),
    online_snapshot: u.online_snapshot === 1 ? 1 : 0,
    online_devices: Math.max(0, Math.floor(Number((u as { online_devices?: unknown }).online_devices) || 0)),
    device_limit_enabled: Number((u as { device_limit_enabled?: unknown }).device_limit_enabled) === 1 ? 1 : 0,
    device_limit_count: Math.max(1, Math.floor(Number((u as { device_limit_count?: unknown }).device_limit_count) || 1)),
    whitelist_happ_enabled: Number((u as { whitelist_happ_enabled?: unknown }).whitelist_happ_enabled) === 1 ? 1 : 0,
    stats_synced_at: Number.isFinite(Number(u.stats_synced_at))
      ? Math.max(0, Math.floor(Number(u.stats_synced_at)))
      : 0,
    stats_raw_up: Number.isFinite(Number(u.stats_raw_up)) ? Math.max(-1, Math.floor(Number(u.stats_raw_up))) : -1,
    stats_raw_down: Number.isFinite(Number(u.stats_raw_down))
      ? Math.max(-1, Math.floor(Number(u.stats_raw_down)))
      : -1,
    traffic_notify_state:
      u.traffic_notify_state === "low30" || u.traffic_notify_state === "empty" ? u.traffic_notify_state : "",
    connection_profile: mode === "reality" ? "reality" : "legacy",
    created_at: u.created_at ?? new Date().toISOString(),
    updated_at: u.updated_at ?? u.created_at ?? new Date().toISOString(),
  };
}

function readStore(): FileStore {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw) as FileStore;
    if (!Array.isArray(parsed.servers)) return emptyStore();
    const users = Array.isArray(parsed.users) ? parsed.users.map((x) => normalizeUser(x as UserRow)) : [];
    const sessionsRaw = Array.isArray((parsed as { payment_sessions?: unknown }).payment_sessions)
      ? (parsed as { payment_sessions: unknown[] }).payment_sessions
      : [];
    const payment_sessions = sessionsRaw
      .map((x) => normalizePaymentSession(x))
      .filter((x): x is PaymentSessionRow => x != null);
    const shopActivityRaw = Array.isArray((parsed as { shop_activity_log?: unknown }).shop_activity_log)
      ? (parsed as { shop_activity_log: unknown[] }).shop_activity_log
      : [];
    const shop_activity_log = shopActivityRaw
      .map((x) => normalizeShopActivity(x))
      .filter((x): x is ShopActivityRow => x != null);
    const invitesRaw = Array.isArray((parsed as { referral_invites?: unknown }).referral_invites)
      ? (parsed as { referral_invites: unknown[] }).referral_invites
      : [];
    const referral_invites = invitesRaw
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const tg = Number(o.tg_user_id);
        const inviter = Number(o.inviter_user_id);
        if (!Number.isFinite(tg) || tg <= 0 || !Number.isFinite(inviter) || inviter <= 0) return null;
        return {
          tg_user_id: Math.floor(tg),
          inviter_user_id: Math.floor(inviter),
          created_at: String(o.created_at ?? new Date().toISOString()),
          consumed: o.consumed === 1 ? 1 : 0,
        } as ReferralInviteRow;
      })
      .filter((x): x is ReferralInviteRow => x != null);
    const rewardsRaw = Array.isArray((parsed as { referral_rewards?: unknown }).referral_rewards)
      ? (parsed as { referral_rewards: unknown[] }).referral_rewards
      : [];
    const referral_rewards = rewardsRaw
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const id = String(o.id ?? "").trim();
        const inviterUserId = Number(o.inviter_user_id);
        const inviteeTgUserId = Number(o.invitee_tg_user_id);
        if (!id || !Number.isFinite(inviterUserId) || inviterUserId <= 0 || !Number.isFinite(inviteeTgUserId) || inviteeTgUserId <= 0) {
          return null;
        }
        const ck = String(o.claimed_kind ?? "").trim().toLowerCase();
        const claimed_kind = ck === "gb" || ck === "days" ? (ck as "gb" | "days") : undefined;
        return {
          id,
          inviter_user_id: Math.floor(inviterUserId),
          invitee_tg_user_id: Math.floor(inviteeTgUserId),
          invitee_name: String(o.invitee_name ?? "").trim(),
          reward_gb: Math.max(1, Math.floor(Number(o.reward_gb) || 1)),
          reward_days: Math.max(1, Math.floor(Number(o.reward_days) || 1)),
          status: o.status === "claimed" ? "claimed" : "pending",
          ...(claimed_kind ? { claimed_kind } : {}),
          created_at: String(o.created_at ?? new Date().toISOString()),
        } as ReferralRewardRow;
      })
      .filter((x): x is ReferralRewardRow => x != null);
    const promoCodesRaw = Array.isArray((parsed as { promo_codes?: unknown }).promo_codes)
      ? (parsed as { promo_codes: unknown[] }).promo_codes
      : [];
    const promo_codes = promoCodesRaw.map((x) => normalizePromoCode(x)).filter((x): x is PromoCodeRow => x != null);
    const promoUsagesRaw = Array.isArray((parsed as { promo_code_usages?: unknown }).promo_code_usages)
      ? (parsed as { promo_code_usages: unknown[] }).promo_code_usages
      : [];
    const promo_code_usages = promoUsagesRaw
      .map((x) => normalizePromoCodeUsage(x))
      .filter((x): x is PromoCodeUsageRow => x != null);
    return {
      subscription_token: parsed.subscription_token ?? null,
      next_server_id: Number(parsed.next_server_id) > 0 ? Number(parsed.next_server_id) : 1,
      next_user_id: Number(parsed.next_user_id) > 0 ? Number(parsed.next_user_id) : 1,
      servers: parsed.servers.map((x) => normalizeServer(x as ServerRow)),
      users,
      payment_sessions,
      shop_activity_log,
      subscription_shop: normalizeSubscriptionShop(
        (parsed as { subscription_shop?: unknown }).subscription_shop,
      ),
      referral_program: normalizeReferralProgram((parsed as { referral_program?: unknown }).referral_program),
      referral_invites,
      referral_rewards,
      promo_codes,
      promo_code_usages,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: FileStore): void {
  const dir = path.dirname(dataPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(store, null, 2), "utf8");
}

function mutate(fn: (store: FileStore) => void): void {
  const store = readStore();
  fn(store);
  writeStore(store);
}

export function listServersOrdered(): ServerRow[] {
  return [...readStore().servers].sort((a, b) => a.id - b.id);
}

export function listDeployedServers(): ServerRow[] {
  return listServersOrdered().filter((r) => r.vless_deployed === 1 && r.vless_uuid != null);
}

/** Узлы в подписке: 0 или больше числа развёрнутых — все; иначе первые N по порядку id. */
export function serversForUserSubscription(user: UserRow): ServerRow[] {
  const rows = listDeployedServers();
  const lim = Math.floor(Number(user.subscription_server_count) || 0);
  if (lim <= 0 || rows.length === 0 || lim >= rows.length) return rows;
  return rows.slice(0, lim);
}

/**
 * Как в 3x-ui: один Reality-inbound — pbk/sni/sid общие. Подписка подставляет их из карточки
 * пользователя в sub_* сервера, если SSH так и не вытащил ключ из JSON.
 */
export function backfillDeployedServerRealityFromUser(user: UserRow): void {
  const pbk = (user.reality_pbk ?? "").trim();
  const sid = (user.reality_sid ?? "").trim();
  const sni = (user.reality_sni ?? "").trim();
  const fp = (user.reality_fp ?? "").trim();
  const spx = (user.reality_spx ?? "").trim();
  if (!pbk && !sid && !sni && !fp) return;

  for (const r of serversForUserSubscription(user)) {
    if (String(r.sub_security ?? "").trim().toLowerCase() !== "reality") continue;
    const patch: Partial<ServerRow> = {};
    if (pbk && !String(r.sub_reality_pbk ?? "").trim()) patch.sub_reality_pbk = pbk;
    if (sid && !String(r.sub_reality_sid ?? "").trim()) patch.sub_reality_sid = sid;
    if (sni && !String(r.sub_sni ?? "").trim()) patch.sub_sni = sni;
    if (fp && !String(r.sub_fp ?? "").trim()) patch.sub_fp = fp;
    if (spx && spx !== "/" && !String(r.sub_reality_spx ?? "").trim()) patch.sub_reality_spx = spx;
    if (Object.keys(patch).length > 0) updateServer(r.id, patch);
  }
}

export function getServer(id: number): ServerRow | undefined {
  return readStore().servers.find((s) => s.id === id);
}

export function createServer(row: Omit<ServerRow, "id" | "updated_at">): number {
  let newId = 0;
  mutate((store) => {
    newId = store.next_server_id++;
    store.servers.push(
      normalizeServer({
        ...row,
        id: newId,
        updated_at: new Date().toISOString(),
      } as ServerRow),
    );
  });
  return newId;
}

export function deleteServer(id: number): void {
  mutate((store) => {
    store.servers = store.servers.filter((s) => s.id !== id);
  });
}

export function updateServer(id: number, patch: Partial<ServerRow>): void {
  mutate((store) => {
    const i = store.servers.findIndex((s) => s.id === id);
    if (i === -1) return;
    store.servers[i] = normalizeServer({
      ...store.servers[i],
      ...patch,
      id,
      updated_at: new Date().toISOString(),
    } as ServerRow);
  });
}

/** Подписка и синхронизация UUID на Xray только для «живых» клиентов. */
export function userAllowedOnServers(u: UserRow): boolean {
  if (u.enable === 0) return false;
  if (u.expiry_time > 0 && Date.now() > u.expiry_time) return false;
  if (u.total_gb > 0) {
    const limitBytes = u.total_gb * 1073741824;
    if (u.traffic_up + u.traffic_down >= limitBytes) return false;
  }
  return true;
}

export function userExceededDeviceLimit(u: Pick<UserRow, "device_limit_enabled" | "device_limit_count" | "online_devices">): boolean {
  if (u.device_limit_enabled !== 1) return false;
  const limit = Math.max(1, Math.floor(Number(u.device_limit_count) || 1));
  const online = Math.max(0, Math.floor(Number(u.online_devices) || 0));
  return online > limit;
}

export function listUsers(): UserRow[] {
  return [...readStore().users].sort((a, b) => a.id - b.id);
}

export function getUser(id: number): UserRow | undefined {
  return readStore().users.find((u) => u.id === id);
}

/** Клиенты, у которых в панели указан этот Telegram user id (кому выдали подписку). */
export function findUsersByTelegramChatId(chatId: number | string): UserRow[] {
  const key = String(chatId).trim();
  if (!key) return [];
  return listUsers().filter((u) => String(u.tg_id ?? "").trim() === key);
}

export function getUserBySubToken(token: string): UserRow | undefined {
  const t = token.trim();
  const users = readStore().users;
  const exact = users.find((u) => String(u.sub_token ?? "").trim() === t);
  if (exact) return exact;
  const lower = t.toLowerCase();
  return users.find((u) => String(u.sub_token ?? "").trim().toLowerCase() === lower);
}

export function findUserByVlessUuid(uuid: string): UserRow | undefined {
  return readStore().users.find((u) => u.vless_uuid === uuid);
}

/** Как x-ui subId: 16 символов [a-z0-9] — длинный hex ломал импорт подписки в части клиентов. */
function randomSubToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[buf[i]! % alphabet.length]!;
  }
  return out;
}

/** Как в x-ui при импорте. */
function subTokenImportOk(s: string): boolean {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(s);
}

/** Старый генератор: randomBytes(24).toString("hex") — клиенты подписки часто не принимают. */
function isLegacyAutoHexSubToken(s: string): boolean {
  return s.length === 48 && /^[0-9a-f]+$/i.test(s);
}

/** Параметры Reality с уже настроенного клиента (тот же inbound на сервере). */
function templateRealityFromPeers(users: UserRow[]): {
  reality_pbk: string;
  reality_fp: string;
  reality_sni: string;
  reality_sid: string;
  reality_spx: string;
  remote_port: number | null;
} | undefined {
  for (const u of users) {
    const pbk = (u.reality_pbk ?? "").trim();
    const sid = (u.reality_sid ?? "").trim();
    if (!pbk || !sid) continue;
    return {
      reality_pbk: pbk,
      reality_fp: (u.reality_fp ?? "").trim() || "chrome",
      reality_sni: (u.reality_sni ?? "").trim() || defaultRealitySni(),
      reality_sid: sid,
      reality_spx: (u.reality_spx ?? "").trim() || "/",
      remote_port: u.remote_port != null && u.remote_port > 0 ? u.remote_port : null,
    };
  }
  return undefined;
}

function templateRealityFromServers(servers: ServerRow[]): {
  reality_pbk: string;
  reality_fp: string;
  reality_sni: string;
  reality_sid: string;
  reality_spx: string;
  remote_port: number | null;
} | undefined {
  for (const s of servers) {
    if (String(s.sub_security ?? "").trim().toLowerCase() !== "reality") continue;
    const pbk = String(s.sub_reality_pbk ?? "").trim();
    const sid = String(s.sub_reality_sid ?? "").trim();
    const sni = String(s.sub_sni ?? "").trim();
    if (!pbk || !sid || !sni) continue;
    return {
      reality_pbk: pbk,
      reality_fp: String(s.sub_fp ?? "").trim() || "chrome",
      reality_sni: sni,
      reality_sid: sid,
      reality_spx: String(s.sub_reality_spx ?? "").trim() || "/",
      remote_port: Number(s.sub_port) > 0 ? Number(s.sub_port) : Number(s.vless_port) || null,
    };
  }
  return undefined;
}

export function createUser(input: CreateUserInput = {}): UserRow {
  const now = new Date().toISOString();
  let created: UserRow | undefined;
  mutate((store) => {
    const id = store.next_user_id++;
    let sub = (input.sub_token ?? "").trim();
    const dup = store.users.some((u) => u.sub_token === sub);
    if (!sub || !subTokenImportOk(sub) || isLegacyAutoHexSubToken(sub) || dup) {
      do {
        sub = randomSubToken();
      } while (store.users.some((u) => u.sub_token === sub));
    }
    const uuid = (input.vless_uuid ?? "").trim() || uuidv4();
    if (store.users.some((u) => u.vless_uuid === uuid)) {
      throw new Error("Пользователь с таким UUID уже есть.");
    }
    const name = (input.name ?? "").trim() || `user-${id}`;
    let remote_port: number | null =
      input.remote_port != null && Number(input.remote_port) > 0 ? Number(input.remote_port) : null;
    const requestedMode = String(input.connection_profile ?? "").toLowerCase();
    let connection_profile: "legacy" | "reality" = requestedMode === "reality" ? "reality" : "legacy";
    let reality_pbk = (input.reality_pbk ?? "").trim();
    let reality_fp = (input.reality_fp ?? "").trim() || "chrome";
    let reality_sni = (input.reality_sni ?? "").trim() || defaultRealitySni();
    let reality_sid = (input.reality_sid ?? "").trim() || randomRealityShortId();
    let reality_spx = (input.reality_spx ?? "").trim() || "/";
    if (!reality_pbk) {
      const tmpl = templateRealityFromServers(store.servers) ?? templateRealityFromPeers(store.users);
      if (tmpl) {
        reality_pbk = tmpl.reality_pbk;
        reality_fp = tmpl.reality_fp;
        reality_sni = tmpl.reality_sni;
        reality_sid = tmpl.reality_sid;
        reality_spx = tmpl.reality_spx;
        if (tmpl.remote_port != null) remote_port = tmpl.remote_port;
        if (requestedMode !== "legacy") connection_profile = "reality";
      }
    }
    if (connection_profile === "legacy" && (process.env.AUTO_REALITY_FOR_NEW_USERS ?? "0") === "1") {
      if (reality_pbk && reality_sid && reality_sni) connection_profile = "reality";
    }
    created = normalizeUser({
      id,
      name,
      email: (input.email ?? "").trim() || name,
      vless_uuid: uuid,
      sub_token: sub,
      flow: normalizeFlow(input.flow ?? "") || defaultRealityFlow(),
      total_gb: coerceTotalGbField(input.total_gb),
      expiry_time: coerceExpiryTimeMs(input.expiry_time),
      enable: input.enable === undefined ? 1 : input.enable === 0 ? 0 : 1,
      tg_id: (input.tg_id ?? "").trim(),
      comment: (input.comment ?? "").trim(),
      traffic_up: Number(input.traffic_up) || 0,
      traffic_down: Number(input.traffic_down) || 0,
      remote_port,
      reality_pbk,
      reality_fp,
      reality_sni,
      reality_sid,
      reality_spx,
      subscription_server_count: Math.max(0, Math.floor(Number(input.subscription_server_count) || 0)),
      online_snapshot: 0,
      online_devices: 0,
      device_limit_enabled: input.device_limit_enabled === 1 ? 1 : 0,
      device_limit_count: Math.max(1, Math.floor(Number(input.device_limit_count) || 1)),
      whitelist_happ_enabled: input.whitelist_happ_enabled === 1 ? 1 : 0,
      stats_synced_at: 0,
      stats_raw_up: -1,
      stats_raw_down: -1,
      traffic_notify_state: "",
      connection_profile,
      created_at: now,
      updated_at: now,
    });
    store.users.push(created);
  });
  return created!;
}

export function updateUserRow(id: number, patch: Partial<CreateUserInput>): UserRow | undefined {
  let out: UserRow | undefined;
  mutate((store) => {
    const i = store.users.findIndex((u) => u.id === id);
    if (i === -1) return;
    const cur = store.users[i];
    const merged: UserRow = normalizeUser({
      ...cur,
      name: patch.name !== undefined ? String(patch.name).trim() || cur.name : cur.name,
      email: patch.email !== undefined ? String(patch.email).trim() || cur.email : cur.email,
      flow:
        patch.flow !== undefined
          ? normalizeFlow(String(patch.flow)) || defaultRealityFlow()
          : normalizeFlow(cur.flow),
      total_gb: patch.total_gb !== undefined ? coerceTotalGbField(patch.total_gb) : cur.total_gb,
      expiry_time: patch.expiry_time !== undefined ? coerceExpiryTimeMs(patch.expiry_time) : cur.expiry_time,
      enable: patch.enable !== undefined ? (patch.enable === 0 ? 0 : 1) : cur.enable,
      tg_id: patch.tg_id !== undefined ? String(patch.tg_id).trim() : cur.tg_id,
      comment: patch.comment !== undefined ? String(patch.comment).trim() : cur.comment,
      traffic_up: patch.traffic_up !== undefined ? Number(patch.traffic_up) : cur.traffic_up,
      traffic_down: patch.traffic_down !== undefined ? Number(patch.traffic_down) : cur.traffic_down,
      remote_port:
        patch.remote_port !== undefined
          ? patch.remote_port != null && patch.remote_port > 0
            ? patch.remote_port
            : null
          : cur.remote_port,
      reality_pbk: patch.reality_pbk !== undefined ? String(patch.reality_pbk).trim() : cur.reality_pbk,
      reality_fp: patch.reality_fp !== undefined ? String(patch.reality_fp).trim() || "chrome" : cur.reality_fp,
      reality_sni:
        patch.reality_sni !== undefined
          ? String(patch.reality_sni).trim() || defaultRealitySni()
          : cur.reality_sni,
      reality_sid: patch.reality_sid !== undefined ? String(patch.reality_sid).trim() : cur.reality_sid,
      reality_spx: patch.reality_spx !== undefined ? String(patch.reality_spx).trim() || "/" : cur.reality_spx,
      subscription_server_count:
        patch.subscription_server_count !== undefined
          ? Math.max(0, Math.floor(Number(patch.subscription_server_count) || 0))
          : cur.subscription_server_count,
      device_limit_enabled:
        patch.device_limit_enabled !== undefined
          ? patch.device_limit_enabled === 1
            ? 1
            : 0
          : cur.device_limit_enabled,
      device_limit_count:
        patch.device_limit_count !== undefined
          ? Math.max(1, Math.floor(Number(patch.device_limit_count) || 1))
          : cur.device_limit_count,
      whitelist_happ_enabled:
        patch.whitelist_happ_enabled !== undefined
          ? patch.whitelist_happ_enabled === 1
            ? 1
            : 0
          : cur.whitelist_happ_enabled,
      online_snapshot:
        patch.online_snapshot !== undefined
          ? patch.online_snapshot === 1
            ? 1
            : 0
          : cur.online_snapshot,
      online_devices:
        patch.online_devices !== undefined
          ? Math.max(0, Math.floor(Number(patch.online_devices) || 0))
          : cur.online_devices,
      stats_synced_at:
        patch.stats_synced_at !== undefined
          ? Number.isFinite(Number(patch.stats_synced_at))
            ? Math.max(0, Math.floor(Number(patch.stats_synced_at)))
            : cur.stats_synced_at
          : cur.stats_synced_at,
      stats_raw_up:
        patch.stats_raw_up !== undefined
          ? Number.isFinite(Number(patch.stats_raw_up))
            ? Math.max(-1, Math.floor(Number(patch.stats_raw_up)))
            : cur.stats_raw_up
          : cur.stats_raw_up,
      stats_raw_down:
        patch.stats_raw_down !== undefined
          ? Number.isFinite(Number(patch.stats_raw_down))
            ? Math.max(-1, Math.floor(Number(patch.stats_raw_down)))
            : cur.stats_raw_down
          : cur.stats_raw_down,
      traffic_notify_state:
        patch.traffic_notify_state !== undefined
          ? patch.traffic_notify_state === "low30" || patch.traffic_notify_state === "empty"
            ? patch.traffic_notify_state
            : ""
          : cur.traffic_notify_state,
      connection_profile:
        patch.connection_profile !== undefined
          ? String(patch.connection_profile).toLowerCase() === "reality"
            ? "reality"
            : "legacy"
          : cur.connection_profile,
      updated_at: new Date().toISOString(),
    });
    store.users[i] = merged;
    out = merged;
  });
  return out;
}

/** Обновить трафик и снимок «онлайн» из агрегата по UUID (только для пользователей из списка). */
export function applyUsersTrafficSnapshot(
  rows: Array<{
    vless_uuid: string;
    traffic_up: number;
    traffic_down: number;
    online?: boolean;
    online_count?: number;
  }>,
  syncedAtMs: number,
): number {
  let n = 0;
  mutate((store) => {
    for (let i = 0; i < store.users.length; i++) {
      const u = store.users[i];
      const hit = rows.find((r) => r.vless_uuid === u.vless_uuid);
      if (!hit) continue;
      const candUp = Number.isFinite(Number(hit.traffic_up)) ? Math.max(0, Math.floor(Number(hit.traffic_up))) : u.traffic_up;
      const candDown = Number.isFinite(Number(hit.traffic_down))
        ? Math.max(0, Math.floor(Number(hit.traffic_down)))
        : u.traffic_down;
      const onlineCount = Number.isFinite(Number(hit.online_count))
        ? Math.max(0, Math.floor(Number(hit.online_count)))
        : hit.online
          ? 1
          : 0;
      const prevRawUp = Number.isFinite(Number(u.stats_raw_up)) ? Number(u.stats_raw_up) : -1;
      const prevRawDown = Number.isFinite(Number(u.stats_raw_down)) ? Number(u.stats_raw_down) : -1;
      const hasRawBaseline = prevRawUp >= 0 && prevRawDown >= 0;
      let up = u.traffic_up;
      let down = u.traffic_down;
      if (!hasRawBaseline) {
        // Первая инициализация baseline: прибавляем текущий raw-снимок как новый сессионный прирост.
        // Иначе первый заметный трафик после деплоя "теряется" до следующего цикла sync.
        up = Math.max(0, Math.floor(Number(u.traffic_up) || 0) + candUp);
        down = Math.max(0, Math.floor(Number(u.traffic_down) || 0) + candDown);
      } else {
        const addUp = candUp >= prevRawUp ? candUp - prevRawUp : candUp;
        const addDown = candDown >= prevRawDown ? candDown - prevRawDown : candDown;
        up = Math.max(0, Math.floor(Number(u.traffic_up) || 0) + Math.max(0, addUp));
        down = Math.max(0, Math.floor(Number(u.traffic_down) || 0) + Math.max(0, addDown));
      }
      store.users[i] = normalizeUser({
        ...u,
        traffic_up: up,
        traffic_down: down,
        online_snapshot: onlineCount > 0 ? 1 : 0,
        online_devices: onlineCount,
        stats_synced_at: syncedAtMs,
        stats_raw_up: candUp,
        stats_raw_down: candDown,
        updated_at: new Date().toISOString(),
      });
      n++;
    }
  });
  return n;
}

export function clientUuidsForServer(serverUuid: string | null): string[] {
  const u = new Set<string>();
  if (serverUuid) u.add(serverUuid);
  for (const row of readStore().users) {
    if (userAllowedOnServers(row)) u.add(row.vless_uuid);
  }
  return [...u];
}

export function deleteUser(id: number): UserRow | undefined {
  let removed: UserRow | undefined;
  mutate((store) => {
    const i = store.users.findIndex((u) => u.id === id);
    if (i === -1) return;
    removed = store.users[i];
    store.users.splice(i, 1);
  });
  return removed;
}

function repairBrokenSubTokens(): void {
  const store = readStore();
  const used = new Set(store.users.map((u) => u.sub_token));
  let changed = false;
  for (let i = 0; i < store.users.length; i++) {
    if (!isLegacyAutoHexSubToken(store.users[i].sub_token)) continue;
    let sub: string;
    do {
      sub = randomSubToken();
    } while (used.has(sub));
    used.add(sub);
    store.users[i] = normalizeUser({
      ...store.users[i],
      sub_token: sub,
      updated_at: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) writeStore(store);
}

/** У клиентов без Reality подставить параметры с «эталонного» пользователя (один inbound). */
function repairUsersRealityFromPeers(): void {
  const store = readStore();
  const tmpl = templateRealityFromPeers(store.users);
  if (!tmpl) return;
  let changed = false;
  for (let i = 0; i < store.users.length; i++) {
    const u = store.users[i];
    if ((u.reality_pbk ?? "").trim()) continue;
    store.users[i] = normalizeUser({
      ...u,
      reality_pbk: tmpl.reality_pbk,
      reality_fp: tmpl.reality_fp,
      reality_sni: tmpl.reality_sni,
      reality_sid: tmpl.reality_sid,
      reality_spx: tmpl.reality_spx,
      remote_port: tmpl.remote_port != null ? tmpl.remote_port : u.remote_port,
      updated_at: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) writeStore(store);
}

export function getPaymentSession(id: string): PaymentSessionRow | undefined {
  return readStore().payment_sessions.find((s) => s.id === id);
}

export function findAwaitingProofSessionByChat(tg_chat_id: number): PaymentSessionRow | undefined {
  return readStore().payment_sessions.find(
    (s) => s.tg_chat_id === tg_chat_id && s.status === "awaiting_proof",
  );
}

export function findPendingAdminSessionByChat(tg_chat_id: number): PaymentSessionRow | undefined {
  return readStore().payment_sessions.find(
    (s) => s.tg_chat_id === tg_chat_id && s.status === "pending_admin",
  );
}

/** Новая заявка: сбрасываем все незавершённые сессии этого чата. */
export function startPaymentAwaitingProof(
  tg_chat_id: number,
  tg_user_id: number,
  plan_id: PaymentPlanId,
  kind: "subscription" | "topup" = "subscription",
  target_user_id?: number,
  new_subscription_name?: string,
  tgProfile?: { username?: string; first_name?: string },
  referralMeta?: { inviter_user_id?: number; discount_percent?: number },
): string {
  const id = randomBytes(8).toString("hex");
  const un = (tgProfile?.username ?? "").trim().replace(/^@/, "");
  const fn = (tgProfile?.first_name ?? "").trim();
  mutate((store) => {
    const prev = store.payment_sessions ?? [];
    store.payment_sessions = prev.filter((s) => s.tg_chat_id !== tg_chat_id);
    store.payment_sessions.push({
      id,
      tg_chat_id,
      tg_user_id,
      ...(target_user_id && target_user_id > 0 ? { target_user_id: Math.floor(target_user_id) } : {}),
      ...(new_subscription_name && String(new_subscription_name).trim()
        ? { new_subscription_name: String(new_subscription_name).trim().slice(0, 25) }
        : {}),
      kind,
      plan_id,
      created_at: new Date().toISOString(),
      status: "awaiting_proof",
      ...(un ? { tg_username: un } : {}),
      ...(fn ? { tg_first_name: fn } : {}),
      ...(referralMeta?.inviter_user_id && referralMeta.inviter_user_id > 0
        ? { referral_inviter_user_id: Math.floor(referralMeta.inviter_user_id) }
        : {}),
      ...(Number.isFinite(Number(referralMeta?.discount_percent))
        ? { referral_discount_percent: Math.max(0, Math.floor(Number(referralMeta?.discount_percent))) }
        : {}),
    });
  });
  return id;
}

export function markPaymentSessionPendingAdmin(sessionId: string, proof_file_id: string): boolean {
  let ok = false;
  mutate((store) => {
    const rows = store.payment_sessions ?? [];
    const i = rows.findIndex((s) => s.id === sessionId && s.status === "awaiting_proof");
    if (i === -1) return;
    rows[i] = { ...rows[i]!, status: "pending_admin", proof_file_id };
    ok = true;
  });
  return ok;
}

export function deletePaymentSession(sessionId: string): void {
  mutate((store) => {
    store.payment_sessions = (store.payment_sessions ?? []).filter((s) => s.id !== sessionId);
  });
}

export function appendShopActivity(
  input: Omit<ShopActivityRow, "id" | "created_at"> & { created_at?: string },
): ShopActivityRow {
  const row: ShopActivityRow = {
    id: randomBytes(8).toString("hex"),
    kind: input.kind === "topup" ? "topup" : "subscription",
    user_id: Math.max(1, Math.floor(Number(input.user_id) || 1)),
    user_name: String(input.user_name ?? "").trim() || `#${Math.max(1, Math.floor(Number(input.user_id) || 1))}`,
    plan_id: Number(input.plan_id) === 2 ? 2 : Number(input.plan_id) === 3 ? 3 : 1,
    plan_title: String(input.plan_title ?? "").trim() || "План",
    ...(input.total_gb != null ? { total_gb: Math.max(0, Math.floor(Number(input.total_gb) || 0)) } : {}),
    ...(input.days != null ? { days: Math.max(0, Math.floor(Number(input.days) || 0)) } : {}),
    ...(input.add_gb != null ? { add_gb: Math.max(0, Math.floor(Number(input.add_gb) || 0)) } : {}),
    created_at: String(input.created_at ?? new Date().toISOString()),
  };
  mutate((store) => {
    const rows = store.shop_activity_log ?? [];
    // Храним ограниченный хвост, чтобы JSON не разрастался бесконечно.
    const next = [...rows, row];
    store.shop_activity_log = next.slice(-2000);
  });
  return row;
}

export function listShopActivity(): ShopActivityRow[] {
  const rows = readStore().shop_activity_log ?? [];
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

export function getSubscriptionShop(): SubscriptionShopConfig {
  return normalizeSubscriptionShop(readStore().subscription_shop);
}

export function setSubscriptionShop(config: SubscriptionShopConfig): void {
  mutate((store) => {
    store.subscription_shop = normalizeSubscriptionShop(config);
  });
}

export function getReferralProgram(): ReferralProgramConfig {
  return normalizeReferralProgram(readStore().referral_program);
}

export function setReferralProgram(config: ReferralProgramConfig): void {
  mutate((store) => {
    store.referral_program = normalizeReferralProgram(config);
  });
}

export function setReferralInvite(tgUserId: number, inviterUserId: number): void {
  mutate((store) => {
    const rows = store.referral_invites ?? [];
    const next = rows.filter((r) => r.tg_user_id !== tgUserId || r.consumed === 1);
    next.push({
      tg_user_id: Math.floor(tgUserId),
      inviter_user_id: Math.floor(inviterUserId),
      created_at: new Date().toISOString(),
      consumed: 0,
    });
    store.referral_invites = next;
  });
}

export function getReferralInviteByTgUser(tgUserId: number): ReferralInviteRow | undefined {
  return readStore().referral_invites.find((r) => r.tg_user_id === tgUserId && r.consumed === 0);
}

export function consumeReferralInviteByTgUser(tgUserId: number): void {
  mutate((store) => {
    const rows = store.referral_invites ?? [];
    const i = rows.findIndex((r) => r.tg_user_id === tgUserId && r.consumed === 0);
    if (i === -1) return;
    rows[i] = { ...rows[i]!, consumed: 1 };
  });
}

export function createReferralReward(input: {
  inviter_user_id: number;
  invitee_tg_user_id: number;
  invitee_name: string;
  reward_gb: number;
  reward_days: number;
}): ReferralRewardRow {
  const row: ReferralRewardRow = {
    id: randomBytes(8).toString("hex"),
    inviter_user_id: Math.floor(input.inviter_user_id),
    invitee_tg_user_id: Math.floor(input.invitee_tg_user_id),
    invitee_name: String(input.invitee_name ?? "").trim(),
    reward_gb: Math.max(1, Math.floor(Number(input.reward_gb) || 1)),
    reward_days: Math.max(1, Math.floor(Number(input.reward_days) || 1)),
    status: "pending",
    created_at: new Date().toISOString(),
  };
  mutate((store) => {
    store.referral_rewards = [...(store.referral_rewards ?? []), row];
  });
  return row;
}

export function getReferralReward(id: string): ReferralRewardRow | undefined {
  return readStore().referral_rewards.find((r) => r.id === id);
}

export function claimReferralReward(id: string, kind?: "gb" | "days"): ReferralRewardRow | undefined {
  let out: ReferralRewardRow | undefined;
  mutate((store) => {
    const rows = store.referral_rewards ?? [];
    const i = rows.findIndex((r) => r.id === id && r.status === "pending");
    if (i === -1) return;
    const next: ReferralRewardRow = {
      ...rows[i]!,
      status: "claimed",
      ...(kind === "gb" || kind === "days" ? { claimed_kind: kind } : {}),
    };
    rows[i] = next;
    out = next;
  });
  return out;
}

/** Все реферальные награды (новые сверху) для админ-лога. */
export function listAllReferralRewards(): ReferralRewardRow[] {
  const rows = readStore().referral_rewards ?? [];
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

export function listReferralRewardsForInviterUsers(inviterUserIds: number[]): ReferralRewardRow[] {
  const ids = new Set(
    inviterUserIds
      .map((n) => Math.floor(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  if (ids.size === 0) return [];
  return readStore().referral_rewards.filter((r) => ids.has(r.inviter_user_id));
}

export function initDb(): void {
  if (!fs.existsSync(dataPath)) {
    writeStore(emptyStore());
    return;
  }
  repairBrokenSubTokens();
  repairUsersRealityFromPeers();
}

export function listPromoCodes(): PromoCodeRow[] {
  const rows = readStore().promo_codes ?? [];
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

export function getPromoCodeByText(code: string): PromoCodeRow | undefined {
  const key = String(code ?? "")
    .trim()
    .toUpperCase();
  if (!key) return undefined;
  return listPromoCodes().find((p) => p.code === key);
}

export function createPromoCode(input: {
  name: string;
  code: string;
  discount_percent: number;
  one_time_per_user: boolean;
}): PromoCodeRow {
  const name = String(input.name ?? "").trim();
  const code = String(input.code ?? "")
    .trim()
    .toUpperCase();
  if (!name) throw new Error("promo_name_required");
  if (!code) throw new Error("promo_code_required");
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new Error("promo_code_invalid");
  const discount = Math.min(99, Math.max(1, Math.floor(Number(input.discount_percent) || 0)));
  if (!Number.isFinite(discount) || discount <= 0) throw new Error("promo_discount_invalid");
  let out: PromoCodeRow | undefined;
  mutate((store) => {
    const rows = store.promo_codes ?? [];
    if (rows.some((r) => r.code === code)) throw new Error("promo_code_exists");
    out = {
      id: randomBytes(8).toString("hex"),
      name,
      code,
      discount_percent: discount,
      one_time_per_user: input.one_time_per_user === true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.promo_codes = [out!, ...rows];
  });
  return out!;
}

export function listPromoCodeUsages(promoId: string): PromoCodeUsageRow[] {
  const rows = readStore().promo_code_usages ?? [];
  return rows
    .filter((r) => r.promo_id === promoId)
    .sort((a, b) => {
      const ta = Date.parse(a.applied_at);
      const tb = Date.parse(b.applied_at);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
}

export function hasPromoCodeUsageByUser(promoId: string, tgUserId: number): boolean {
  const uid = Math.floor(Number(tgUserId));
  if (!Number.isFinite(uid) || uid <= 0) return false;
  return (readStore().promo_code_usages ?? []).some((r) => r.promo_id === promoId && r.tg_user_id === uid);
}

export function validatePromoCodeForUser(code: string, tgUserId: number): PromoCodeRow {
  const promo = getPromoCodeByText(code);
  if (!promo) throw new Error("promo_not_found");
  const uid = Math.floor(Number(tgUserId));
  if (!Number.isFinite(uid) || uid <= 0) throw new Error("promo_bad_user");
  if (promo.one_time_per_user && hasPromoCodeUsageByUser(promo.id, uid)) {
    throw new Error("promo_already_used");
  }
  return promo;
}

export function registerPromoCodeUsage(input: {
  code: string;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  session_id?: string;
}): PromoCodeUsageRow {
  const promo = validatePromoCodeForUser(input.code, input.tg_user_id);
  const uid = Math.floor(Number(input.tg_user_id));
  let out: PromoCodeUsageRow | undefined;
  mutate((store) => {
    const rows = store.promo_code_usages ?? [];
    out = {
      id: randomBytes(8).toString("hex"),
      promo_id: promo.id,
      promo_code: promo.code,
      tg_user_id: uid,
      tg_username: String(input.tg_username ?? "").trim() || undefined,
      tg_first_name: String(input.tg_first_name ?? "").trim() || undefined,
      applied_at: new Date().toISOString(),
      session_id: String(input.session_id ?? "").trim() || undefined,
    };
    rows.push(out!);
    store.promo_code_usages = rows.slice(-20_000);
  });
  return out!;
}

export function applyPromoCodeForUser(input: {
  code: string;
  tg_user_id: number;
  original_price_rub: number;
}): { promo: PromoCodeRow; final_price_rub: number; original_price_rub: number; discount_rub: number; discount_percent: number } {
  const promo = getPromoCodeByText(input.code);
  if (!promo) throw new Error("promo_not_found");
  const uid = Math.floor(Number(input.tg_user_id));
  if (!Number.isFinite(uid) || uid <= 0) throw new Error("promo_bad_user");
  if (promo.one_time_per_user && hasPromoCodeUsageByUser(promo.id, uid)) {
    throw new Error("promo_already_used");
  }
  const original = Math.max(0, Math.floor(Number(input.original_price_rub) || 0));
  const final = Math.max(0, Math.floor(original - (original * promo.discount_percent) / 100));
  return {
    promo,
    original_price_rub: original,
    final_price_rub: final,
    discount_rub: Math.max(0, original - final),
    discount_percent: promo.discount_percent,
  };
}
