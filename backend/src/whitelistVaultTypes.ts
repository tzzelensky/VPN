import type { VlessCheckStatus, VlessKeyCheckRow } from "./configVaultTypes.js";

export type WhitelistSourceType = "manual_vless" | "json_import";
export type WhitelistAssignmentMode = "none" | "all" | "selected" | "purchasers";

export type WhitelistSaleDuration = "subscription_end" | "30_days" | "forever";

export type WhitelistPurchaseSettings = {
  /** Продажа белых списков включена (только при глобальном enabled). */
  sale_enabled: boolean;
  price_rub: number;
  duration: WhitelistSaleDuration;
  miniapp_description: string;
  bot_description: string;
  /** Выдавать ключи со статусом «недоступен». */
  issue_unavailable_keys: boolean;
};

export type WhitelistInstructionSettings = {
  title: string;
  text: string;
  photo_path: string | null;
};

export type WhiteListPurchaseStatus = "pending" | "paid" | "failed" | "refunded";

export type WhiteListPurchaseRow = {
  id: string;
  user_id: number;
  user_name: string;
  tg_id: string;
  payment_id: string;
  amount: number;
  status: WhiteListPurchaseStatus;
  activated_at: string | null;
  expires_at: string | null;
  instruction_sent: boolean;
  instruction_error: string | null;
  activation_error: string | null;
  created_at: string;
  updated_at: string;
};

export type WhitelistSubscriptionSnapshot = {
  include_in_sale: boolean;
  assignment_mode: WhitelistAssignmentMode;
  assigned_user_ids: number[];
};

export type WhitelistGroupRow = {
  id: number;
  name: string;
  /** Убирать ключи группы из подписок при недоступности (общая настройка). */
  remove_on_unavailable: boolean;
  /** Сколько подряд неудачных проверок до снятия с подписок. */
  checks_before_remove: number;
  created_at: string;
  updated_at: string;
};

export type WhitelistKeyRow = {
  id: number;
  name: string;
  raw_uri: string;
  masked_uri: string;
  source_type: WhitelistSourceType;
  /**
   * Полный клиентский JSON (Happ/Xray profile) — для подписки Happ отдаём его as-is,
   * иначе routing/xhttp.extra теряются в vless://.
   */
  client_json: string | null;
  active: boolean;
  /** Включать ключ в продажу (покупателям). */
  include_in_sale: boolean;
  assignment_mode: WhitelistAssignmentMode;
  assigned_user_ids: number[];
  last_check_at: string | null;
  last_check_status: VlessCheckStatus;
  last_check_latency_ms: number | null;
  last_error: string | null;
  unavailable_since: string | null;
  notify_on_fail: boolean;
  /** Группа конфигов (null — отдельный ключ). */
  group_id: number | null;
  /** Для ключей вне группы: убирать из подписок при недоступности. */
  remove_on_unavailable: boolean;
  /** Для ключей вне группы: число проверок до снятия. */
  checks_before_remove: number;
  /** Подряд неудачных проверок (счётчик). */
  consecutive_unavailable_checks: number;
  /** Автоматически снят с подписок из-за недоступности. */
  removed_from_subscriptions: boolean;
  /** Снят администратором вручную — не возвращать автоматически при доступности. */
  removed_manually: boolean;
  removed_at: string | null;
  /** Снимок назначения до авто-снятия (для восстановления). */
  subscription_restore_snapshot: WhitelistSubscriptionSnapshot | null;
  last_notified_status: VlessCheckStatus | null;
  last_notify_at: string | null;
  parsed_address: string;
  parsed_port: number;
  parsed_uuid: string;
  parsed_network: string;
  parsed_security: string;
  parsed_flow: string;
  parsed_sni: string;
  parsed_fingerprint: string;
  parsed_public_key: string;
  parsed_short_id: string;
  created_at: string;
  updated_at: string;
};

export type WhitelistVaultSettings = {
  /** Глобальный switch «Белые списки включены». */
  enabled: boolean;
  auto_check_enabled: boolean;
  interval_minutes: number;
  attempts_per_check: number;
  attempt_timeout_sec: number;
  test_url: string;
  notify_on_unavailable: boolean;
  notify_cooldown_minutes: number;
  last_auto_run_at: string | null;
  purchase: WhitelistPurchaseSettings;
  instruction: WhitelistInstructionSettings;
};

export const DEFAULT_WHITELIST_INSTRUCTION: WhitelistInstructionSettings = {
  title: "Как обновить подписку",
  text:
    "Чтобы белые списки появились в приложении:\n\n" +
    "1. Откройте приложение VPN.\n" +
    "2. Перейдите в раздел подписки.\n" +
    "3. Нажмите «Обновить подписку».\n" +
    "4. Дождитесь загрузки новых ключей.\n" +
    "5. Переподключите VPN.",
  photo_path: null,
};

export const DEFAULT_WHITELIST_PURCHASE: WhitelistPurchaseSettings = {
  sale_enabled: false,
  price_rub: 0,
  duration: "subscription_end",
  miniapp_description: "Дополнительные VLESS-ключи для доступа к ресурсам из белого списка.",
  bot_description:
    "Белые списки — это дополнительный набор VLESS-ключей, который можно добавить к вашей подписке.",
  issue_unavailable_keys: false,
};

export const DEFAULT_WHITELIST_VAULT_SETTINGS: WhitelistVaultSettings = {
  enabled: false,
  auto_check_enabled: false,
  interval_minutes: 15,
  attempts_per_check: 5,
  attempt_timeout_sec: 8,
  test_url: "https://www.google.com/generate_204",
  notify_on_unavailable: true,
  notify_cooldown_minutes: 45,
  last_auto_run_at: null,
  purchase: { ...DEFAULT_WHITELIST_PURCHASE },
  instruction: { ...DEFAULT_WHITELIST_INSTRUCTION },
};

export type { VlessKeyCheckRow as WhitelistKeyCheckRow };
