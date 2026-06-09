import {
  normalizeSubscriptionSettings,
  subscriptionSettingsFromLegacyServer,
  type ServerSubscriptionSettings,
} from "./serverSubscriptionSettings.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { normalizeExtraVlessLinks, type ExtraVlessLink } from "./extraVless.js";
import {
  defaultRealityFlow,
  defaultRealitySni,
  normalizeFlow,
  randomRealityShortId,
} from "./realityKeygen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

function communicationLogPath(): string {
  return path.join(path.dirname(dataPath), "communication_message_log.json");
}

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
  /** 0 = все развёрнутые серверы в подписке; иначе только первые N по порядку id (legacy). */
  subscription_server_count?: number;
  /** Явный список id развёрнутых серверов в подписке (порядок сохраняется). */
  subscription_server_ids?: number[];
  /** Ограничение по количеству одновременно подключённых устройств. */
  device_limit_enabled?: number;
  /** Максимум устройств при включённом device_limit_enabled. */
  device_limit_count?: number;
  /** Лимит скорости, Мбит/с; 0 = без ограничения. */
  speed_limit_mbps?: number;
  /** 1 = к подписке дописать последние 4 узла + строка Happ (белые списки). По умолчанию выкл. */
  whitelist_happ_enabled?: number;
  whitelist_active_until?: number;
  whitelist_purchase_id?: string;
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
  /** Антиспам авто-уведомлений о сроке подписки: warn = ≤3 дня, expired = истекла. */
  expiry_notify_state?: "" | "warn" | "expired";
  /** legacy = старый plain/tls; reality = использовать Reality-профиль в ссылках. */
  connection_profile?: "legacy" | "reality";
  /** 1 = тестовая подписка (скрыта из раздела «Пользователи»). */
  is_test_subscription?: number;
  /** Дополнительные VLESS-строки в подписке (вне узлов панели). */
  extra_vless_links?: ExtraVlessLink[];
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
  subscription_server_ids: number[];
  /** 1 = при последнем опросе Xray сообщал online>0 для этого UUID. */
  online_snapshot: number;
  /** Число одновременных активных подключений по последнему опросу Xray. */
  online_devices: number;
  /** Ограничение устройств для подписки: 0=выкл, 1=вкл. */
  device_limit_enabled: number;
  /** Максимум устройств, когда ограничение включено. */
  device_limit_count: number;
  /** Лимит скорости, Мбит/с; 0 = без ограничения. */
  speed_limit_mbps: number;
  /** 1 = к подписке дописываются последние 4 сервера + happ-строка белых списков. */
  whitelist_happ_enabled: number;
  /** Срок действия купленных белых списков (ms); 0 = до конца подписки или бессрочно. */
  whitelist_active_until: number;
  /** ID последней оплаченной покупки белых списков. */
  whitelist_purchase_id: string;
  /** Время последнего успешного sync трафика с узлов (ms). */
  stats_synced_at: number;
  /** Последний «сырой» снимок uplink/downlink из Xray; -1 = ещё не инициализировано. */
  stats_raw_up: number;
  stats_raw_down: number;
  /** Антиспам-состояние авто-уведомлений о трафике в Telegram. */
  traffic_notify_state: "" | "low30" | "empty";
  expiry_notify_state: "" | "warn" | "expired";
  connection_profile: "legacy" | "reality";
  /** Билеты на мини-игру «Дроппер» в WebApp. */
  dropper_tickets: number;
  /** 1 = клиент создан по тестовой подписке (не показывается в разделе «Пользователи»). */
  is_test_subscription: number;
  /** Доп. VLESS-ключи, добавленные вручную в подписку. */
  extra_vless_links: ExtraVlessLink[];
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
  kind: "subscription" | "topup" | "test" | "white_lists";
  plan_id: PaymentPlanId;
  created_at: string;
  status: "awaiting_proof" | "pending_admin";
  proof_file_id?: string;
  /** Снимок из Telegram при выборе тарифа — для имени клиента в панели. */
  tg_username?: string;
  tg_first_name?: string;
  referral_inviter_user_id?: number;
  referral_discount_percent?: number;
  roulette_discount_percent?: number;
  roulette_discount_spin_id?: number;
};

export type RoulettePurchaseDiscountRow = {
  tg_user_id: number;
  discount_percent: number;
  spin_id: number;
  created_at: string;
};

export type RouletteGbPiggyRow = {
  user_id: number;
  accumulated_gb: number;
  updated_at: string;
};

export const ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD = 50;

export type ShopActivityRow = {
  id: string;
  kind: "subscription" | "topup" | "test" | "white_lists";
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

export type TestSubscriptionPlanConfig = {
  enabled: boolean;
  title: string;
  total_gb: number;
  days: number;
  price_rub: number;
};

/** Магазин в боте: цены, ссылка на оплату, отключение продажи новым клиентам. */
export type SubscriptionShopConfig = {
  sales_disabled: boolean;
  /** Пусто — взять из TELEGRAM_PAYMENT_URL / дефолт. */
  payment_url: string;
  plans: SubscriptionShopPlanRow[];
  topup_plans: TopUpShopPlanRow[];
  test_plan: TestSubscriptionPlanConfig;
};

export type ReferralProgramConfig = {
  enabled: boolean;
  inviter_reward_gb: number;
  inviter_reward_days: number;
  invited_discount_percent: number;
  invite_copy_text: string;
};

/** Кнопка «Сообщить о проблеме» в боте и «Поддержка» в WebApp. */
export type SupportAppealsConfig = {
  enabled: boolean;
};

export type SupportAppealStatus = "new" | "in_progress" | "closed";

export type SupportAppealRow = {
  id: string;
  tg_chat_id: number;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  user_id?: number;
  text: string;
  /** file_id из Telegram (бот). */
  photo_file_ids: string[];
  /** Файлы на диске (WebApp и ответ админа). */
  photo_paths: string[];
  status: SupportAppealStatus;
  source: "bot" | "webapp";
  created_at: string;
  updated_at: string;
  taken_at?: string;
  closed_at?: string;
  admin_reply_text?: string;
  admin_reply_photo_paths?: string[];
};

export type ReferralInviteRow = {
  tg_user_id: number;
  inviter_user_id: number;
  created_at: string;
  consumed: 0 | 1;
};

/** Мини-игра «Дроппер» в WebApp (Peace Death–стиль в UI). */
export type DropperGameConfig = {
  enabled: boolean;
  /** Награда «ГБ» при выборе подарка (целое число ГБ). */
  reward_gb: number;
  /** Награда «дни» при выборе подарка. */
  reward_days: number;
  /** Билетов за одну подтверждённую покупку (бот / WebApp). */
  tickets_per_purchase: number;
  /**
   * Базовая длительность полёта (сек) при множителе скорости 1. Скорость падения на клиенте ∝ 1/это_значение × flight_speed_mult.
   */
  flight_duration_sec: number;
  /**
   * Множитель скорости падения (вертикаль). 1 = по базовой длительности; ниже 1 — медленнее и дольше раунд; выше 1 — быстрее.
   * Ориентир времени до финиша: flight_duration_sec / flight_speed_mult (сек).
   */
  flight_speed_mult: number;
  /** Умирать ли от бокового касания препятствия. */
  side_hit_death_enabled: boolean;
};

export type DropperSessionRow = {
  id: string;
  tg_user_id: number;
  user_id: number;
  seed: number;
  started_at: string;
  /** Тренировка: без списания билета, без записи в статистику и наград. */
  practice?: boolean;
};

export type DropperPlayLogRow = {
  id: string;
  tg_user_id: number;
  user_id: number;
  user_name: string;
  result: "win" | "lose";
  reward_kind?: "gb" | "days";
  reward_amount?: number;
  flight_ms?: number;
  created_at: string;
};

export type WebAppActiveGame = "none" | "dropper" | "roulette";

export type RoulettePrizeRow = {
  id: string;
  title: string;
  type: string;
  value: number;
  chance_percent: number;
  active: boolean;
  color: string;
  icon: string;
  win_text: string;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type RouletteSpinRow = {
  id: number;
  user_id: number;
  tg_user_id: number;
  prize_id: string;
  prize_title: string;
  /** Пояснение для пользователя, если фактический приз отличается от сектора на колесе. */
  prize_display_message?: string | null;
  ticket_spent: boolean;
  result_type: string;
  result_value: number;
  status: "success" | "failed" | "pending";
  error_message: string | null;
  /** Telegram-уведомление пользователю отправлено (после анимации в Mini App). */
  user_notified?: boolean;
  created_at: string;
};

export type GameTicketTransactionSource =
  | "purchase"
  | "admin"
  | "roulette_prize"
  | "compensation"
  | "purchase_for_days"
  | "purchase_for_gb";

export type GameTicketTransactionRow = {
  id: string;
  user_id: number;
  tg_user_id: number;
  source: GameTicketTransactionSource;
  payment_id?: string | null;
  amount: number;
  roulette_spin_id?: number | null;
  game_type?: "roulette" | "dropper" | null;
  spent_resource_type?: "subscription_days" | "traffic_gb" | "none" | null;
  spent_resource_amount?: number | null;
  subscription_before?: number | null;
  subscription_after?: number | null;
  traffic_before?: number | null;
  traffic_after?: number | null;
  status?: "success" | "failed";
  error_message?: string | null;
  created_at: string;
};

export type RouletteTicketShopConfig = {
  enabled: boolean;
  price_days_per_ticket: number;
  price_gb_per_ticket: number;
  min_tickets: number;
  max_tickets: number;
  allow_days: boolean;
  allow_gb: boolean;
  notify_telegram_on_purchase: boolean;
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

export type ReferralAdminGiftRow = {
  id: string;
  user_id: number;
  user_name: string;
  kind: "gb" | "days";
  amount: number;
  created_at: string;
  admin_comment?: string;
  granted_by?: string;
  telegram_sent?: boolean;
};

export type ReferralSettingsChangeRow = {
  id: string;
  changed_by: string;
  field: string;
  field_label: string;
  old_value: string;
  new_value: string;
  created_at: string;
};

export type PromoCodeRow = {
  id: string;
  name: string;
  code: string;
  type: "percent" | "rub" | "gb" | "days" | "combo";
  discount_percent: number;
  discount_rub: number;
  gift_gb: number;
  gift_days: number;
  one_time_per_user: boolean;
  max_uses_total?: number;
  max_uses_per_user: number;
  min_purchase_rub?: number;
  first_purchase_only: boolean;
  new_users_only: boolean;
  apply_plan_ids?: number[];
  admin_note?: string;
  active: boolean;
  valid_until: string;
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
  user_name?: string;
  phone?: string;
  applied_at: string;
  session_id?: string;
  plan_id?: number;
  plan_title?: string;
  original_price_rub?: number;
  final_price_rub?: number;
  discount_rub?: number;
  bonus_gb?: number;
  bonus_days?: number;
  status?: "applied" | "error";
  error?: string;
};

export type CommunicationMessageRecipient = {
  user_id: number;
  user_name: string;
};

export type CommunicationMessageLogRow = {
  id: string;
  sent_at: string;
  automatic: boolean;
  /** Подпись в интерфейсе, напр. «Рассылка: всем» или «Авто: мало трафика». */
  source_label: string;
  mode?: "global" | "single" | "selected" | "segment";
  segment_id?: string;
  segment_name?: string;
  text: string;
  has_photo: boolean;
  recipients: CommunicationMessageRecipient[];
  sent: number;
  attempted: number;
  failed: number;
};

export type CommunicationSegmentRow = {
  id: string;
  name: string;
  user_ids: number[];
  days_mode: "any" | "exact" | "range";
  days_exact?: number;
  days_from?: number;
  days_to?: number;
  gb_mode: "any" | "exact" | "range";
  gb_exact?: number;
  gb_from?: number;
  gb_to?: number;
  preset_enabled: boolean;
  preset_text: string;
  /** Системный сегмент (нельзя удалить). */
  system_key?: string;
  created_at: string;
  updated_at: string;
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
  /** Индивидуальные настройки VLESS/JSON подписки для этого сервера. */
  subscription_settings: ServerSubscriptionSettings | null;
  /** 1 = админ сохранил настройки вручную; deploy/hints не перезаписывают subscription_settings. */
  subscription_settings_custom: number;
  vless_deployed: number;
  /** 1 = только эксперименты, можно свободно использовать 443 без прод-подписок. */
  experimental_only: number;
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
  referral_admin_gifts: ReferralAdminGiftRow[];
  referral_settings_history: ReferralSettingsChangeRow[];
  promo_codes: PromoCodeRow[];
  promo_code_usages: PromoCodeUsageRow[];
  communication_segments: CommunicationSegmentRow[];
  dropper_game: DropperGameConfig;
  dropper_sessions: DropperSessionRow[];
  dropper_play_log: DropperPlayLogRow[];
  webapp_active_game?: WebAppActiveGame;
  game_tickets_per_purchase?: number;
  roulette_prizes?: RoulettePrizeRow[];
  roulette_spins?: RouletteSpinRow[];
  game_ticket_transactions?: GameTicketTransactionRow[];
  roulette_ticket_shop?: RouletteTicketShopConfig;
  roulette_purchase_discounts?: RoulettePurchaseDiscountRow[];
  roulette_gb_piggy?: RouletteGbPiggyRow[];
  next_roulette_spin_id?: number;
  support_appeals_config: SupportAppealsConfig;
  support_appeals: SupportAppealRow[];
  /** FCM-токены мобильного приложения панели (любой вошедший админ). */
  panel_fcm_tokens: PanelFcmTokenRow[];
  /** Telegram user id, уже оформивших тестовую подписку (1 раз на пользователя). */
  test_subscription_used_tg_ids: number[];
  /** Изолированные VPN-эксперименты (не связаны с users[]). */
  vpn_experiments: VpnExperimentRow[];
  next_experiment_id: number;
};

export type VpnExperimentRow = {
  id: number;
  name: string;
  server_id: number;
  preset_id: string;
  experimental: 1;
  vless_uuid: string;
  sub_token: string;
  inbound_tag: string;
  port: number;
  config_path: string;
  network: "tcp" | "ws" | "grpc";
  security: "reality" | "tls" | "none";
  flow: string;
  fingerprint: string;
  server_name: string;
  reality_pbk: string;
  reality_sid: string;
  reality_private_key: string;
  reality_spx: string;
  ws_path: string;
  grpc_service: string;
  query_strategy: string;
  sniff_quic: number;
  dns_mode: "default" | "proxy" | "no_direct_dns";
  mux_enabled: number;
  xudp_enabled: number;
  mtu: number | null;
  log_level: string;
  status: "pending" | "deployed" | "failed";
  deploy_error: string | null;
  diag_status: string;
  diag_has_accepted: number;
  diag_has_handshake_fail: number;
  diag_last_check_at: string | null;
  user_note: "" | "works" | "fail" | "partial";
  /** Единственный активный EXP на 443 для server_id (0/1). */
  active_on_443: number;
  port_warning: string | null;
  created_at: string;
  updated_at: string;
};

export type PanelFcmTokenRow = {
  token: string;
  created_at: string;
  updated_at: string;
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
    test_plan: {
      enabled: false,
      title: "Тестовая подписка",
      total_gb: 10,
      days: 3,
      price_rub: 10,
    },
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

function defaultSupportAppealsConfig(): SupportAppealsConfig {
  return { enabled: false };
}

function defaultDropperGame(): DropperGameConfig {
  return {
    enabled: false,
    reward_gb: 5,
    reward_days: 3,
    tickets_per_purchase: 1,
    flight_duration_sec: 40,
    flight_speed_mult: 1,
    side_hit_death_enabled: true,
  };
}

/** Допустимые интервалы времени победы (античит) по эффективной длительности полёта (сек). */
export function dropperWinTimingMsFromEffectiveFlightSec(effectiveSecRaw: number): {
  flightMin: number;
  flightMax: number;
  elapsedMin: number;
  elapsedMax: number;
} {
  const sec = Math.max(6, Math.min(380, Math.floor(Number(effectiveSecRaw) || 40)));
  const target = sec * 1000;
  return {
    flightMin: Math.max(3000, Math.floor(target * 0.6)),
    flightMax: Math.floor(target * 1.05),
    elapsedMin: Math.max(5000, Math.floor(target * 0.45)),
    elapsedMax: Math.floor(target * 3.0),
  };
}

export function normalizeDropperGame(raw: unknown): DropperGameConfig {
  const d = defaultDropperGame();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  const multRaw = Number(o.flight_speed_mult);
  const mult = Number.isFinite(multRaw)
    ? Math.max(0.25, Math.min(4, Math.round(multRaw * 100) / 100))
    : d.flight_speed_mult;
  return {
    enabled: o.enabled === true || o.enabled === 1 || o.enabled === "1",
    reward_gb: Math.max(0, Math.floor(Number(o.reward_gb) || 0)),
    reward_days: Math.max(0, Math.floor(Number(o.reward_days) || 0)),
    tickets_per_purchase: Math.max(0, Math.floor(Number(o.tickets_per_purchase) || 0)),
    flight_duration_sec: Math.max(15, Math.min(180, Math.floor(Number(o.flight_duration_sec) || d.flight_duration_sec))),
    flight_speed_mult: mult,
    side_hit_death_enabled:
      o.side_hit_death_enabled === undefined
        ? d.side_hit_death_enabled
        : o.side_hit_death_enabled === true || o.side_hit_death_enabled === 1 || o.side_hit_death_enabled === "1",
  };
}

function normalizeDropperSession(raw: unknown): DropperSessionRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const tg = Number(o.tg_user_id);
  const uid = Number(o.user_id);
  const seed = Number(o.seed);
  const started = String(o.started_at ?? "").trim();
  if (!id || !Number.isFinite(tg) || tg <= 0 || !Number.isFinite(uid) || uid <= 0 || !started) return null;
  return {
    id,
    tg_user_id: Math.floor(tg),
    user_id: Math.floor(uid),
    seed: Number.isFinite(seed) ? Math.floor(seed) : 0,
    started_at: started,
    practice: o.practice === true || o.practice === 1 || o.practice === "1",
  };
}

function normalizeDropperPlayLog(raw: unknown): DropperPlayLogRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const tg = Number(o.tg_user_id);
  const uid = Number(o.user_id);
  const res = String(o.result ?? "").trim().toLowerCase();
  if (!id || !Number.isFinite(tg) || tg <= 0 || !Number.isFinite(uid) || uid <= 0) return null;
  if (res !== "win" && res !== "lose") return null;
  const rk = String(o.reward_kind ?? "").trim().toLowerCase();
  const reward_kind = rk === "gb" || rk === "days" ? (rk as "gb" | "days") : undefined;
  return {
    id,
    tg_user_id: Math.floor(tg),
    user_id: Math.floor(uid),
    user_name: String(o.user_name ?? "").trim(),
    result: res as "win" | "lose",
    ...(reward_kind ? { reward_kind } : {}),
    ...(Number.isFinite(Number(o.reward_amount)) ? { reward_amount: Math.floor(Number(o.reward_amount)) } : {}),
    ...(Number.isFinite(Number(o.flight_ms)) ? { flight_ms: Math.floor(Number(o.flight_ms)) } : {}),
    created_at: String(o.created_at ?? new Date().toISOString()),
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
    referral_admin_gifts: [],
    referral_settings_history: [],
    promo_codes: [],
    promo_code_usages: [],
    communication_segments: [],
    dropper_game: defaultDropperGame(),
    dropper_sessions: [],
    dropper_play_log: [],
    webapp_active_game: "none",
    game_tickets_per_purchase: defaultDropperGame().tickets_per_purchase,
    roulette_prizes: [],
    roulette_spins: [],
    game_ticket_transactions: [],
    roulette_ticket_shop: defaultRouletteTicketShop(),
    roulette_purchase_discounts: [],
    roulette_gb_piggy: [],
    next_roulette_spin_id: 1,
    support_appeals_config: defaultSupportAppealsConfig(),
    support_appeals: [],
    panel_fcm_tokens: [],
    test_subscription_used_tg_ids: [],
    vpn_experiments: [],
    next_experiment_id: 1,
  };
}

function defaultCommunicationSegments(): CommunicationSegmentRow[] {
  const now = new Date().toISOString();
  return [
    {
      id: randomBytes(8).toString("hex"),
      name: "Подписка заканчивается через 3 дня",
      user_ids: [],
      days_mode: "range",
      days_from: 0,
      days_to: 3,
      gb_mode: "any",
      preset_enabled: false,
      preset_text: "",
      created_at: now,
      updated_at: now,
    },
    {
      id: randomBytes(8).toString("hex"),
      name: "Осталось 10 ГБ и меньше",
      user_ids: [],
      days_mode: "any",
      gb_mode: "range",
      gb_from: 0,
      gb_to: 10,
      preset_enabled: false,
      preset_text: "",
      created_at: now,
      updated_at: now,
    },
  ];
}

function normalizeCommunicationSegment(raw: unknown): CommunicationSegmentRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const name = String(o.name ?? "").trim();
  if (!id || !name) return null;
  const user_ids = Array.isArray(o.user_ids)
    ? [...new Set(o.user_ids.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))]
    : [];
  const days_mode_raw = String(o.days_mode ?? "any").trim().toLowerCase();
  const gb_mode_raw = String(o.gb_mode ?? "any").trim().toLowerCase();
  const days_mode = days_mode_raw === "exact" || days_mode_raw === "range" ? (days_mode_raw as "exact" | "range") : "any";
  const gb_mode = gb_mode_raw === "exact" || gb_mode_raw === "range" ? (gb_mode_raw as "exact" | "range") : "any";
  const days_exact = Math.max(0, Math.floor(Number(o.days_exact) || 0));
  const days_from = Math.max(0, Math.floor(Number(o.days_from) || 0));
  const days_to = Math.max(0, Math.floor(Number(o.days_to) || 0));
  const gb_exact = Math.max(0, Math.floor(Number(o.gb_exact) || 0));
  const gb_from = Math.max(0, Math.floor(Number(o.gb_from) || 0));
  const gb_to = Math.max(0, Math.floor(Number(o.gb_to) || 0));
  const preset_enabled = o.preset_enabled === true || o.preset_enabled === 1 || o.preset_enabled === "1";
  const preset_text = String(o.preset_text ?? "").trim();
  const system_key = String(o.system_key ?? "").trim() || undefined;
  return {
    id,
    name: name.slice(0, 120),
    user_ids,
    days_mode,
    ...(days_mode === "exact" ? { days_exact } : {}),
    ...(days_mode === "range" ? { days_from: Math.min(days_from, days_to), days_to: Math.max(days_from, days_to) } : {}),
    gb_mode,
    ...(gb_mode === "exact" ? { gb_exact } : {}),
    ...(gb_mode === "range" ? { gb_from: Math.min(gb_from, gb_to), gb_to: Math.max(gb_from, gb_to) } : {}),
    preset_enabled,
    preset_text: preset_enabled ? preset_text.slice(0, 4000) : "",
    ...(system_key ? { system_key } : {}),
    created_at: String(o.created_at ?? new Date().toISOString()),
    updated_at: String(o.updated_at ?? o.created_at ?? new Date().toISOString()),
  };
}

function normalizeCommunicationMessageLog(raw: unknown): CommunicationMessageLogRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const source_label = String(o.source_label ?? "").trim();
  const text = String(o.text ?? "").trim();
  if (!id || !source_label || !text) return null;
  const recipientsRaw = Array.isArray(o.recipients) ? o.recipients : [];
  const recipients: CommunicationMessageRecipient[] = [];
  for (const r of recipientsRaw) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const user_id = Math.floor(Number(row.user_id) || 0);
    const user_name = String(row.user_name ?? "").trim();
    if (!user_name) continue;
    recipients.push({ user_id, user_name: user_name.slice(0, 200) });
  }
  const modeRaw = String(o.mode ?? "").trim();
  const mode =
    modeRaw === "global" || modeRaw === "single" || modeRaw === "selected" || modeRaw === "segment"
      ? modeRaw
      : undefined;
  return {
    id,
    sent_at: String(o.sent_at ?? new Date().toISOString()),
    automatic: o.automatic === true || o.automatic === 1 || o.automatic === "1",
    source_label: source_label.slice(0, 160),
    ...(mode ? { mode } : {}),
    ...(o.segment_id != null && String(o.segment_id).trim()
      ? { segment_id: String(o.segment_id).trim().slice(0, 64) }
      : {}),
    ...(o.segment_name != null && String(o.segment_name).trim()
      ? { segment_name: String(o.segment_name).trim().slice(0, 120) }
      : {}),
    text: text.slice(0, 8000),
    has_photo: o.has_photo === true || o.has_photo === 1 || o.has_photo === "1",
    recipients,
    sent: Math.max(0, Math.floor(Number(o.sent) || 0)),
    attempted: Math.max(0, Math.floor(Number(o.attempted) || 0)),
    failed: Math.max(0, Math.floor(Number(o.failed) || 0)),
  };
}

function normalizePromoCode(raw: unknown): PromoCodeRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const code = normalizePromoCodeText(String(o.code ?? ""));
  if (!id || !code) return null;
  const typeRaw = String(o.type ?? "percent").trim().toLowerCase();
  const type: PromoCodeRow["type"] =
    typeRaw === "rub" || typeRaw === "gb" || typeRaw === "days" || typeRaw === "combo" ? (typeRaw as PromoCodeRow["type"]) : "percent";
  const discount_percent = Math.min(100, Math.max(0, Math.floor(Number(o.discount_percent) || 0)));
  const discount_rub = Math.max(0, Math.floor(Number(o.discount_rub) || 0));
  const gift_gb = Math.max(0, Math.floor(Number(o.gift_gb) || 0));
  const gift_days = Math.max(0, Math.floor(Number(o.gift_days) || 0));
  const max_uses_total_raw = Math.floor(Number(o.max_uses_total));
  const max_uses_per_user_raw = Math.floor(Number(o.max_uses_per_user));
  const min_purchase_rub_raw = Math.floor(Number(o.min_purchase_rub));
  const applyPlanIdsIn = Array.isArray(o.apply_plan_ids) ? o.apply_plan_ids : [];
  const applyPlanIds = [...new Set(applyPlanIdsIn.map((x) => Math.floor(Number(x))).filter((x) => Number.isFinite(x) && x > 0))];
  return {
    id,
    name: String(o.name ?? "").trim() || code,
    code,
    type,
    discount_percent,
    discount_rub,
    gift_gb,
    gift_days,
    one_time_per_user: o.one_time_per_user === true || o.one_time_per_user === 1 || o.one_time_per_user === "1",
    ...(Number.isFinite(max_uses_total_raw) && max_uses_total_raw >= 1 ? { max_uses_total: max_uses_total_raw } : {}),
    max_uses_per_user: Number.isFinite(max_uses_per_user_raw) && max_uses_per_user_raw >= 1 ? max_uses_per_user_raw : 1,
    ...(Number.isFinite(min_purchase_rub_raw) && min_purchase_rub_raw > 0 ? { min_purchase_rub: min_purchase_rub_raw } : {}),
    first_purchase_only: o.first_purchase_only === true || o.first_purchase_only === 1 || o.first_purchase_only === "1",
    new_users_only: o.new_users_only === true || o.new_users_only === 1 || o.new_users_only === "1",
    ...(applyPlanIds.length > 0 ? { apply_plan_ids: applyPlanIds } : {}),
    ...(String(o.admin_note ?? "").trim() ? { admin_note: String(o.admin_note ?? "").trim().slice(0, 500) } : {}),
    active: !(o.active === false || o.active === 0 || o.active === "0"),
    valid_until: String(o.valid_until ?? "").trim(),
    created_at: String(o.created_at ?? new Date().toISOString()),
    updated_at: String(o.updated_at ?? o.created_at ?? new Date().toISOString()),
  };
}

function normalizePromoCodeUsage(raw: unknown): PromoCodeUsageRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const promo_id = String(o.promo_id ?? "").trim();
  const promo_code = normalizePromoCodeText(String(o.promo_code ?? ""));
  const tg_user_id = Number(o.tg_user_id);
  if (!id || !promo_id || !promo_code || !Number.isFinite(tg_user_id) || tg_user_id <= 0) return null;
  return {
    id,
    promo_id,
    promo_code,
    tg_user_id: Math.floor(tg_user_id),
    tg_username: String(o.tg_username ?? "").trim() || undefined,
    tg_first_name: String(o.tg_first_name ?? "").trim() || undefined,
    user_name: String(o.user_name ?? "").trim() || undefined,
    phone: String(o.phone ?? "").trim() || undefined,
    applied_at: String(o.applied_at ?? new Date().toISOString()),
    session_id: String(o.session_id ?? "").trim() || undefined,
    plan_id: Number.isFinite(Number(o.plan_id)) && Number(o.plan_id) > 0 ? Math.floor(Number(o.plan_id)) : undefined,
    plan_title: String(o.plan_title ?? "").trim() || undefined,
    original_price_rub: Number.isFinite(Number(o.original_price_rub)) ? Math.max(0, Math.floor(Number(o.original_price_rub))) : undefined,
    final_price_rub: Number.isFinite(Number(o.final_price_rub)) ? Math.max(0, Math.floor(Number(o.final_price_rub))) : undefined,
    discount_rub: Number.isFinite(Number(o.discount_rub)) ? Math.max(0, Math.floor(Number(o.discount_rub))) : undefined,
    bonus_gb: Number.isFinite(Number(o.bonus_gb)) ? Math.max(0, Math.floor(Number(o.bonus_gb))) : undefined,
    bonus_days: Number.isFinite(Number(o.bonus_days)) ? Math.max(0, Math.floor(Number(o.bonus_days))) : undefined,
    status: String(o.status ?? "").trim() === "error" ? "error" : "applied",
    error: String(o.error ?? "").trim() || undefined,
  };
}

export function normalizeReferralProgram(raw: unknown): ReferralProgramConfig {
  const base = defaultReferralProgram();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const legacyKind = String(o.inviter_reward_kind ?? "").trim().toLowerCase();
  const legacyVal = Math.max(1, Math.floor(Number(o.inviter_reward_value) || 1));
  const rewardGb = Math.max(
    0,
    Math.floor(Number(o.inviter_reward_gb) || (legacyKind === "gb" ? legacyVal : base.inviter_reward_gb)),
  );
  const rewardDays = Math.max(
    0,
    Math.floor(Number(o.inviter_reward_days) || (legacyKind === "days" ? legacyVal : base.inviter_reward_days)),
  );
  const discount = Math.min(100, Math.max(0, Math.floor(Number(o.invited_discount_percent) || 0)));
  const copy = String(o.invite_copy_text ?? "").trim();
  return {
    enabled: o.enabled === true || o.enabled === 1 || o.enabled === "1",
    inviter_reward_gb: rewardGb,
    inviter_reward_days: rewardDays,
    invited_discount_percent: Number.isFinite(discount) ? discount : base.invited_discount_percent,
    invite_copy_text: copy || base.invite_copy_text,
  };
}

const REFERRAL_FIELD_LABELS: Record<keyof ReferralProgramConfig, string> = {
  enabled: "Реферальная программа",
  inviter_reward_gb: "Награда пригласившему (ГБ)",
  inviter_reward_days: "Награда пригласившему (дни)",
  invited_discount_percent: "Скидка приглашенному",
  invite_copy_text: "Текст приглашения",
};

function referralFieldDisplay(key: keyof ReferralProgramConfig, value: unknown): string {
  if (key === "enabled") return value === true ? "включена" : "выключена";
  if (key === "invite_copy_text") {
    const s = String(value ?? "").trim();
    return s.length > 60 ? `${s.slice(0, 60)}…` : s || "—";
  }
  if (key === "invited_discount_percent") return `${value}%`;
  if (key === "inviter_reward_gb") return `${value} ГБ`;
  if (key === "inviter_reward_days") return `${value} дн.`;
  return String(value ?? "");
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
    test_plan: normalizeTestSubscriptionPlan(o.test_plan, base.test_plan),
  };
}

function normalizeTestSubscriptionPlan(raw: unknown, fallback: TestSubscriptionPlanConfig): TestSubscriptionPlanConfig {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled === true || o.enabled === 1 || o.enabled === "1";
  const title = o.title != null ? String(o.title).trim() : fallback.title;
  const total_gb =
    o.total_gb != null ? Math.max(0, Math.floor(Number(o.total_gb))) : fallback.total_gb;
  const days = o.days != null ? Math.max(1, Math.floor(Number(o.days))) : fallback.days;
  const price_rub =
    o.price_rub != null ? Math.max(0, Math.floor(Number(o.price_rub))) : fallback.price_rub;
  return {
    enabled,
    title: title || fallback.title,
    total_gb: Number.isFinite(total_gb) ? total_gb : fallback.total_gb,
    days: Number.isFinite(days) ? days : fallback.days,
    price_rub: Number.isFinite(price_rub) ? price_rub : fallback.price_rub,
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
  const kindRaw = String(o.kind ?? "subscription").trim().toLowerCase();
  const kind =
    kindRaw === "topup"
      ? "topup"
      : kindRaw === "test"
        ? "test"
        : kindRaw === "white_lists"
          ? "white_lists"
          : "subscription";
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
    roulette_discount_percent:
      Number.isFinite(Number(o.roulette_discount_percent)) && Number(o.roulette_discount_percent) > 0
        ? Math.floor(Number(o.roulette_discount_percent))
        : undefined,
    roulette_discount_spin_id:
      Number.isFinite(Number(o.roulette_discount_spin_id)) && Number(o.roulette_discount_spin_id) > 0
        ? Math.floor(Number(o.roulette_discount_spin_id))
        : undefined,
  };
}

function normalizeShopActivity(raw: unknown): ShopActivityRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const userId = Number(o.user_id);
  const planId = Number(o.plan_id);
  const kindRaw = String(o.kind ?? "subscription").trim().toLowerCase();
  const kind =
    kindRaw === "topup"
      ? "topup"
      : kindRaw === "test"
        ? "test"
        : kindRaw === "white_lists"
          ? "white_lists"
          : kindRaw === "subscription"
            ? "subscription"
            : "";
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
    subscription_settings: normalizeSubscriptionSettings(
      s.subscription_settings ?? subscriptionSettingsFromLegacyServer(s as ServerRow),
      s as ServerRow,
    ),
    subscription_settings_custom: s.subscription_settings_custom === 1 ? 1 : 0,
    experimental_only: s.experimental_only === 1 ? 1 : 0,
  };
}

export function getServerSubscriptionSettings(server: ServerRow): ServerSubscriptionSettings {
  return normalizeSubscriptionSettings(
    server.subscription_settings ?? subscriptionSettingsFromLegacyServer(server),
    server,
  );
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

/** Лимит скорости в Мбит/с; 0 или пусто — без ограничения. */
export function coerceSpeedLimitMbps(raw: unknown): number {
  if (raw === "" || raw == null) return 0;
  const n = Math.floor(Number(raw) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(9999, n);
}

/** Лимит в ГБ; если в поле попали байты (импорт), переводим в ГБ. */
function coerceTotalGbField(raw: unknown): number {
  let gb = Number(raw);
  if (!Number.isFinite(gb) || gb < 0) return 0;
  if (gb > BYTES_PER_GB) gb = Math.max(1, Math.ceil(gb / BYTES_PER_GB));
  return gb;
}

function deployedIdsFromServerRows(servers: ServerRow[]): number[] {
  return [...servers]
    .filter((r) => r.vless_deployed === 1 && r.vless_uuid != null)
    .sort((a, b) => a.id - b.id)
    .map((s) => s.id);
}

function coerceSubscriptionServerIds(rawIds: unknown, legacyCount: number, allIds: number[]): number[] {
  if (Array.isArray(rawIds) && rawIds.length > 0) {
    const valid = new Set(allIds);
    const seen = new Set<number>();
    const out: number[] = [];
    for (const x of rawIds) {
      const id = Math.floor(Number(x));
      if (!valid.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out.length > 0 ? out : allIds;
  }
  const lim = Math.max(0, Math.floor(legacyCount || 0));
  if (lim <= 0 || lim >= allIds.length) return allIds;
  return allIds.slice(0, lim);
}

/** Legacy-поле для совместимости: 0 = все развёрнутые, иначе число выбранных. */
function subscriptionCountFromIds(ids: number[], allIds: number[]): number {
  const all = allIds;
  if (all.length === 0) return 0;
  if (ids.length >= all.length) {
    const set = new Set(ids);
    if (all.every((id) => set.has(id))) return 0;
  }
  return ids.length;
}

function subscriptionIdsFromInput(
  input: {
    subscription_server_ids?: unknown;
    subscription_server_count?: number;
  },
  allIds?: number[],
): number[] {
  const deployedIds = allIds ?? deployedIdsFromServerRows(listDeployedServers());
  if (input.subscription_server_ids !== undefined) {
    return coerceSubscriptionServerIds(input.subscription_server_ids, 0, deployedIds);
  }
  if (input.subscription_server_count !== undefined) {
    return coerceSubscriptionServerIds(undefined, input.subscription_server_count, deployedIds);
  }
  return deployedIds;
}

function normalizeUser(u: UserRow, deployedIdsForNormalize?: number[]): UserRow {
  const mode = String((u as { connection_profile?: unknown }).connection_profile ?? "legacy").toLowerCase();
  const allDeployedIds = deployedIdsForNormalize ?? deployedIdsFromServerRows(listDeployedServers());
  const subscription_server_ids = coerceSubscriptionServerIds(
    (u as { subscription_server_ids?: unknown }).subscription_server_ids,
    u.subscription_server_count,
    allDeployedIds,
  );
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
    subscription_server_ids,
    subscription_server_count: subscriptionCountFromIds(subscription_server_ids, allDeployedIds),
    online_snapshot: u.online_snapshot === 1 ? 1 : 0,
    online_devices: Math.max(0, Math.floor(Number((u as { online_devices?: unknown }).online_devices) || 0)),
    device_limit_enabled: Number((u as { device_limit_enabled?: unknown }).device_limit_enabled) === 1 ? 1 : 0,
    device_limit_count: Math.max(1, Math.floor(Number((u as { device_limit_count?: unknown }).device_limit_count) || 1)),
    speed_limit_mbps: coerceSpeedLimitMbps((u as { speed_limit_mbps?: unknown }).speed_limit_mbps),
    whitelist_happ_enabled: Number((u as { whitelist_happ_enabled?: unknown }).whitelist_happ_enabled) === 1 ? 1 : 0,
    whitelist_active_until: Math.max(0, Math.floor(Number((u as { whitelist_active_until?: unknown }).whitelist_active_until) || 0)),
    whitelist_purchase_id: String((u as { whitelist_purchase_id?: unknown }).whitelist_purchase_id ?? "").trim(),
    stats_synced_at: Number.isFinite(Number(u.stats_synced_at))
      ? Math.max(0, Math.floor(Number(u.stats_synced_at)))
      : 0,
    stats_raw_up: Number.isFinite(Number(u.stats_raw_up)) ? Math.max(-1, Math.floor(Number(u.stats_raw_up))) : -1,
    stats_raw_down: Number.isFinite(Number(u.stats_raw_down))
      ? Math.max(-1, Math.floor(Number(u.stats_raw_down)))
      : -1,
    traffic_notify_state:
      u.traffic_notify_state === "low30" || u.traffic_notify_state === "empty" ? u.traffic_notify_state : "",
    expiry_notify_state:
      (u as { expiry_notify_state?: unknown }).expiry_notify_state === "warn" ||
      (u as { expiry_notify_state?: unknown }).expiry_notify_state === "expired"
        ? ((u as { expiry_notify_state: "warn" | "expired" }).expiry_notify_state)
        : "",
    connection_profile: mode === "reality" ? "reality" : "legacy",
    dropper_tickets: Math.max(0, Math.floor(Number((u as { dropper_tickets?: unknown }).dropper_tickets) || 0)),
    is_test_subscription: Number((u as { is_test_subscription?: unknown }).is_test_subscription) === 1 ? 1 : 0,
    extra_vless_links: normalizeExtraVlessLinks((u as { extra_vless_links?: unknown }).extra_vless_links),
    created_at: u.created_at ?? new Date().toISOString(),
    updated_at: u.updated_at ?? u.created_at ?? new Date().toISOString(),
  };
}

function readStore(): FileStore {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw) as FileStore;
    if (!Array.isArray(parsed.servers)) return emptyStore();
    const servers = parsed.servers.map((x) => normalizeServer(x as ServerRow));
    const deployedIds = deployedIdsFromServerRows(servers);
    const users = Array.isArray(parsed.users)
      ? parsed.users.map((x) => normalizeUser(x as UserRow, deployedIds))
      : [];
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
    const adminGiftsRaw = Array.isArray((parsed as { referral_admin_gifts?: unknown }).referral_admin_gifts)
      ? (parsed as { referral_admin_gifts: unknown[] }).referral_admin_gifts
      : [];
    const referral_admin_gifts = adminGiftsRaw
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const id = String(o.id ?? "").trim();
        const userId = Number(o.user_id);
        const kind = String(o.kind ?? "").trim().toLowerCase();
        const amount = Math.floor(Number(o.amount));
        if (!id || !Number.isFinite(userId) || userId <= 0 || (kind !== "gb" && kind !== "days") || amount <= 0) {
          return null;
        }
        const admin_comment = String(o.admin_comment ?? "").trim() || undefined;
        const granted_by = String(o.granted_by ?? "").trim() || undefined;
        const telegram_sent =
          o.telegram_sent === true || o.telegram_sent === 1 || o.telegram_sent === "1"
            ? true
            : o.telegram_sent === false || o.telegram_sent === 0 || o.telegram_sent === "0"
              ? false
              : undefined;
        return {
          id,
          user_id: Math.floor(userId),
          user_name: String(o.user_name ?? "").trim() || `Клиент #${Math.floor(userId)}`,
          kind: kind as "gb" | "days",
          amount,
          created_at: String(o.created_at ?? new Date().toISOString()),
          ...(admin_comment ? { admin_comment } : {}),
          ...(granted_by ? { granted_by } : {}),
          ...(telegram_sent !== undefined ? { telegram_sent } : {}),
        } as ReferralAdminGiftRow;
      })
      .filter((x): x is ReferralAdminGiftRow => x != null);
    const settingsHistoryRaw = Array.isArray((parsed as { referral_settings_history?: unknown }).referral_settings_history)
      ? (parsed as { referral_settings_history: unknown[] }).referral_settings_history
      : [];
    const referral_settings_history = settingsHistoryRaw
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const id = String(o.id ?? "").trim();
        const field = String(o.field ?? "").trim();
        if (!id || !field) return null;
        return {
          id,
          changed_by: String(o.changed_by ?? "Администратор").trim() || "Администратор",
          field,
          field_label: String(o.field_label ?? field).trim() || field,
          old_value: String(o.old_value ?? ""),
          new_value: String(o.new_value ?? ""),
          created_at: String(o.created_at ?? new Date().toISOString()),
        } as ReferralSettingsChangeRow;
      })
      .filter((x): x is ReferralSettingsChangeRow => x != null);
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
    const commSegmentsRaw = Array.isArray((parsed as { communication_segments?: unknown }).communication_segments)
      ? (parsed as { communication_segments: unknown[] }).communication_segments
      : [];
    const communication_segments = commSegmentsRaw
      .map((x) => normalizeCommunicationSegment(x))
      .filter((x): x is CommunicationSegmentRow => x != null);
    const dropperSessionsRaw = Array.isArray((parsed as { dropper_sessions?: unknown }).dropper_sessions)
      ? (parsed as { dropper_sessions: unknown[] }).dropper_sessions
      : [];
    const dropper_sessions = dropperSessionsRaw
      .map((x) => normalizeDropperSession(x))
      .filter((x): x is DropperSessionRow => x != null);
    const dropperLogRaw = Array.isArray((parsed as { dropper_play_log?: unknown }).dropper_play_log)
      ? (parsed as { dropper_play_log: unknown[] }).dropper_play_log
      : [];
    const dropper_play_log = dropperLogRaw
      .map((x) => normalizeDropperPlayLog(x))
      .filter((x): x is DropperPlayLogRow => x != null);
    return {
      subscription_token: parsed.subscription_token ?? null,
      next_server_id: Number(parsed.next_server_id) > 0 ? Number(parsed.next_server_id) : 1,
      next_user_id: Number(parsed.next_user_id) > 0 ? Number(parsed.next_user_id) : 1,
      servers,
      users,
      payment_sessions,
      shop_activity_log,
      subscription_shop: normalizeSubscriptionShop(
        (parsed as { subscription_shop?: unknown }).subscription_shop,
      ),
      referral_program: normalizeReferralProgram((parsed as { referral_program?: unknown }).referral_program),
      referral_invites,
      referral_rewards,
      referral_admin_gifts,
      referral_settings_history,
      promo_codes,
      promo_code_usages,
      communication_segments: communication_segments.length > 0 ? communication_segments : defaultCommunicationSegments(),
      dropper_game: normalizeDropperGame((parsed as { dropper_game?: unknown }).dropper_game),
      dropper_sessions,
      dropper_play_log,
      webapp_active_game: normalizeWebAppActiveGame(
        (parsed as { webapp_active_game?: unknown }).webapp_active_game,
        (parsed as { dropper_game?: DropperGameConfig }).dropper_game,
      ),
      game_tickets_per_purchase: normalizeGameTicketsPerPurchase(
        (parsed as { game_tickets_per_purchase?: unknown }).game_tickets_per_purchase,
        (parsed as { dropper_game?: DropperGameConfig }).dropper_game,
      ),
      roulette_prizes: normalizeRoulettePrizes((parsed as { roulette_prizes?: unknown }).roulette_prizes),
      roulette_spins: normalizeRouletteSpins((parsed as { roulette_spins?: unknown }).roulette_spins),
      game_ticket_transactions: normalizeGameTicketTransactions(
        (parsed as { game_ticket_transactions?: unknown }).game_ticket_transactions,
      ),
      roulette_ticket_shop: normalizeRouletteTicketShop(
        (parsed as { roulette_ticket_shop?: unknown }).roulette_ticket_shop,
      ),
      roulette_purchase_discounts: Array.isArray(
        (parsed as { roulette_purchase_discounts?: unknown }).roulette_purchase_discounts,
      )
        ? (parsed as { roulette_purchase_discounts: unknown[] }).roulette_purchase_discounts
            .map((x) => normalizeRoulettePurchaseDiscount(x))
            .filter((x): x is RoulettePurchaseDiscountRow => x != null)
        : [],
      roulette_gb_piggy: Array.isArray((parsed as { roulette_gb_piggy?: unknown }).roulette_gb_piggy)
        ? (parsed as { roulette_gb_piggy: unknown[] }).roulette_gb_piggy
            .map((x) => normalizeRouletteGbPiggy(x, users))
            .filter((x): x is RouletteGbPiggyRow => x != null)
        : [],
      next_roulette_spin_id:
        Number((parsed as { next_roulette_spin_id?: unknown }).next_roulette_spin_id) > 0
          ? Number((parsed as { next_roulette_spin_id?: unknown }).next_roulette_spin_id)
          : 1,
      support_appeals_config: normalizeSupportAppealsConfig(
        (parsed as { support_appeals_config?: unknown }).support_appeals_config,
      ),
      support_appeals: (Array.isArray((parsed as { support_appeals?: unknown }).support_appeals)
        ? (parsed as { support_appeals: unknown[] }).support_appeals
        : []
      )
        .map((x) => normalizeSupportAppeal(x))
        .filter((x): x is SupportAppealRow => x != null),
      panel_fcm_tokens: normalizePanelFcmTokens((parsed as { panel_fcm_tokens?: unknown }).panel_fcm_tokens),
      test_subscription_used_tg_ids: Array.isArray(
        (parsed as { test_subscription_used_tg_ids?: unknown }).test_subscription_used_tg_ids,
      )
        ? [
            ...new Set(
              (parsed as { test_subscription_used_tg_ids: unknown[] }).test_subscription_used_tg_ids
                .map((x) => Math.floor(Number(x)))
                .filter((n) => Number.isFinite(n) && n > 0),
            ),
          ]
        : [],
      vpn_experiments: (Array.isArray((parsed as { vpn_experiments?: unknown }).vpn_experiments)
        ? (parsed as { vpn_experiments: unknown[] }).vpn_experiments
        : []
      )
        .map((x) => normalizeVpnExperiment(x))
        .filter((x): x is VpnExperimentRow => x != null),
      next_experiment_id:
        Number((parsed as { next_experiment_id?: unknown }).next_experiment_id) > 0
          ? Number((parsed as { next_experiment_id?: unknown }).next_experiment_id)
          : 1,
    };
  } catch {
    return emptyStore();
  }
}

function normalizeVpnExperiment(raw: unknown): VpnExperimentRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Number(o.id);
  const serverId = Number(o.server_id);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(serverId) || serverId <= 0) return null;
  const net = String(o.network ?? "tcp").toLowerCase();
  const network = net === "ws" || net === "grpc" ? net : "tcp";
  const sec = String(o.security ?? "reality").toLowerCase();
  const security = sec === "tls" || sec === "none" ? sec : "reality";
  const note = String(o.user_note ?? "").trim();
  const user_note = note === "works" || note === "fail" || note === "partial" ? note : "";
  const dns = String(o.dns_mode ?? "default");
  const dns_mode = dns === "proxy" || dns === "no_direct_dns" ? dns : "default";
  const st = String(o.status ?? "pending");
  const status = st === "deployed" || st === "failed" ? st : "pending";
  return {
    id: Math.floor(id),
    name: String(o.name ?? `EXP-${Math.floor(id)}`).trim() || `EXP-${Math.floor(id)}`,
    server_id: Math.floor(serverId),
    preset_id: String(o.preset_id ?? "custom").trim() || "custom",
    experimental: 1,
    vless_uuid: String(o.vless_uuid ?? "").trim(),
    sub_token: String(o.sub_token ?? "").trim(),
    inbound_tag: String(o.inbound_tag ?? `EXP-${Math.floor(id)}`).trim(),
    port: Math.max(1, Math.min(65535, Math.floor(Number(o.port) || 443))),
    config_path: String(o.config_path ?? "").trim(),
    network,
    security,
    flow: String(o.flow ?? "").trim(),
    fingerprint: String(o.fingerprint ?? "chrome").trim() || "chrome",
    server_name: String(o.server_name ?? "www.microsoft.com").trim() || "www.microsoft.com",
    reality_pbk: String(o.reality_pbk ?? "").trim(),
    reality_sid: String(o.reality_sid ?? "").trim(),
    reality_private_key: String(o.reality_private_key ?? "").trim(),
    reality_spx: String(o.reality_spx ?? "/").trim() || "/",
    ws_path: String(o.ws_path ?? "").trim(),
    grpc_service: String(o.grpc_service ?? "").trim(),
    query_strategy: String(o.query_strategy ?? "UseIPv4").trim() || "UseIPv4",
    sniff_quic: o.sniff_quic === 1 || o.sniff_quic === true ? 1 : 0,
    dns_mode,
    mux_enabled: o.mux_enabled === 1 || o.mux_enabled === true ? 1 : 0,
    xudp_enabled: o.xudp_enabled === 1 || o.xudp_enabled === true ? 1 : 0,
    mtu: o.mtu != null && Number(o.mtu) > 0 ? Math.floor(Number(o.mtu)) : null,
    log_level: String(o.log_level ?? "warning").trim() || "warning",
    status,
    deploy_error: o.deploy_error != null ? String(o.deploy_error) : null,
    diag_status: String(o.diag_status ?? "").trim(),
    diag_has_accepted: o.diag_has_accepted === 1 ? 1 : 0,
    diag_has_handshake_fail: o.diag_has_handshake_fail === 1 ? 1 : 0,
    diag_last_check_at: o.diag_last_check_at != null ? String(o.diag_last_check_at) : null,
    user_note,
    active_on_443: o.active_on_443 === 1 ? 1 : 0,
    port_warning: o.port_warning != null ? String(o.port_warning) : null,
    created_at: String(o.created_at ?? new Date().toISOString()),
    updated_at: String(o.updated_at ?? new Date().toISOString()),
  };
}

function normalizePanelFcmTokens(raw: unknown): PanelFcmTokenRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelFcmTokenRow[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const token = String((x as { token?: unknown }).token ?? "").trim();
    if (token.length < 20 || seen.has(token)) continue;
    seen.add(token);
    const created = String((x as { created_at?: unknown }).created_at ?? new Date().toISOString());
    const updated = String((x as { updated_at?: unknown }).updated_at ?? created);
    out.push({ token, created_at: created, updated_at: updated });
  }
  return out;
}

export function listPanelFcmTokens(): string[] {
  return (readStore().panel_fcm_tokens ?? []).map((r) => r.token);
}

export function registerPanelFcmToken(token: string): void {
  const t = String(token ?? "").trim();
  if (t.length < 20) return;
  mutate((store) => {
    const list = store.panel_fcm_tokens ?? [];
    const i = list.findIndex((r) => r.token === t);
    const now = new Date().toISOString();
    if (i >= 0) {
      list[i] = { ...list[i]!, updated_at: now };
    } else {
      list.push({ token: t, created_at: now, updated_at: now });
    }
    store.panel_fcm_tokens = list;
  });
}

export function unregisterPanelFcmToken(token: string): void {
  const t = String(token ?? "").trim();
  if (!t) return;
  mutate((store) => {
    store.panel_fcm_tokens = (store.panel_fcm_tokens ?? []).filter((r) => r.token !== t);
  });
}

export function removePanelFcmTokens(tokens: string[]): void {
  const drop = new Set(tokens.map((x) => String(x).trim()).filter(Boolean));
  if (drop.size === 0) return;
  mutate((store) => {
    store.panel_fcm_tokens = (store.panel_fcm_tokens ?? []).filter((r) => !drop.has(r.token));
  });
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

export type ServerSubscriptionCoverage = {
  in_all_subscriptions: boolean;
  users_total: number;
  users_missing: number;
};

/** Сколько клиентов ещё не имеют этот развёрнутый узел в subscription_server_ids. */
export function getServerSubscriptionCoverage(serverId: number): ServerSubscriptionCoverage {
  const server = getServer(serverId);
  if (!server || server.vless_deployed !== 1 || server.vless_uuid == null) {
    return { in_all_subscriptions: true, users_total: 0, users_missing: 0 };
  }
  const users = listUsers().filter((u) => u.is_test_subscription !== 1);
  let missing = 0;
  for (const u of users) {
    const ids = u.subscription_server_ids ?? [];
    if (!ids.includes(serverId)) missing += 1;
  }
  return {
    in_all_subscriptions: missing === 0,
    users_total: users.length,
    users_missing: missing,
  };
}

/** Добавить развёрнутый сервер в subscription_server_ids у всех клиентов (кроме тестовых). */
export function addServerToAllSubscriptions(serverId: number): { updated_users: number } {
  const server = getServer(serverId);
  if (!server) throw new Error("server_not_found");
  if (server.vless_deployed !== 1 || server.vless_uuid == null) {
    throw new Error("server_not_deployed");
  }
  const deployedIds = deployedIdsFromServerRows(readStore().servers);
  if (!deployedIds.includes(serverId)) {
    throw new Error("server_not_deployed");
  }

  let updated = 0;
  mutate((store) => {
    const allDeployed = deployedIdsFromServerRows(store.servers);
    for (let i = 0; i < store.users.length; i++) {
      const u = store.users[i]!;
      if (u.is_test_subscription === 1) continue;
      const cur = u.subscription_server_ids ?? [];
      if (cur.includes(serverId)) continue;
      const set = new Set(cur);
      set.add(serverId);
      const nextIds = allDeployed.filter((id) => set.has(id));
      store.users[i] = normalizeUser(
        {
          ...u,
          subscription_server_ids: nextIds,
          subscription_server_count: subscriptionCountFromIds(nextIds, allDeployed),
          updated_at: new Date().toISOString(),
        },
        allDeployed,
      );
      updated += 1;
    }
  });
  return { updated_users: updated };
}

/** Узлы в подписке по списку subscription_server_ids (порядок из списка). */
export function serversForUserSubscription(user: UserRow): ServerRow[] {
  const rows = listDeployedServers();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = user.subscription_server_ids ?? [];
  if (ids.length === 0) return [];
  return ids.map((id) => byId.get(id)).filter((r): r is ServerRow => Boolean(r));
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

/** Активная подписка: включена и не истёк срок (expiry_time=0 — без срока). Без проверки лимита трафика. */
export function userHasActiveSubscription(u: UserRow): boolean {
  if (u.enable !== 1) return false;
  if (u.expiry_time > 0 && Date.now() > u.expiry_time) return false;
  return true;
}

/** Подписка и синхронизация UUID на Xray только для «живых» клиентов. */
export function userAllowedOnServers(u: UserRow): boolean {
  if (!userHasActiveSubscription(u)) return false;
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
    const deployedIds = deployedIdsFromServerRows(store.servers);
    const subIds = subscriptionIdsFromInput(input, deployedIds);
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
      subscription_server_ids: subIds,
      subscription_server_count: subscriptionCountFromIds(subIds, deployedIds),
      online_snapshot: 0,
      online_devices: 0,
      device_limit_enabled: input.device_limit_enabled === 1 ? 1 : 0,
      device_limit_count: Math.max(1, Math.floor(Number(input.device_limit_count) || 1)),
      speed_limit_mbps: coerceSpeedLimitMbps(input.speed_limit_mbps),
      whitelist_happ_enabled: input.whitelist_happ_enabled === 1 ? 1 : 0,
      whitelist_active_until: Math.max(0, Math.floor(Number(input.whitelist_active_until) || 0)),
      whitelist_purchase_id: String(input.whitelist_purchase_id ?? "").trim(),
      stats_synced_at: 0,
      stats_raw_up: -1,
      stats_raw_down: -1,
      traffic_notify_state: "",
      expiry_notify_state: "",
      connection_profile,
      dropper_tickets: 0,
      is_test_subscription: input.is_test_subscription === 1 ? 1 : 0,
      extra_vless_links: normalizeExtraVlessLinks(input.extra_vless_links ?? []),
      created_at: now,
      updated_at: now,
    }, deployedIds);
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
    const deployedIds = deployedIdsFromServerRows(store.servers);
    const subIds =
      patch.subscription_server_ids !== undefined
        ? subscriptionIdsFromInput({ subscription_server_ids: patch.subscription_server_ids }, deployedIds)
        : patch.subscription_server_count !== undefined
          ? subscriptionIdsFromInput({ subscription_server_count: patch.subscription_server_count }, deployedIds)
          : cur.subscription_server_ids;
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
      subscription_server_ids: subIds,
      subscription_server_count: subscriptionCountFromIds(subIds, deployedIds),
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
      speed_limit_mbps:
        patch.speed_limit_mbps !== undefined ? coerceSpeedLimitMbps(patch.speed_limit_mbps) : cur.speed_limit_mbps,
      whitelist_happ_enabled:
        patch.whitelist_happ_enabled !== undefined
          ? patch.whitelist_happ_enabled === 1
            ? 1
            : 0
          : cur.whitelist_happ_enabled,
      whitelist_active_until:
        patch.whitelist_active_until !== undefined
          ? Math.max(0, Math.floor(Number(patch.whitelist_active_until) || 0))
          : cur.whitelist_active_until,
      whitelist_purchase_id:
        patch.whitelist_purchase_id !== undefined
          ? String(patch.whitelist_purchase_id ?? "").trim()
          : cur.whitelist_purchase_id,
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
      expiry_notify_state:
        patch.expiry_notify_state !== undefined
          ? patch.expiry_notify_state === "warn" || patch.expiry_notify_state === "expired"
            ? patch.expiry_notify_state
            : ""
          : cur.expiry_notify_state,
      connection_profile:
        patch.connection_profile !== undefined
          ? String(patch.connection_profile).toLowerCase() === "reality"
            ? "reality"
            : "legacy"
          : cur.connection_profile,
      is_test_subscription:
        patch.is_test_subscription !== undefined
          ? patch.is_test_subscription === 1
            ? 1
            : 0
          : cur.is_test_subscription,
      extra_vless_links:
        patch.extra_vless_links !== undefined
          ? normalizeExtraVlessLinks(patch.extra_vless_links)
          : cur.extra_vless_links,
      updated_at: new Date().toISOString(),
    }, deployedIds);
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
  kind: "subscription" | "topup" | "test" | "white_lists" = "subscription",
  target_user_id?: number,
  new_subscription_name?: string,
  tgProfile?: { username?: string; first_name?: string },
  referralMeta?: {
    inviter_user_id?: number;
    discount_percent?: number;
    roulette_discount_percent?: number;
    roulette_discount_spin_id?: number;
  },
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
      ...(Number.isFinite(Number(referralMeta?.roulette_discount_percent)) &&
      Number(referralMeta?.roulette_discount_percent) > 0
        ? { roulette_discount_percent: Math.floor(Number(referralMeta?.roulette_discount_percent)) }
        : {}),
      ...(Number.isFinite(Number(referralMeta?.roulette_discount_spin_id)) &&
      Number(referralMeta?.roulette_discount_spin_id) > 0
        ? { roulette_discount_spin_id: Math.floor(Number(referralMeta?.roulette_discount_spin_id)) }
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
    kind:
      input.kind === "topup"
        ? "topup"
        : input.kind === "test"
          ? "test"
          : input.kind === "white_lists"
            ? "white_lists"
            : "subscription",
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

export function hasUsedTestSubscription(tgUserId: number): boolean {
  const ids = readStore().test_subscription_used_tg_ids ?? [];
  return ids.includes(Math.floor(tgUserId));
}

export function markTestSubscriptionUsed(tgUserId: number): void {
  const id = Math.floor(tgUserId);
  mutate((store) => {
    const prev = store.test_subscription_used_tg_ids ?? [];
    if (!prev.includes(id)) {
      store.test_subscription_used_tg_ids = [...prev, id];
    }
  });
}

export function getReferralProgram(): ReferralProgramConfig {
  return normalizeReferralProgram(readStore().referral_program);
}

export function setReferralProgram(config: ReferralProgramConfig, meta?: { changed_by?: string }): void {
  const next = normalizeReferralProgram(config);
  const copyTrim = String(next.invite_copy_text ?? "").trim();
  if (!copyTrim) {
    throw new Error("invite_copy_text_required");
  }
  next.invite_copy_text = copyTrim;
  mutate((store) => {
    const prev = normalizeReferralProgram(store.referral_program);
    const changedBy = String(meta?.changed_by ?? "Администратор").trim() || "Администратор";
    const history = store.referral_settings_history ?? [];
    const keys = Object.keys(REFERRAL_FIELD_LABELS) as (keyof ReferralProgramConfig)[];
    for (const key of keys) {
      const a = prev[key];
      const b = next[key];
      if (a === b) continue;
      if (key === "invite_copy_text" && String(a) === String(b)) continue;
      history.push({
        id: randomBytes(8).toString("hex"),
        changed_by: changedBy,
        field: key,
        field_label: REFERRAL_FIELD_LABELS[key],
        old_value: referralFieldDisplay(key, a),
        new_value: referralFieldDisplay(key, b),
        created_at: new Date().toISOString(),
      });
    }
    store.referral_settings_history = history.slice(-200);
    store.referral_program = next;
  });
}

export function listReferralInvites(): ReferralInviteRow[] {
  const rows = readStore().referral_invites ?? [];
  return [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function listReferralSettingsHistory(): ReferralSettingsChangeRow[] {
  const rows = readStore().referral_settings_history ?? [];
  return [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function normalizeSupportAppealsConfig(raw: unknown): SupportAppealsConfig {
  const base = defaultSupportAppealsConfig();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true || o.enabled === 1 || o.enabled === "1",
  };
}

function normalizeSupportAppeal(raw: unknown): SupportAppealRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  if (!id) return null;
  const stRaw = String(o.status ?? "new").trim().toLowerCase();
  const status: SupportAppealStatus =
    stRaw === "in_progress" || stRaw === "closed" ? (stRaw as SupportAppealStatus) : "new";
  const photosRaw = Array.isArray(o.photo_file_ids) ? o.photo_file_ids : [];
  const photo_file_ids = photosRaw
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const pathsRaw = Array.isArray(o.photo_paths) ? o.photo_paths : [];
  const photo_paths = pathsRaw
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const replyPathsRaw = Array.isArray(o.admin_reply_photo_paths) ? o.admin_reply_photo_paths : [];
  const admin_reply_photo_paths = replyPathsRaw
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);
  const src = String(o.source ?? "bot").trim().toLowerCase() === "webapp" ? "webapp" : "bot";
  const tg_chat_id = Math.floor(Number(o.tg_chat_id) || 0);
  const tg_user_id = Math.floor(Number(o.tg_user_id) || 0);
  if (!tg_chat_id || !tg_user_id) return null;
  const user_id = Number.isFinite(Number(o.user_id)) && Number(o.user_id) > 0 ? Math.floor(Number(o.user_id)) : undefined;
  return {
    id,
    tg_chat_id,
    tg_user_id,
    tg_username: String(o.tg_username ?? "").trim() || undefined,
    tg_first_name: String(o.tg_first_name ?? "").trim() || undefined,
    user_id,
    text: String(o.text ?? "").trim().slice(0, 8000),
    photo_file_ids,
    photo_paths,
    status,
    source: src,
    created_at: String(o.created_at ?? new Date().toISOString()),
    updated_at: String(o.updated_at ?? new Date().toISOString()),
    taken_at: o.taken_at ? String(o.taken_at) : undefined,
    closed_at: o.closed_at ? String(o.closed_at) : undefined,
    admin_reply_text: String(o.admin_reply_text ?? "").trim() || undefined,
    admin_reply_photo_paths: admin_reply_photo_paths.length ? admin_reply_photo_paths : undefined,
  };
}

export function getSupportAppealsConfig(): SupportAppealsConfig {
  return normalizeSupportAppealsConfig(readStore().support_appeals_config);
}

export function setSupportAppealsConfig(config: SupportAppealsConfig): void {
  mutate((store) => {
    store.support_appeals_config = normalizeSupportAppealsConfig(config);
  });
}

export function listSupportAppeals(): SupportAppealRow[] {
  return [...(readStore().support_appeals ?? [])].sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

export function countNewSupportAppeals(): number {
  return (readStore().support_appeals ?? []).filter((a) => a.status === "new").length;
}

export function getSupportAppeal(id: string): SupportAppealRow | undefined {
  const key = String(id ?? "").trim();
  if (!key) return undefined;
  return readStore().support_appeals?.find((a) => a.id === key);
}

export function createSupportAppeal(input: {
  tg_chat_id: number;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  user_id?: number;
  text: string;
  photo_file_ids: string[];
  photo_paths?: string[];
  source: "bot" | "webapp";
}): SupportAppealRow {
  const now = new Date().toISOString();
  const row: SupportAppealRow = {
    id: randomBytes(8).toString("hex"),
    tg_chat_id: Math.floor(input.tg_chat_id),
    tg_user_id: Math.floor(input.tg_user_id),
    tg_username: String(input.tg_username ?? "").trim() || undefined,
    tg_first_name: String(input.tg_first_name ?? "").trim() || undefined,
    user_id:
      input.user_id != null && Number.isFinite(Number(input.user_id)) && Number(input.user_id) > 0
        ? Math.floor(Number(input.user_id))
        : undefined,
    text: String(input.text ?? "").trim().slice(0, 8000),
    photo_file_ids: (input.photo_file_ids ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10),
    photo_paths: (input.photo_paths ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10),
    status: "new",
    source: input.source === "webapp" ? "webapp" : "bot",
    created_at: now,
    updated_at: now,
  };
  mutate((store) => {
    store.support_appeals = [...(store.support_appeals ?? []), row];
  });
  return row;
}

export function takeSupportAppealInWork(id: string): SupportAppealRow | undefined {
  let out: SupportAppealRow | undefined;
  mutate((store) => {
    const i = (store.support_appeals ?? []).findIndex((a) => a.id === id);
    if (i === -1) return;
    const cur = store.support_appeals[i]!;
    if (cur.status !== "new") return;
    const now = new Date().toISOString();
    const next: SupportAppealRow = {
      ...cur,
      status: "in_progress",
      updated_at: now,
      taken_at: now,
    };
    store.support_appeals[i] = next;
    out = next;
  });
  return out;
}

export function patchSupportAppealPhotoPaths(id: string, photo_paths: string[]): SupportAppealRow | undefined {
  let out: SupportAppealRow | undefined;
  mutate((store) => {
    const i = (store.support_appeals ?? []).findIndex((a) => a.id === id);
    if (i === -1) return;
    const cur = store.support_appeals[i]!;
    const next: SupportAppealRow = {
      ...cur,
      photo_paths: photo_paths.map((x) => String(x).trim()).filter(Boolean).slice(0, 10),
      updated_at: new Date().toISOString(),
    };
    store.support_appeals[i] = next;
    out = next;
  });
  return out;
}

export function deleteSupportAppeal(id: string): boolean {
  const key = String(id ?? "").trim();
  if (!key) return false;
  let removed = false;
  mutate((store) => {
    const list = store.support_appeals ?? [];
    const next = list.filter((a) => a.id !== key);
    removed = next.length < list.length;
    if (removed) store.support_appeals = next;
  });
  return removed;
}

export function completeSupportAppeal(
  id: string,
  patch: { admin_reply_text: string; admin_reply_photo_paths?: string[] },
): SupportAppealRow | undefined {
  let out: SupportAppealRow | undefined;
  mutate((store) => {
    const i = (store.support_appeals ?? []).findIndex((a) => a.id === id);
    if (i === -1) return;
    const cur = store.support_appeals[i]!;
    if (cur.status !== "in_progress") return;
    const now = new Date().toISOString();
    const replyPaths = (patch.admin_reply_photo_paths ?? [])
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 5);
    const next: SupportAppealRow = {
      ...cur,
      status: "closed",
      updated_at: now,
      closed_at: now,
      admin_reply_text: String(patch.admin_reply_text ?? "").trim().slice(0, 8000) || undefined,
      admin_reply_photo_paths: replyPaths.length ? replyPaths : undefined,
    };
    store.support_appeals[i] = next;
    out = next;
  });
  return out;
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

export function appendReferralAdminGift(input: {
  user_id: number;
  user_name: string;
  kind: "gb" | "days";
  amount: number;
  admin_comment?: string;
  granted_by?: string;
  telegram_sent?: boolean;
}): ReferralAdminGiftRow {
  const admin_comment = String(input.admin_comment ?? "").trim() || undefined;
  const granted_by = String(input.granted_by ?? "Администратор").trim() || "Администратор";
  const row: ReferralAdminGiftRow = {
    id: randomBytes(8).toString("hex"),
    user_id: Math.floor(input.user_id),
    user_name: String(input.user_name ?? "").trim() || `Клиент #${Math.floor(input.user_id)}`,
    kind: input.kind,
    amount: Math.max(1, Math.floor(Number(input.amount) || 1)),
    created_at: new Date().toISOString(),
    granted_by,
    ...(admin_comment ? { admin_comment } : {}),
    ...(input.telegram_sent === true || input.telegram_sent === false ? { telegram_sent: input.telegram_sent } : {}),
  };
  mutate((store) => {
    const prev = store.referral_admin_gifts ?? [];
    store.referral_admin_gifts = [...prev, row].slice(-500);
  });
  return row;
}

export function listReferralAdminGifts(): ReferralAdminGiftRow[] {
  const rows = readStore().referral_admin_gifts ?? [];
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

export function getDropperGameConfig(): DropperGameConfig {
  return normalizeDropperGame(readStore().dropper_game);
}

export function setDropperGameConfig(cfg: DropperGameConfig): void {
  mutate((store) => {
    const next = normalizeDropperGame(cfg);
    store.dropper_game = next;
    store.game_tickets_per_purchase = Math.max(0, Math.floor(next.tickets_per_purchase || 0));
    if (next.enabled) {
      store.webapp_active_game = "dropper";
    } else if (store.webapp_active_game === "dropper") {
      store.webapp_active_game = "none";
    }
  });
}

export function sumDropperTicketsForTgUser(tgUserId: number): number {
  const key = String(tgUserId).trim();
  if (!key) return 0;
  return readStore()
    .users.filter((u) => String(u.tg_id).trim() === key)
    .reduce((s, u) => s + u.dropper_tickets, 0);
}

function dropperPoolKey(u: { id: number; tg_id?: string }): string {
  const t = String(u.tg_id ?? "").trim();
  return t || `__solo:${u.id}`;
}

/** Начислить билеты выбранным строкам: +n на каждую выбранную подписку. */
export function grantDropperTicketsToUserIds(
  userIds: number[],
  tickets: number,
): { uniquePools: number; tgChatIds: number[] } {
  const n = Math.max(0, Math.floor(Number(tickets) || 0));
  if (n <= 0 || userIds.length === 0) return { uniquePools: 0, tgChatIds: [] };
  const idSet = new Set(userIds.map((x) => Math.floor(Number(x))).filter((x) => Number.isFinite(x) && x > 0));
  const tgChatIds = new Set<number>();
  mutate((store) => {
    for (const uid of idSet) {
      const idx = store.users.findIndex((u) => u.id === uid);
      if (idx === -1) continue;
      const row = store.users[idx]!;
      store.users[idx] = normalizeUser({ ...row, dropper_tickets: row.dropper_tickets + n });
      const tgKey = String(row.tg_id ?? "").trim();
      const chatId = Math.floor(Number(tgKey));
      if (tgKey && Number.isFinite(chatId) && chatId > 0) tgChatIds.add(chatId);
    }
  });
  return { uniquePools: idSet.size, tgChatIds: [...tgChatIds] };
}

/** Обнулить билеты «Дроппер» у всех клиентов. */
export function resetAllDropperTickets(): void {
  mutate((store) => {
    for (let i = 0; i < store.users.length; i++) {
      const u = store.users[i]!;
      store.users[i] = normalizeUser({ ...u, dropper_tickets: 0 });
    }
  });
}

/**
 * Задать число билетов для конкретной подписки (строки клиента).
 */
export function setDropperTicketsPoolForClientRow(
  anchorUserId: number,
  totalTickets: number,
): { ok: true } | { ok: false; error: string } {
  const t = Math.max(0, Math.floor(Number(totalTickets) || 0));
  let err: string | null = null;
  mutate((store) => {
    const idx = store.users.findIndex((u) => u.id === anchorUserId);
    if (idx === -1) {
      err = "user_not_found";
      return;
    }
    store.users[idx] = normalizeUser({ ...store.users[idx]!, dropper_tickets: t });
  });
  if (err) return { ok: false, error: err };
  return { ok: true };
}

/**
 * Начисление билетов на подписку после покупки.
 * targetUserId — продлённая/новая подписка; иначе первая привязанная строка.
 */
export function grantDropperTicketsForPurchaseChat(
  tgChatId: number,
  tickets: number,
  targetUserId?: number,
): number {
  const key = String(tgChatId).trim();
  const n = Math.max(0, Math.floor(Number(tickets) || 0));
  if (!key || n <= 0) return 0;
  let matched = 0;
  mutate((store) => {
    const members = store.users.filter((u) => String(u.tg_id ?? "").trim() === key).sort((a, b) => a.id - b.id);
    if (members.length === 0) return;
    const tid = Math.floor(Number(targetUserId));
    const target =
      Number.isFinite(tid) && tid > 0 ? members.find((u) => u.id === tid) : members.length === 1 ? members[0] : members[0];
    if (!target) return;
    matched = 1;
    const idx = store.users.findIndex((u) => u.id === target.id);
    if (idx === -1) return;
    const row = store.users[idx]!;
    store.users[idx] = normalizeUser({ ...row, dropper_tickets: row.dropper_tickets + n });
  });
  return matched;
}

export function startDropperPlaySession(
  tgUserId: number,
  targetUserId: number,
  opts?: { practice?: boolean },
): { ok: true; session_id: string; seed: number } | { ok: false; error: string } {
  const practice = opts?.practice === true;
  if (getWebAppActiveGame() !== "dropper") return { ok: false, error: "game_disabled" };
  const linked = findUsersByTelegramChatId(tgUserId);
  if (linked.length === 0) return { ok: false, error: "forbidden" };

  let resolvedTargetId = Math.floor(Number(targetUserId));
  if (practice) {
    if (!Number.isFinite(resolvedTargetId) || resolvedTargetId <= 0) {
      resolvedTargetId = [...linked].sort((a, b) => a.id - b.id)[0]!.id;
    } else if (!linked.some((u) => u.id === resolvedTargetId)) {
      return { ok: false, error: "forbidden" };
    }
  } else {
    const target = linked.find((u) => u.id === resolvedTargetId);
    if (!target) return { ok: false, error: "forbidden" };
    if (target.dropper_tickets < 1) return { ok: false, error: "no_tickets" };
  }

  const sessionBox: { row: DropperSessionRow | null } = { row: null };
  mutate((store) => {
    if (!practice) {
      const idx = store.users.findIndex((u) => u.id === resolvedTargetId);
      if (idx === -1) return;
      const row = store.users[idx]!;
      if (String(row.tg_id ?? "").trim() !== String(tgUserId).trim()) return;
      if (row.dropper_tickets < 1) return;
      store.users[idx] = normalizeUser({ ...row, dropper_tickets: row.dropper_tickets - 1 });
    }
    const seed = Math.floor(Math.random() * 2147483646) + 1;
    const session: DropperSessionRow = {
      id: randomBytes(8).toString("hex"),
      tg_user_id: tgUserId,
      user_id: resolvedTargetId,
      seed,
      started_at: new Date().toISOString(),
      ...(practice ? { practice: true } : {}),
    };
    const cutoff = Date.now() - 30 * 60 * 1000;
    store.dropper_sessions = (store.dropper_sessions ?? []).filter((s) => Date.parse(s.started_at) >= cutoff);
    store.dropper_sessions.push(session);
    sessionBox.row = session;
  });

  const created = sessionBox.row;
  if (!created) return { ok: false, error: practice ? "forbidden" : "no_tickets" };
  return { ok: true, session_id: created.id, seed: created.seed };
}

export function finishDropperPlay(input: {
  tgUserId: number;
  sessionId: string;
  won: boolean;
  flightMs: number;
  choice?: "gb" | "days";
  /** Какому привязанному пользователю начислить награду (если не задан — из сессии). */
  rewardUserId?: number;
}):
  | {
      ok: true;
      practice?: boolean;
      prizeApplied?: { kind: "gb" | "days"; amount: number; userId: number; userName: string };
    }
  | { ok: false; error: string } {
  const cfg = getDropperGameConfig();
  if (getWebAppActiveGame() !== "dropper") return { ok: false, error: "game_disabled" };

  let err: string | null = null;
  const out: {
    practice: boolean;
    prizeApplied?: { kind: "gb" | "days"; amount: number; userId: number; userName: string };
  } = { practice: false };
  mutate((store) => {
    const sessions = store.dropper_sessions ?? [];
    const idx = sessions.findIndex((s) => s.id === input.sessionId);
    if (idx === -1) {
      err = "session_not_found";
      return;
    }
    const sess = sessions[idx]!;
    if (sess.tg_user_id !== input.tgUserId) {
      err = "forbidden";
      return;
    }
    if (sess.practice === true) {
      out.practice = true;
      sessions.splice(idx, 1);
      store.dropper_sessions = sessions;
      return;
    }
    const elapsed = Date.now() - Date.parse(sess.started_at);
    const flight = Math.max(0, Math.floor(Number(input.flightMs) || 0));

    const user = store.users.find((u) => u.id === sess.user_id);
    const userName = user ? String(user.name ?? "").trim() : "";

    const pushLose = () => {
      const row: DropperPlayLogRow = {
        id: randomBytes(8).toString("hex"),
        tg_user_id: sess.tg_user_id,
        user_id: sess.user_id,
        user_name: userName,
        result: "lose",
        flight_ms: flight,
        created_at: new Date().toISOString(),
      };
      if (!store.dropper_play_log) store.dropper_play_log = [];
      store.dropper_play_log.push(row);
      store.dropper_play_log = store.dropper_play_log.slice(-15_000);
    };

    const removeSession = () => {
      sessions.splice(idx, 1);
      store.dropper_sessions = sessions;
    };

    if (!input.won) {
      removeSession();
      pushLose();
      return;
    }

    const effSec = cfg.flight_duration_sec / Math.max(0.25, cfg.flight_speed_mult);
    const tw = dropperWinTimingMsFromEffectiveFlightSec(effSec);
    const timingOk =
      flight >= tw.flightMin && flight <= tw.flightMax && elapsed >= tw.elapsedMin && elapsed <= tw.elapsedMax;
    if (!timingOk) {
      removeSession();
      pushLose();
      return;
    }

    const choice = input.choice;
    if (choice !== "gb" && choice !== "days") {
      err = "choice_required";
      return;
    }
    if (choice === "gb" && cfg.reward_gb <= 0) {
      err = "reward_gb_disabled";
      removeSession();
      pushLose();
      return;
    }
    if (choice === "days" && cfg.reward_days <= 0) {
      err = "reward_days_disabled";
      removeSession();
      pushLose();
      return;
    }

    let rewardUid = sess.user_id;
    const rawReward = input.rewardUserId;
    if (rawReward != null && Number.isFinite(Number(rawReward)) && Math.floor(Number(rawReward)) > 0) {
      const rid = Math.floor(Number(rawReward));
      const linked = findUsersByTelegramChatId(input.tgUserId);
      if (!linked.some((u) => u.id === rid)) {
        err = "forbidden";
        return;
      }
      rewardUid = rid;
    }

    const rewardUser = store.users.find((u) => u.id === rewardUid);
    const rewardUserName = rewardUser ? String(rewardUser.name ?? "").trim() : "";

    const ui = store.users.findIndex((u) => u.id === rewardUid);
    if (ui === -1) {
      err = "user_not_found";
      removeSession();
      return;
    }
    const u = store.users[ui]!;

    if (choice === "gb") {
      if (u.total_gb <= 0) {
        removeSession();
        pushLose();
        return;
      }
      store.users[ui] = normalizeUser({ ...u, total_gb: u.total_gb + cfg.reward_gb });
    } else {
      const base = Math.max(Date.now(), u.expiry_time > 0 ? u.expiry_time : 0);
      const newExp = snapExpiryTimeToNoonLocal(base + cfg.reward_days * 86_400_000);
      store.users[ui] = normalizeUser({ ...u, expiry_time: newExp });
    }

    removeSession();
    const winRow: DropperPlayLogRow = {
      id: randomBytes(8).toString("hex"),
      tg_user_id: sess.tg_user_id,
      user_id: rewardUid,
      user_name: rewardUserName,
      result: "win",
      reward_kind: choice,
      reward_amount: choice === "gb" ? cfg.reward_gb : cfg.reward_days,
      flight_ms: flight,
      created_at: new Date().toISOString(),
    };
    if (!store.dropper_play_log) store.dropper_play_log = [];
    store.dropper_play_log.push(winRow);
    store.dropper_play_log = store.dropper_play_log.slice(-15_000);
    out.prizeApplied = {
      kind: choice,
      amount: choice === "gb" ? cfg.reward_gb : cfg.reward_days,
      userId: rewardUid,
      userName: rewardUserName,
    };
  });

  if (err) return { ok: false, error: err };
  if (out.practice) return { ok: true, practice: true };
  if (out.prizeApplied) return { ok: true, prizeApplied: out.prizeApplied };
  return { ok: true };
}

export function getDropperStatsForTgUser(tgUserId: number): {
  plays: number;
  wins: number;
  won_gb: number;
  won_days: number;
} {
  const log = readStore().dropper_play_log ?? [];
  const rows = log.filter((r) => r.tg_user_id === tgUserId);
  let wins = 0;
  let wonGb = 0;
  let wonDays = 0;
  for (const r of rows) {
    if (r.result === "win") {
      wins++;
      if (r.reward_kind === "gb" && r.reward_amount) wonGb += r.reward_amount;
      if (r.reward_kind === "days" && r.reward_amount) wonDays += r.reward_amount;
    }
  }
  return { plays: rows.length, wins, won_gb: wonGb, won_days: wonDays };
}

/** Победы для строки клиента: при tg_id — как в WebApp (все победы этого Telegram); иначе — только wins с user_id = id строки. */
export function dropperWinsForClientRow(u: { id: number; tg_id?: string }): number {
  const t = String(u.tg_id ?? "").trim();
  if (t && Number.isFinite(Number(t)) && Math.floor(Number(t)) > 0) {
    return getDropperStatsForTgUser(Math.floor(Number(t))).wins;
  }
  const log = readStore().dropper_play_log ?? [];
  return log.filter((r) => r.result === "win" && r.user_id === u.id).length;
}

export function getDropperAdminReport(): {
  total_plays: number;
  total_wins: number;
  total_loses: number;
  unique_players: number;
  unique_winners: number;
  gifts_gb_choices: number;
  gifts_days_choices: number;
} {
  const log = readStore().dropper_play_log ?? [];
  const players = new Set<number>();
  const winners = new Set<number>();
  let wins = 0;
  let loses = 0;
  let gbC = 0;
  let daysC = 0;
  for (const r of log) {
    players.add(r.tg_user_id);
    if (r.result === "win") {
      wins++;
      winners.add(r.tg_user_id);
      if (r.reward_kind === "gb") gbC++;
      if (r.reward_kind === "days") daysC++;
    } else loses++;
  }
  return {
    total_plays: log.length,
    total_wins: wins,
    total_loses: loses,
    unique_players: players.size,
    unique_winners: winners.size,
    gifts_gb_choices: gbC,
    gifts_days_choices: daysC,
  };
}

function readCommunicationLogFile(): CommunicationMessageLogRow[] {
  const p = communicationLogPath();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x) => normalizeCommunicationMessageLog(x))
      .filter((x): x is CommunicationMessageLogRow => x != null);
  } catch {
    return [];
  }
}

function writeCommunicationLogFile(rows: CommunicationMessageLogRow[]): void {
  const p = communicationLogPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(rows, null, 2), "utf8");
}

/** Однократно переносит журнал из data.json, если он был записан до выноса в отдельный файл. */
function migrateEmbeddedCommunicationLog(): void {
  if (readCommunicationLogFile().length > 0) return;
  try {
    if (!fs.existsSync(dataPath)) return;
    const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8")) as {
      communication_message_log?: unknown;
    };
    const embedded = Array.isArray(parsed.communication_message_log) ? parsed.communication_message_log : [];
    const rows = embedded
      .map((x) => normalizeCommunicationMessageLog(x))
      .filter((x): x is CommunicationMessageLogRow => x != null);
    if (rows.length > 0) writeCommunicationLogFile(rows);
  } catch {
    /* ignore */
  }
}

export function initDb(): void {
  migrateEmbeddedCommunicationLog();
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

function normalizePromoCodeText(input: string): string {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toLocaleUpperCase("ru-RU");
}

export function getPromoCodeByText(code: string): PromoCodeRow | undefined {
  const key = normalizePromoCodeText(code);
  if (!key) return undefined;
  return listPromoCodes().find((p) => p.code === key);
}

export function createPromoCode(input: {
  name: string;
  code: string;
  type?: PromoCodeRow["type"];
  discount_percent: number;
  discount_rub?: number;
  gift_gb?: number;
  gift_days?: number;
  one_time_per_user: boolean;
  max_uses_total?: number;
  max_uses_per_user?: number;
  min_purchase_rub?: number;
  first_purchase_only?: boolean;
  new_users_only?: boolean;
  apply_plan_ids?: number[];
  admin_note?: string;
  active?: boolean;
  valid_until?: string;
}): PromoCodeRow {
  const name = String(input.name ?? "").trim();
  const code = normalizePromoCodeText(input.code);
  if (!name) throw new Error("promo_name_required");
  if (!code) throw new Error("promo_code_required");
  if (!/^[\p{L}\p{N}_-]{3,40}$/u.test(code)) throw new Error("promo_code_invalid");
  const type = input.type ?? "percent";
  const discountPercent = Math.min(100, Math.max(0, Math.floor(Number(input.discount_percent) || 0)));
  const discountRub = Math.max(0, Math.floor(Number(input.discount_rub) || 0));
  const giftGb = Math.max(0, Math.floor(Number(input.gift_gb) || 0));
  const giftDays = Math.max(0, Math.floor(Number(input.gift_days) || 0));
  if (type === "percent" && (discountPercent < 1 || discountPercent > 100)) throw new Error("promo_discount_invalid");
  if (type === "rub" && discountRub <= 0) throw new Error("promo_discount_rub_invalid");
  if (type === "gb" && giftGb <= 0) throw new Error("promo_gb_invalid");
  if (type === "days" && giftDays <= 0) throw new Error("promo_days_invalid");
  if (type === "combo" && discountPercent <= 0 && giftGb <= 0 && giftDays <= 0) throw new Error("promo_combo_invalid");
  const maxUsesTotalRaw = Math.floor(Number(input.max_uses_total));
  const maxUsesPerUserRaw = Math.floor(Number(input.max_uses_per_user));
  const minPurchaseRaw = Math.floor(Number(input.min_purchase_rub));
  if (Number.isFinite(maxUsesTotalRaw) && maxUsesTotalRaw > 0 && maxUsesTotalRaw < 1) throw new Error("promo_max_uses_total_invalid");
  const maxUsesPerUser = Number.isFinite(maxUsesPerUserRaw) && maxUsesPerUserRaw >= 1 ? maxUsesPerUserRaw : 1;
  const applyPlanIdsIn = Array.isArray(input.apply_plan_ids) ? input.apply_plan_ids : [];
  const applyPlanIds = [...new Set(applyPlanIdsIn.map((x) => Math.floor(Number(x))).filter((x) => Number.isFinite(x) && x > 0))];
  const validUntil = String(input.valid_until ?? "").trim();
  if (validUntil) {
    const expiryMs = Date.parse(validUntil);
    if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) throw new Error("promo_valid_until_past");
  }
  let out: PromoCodeRow | undefined;
  mutate((store) => {
    const rows = store.promo_codes ?? [];
    if (rows.some((r) => r.code === code)) throw new Error("promo_code_exists");
    out = {
      id: randomBytes(8).toString("hex"),
      name,
      code,
      type,
      discount_percent: discountPercent,
      discount_rub: discountRub,
      gift_gb: giftGb,
      gift_days: giftDays,
      one_time_per_user: input.one_time_per_user === true,
      ...(Number.isFinite(maxUsesTotalRaw) && maxUsesTotalRaw >= 1 ? { max_uses_total: maxUsesTotalRaw } : {}),
      max_uses_per_user: maxUsesPerUser,
      ...(Number.isFinite(minPurchaseRaw) && minPurchaseRaw > 0 ? { min_purchase_rub: minPurchaseRaw } : {}),
      first_purchase_only: input.first_purchase_only === true,
      new_users_only: input.new_users_only === true,
      ...(applyPlanIds.length > 0 ? { apply_plan_ids: applyPlanIds } : {}),
      ...(String(input.admin_note ?? "").trim() ? { admin_note: String(input.admin_note ?? "").trim().slice(0, 500) } : {}),
      active: input.active !== false,
      valid_until: validUntil,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.promo_codes = [out!, ...rows];
  });
  return out!;
}

export function updatePromoCode(
  promoId: string,
  patch: Partial<{
    name: string;
    code: string;
    type: PromoCodeRow["type"];
    discount_percent: number;
    discount_rub: number;
    gift_gb: number;
    gift_days: number;
    one_time_per_user: boolean;
    max_uses_total: number;
    max_uses_per_user: number;
    min_purchase_rub: number;
    first_purchase_only: boolean;
    new_users_only: boolean;
    apply_plan_ids: number[];
    admin_note: string;
    active: boolean;
    valid_until: string;
  }>,
): PromoCodeRow | undefined {
  const id = String(promoId ?? "").trim();
  if (!id) return undefined;
  let out: PromoCodeRow | undefined;
  mutate((store) => {
    const rows = store.promo_codes ?? [];
    const idx = rows.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const cur = rows[idx]!;
    const nextName = patch.name !== undefined ? String(patch.name).trim() : cur.name;
    const nextCode = patch.code !== undefined ? normalizePromoCodeText(patch.code) : cur.code;
    if (!nextName) throw new Error("promo_name_required");
    if (!nextCode) throw new Error("promo_code_required");
    if (!/^[\p{L}\p{N}_-]{3,40}$/u.test(nextCode)) throw new Error("promo_code_invalid");
    if (rows.some((r, i) => i !== idx && r.code === nextCode)) throw new Error("promo_code_exists");
    const nextType = patch.type ?? cur.type;
    const nextDiscountPercent =
      patch.discount_percent !== undefined ? Math.min(100, Math.max(0, Math.floor(Number(patch.discount_percent) || 0))) : cur.discount_percent;
    const nextDiscountRub =
      patch.discount_rub !== undefined ? Math.max(0, Math.floor(Number(patch.discount_rub) || 0)) : cur.discount_rub;
    const nextGiftGb = patch.gift_gb !== undefined ? Math.max(0, Math.floor(Number(patch.gift_gb) || 0)) : cur.gift_gb;
    const nextGiftDays = patch.gift_days !== undefined ? Math.max(0, Math.floor(Number(patch.gift_days) || 0)) : cur.gift_days;
    if (nextType === "percent" && (nextDiscountPercent < 1 || nextDiscountPercent > 100)) throw new Error("promo_discount_invalid");
    if (nextType === "rub" && nextDiscountRub <= 0) throw new Error("promo_discount_rub_invalid");
    if (nextType === "gb" && nextGiftGb <= 0) throw new Error("promo_gb_invalid");
    if (nextType === "days" && nextGiftDays <= 0) throw new Error("promo_days_invalid");
    if (nextType === "combo" && nextDiscountPercent <= 0 && nextGiftGb <= 0 && nextGiftDays <= 0) throw new Error("promo_combo_invalid");
    const nextMaxUsesTotalRaw =
      patch.max_uses_total !== undefined ? Math.floor(Number(patch.max_uses_total)) : cur.max_uses_total ?? Number.NaN;
    if (patch.max_uses_total !== undefined && Number.isFinite(nextMaxUsesTotalRaw) && nextMaxUsesTotalRaw < 1) {
      throw new Error("promo_max_uses_total_invalid");
    }
    const nextMaxUsesPerUser =
      patch.max_uses_per_user !== undefined
        ? Math.max(1, Math.floor(Number(patch.max_uses_per_user) || 1))
        : Math.max(1, Math.floor(Number(cur.max_uses_per_user) || 1));
    const nextMinPurchaseRaw =
      patch.min_purchase_rub !== undefined ? Math.floor(Number(patch.min_purchase_rub) || 0) : cur.min_purchase_rub ?? 0;
    const applyPlanIdsIn = patch.apply_plan_ids !== undefined ? patch.apply_plan_ids : cur.apply_plan_ids ?? [];
    const applyPlanIds = [...new Set(applyPlanIdsIn.map((x) => Math.floor(Number(x))).filter((x) => Number.isFinite(x) && x > 0))];
    const nextValidUntil =
      patch.valid_until !== undefined ? String(patch.valid_until ?? "").trim() : String(cur.valid_until ?? "").trim();
    if (nextValidUntil) {
      const expiryMs = Date.parse(nextValidUntil);
      if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) throw new Error("promo_valid_until_past");
    }
    out = {
      ...cur,
      name: nextName,
      code: nextCode,
      type: nextType,
      discount_percent: nextDiscountPercent,
      discount_rub: nextDiscountRub,
      gift_gb: nextGiftGb,
      gift_days: nextGiftDays,
      one_time_per_user: patch.one_time_per_user !== undefined ? patch.one_time_per_user === true : cur.one_time_per_user,
      ...(Number.isFinite(nextMaxUsesTotalRaw) && nextMaxUsesTotalRaw >= 1 ? { max_uses_total: nextMaxUsesTotalRaw } : {}),
      max_uses_per_user: nextMaxUsesPerUser,
      ...(nextMinPurchaseRaw > 0 ? { min_purchase_rub: nextMinPurchaseRaw } : {}),
      first_purchase_only: patch.first_purchase_only !== undefined ? patch.first_purchase_only === true : cur.first_purchase_only,
      new_users_only: patch.new_users_only !== undefined ? patch.new_users_only === true : cur.new_users_only,
      ...(applyPlanIds.length > 0 ? { apply_plan_ids: applyPlanIds } : {}),
      ...(patch.admin_note !== undefined
        ? (String(patch.admin_note ?? "").trim() ? { admin_note: String(patch.admin_note ?? "").trim().slice(0, 500) } : {})
        : cur.admin_note
          ? { admin_note: cur.admin_note }
          : {}),
      active: patch.active !== undefined ? patch.active === true : cur.active,
      valid_until: nextValidUntil,
      updated_at: new Date().toISOString(),
    };
    rows[idx] = out!;
    store.promo_codes = rows;
  });
  return out;
}

export function deletePromoCode(promoId: string): boolean {
  const id = String(promoId ?? "").trim();
  if (!id) return false;
  let removed = false;
  mutate((store) => {
    const before = (store.promo_codes ?? []).length;
    store.promo_codes = (store.promo_codes ?? []).filter((p) => p.id !== id);
    store.promo_code_usages = (store.promo_code_usages ?? []).filter((u) => u.promo_id !== id);
    removed = (store.promo_codes ?? []).length !== before;
  });
  return removed;
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
  if (promo.active === false) throw new Error("promo_inactive");
  if (promo.valid_until) {
    const expiryMs = Date.parse(promo.valid_until);
    if (Number.isFinite(expiryMs) && Date.now() > expiryMs) throw new Error("promo_expired");
  }
  const uid = Math.floor(Number(tgUserId));
  if (!Number.isFinite(uid) || uid <= 0) throw new Error("promo_bad_user");
  const userUsages = (readStore().promo_code_usages ?? []).filter((r) => r.promo_id === promo.id && r.tg_user_id === uid);
  const allUsages = (readStore().promo_code_usages ?? []).filter((r) => r.promo_id === promo.id);
  if (promo.max_uses_total && allUsages.length >= promo.max_uses_total) throw new Error("promo_limit_reached");
  if (userUsages.length >= Math.max(1, Math.floor(Number(promo.max_uses_per_user) || 1))) throw new Error("promo_user_limit_reached");
  if (promo.one_time_per_user && hasPromoCodeUsageByUser(promo.id, uid)) {
    throw new Error("promo_already_used");
  }
  if (promo.new_users_only && uid > 0) {
    const hadNonTestSubscription = findUsersByTelegramChatId(uid).some((u) => u.is_test_subscription !== 1);
    if (hadNonTestSubscription) throw new Error("promo_new_users_only");
  }
  return promo;
}

export function registerPromoCodeUsage(input: {
  code: string;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  session_id?: string;
  user_name?: string;
  phone?: string;
  plan_id?: number;
  plan_title?: string;
  original_price_rub?: number;
  final_price_rub?: number;
  discount_rub?: number;
  bonus_gb?: number;
  bonus_days?: number;
  status?: "applied" | "error";
  error?: string;
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
      user_name: String(input.user_name ?? "").trim() || undefined,
      phone: String(input.phone ?? "").trim() || undefined,
      applied_at: new Date().toISOString(),
      session_id: String(input.session_id ?? "").trim() || undefined,
      plan_id: Number.isFinite(Number(input.plan_id)) && Number(input.plan_id) > 0 ? Math.floor(Number(input.plan_id)) : undefined,
      plan_title: String(input.plan_title ?? "").trim() || undefined,
      original_price_rub:
        Number.isFinite(Number(input.original_price_rub)) ? Math.max(0, Math.floor(Number(input.original_price_rub))) : undefined,
      final_price_rub: Number.isFinite(Number(input.final_price_rub)) ? Math.max(0, Math.floor(Number(input.final_price_rub))) : undefined,
      discount_rub: Number.isFinite(Number(input.discount_rub)) ? Math.max(0, Math.floor(Number(input.discount_rub))) : undefined,
      bonus_gb: Number.isFinite(Number(input.bonus_gb)) ? Math.max(0, Math.floor(Number(input.bonus_gb))) : undefined,
      bonus_days: Number.isFinite(Number(input.bonus_days)) ? Math.max(0, Math.floor(Number(input.bonus_days))) : undefined,
      status: input.status === "error" ? "error" : "applied",
      error: String(input.error ?? "").trim() || undefined,
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
  plan_id?: number;
}): {
  promo: PromoCodeRow;
  final_price_rub: number;
  original_price_rub: number;
  discount_rub: number;
  discount_percent: number;
  bonus_gb: number;
  bonus_days: number;
} {
  const promo = validatePromoCodeForUser(input.code, input.tg_user_id);
  const original = Math.max(0, Math.floor(Number(input.original_price_rub) || 0));
  if (promo.min_purchase_rub && original < promo.min_purchase_rub) throw new Error("promo_min_purchase_not_met");
  if (promo.apply_plan_ids && promo.apply_plan_ids.length > 0 && input.plan_id && !promo.apply_plan_ids.includes(input.plan_id)) {
    throw new Error("promo_plan_not_allowed");
  }
  const discountByPercent = Math.max(0, Math.floor((original * promo.discount_percent) / 100));
  const discountByRub = promo.discount_rub;
  const rawDiscount =
    promo.type === "percent"
      ? discountByPercent
      : promo.type === "rub"
        ? discountByRub
        : promo.type === "combo"
          ? Math.max(discountByPercent, discountByRub)
          : 0;
  const final = Math.max(0, original - rawDiscount);
  const discountRub = Math.max(0, original - final);
  const bonusGb = promo.type === "gb" || promo.type === "combo" ? promo.gift_gb : 0;
  const bonusDays = promo.type === "days" || promo.type === "combo" ? promo.gift_days : 0;
  return {
    promo,
    original_price_rub: original,
    final_price_rub: final,
    discount_rub: discountRub,
    discount_percent: original > 0 ? Math.round((discountRub / original) * 100) : 0,
    bonus_gb: bonusGb,
    bonus_days: bonusDays,
  };
}

export function listCommunicationSegments(): CommunicationSegmentRow[] {
  const rows = readStore().communication_segments ?? [];
  if (rows.length === 0) return defaultCommunicationSegments();
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

export function createCommunicationSegment(input: Omit<CommunicationSegmentRow, "id" | "created_at" | "updated_at">): CommunicationSegmentRow {
  const now = new Date().toISOString();
  const normalized = normalizeCommunicationSegment({
    ...input,
    id: randomBytes(8).toString("hex"),
    created_at: now,
    updated_at: now,
  });
  if (!normalized) throw new Error("segment_invalid");
  let out: CommunicationSegmentRow | undefined;
  mutate((store) => {
    const rows = store.communication_segments ?? [];
    out = normalized;
    store.communication_segments = [out!, ...rows];
  });
  return out!;
}

export function updateCommunicationSegment(
  id: string,
  patch: Partial<Omit<CommunicationSegmentRow, "id" | "created_at" | "updated_at">>,
): CommunicationSegmentRow | undefined {
  const key = String(id ?? "").trim();
  if (!key) return undefined;
  let out: CommunicationSegmentRow | undefined;
  mutate((store) => {
    const rows = store.communication_segments ?? [];
    const idx = rows.findIndex((r) => r.id === key);
    if (idx === -1) return;
    const merged = normalizeCommunicationSegment({
      ...rows[idx],
      ...patch,
      id: key,
      created_at: rows[idx]!.created_at,
      updated_at: new Date().toISOString(),
    });
    if (!merged) return;
    rows[idx] = merged;
    store.communication_segments = rows;
    out = merged;
  });
  return out;
}

export function deleteCommunicationSegment(id: string): boolean {
  const key = String(id ?? "").trim();
  if (!key) return false;
  let removed = false;
  mutate((store) => {
    const target = (store.communication_segments ?? []).find((r) => r.id === key);
    if (
      target?.system_key === "test_subscriptions" ||
      target?.id === "sys_test_subscriptions"
    ) {
      return;
    }
    const before = (store.communication_segments ?? []).length;
    store.communication_segments = (store.communication_segments ?? []).filter((r) => r.id !== key);
    removed = (store.communication_segments ?? []).length !== before;
    if ((store.communication_segments ?? []).length === 0) {
      store.communication_segments = defaultCommunicationSegments();
    }
  });
  return removed;
}

export const TEST_SUBSCRIPTION_SEGMENT_ID = "sys_test_subscriptions";
export const TEST_SUBSCRIPTION_SEGMENT_SYSTEM_KEY = "test_subscriptions";
export const TEST_SUBSCRIPTION_SEGMENT_NAME = "Оформившие тестовые подписки";
export const TEST_SUBSCRIPTION_SEGMENT_PRESET =
  "Вам понравился наш VPN? Оформите полную подписку — вот промокод: ";

export function isTestSubscriptionSystemSegment(segment: Pick<CommunicationSegmentRow, "system_key" | "id">): boolean {
  return (
    segment.system_key === TEST_SUBSCRIPTION_SEGMENT_SYSTEM_KEY ||
    segment.id === TEST_SUBSCRIPTION_SEGMENT_ID
  );
}

export function ensureTestSubscriptionSegment(): CommunicationSegmentRow {
  const rows = readStore().communication_segments ?? [];
  const existing = rows.find((s) => isTestSubscriptionSystemSegment(s));
  if (existing) return existing;

  const now = new Date().toISOString();
  const created = normalizeCommunicationSegment({
    id: TEST_SUBSCRIPTION_SEGMENT_ID,
    name: TEST_SUBSCRIPTION_SEGMENT_NAME,
    user_ids: [],
    days_mode: "any",
    gb_mode: "any",
    preset_enabled: true,
    preset_text: TEST_SUBSCRIPTION_SEGMENT_PRESET,
    system_key: TEST_SUBSCRIPTION_SEGMENT_SYSTEM_KEY,
    created_at: now,
    updated_at: now,
  });
  if (!created) throw new Error("segment_invalid");
  mutate((store) => {
    const prev = store.communication_segments ?? [];
    store.communication_segments = [created, ...prev.filter((s) => !isTestSubscriptionSystemSegment(s))];
  });
  return created;
}

export function refreshTestSubscriptionSegment(): CommunicationSegmentRow {
  ensureTestSubscriptionSegment();
  const ids = listTestSubscriptionSegmentUserIds();
  const updated = updateCommunicationSegment(TEST_SUBSCRIPTION_SEGMENT_ID, { user_ids: ids });
  return updated ?? ensureTestSubscriptionSegment();
}

/** Активные тестовые подписчики: тест оформлен и полный тариф после не покупали. */
export function listTestSubscriptionSegmentUserIds(): number[] {
  const usedTg = new Set(readStore().test_subscription_used_tg_ids ?? []);
  const regularSubUserIds = new Set(
    listShopActivity()
      .filter((a) => a.kind === "subscription")
      .map((a) => a.user_id),
  );
  return listUsers()
    .filter((u) => {
      if (u.is_test_subscription === 1) return true;
      const tg = Math.floor(Number(String(u.tg_id ?? "").trim()));
      if (!Number.isFinite(tg) || tg <= 0 || !usedTg.has(tg)) return false;
      if (regularSubUserIds.has(u.id)) return false;
      const comment = String(u.comment ?? "").toLowerCase();
      if (comment.includes("тестов")) return true;
      return listShopActivity().some((a) => a.user_id === u.id && a.kind === "test");
    })
    .map((u) => u.id);
}

export function addUserToTestSubscriptionSegment(userId: number): void {
  const id = Math.floor(userId);
  if (!Number.isFinite(id) || id <= 0) return;
  ensureTestSubscriptionSegment();
  mutate((store) => {
    const rows = store.communication_segments ?? [];
    const idx = rows.findIndex((s) => isTestSubscriptionSystemSegment(s));
    if (idx === -1) return;
    const cur = rows[idx]!;
    const prevIds = Array.isArray(cur.user_ids) ? cur.user_ids : [];
    if (prevIds.includes(id)) return;
    rows[idx] = {
      ...cur,
      user_ids: [...prevIds, id],
      updated_at: new Date().toISOString(),
    };
    store.communication_segments = rows;
  });
}

export function clearTestSubscriptionFlags(userIds: number[]): void {
  const ids = [...new Set(userIds.map((x) => Math.floor(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return;
  mutate((store) => {
    for (let i = 0; i < store.users.length; i++) {
      const u = store.users[i]!;
      if (!ids.includes(u.id)) continue;
      if (u.is_test_subscription !== 1) continue;
      store.users[i] = normalizeUser({
        ...u,
        is_test_subscription: 0,
        updated_at: new Date().toISOString(),
      });
    }
  });
  refreshTestSubscriptionSegment();
}

const COMMUNICATION_LOG_MAX = 2000;

export function listCommunicationMessageLog(limit = 200): CommunicationMessageLogRow[] {
  const cap = Math.max(1, Math.min(500, Math.floor(limit) || 200));
  const rows = readCommunicationLogFile();
  return [...rows]
    .sort((a, b) => {
      const ta = Date.parse(a.sent_at);
      const tb = Date.parse(b.sent_at);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    })
    .slice(0, cap);
}

export function appendCommunicationMessageLog(
  input: Omit<CommunicationMessageLogRow, "id" | "sent_at">,
): CommunicationMessageLogRow {
  const now = new Date().toISOString();
  const row = normalizeCommunicationMessageLog({
    ...input,
    id: randomBytes(8).toString("hex"),
    sent_at: now,
  });
  if (!row) throw new Error("communication_log_invalid");
  const prev = readCommunicationLogFile();
  const next = [row, ...prev];
  writeCommunicationLogFile(
    next.length > COMMUNICATION_LOG_MAX ? next.slice(0, COMMUNICATION_LOG_MAX) : next,
  );
  return row;
}

export function listVpnExperiments(): VpnExperimentRow[] {
  return [...(readStore().vpn_experiments ?? [])].sort((a, b) => b.id - a.id);
}

export function listVpnExperimentsForServer(serverId: number): VpnExperimentRow[] {
  return listVpnExperiments().filter((e) => e.server_id === serverId);
}

export function getActive443Experiment(serverId: number): VpnExperimentRow | undefined {
  return listVpnExperimentsForServer(serverId).find((e) => e.active_on_443 === 1 && e.status === "deployed");
}

export function clearActive443ForServer(serverId: number, exceptId?: number): void {
  mutate((store) => {
    for (const e of store.vpn_experiments ?? []) {
      if (e.server_id !== serverId) continue;
      if (exceptId != null && e.id === exceptId) continue;
      if (e.active_on_443 === 1) e.active_on_443 = 0;
    }
  });
}

export function getVpnExperiment(id: number): VpnExperimentRow | undefined {
  return readStore().vpn_experiments?.find((e) => e.id === id);
}

export function getVpnExperimentBySubToken(token: string): VpnExperimentRow | undefined {
  const t = String(token ?? "").trim();
  if (!t) return undefined;
  return readStore().vpn_experiments?.find((e) => e.sub_token === t);
}

export function createVpnExperimentRow(
  row: Omit<VpnExperimentRow, "id" | "experimental" | "created_at" | "updated_at">,
): VpnExperimentRow {
  let created!: VpnExperimentRow;
  mutate((store) => {
    const id = store.next_experiment_id ?? 1;
    store.next_experiment_id = id + 1;
    const now = new Date().toISOString();
    created = normalizeVpnExperiment({
      ...row,
      id,
      experimental: 1,
      created_at: now,
      updated_at: now,
    })!;
    store.vpn_experiments = [...(store.vpn_experiments ?? []), created];
  });
  return created;
}

export function updateVpnExperimentRow(id: number, patch: Partial<VpnExperimentRow>): VpnExperimentRow | undefined {
  let out: VpnExperimentRow | undefined;
  mutate((store) => {
    const list = store.vpn_experiments ?? [];
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return;
    const cur = list[i]!;
    const merged = normalizeVpnExperiment({
      ...cur,
      ...patch,
      id,
      experimental: 1,
      updated_at: new Date().toISOString(),
    });
    if (!merged) return;
    list[i] = merged;
    store.vpn_experiments = list;
    out = merged;
  });
  return out;
}

export function deleteVpnExperimentRow(id: number): boolean {
  let ok = false;
  mutate((store) => {
    const before = store.vpn_experiments?.length ?? 0;
    store.vpn_experiments = (store.vpn_experiments ?? []).filter((e) => e.id !== id);
    ok = (store.vpn_experiments?.length ?? 0) < before;
  });
  return ok;
}

function normalizeWebAppActiveGame(raw: unknown, dropperCfg?: DropperGameConfig): WebAppActiveGame {
  const v = String(raw ?? "").trim();
  if (v === "dropper" || v === "roulette" || v === "none") return v;
  return dropperCfg?.enabled ? "dropper" : "none";
}

function normalizeGameTicketsPerPurchase(raw: unknown, dropperCfg?: DropperGameConfig): number {
  const n = Math.floor(Number(raw));
  if (Number.isFinite(n) && n >= 0) return n;
  return Math.max(0, Math.floor(dropperCfg?.tickets_per_purchase ?? defaultDropperGame().tickets_per_purchase));
}

function normalizeRoulettePrize(raw: unknown): RoulettePrizeRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const title = String(o.title ?? "").trim();
  if (!id || !title) return null;
  const now = new Date().toISOString();
  return {
    id,
    title,
    type: String(o.type ?? "custom").trim() || "custom",
    value: Math.max(0, Math.floor(Number(o.value) || 0)),
    chance_percent: Math.max(0, Math.min(100, Number(o.chance_percent) || 0)),
    active: o.active !== false,
    color: String(o.color ?? "#6366f1").trim() || "#6366f1",
    icon: String(o.icon ?? "🎁").trim() || "🎁",
    win_text: String(o.win_text ?? title).trim() || title,
    sort_order: Math.floor(Number(o.sort_order) || 0),
    archived: o.archived === true,
    created_at: String(o.created_at ?? now),
    updated_at: String(o.updated_at ?? now),
  };
}

function normalizeRoulettePrizes(raw: unknown): RoulettePrizeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => normalizeRoulettePrize(x)).filter((x): x is RoulettePrizeRow => x != null);
}

function normalizeRouletteSpin(raw: unknown): RouletteSpinRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Math.floor(Number(o.id));
  if (!Number.isFinite(id) || id <= 0) return null;
  const statusRaw = String(o.status ?? "success");
  const status = statusRaw === "failed" || statusRaw === "pending" ? statusRaw : "success";
  return {
    id,
    user_id: Math.floor(Number(o.user_id) || 0),
    tg_user_id: Math.floor(Number(o.tg_user_id) || 0),
    prize_id: String(o.prize_id ?? "").trim(),
    prize_title: String(o.prize_title ?? "").trim() || "—",
    prize_display_message: o.prize_display_message != null ? String(o.prize_display_message) : null,
    ticket_spent: o.ticket_spent !== false,
    result_type: String(o.result_type ?? "").trim(),
    result_value: Math.floor(Number(o.result_value) || 0),
    status,
    error_message: o.error_message != null ? String(o.error_message) : null,
    user_notified: o.user_notified === true,
    created_at: String(o.created_at ?? new Date().toISOString()),
  };
}

export function getRouletteSpinById(id: number): RouletteSpinRow | undefined {
  return (readStore().roulette_spins ?? []).find((s) => s.id === id);
}

function normalizeRouletteSpins(raw: unknown): RouletteSpinRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => normalizeRouletteSpin(x)).filter((x): x is RouletteSpinRow => x != null);
}

function normalizeGameTicketTransactionSource(raw: unknown): GameTicketTransactionSource {
  const src = String(raw ?? "admin");
  if (
    src === "purchase" ||
    src === "roulette_prize" ||
    src === "compensation" ||
    src === "purchase_for_days" ||
    src === "purchase_for_gb"
  ) {
    return src;
  }
  return "admin";
}

function normalizeGameTicketTransaction(raw: unknown): GameTicketTransactionRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  if (!id) return null;
  const spentType = String(o.spent_resource_type ?? "");
  const spent_resource_type =
    spentType === "subscription_days" || spentType === "traffic_gb" || spentType === "none" ? spentType : null;
  const gameType = String(o.game_type ?? "");
  const game_type = gameType === "roulette" || gameType === "dropper" ? gameType : null;
  const st = String(o.status ?? "success");
  const status = st === "failed" ? "failed" : "success";
  return {
    id,
    user_id: Math.floor(Number(o.user_id) || 0),
    tg_user_id: Math.floor(Number(o.tg_user_id) || 0),
    source: normalizeGameTicketTransactionSource(o.source),
    payment_id: o.payment_id != null ? String(o.payment_id) : null,
    amount: Math.floor(Number(o.amount) || 0),
    roulette_spin_id: Number.isFinite(Number(o.roulette_spin_id)) ? Math.floor(Number(o.roulette_spin_id)) : null,
    game_type,
    spent_resource_type,
    spent_resource_amount: Number.isFinite(Number(o.spent_resource_amount))
      ? Math.floor(Number(o.spent_resource_amount))
      : null,
    subscription_before: Number.isFinite(Number(o.subscription_before)) ? Math.floor(Number(o.subscription_before)) : null,
    subscription_after: Number.isFinite(Number(o.subscription_after)) ? Math.floor(Number(o.subscription_after)) : null,
    traffic_before: Number.isFinite(Number(o.traffic_before)) ? Number(o.traffic_before) : null,
    traffic_after: Number.isFinite(Number(o.traffic_after)) ? Number(o.traffic_after) : null,
    status,
    error_message: o.error_message != null ? String(o.error_message) : null,
    created_at: String(o.created_at ?? new Date().toISOString()),
  };
}

function normalizeGameTicketTransactions(raw: unknown): GameTicketTransactionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => normalizeGameTicketTransaction(x)).filter((x): x is GameTicketTransactionRow => x != null);
}

export function getWebAppActiveGame(): WebAppActiveGame {
  return normalizeWebAppActiveGame(readStore().webapp_active_game, readStore().dropper_game);
}

export function setWebAppActiveGame(game: WebAppActiveGame): void {
  mutate((store) => {
    store.webapp_active_game = game;
    store.dropper_game = {
      ...normalizeDropperGame(store.dropper_game),
      enabled: game === "dropper",
    };
  });
}

export function getGameTicketsPerPurchase(): number {
  return normalizeGameTicketsPerPurchase(readStore().game_tickets_per_purchase, readStore().dropper_game);
}

export function setGameTicketsPerPurchase(n: number): void {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  mutate((store) => {
    store.game_tickets_per_purchase = v;
    store.dropper_game = { ...normalizeDropperGame(store.dropper_game), tickets_per_purchase: v };
  });
}

export function defaultRouletteTicketShop(): RouletteTicketShopConfig {
  return {
    enabled: false,
    price_days_per_ticket: 1,
    price_gb_per_ticket: 5,
    min_tickets: 1,
    max_tickets: 10,
    allow_days: true,
    allow_gb: true,
    notify_telegram_on_purchase: false,
  };
}

export function normalizeRouletteTicketShop(raw: unknown): RouletteTicketShopConfig {
  const d = defaultRouletteTicketShop();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    price_days_per_ticket: Math.max(0, Math.floor(Number(o.price_days_per_ticket) || d.price_days_per_ticket)),
    price_gb_per_ticket: Math.max(0, Math.floor(Number(o.price_gb_per_ticket) || d.price_gb_per_ticket)),
    min_tickets: Math.max(1, Math.floor(Number(o.min_tickets) || d.min_tickets)),
    max_tickets: Math.max(1, Math.floor(Number(o.max_tickets) || d.max_tickets)),
    allow_days: o.allow_days !== false,
    allow_gb: o.allow_gb !== false,
    notify_telegram_on_purchase: o.notify_telegram_on_purchase === true,
  };
}

export type RouletteTicketShopValidationErrors = Partial<
  Record<
    | "enabled"
    | "price_days_per_ticket"
    | "price_gb_per_ticket"
    | "min_tickets"
    | "max_tickets"
    | "allow_days"
    | "allow_gb",
    string
  >
>;

export function validateRouletteTicketShop(cfg: RouletteTicketShopConfig): RouletteTicketShopValidationErrors {
  const errors: RouletteTicketShopValidationErrors = {};
  if (cfg.enabled) {
    if (!cfg.allow_days && !cfg.allow_gb) {
      errors.enabled = "Включите хотя бы один способ оплаты (дни или ГБ).";
    }
    if (cfg.allow_days && cfg.price_days_per_ticket <= 0) {
      errors.price_days_per_ticket = "Цена в днях должна быть больше 0.";
    }
    if (cfg.allow_gb && cfg.price_gb_per_ticket <= 0) {
      errors.price_gb_per_ticket = "Цена в ГБ должна быть больше 0.";
    }
  }
  if (cfg.max_tickets < cfg.min_tickets) {
    errors.max_tickets = "Максимум не может быть меньше минимума.";
  }
  return errors;
}

export function getRouletteTicketShop(): RouletteTicketShopConfig {
  return normalizeRouletteTicketShop(readStore().roulette_ticket_shop);
}

export function setRouletteTicketShop(cfg: RouletteTicketShopConfig): RouletteTicketShopConfig {
  const normalized = normalizeRouletteTicketShop(cfg);
  const errors = validateRouletteTicketShop(normalized);
  if (Object.keys(errors).length > 0) {
    const first = Object.values(errors)[0];
    throw new Error(first ?? "Некорректные настройки покупки билетов");
  }
  mutate((store) => {
    store.roulette_ticket_shop = normalized;
  });
  return normalized;
}

export function readRouletteConfig() {
  return {
    active_game: getWebAppActiveGame(),
    tickets_per_purchase: getGameTicketsPerPurchase(),
    roulette_enabled: getWebAppActiveGame() === "roulette",
    dropper_enabled: getWebAppActiveGame() === "dropper",
    ticket_shop: getRouletteTicketShop(),
  };
}

export function getRoulettePrizes(includeArchived = false): RoulettePrizeRow[] {
  const list = normalizeRoulettePrizes(readStore().roulette_prizes);
  const filtered = includeArchived ? list : list.filter((p) => !p.archived);
  return [...filtered].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
}

export function saveRoulettePrizes(prizes: RoulettePrizeRow[]): RoulettePrizeRow[] {
  const now = new Date().toISOString();
  const normalized = prizes.map((p, i) => {
    const base = normalizeRoulettePrize({ ...p, sort_order: p.sort_order ?? i });
    if (!base) throw new Error("invalid_prize");
    return { ...base, updated_at: now };
  });
  mutate((store) => {
    store.roulette_prizes = normalized;
  });
  return getRoulettePrizes(true);
}

export function normalizeRoulettePrizeChances(): RoulettePrizeRow[] {
  const active = getRoulettePrizes(false).filter((p) => p.active);
  const sum = active.reduce((s, p) => s + (Number(p.chance_percent) || 0), 0);
  if (active.length === 0 || sum <= 0) return getRoulettePrizes(false);
  const all = getRoulettePrizes(true);
  const scaled = all.map((p) => {
    if (!p.active || p.archived) return p;
    const scaledChance = Math.round(((Number(p.chance_percent) || 0) / sum) * 10000) / 100;
    return { ...p, chance_percent: scaledChance, updated_at: new Date().toISOString() };
  });
  const activeScaled = scaled.filter((p) => p.active && !p.archived);
  const scaledSum = activeScaled.reduce((s, p) => s + p.chance_percent, 0);
  if (activeScaled.length > 0 && Math.abs(scaledSum - 100) > 0.01) {
    const last = activeScaled[activeScaled.length - 1]!;
    const idx = scaled.findIndex((p) => p.id === last.id);
    if (idx >= 0) scaled[idx] = { ...scaled[idx]!, chance_percent: scaled[idx]!.chance_percent + (100 - scaledSum) };
  }
  mutate((store) => {
    store.roulette_prizes = scaled;
  });
  return getRoulettePrizes(false);
}

export function insertRouletteSpin(input: Omit<RouletteSpinRow, "id" | "created_at">): RouletteSpinRow {
  let row: RouletteSpinRow | null = null;
  mutate((store) => {
    const id = Math.max(1, Math.floor(Number(store.next_roulette_spin_id) || 1));
    store.next_roulette_spin_id = id + 1;
    row = {
      ...input,
      id,
      created_at: new Date().toISOString(),
    };
    store.roulette_spins = [...(store.roulette_spins ?? []), row];
  });
  return row!;
}

export function updateRouletteSpin(id: number, patch: Partial<RouletteSpinRow>): RouletteSpinRow {
  let out: RouletteSpinRow | null = null;
  mutate((store) => {
    const list = store.roulette_spins ?? [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const merged = normalizeRouletteSpin({ ...list[idx], ...patch, id });
    if (!merged) return;
    list[idx] = merged;
    store.roulette_spins = list;
    out = merged;
  });
  if (!out) throw new Error("spin_not_found");
  return out;
}

export function listRouletteSpins(opts?: {
  limit?: number;
  offset?: number;
  tgUserId?: number;
  userQuery?: string;
  prizeType?: string;
  status?: string;
  errorsOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
}): { rows: RouletteSpinRow[]; total: number } {
  let rows = [...(readStore().roulette_spins ?? [])].sort((a, b) => b.id - a.id);
  if (opts?.tgUserId != null && opts.tgUserId > 0) {
    rows = rows.filter((s) => s.tg_user_id === opts.tgUserId);
  }
  const userQuery = String(opts?.userQuery ?? "").trim().toLowerCase();
  if (userQuery) {
    rows = rows.filter((s) => {
      const u = getUser(s.user_id);
      const name = (u?.name ?? "").toLowerCase();
      const tgId = (u?.tg_id ?? "").toLowerCase();
      const tgUser = String(s.tg_user_id);
      return (
        name.includes(userQuery) ||
        tgId.includes(userQuery) ||
        tgUser.includes(userQuery) ||
        String(s.user_id).includes(userQuery)
      );
    });
  }
  if (opts?.prizeType) rows = rows.filter((s) => s.result_type === opts.prizeType);
  if (opts?.status) rows = rows.filter((s) => s.status === opts.status);
  if (opts?.errorsOnly) rows = rows.filter((s) => s.status === "failed");
  if (opts?.dateFrom) rows = rows.filter((s) => s.created_at >= opts.dateFrom!);
  if (opts?.dateTo) rows = rows.filter((s) => s.created_at.slice(0, 10) <= opts.dateTo!);
  const total = rows.length;
  const offset = Math.max(0, Math.floor(Number(opts?.offset) || 0));
  const limit = Math.max(1, Math.min(100000, Math.floor(Number(opts?.limit) || 500)));
  return { rows: rows.slice(offset, offset + limit), total };
}

function normalizeRoulettePurchaseDiscount(raw: unknown): RoulettePurchaseDiscountRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tgUserId = Number(o.tg_user_id);
  const percent = Number(o.discount_percent);
  const spinId = Number(o.spin_id);
  if (!Number.isFinite(tgUserId) || tgUserId <= 0) return null;
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) return null;
  if (!Number.isFinite(spinId) || spinId <= 0) return null;
  return {
    tg_user_id: Math.floor(tgUserId),
    discount_percent: Math.floor(percent),
    spin_id: Math.floor(spinId),
    created_at: String(o.created_at ?? new Date().toISOString()),
  };
}

export function grantRoulettePurchaseDiscount(
  tgUserId: number,
  discountPercent: number,
  spinId: number,
): RoulettePurchaseDiscountRow {
  const row: RoulettePurchaseDiscountRow = {
    tg_user_id: Math.floor(tgUserId),
    discount_percent: Math.min(100, Math.max(1, Math.floor(discountPercent))),
    spin_id: Math.floor(spinId),
    created_at: new Date().toISOString(),
  };
  mutate((store) => {
    const prev = store.roulette_purchase_discounts ?? [];
    store.roulette_purchase_discounts = [
      ...prev.filter((d) => d.tg_user_id !== row.tg_user_id),
      row,
    ];
  });
  return row;
}

export function getRoulettePurchaseDiscount(tgUserId: number): RoulettePurchaseDiscountRow | undefined {
  return (readStore().roulette_purchase_discounts ?? []).find((d) => d.tg_user_id === Math.floor(tgUserId));
}

function normalizeRouletteGbPiggy(raw: unknown, users: UserRow[]): RouletteGbPiggyRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const gb = Number(o.accumulated_gb);
  if (!Number.isFinite(gb) || gb < 0) return null;
  let userId = Number(o.user_id);
  if (!Number.isFinite(userId) || userId <= 0) {
    const legacyTg = Number(o.tg_user_id);
    if (Number.isFinite(legacyTg) && legacyTg > 0) {
      userId =
        users
          .filter((u) => String(u.tg_id ?? "").trim() === String(Math.floor(legacyTg)))
          .sort((a, b) => a.id - b.id)[0]?.id ?? 0;
    }
  }
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return {
    user_id: Math.floor(userId),
    accumulated_gb: Math.floor(gb),
    updated_at: String(o.updated_at ?? new Date().toISOString()),
  };
}

export function userHasUnlimitedTrafficForRoulette(userId: number): boolean {
  const u = getUser(userId);
  if (!u) return false;
  return u.total_gb <= 0;
}

export function getRouletteGbPiggy(userId: number): number {
  const id = Math.floor(userId);
  const row = (readStore().roulette_gb_piggy ?? []).find((p) => p.user_id === id);
  return row?.accumulated_gb ?? 0;
}

export function addRouletteGbToPiggy(userId: number, gb: number): number {
  const n = Math.max(1, Math.floor(Number(gb) || 0));
  const uid = Math.floor(userId);
  let newTotal = 0;
  mutate((store) => {
    const list = [...(store.roulette_gb_piggy ?? [])];
    const idx = list.findIndex((p) => p.user_id === uid);
    if (idx >= 0) {
      newTotal = list[idx]!.accumulated_gb + n;
      list[idx] = { ...list[idx]!, accumulated_gb: newTotal, updated_at: new Date().toISOString() };
    } else {
      newTotal = n;
      list.push({ user_id: uid, accumulated_gb: n, updated_at: new Date().toISOString() });
    }
    store.roulette_gb_piggy = list;
  });
  return newTotal;
}

export function exchangeRouletteGbPiggyForTicket(
  tgUserId: number,
  userId: number,
): { ok: true; accumulated_gb: number; tickets_remaining: number } | { ok: false; error: string } {
  const uid = Math.floor(userId);
  const key = String(tgUserId).trim();
  const row = getUser(uid);
  if (!row || String(row.tg_id ?? "").trim() !== key) {
    return { ok: false, error: "forbidden" };
  }
  if (!userHasUnlimitedTrafficForRoulette(uid)) {
    return { ok: false, error: "piggy_not_available" };
  }
  let ticketsRemaining = 0;
  let newAccum = 0;
  let err: string | null = null;
  mutate((store) => {
    const list = [...(store.roulette_gb_piggy ?? [])];
    const idx = list.findIndex((p) => p.user_id === uid);
    const current = idx >= 0 ? list[idx]!.accumulated_gb : 0;
    if (current < ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD) {
      err = "not_enough_gb";
      return;
    }
    newAccum = current - ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD;
    if (idx >= 0) {
      list[idx] = { ...list[idx]!, accumulated_gb: newAccum, updated_at: new Date().toISOString() };
    }
    store.roulette_gb_piggy = list;

    const uidx = store.users.findIndex((u) => u.id === uid);
    if (uidx === -1) {
      err = "no_subscription";
      return;
    }
    const urow = store.users[uidx]!;
    ticketsRemaining = urow.dropper_tickets + 1;
    store.users[uidx] = normalizeUser({ ...urow, dropper_tickets: ticketsRemaining });
  });
  if (err) return { ok: false, error: err };
  return { ok: true, accumulated_gb: newAccum, tickets_remaining: ticketsRemaining };
}

export function consumeRoulettePurchaseDiscount(tgUserId: number, spinId?: number): boolean {
  let ok = false;
  mutate((store) => {
    const list = store.roulette_purchase_discounts ?? [];
    const idx = list.findIndex(
      (d) =>
        d.tg_user_id === Math.floor(tgUserId) &&
        (spinId == null || spinId <= 0 || d.spin_id === Math.floor(spinId)),
    );
    if (idx < 0) return;
    list.splice(idx, 1);
    store.roulette_purchase_discounts = list;
    ok = true;
  });
  return ok;
}

export function insertGameTicketTransaction(input: {
  user_id: number;
  tg_user_id: number;
  source: GameTicketTransactionRow["source"];
  amount: number;
  payment_id?: string | null;
  roulette_spin_id?: number | null;
  game_type?: GameTicketTransactionRow["game_type"];
  spent_resource_type?: GameTicketTransactionRow["spent_resource_type"];
  spent_resource_amount?: number | null;
  subscription_before?: number | null;
  subscription_after?: number | null;
  traffic_before?: number | null;
  traffic_after?: number | null;
  status?: GameTicketTransactionRow["status"];
  error_message?: string | null;
}): GameTicketTransactionRow {
  let row: GameTicketTransactionRow | null = null;
  mutate((store) => {
    row = {
      id: randomBytes(8).toString("hex"),
      user_id: input.user_id,
      tg_user_id: input.tg_user_id,
      source: input.source,
      payment_id: input.payment_id ?? null,
      amount: Math.floor(Number(input.amount) || 0),
      roulette_spin_id: input.roulette_spin_id ?? null,
      game_type: input.game_type ?? null,
      spent_resource_type: input.spent_resource_type ?? null,
      spent_resource_amount: input.spent_resource_amount ?? null,
      subscription_before: input.subscription_before ?? null,
      subscription_after: input.subscription_after ?? null,
      traffic_before: input.traffic_before ?? null,
      traffic_after: input.traffic_after ?? null,
      status: input.status ?? "success",
      error_message: input.error_message ?? null,
      created_at: new Date().toISOString(),
    };
    store.game_ticket_transactions = [...(store.game_ticket_transactions ?? []), row];
  });
  return row!;
}

export function listRouletteTicketPurchaseTransactions(opts?: {
  limit?: number;
  tgUserId?: number;
  userId?: number;
  paymentType?: "subscription_days" | "traffic_gb";
  status?: "success" | "failed";
  dateFrom?: string;
  dateTo?: string;
}): GameTicketTransactionRow[] {
  const limit = Math.min(5000, Math.max(1, Math.floor(Number(opts?.limit) || 500)));
  let rows = (readStore().game_ticket_transactions ?? []).filter(
    (t) =>
      t.game_type === "roulette" &&
      (t.source === "purchase_for_days" || t.source === "purchase_for_gb"),
  );
  if (opts?.tgUserId != null) {
    rows = rows.filter((t) => t.tg_user_id === opts.tgUserId);
  }
  if (opts?.userId != null) {
    rows = rows.filter((t) => t.user_id === opts.userId);
  }
  if (opts?.paymentType === "subscription_days") {
    rows = rows.filter((t) => t.source === "purchase_for_days");
  } else if (opts?.paymentType === "traffic_gb") {
    rows = rows.filter((t) => t.source === "purchase_for_gb");
  }
  if (opts?.status) {
    rows = rows.filter((t) => (t.status ?? "success") === opts.status);
  }
  if (opts?.dateFrom) {
    const from = Date.parse(opts.dateFrom);
    if (Number.isFinite(from)) rows = rows.filter((t) => Date.parse(t.created_at) >= from);
  }
  if (opts?.dateTo) {
    const to = Date.parse(opts.dateTo);
    if (Number.isFinite(to)) rows = rows.filter((t) => Date.parse(t.created_at) <= to + 86400000);
  }
  return rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, limit);
}

export function listRouletteTicketPurchasesForTgUser(tgUserId: number, limit = 20): GameTicketTransactionRow[] {
  return listRouletteTicketPurchaseTransactions({ tgUserId, limit, status: "success" });
}

/** Оставшиеся дни и ГБ по строке подписки (для покупки билетов рулетки). */
export function subscriptionResourceBalances(u: UserRow): {
  remaining_days: number | null;
  remaining_gb: number | null;
  unlimited_time: boolean;
  unlimited_traffic: boolean;
} {
  const now = Date.now();
  const unlimited_time = u.expiry_time <= 0;
  const unlimited_traffic = u.total_gb <= 0;
  let remaining_days: number | null = null;
  if (u.expiry_time > 0) {
    const remaining_ms = Math.max(0, u.expiry_time - now);
    remaining_days = remaining_ms > 0 ? Math.max(1, Math.ceil(remaining_ms / 86400000)) : 0;
  }
  let remaining_gb: number | null = null;
  if (u.total_gb > 0) {
    const usedGb = (u.traffic_up + u.traffic_down) / (1024 * 1024 * 1024);
    remaining_gb = Math.max(0, Math.round((u.total_gb - usedGb) * 100) / 100);
  }
  return { remaining_days, remaining_gb, unlimited_time, unlimited_traffic };
}

export type AtomicRouletteTicketPurchaseInput = {
  tg_user_id: number;
  user_id: number;
  tickets: number;
  payment_type: "subscription_days" | "traffic_gb";
  cost: number;
};

export type AtomicRouletteTicketPurchaseResult =
  | {
      ok: true;
      transaction_id: string;
      tickets_remaining: number;
      remaining_days: number | null;
      remaining_gb: number | null;
      subscription_after: number;
      traffic_after: number | null;
    }
  | { ok: false; error: string };

export function atomicRouletteTicketPurchase(
  input: AtomicRouletteTicketPurchaseInput,
): AtomicRouletteTicketPurchaseResult {
  let out: AtomicRouletteTicketPurchaseResult = { ok: false, error: "purchase_failed" };
  mutate((store) => {
    const primaryIdx = store.users.findIndex((u) => u.id === input.user_id);
    if (primaryIdx === -1) {
      out = { ok: false, error: "Подписка не найдена." };
      return;
    }
    const row = store.users[primaryIdx]!;
    if (!userHasActiveSubscription(row)) {
      out = { ok: false, error: "Для покупки билетов нужна активная подписка." };
      return;
    }

    const subBefore = row.expiry_time;
    const trafficBefore = row.total_gb > 0 ? subscriptionResourceBalances(row).remaining_gb : null;

    if (input.payment_type === "subscription_days") {
      if (row.expiry_time <= 0) {
        out = { ok: false, error: "Покупка за дни недоступна при подписке без срока." };
        return;
      }
      const subAfter = snapExpiryTimeToNoonLocal(row.expiry_time - input.cost * 86_400_000);
      if (subAfter < Date.now() || subAfter - Date.now() < 86_400_000) {
        out = { ok: false, error: "Недостаточно дней подписки для покупки билетов." };
        return;
      }
      store.users[primaryIdx] = normalizeUser({ ...row, expiry_time: subAfter });
    } else {
      if (row.total_gb <= 0) {
        out = { ok: false, error: "На безлимитном тарифе покупка за ГБ недоступна." };
        return;
      }
      const usedGb = (row.traffic_up + row.traffic_down) / (1024 * 1024 * 1024);
      const newTotal = row.total_gb - input.cost;
      if (newTotal - usedGb < 0) {
        out = { ok: false, error: "Недостаточно ГБ трафика для покупки билетов." };
        return;
      }
      store.users[primaryIdx] = normalizeUser({ ...row, total_gb: Math.max(0, newTotal) });
    }

    const key = String(input.tg_user_id).trim();
    const members = store.users.filter((u) => String(u.tg_id ?? "").trim() === key).sort((a, b) => a.id - b.id);
    if (members.length === 0) {
      out = { ok: false, error: "Пользователь не найден." };
      return;
    }
    const ticketIdx = store.users.findIndex((u) => u.id === input.user_id);
    if (ticketIdx === -1) {
      out = { ok: false, error: "Подписка не найдена." };
      return;
    }
    const ticketRow = store.users[ticketIdx]!;
    const newTotalTickets = ticketRow.dropper_tickets + input.tickets;
    store.users[ticketIdx] = normalizeUser({ ...ticketRow, dropper_tickets: newTotalTickets });

    const updatedRow = store.users[primaryIdx]!;
    const bal = subscriptionResourceBalances(updatedRow);
    const txId = randomBytes(8).toString("hex");
    const tx: GameTicketTransactionRow = {
      id: txId,
      user_id: input.user_id,
      tg_user_id: input.tg_user_id,
      source: input.payment_type === "subscription_days" ? "purchase_for_days" : "purchase_for_gb",
      payment_id: null,
      amount: input.tickets,
      roulette_spin_id: null,
      game_type: "roulette",
      spent_resource_type: input.payment_type,
      spent_resource_amount: input.cost,
      subscription_before: subBefore,
      subscription_after: updatedRow.expiry_time,
      traffic_before: trafficBefore,
      traffic_after: bal.remaining_gb,
      status: "success",
      error_message: null,
      created_at: new Date().toISOString(),
    };
    store.game_ticket_transactions = [...(store.game_ticket_transactions ?? []), tx];

    out = {
      ok: true,
      transaction_id: txId,
      tickets_remaining: newTotalTickets,
      remaining_days: bal.remaining_days,
      remaining_gb: bal.remaining_gb,
      subscription_after: updatedRow.expiry_time,
      traffic_after: bal.remaining_gb,
    };
  });
  return out;
}

export function consumeGameTicketForUser(
  userId: number,
  tgUserId: number,
): { ok: true; user_id: number; tickets_remaining: number } | { ok: false; error: string } {
  const uid = Math.floor(userId);
  const key = String(tgUserId).trim();
  if (!key || uid <= 0) return { ok: false, error: "invalid_user" };
  let remaining = 0;
  let ok = false;
  mutate((store) => {
    const idx = store.users.findIndex((u) => u.id === uid);
    if (idx === -1) return;
    const row = store.users[idx]!;
    if (String(row.tg_id ?? "").trim() !== key) return;
    if (row.dropper_tickets < 1) return;
    remaining = row.dropper_tickets - 1;
    store.users[idx] = normalizeUser({ ...row, dropper_tickets: remaining });
    ok = true;
  });
  if (!ok) return { ok: false, error: "no_tickets" };
  return { ok: true, user_id: uid, tickets_remaining: remaining };
}

export function consumeGameTicketForTgUser(
  tgUserId: number,
): { ok: true; user_id: number; tickets_remaining: number } | { ok: false; error: string } {
  const key = String(tgUserId).trim();
  if (!key) return { ok: false, error: "invalid_user" };
  if (sumDropperTicketsForTgUser(tgUserId) < 1) return { ok: false, error: "no_tickets" };
  let userId = 0;
  let remaining = 0;
  mutate((store) => {
    const sorted = [...store.users].filter((u) => String(u.tg_id ?? "").trim() === key).sort((a, b) => a.id - b.id);
    for (const u of sorted) {
      const idx = store.users.findIndex((x) => x.id === u.id);
      if (idx === -1) continue;
      const row = store.users[idx]!;
      if (row.dropper_tickets > 0) {
        remaining = row.dropper_tickets - 1;
        store.users[idx] = normalizeUser({ ...row, dropper_tickets: remaining });
        userId = row.id;
        break;
      }
    }
  });
  if (!userId) return { ok: false, error: "no_tickets" };
  return { ok: true, user_id: userId, tickets_remaining: remaining };
}

export function listRouletteSpinsForTgUser(tgUserId: number, limit = 20): RouletteSpinRow[] {
  return listRouletteSpins({ tgUserId, limit }).rows;
}
