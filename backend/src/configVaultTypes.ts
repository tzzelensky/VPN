export type VlessCheckStatus = "available" | "unavailable" | "unstable" | "never" | "checking";

export type VlessKeyRow = {
  id: number;
  name: string;
  raw_uri: string;
  masked_uri: string;
  active: boolean;
  added_to_subscriptions: boolean;
  last_check_at: string | null;
  last_check_status: VlessCheckStatus;
  last_check_latency_ms: number | null;
  last_error: string | null;
  unavailable_since: string | null;
  notify_on_fail: boolean;
  /** Для антиспама Telegram: последний уведомлённый статус. */
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

export type VlessKeyCheckRow = {
  id: number;
  key_id: number;
  checked_at: string;
  attempts_total: number;
  attempts_success: number;
  attempts_failed: number;
  avg_latency_ms: number | null;
  min_latency_ms: number | null;
  max_latency_ms: number | null;
  status: "available" | "unavailable" | "unstable";
  error_message: string | null;
  triggered_by: "manual" | "auto";
  notification_sent: boolean;
};

export type ConfigVaultSettings = {
  auto_check_enabled: boolean;
  interval_minutes: number;
  attempts_per_check: number;
  attempt_timeout_sec: number;
  test_url: string;
  notify_on_unavailable: boolean;
  notify_on_recovery: boolean;
  notify_cooldown_minutes: number;
  last_auto_run_at: string | null;
};

export const DEFAULT_CONFIG_VAULT_SETTINGS: ConfigVaultSettings = {
  auto_check_enabled: false,
  interval_minutes: 15,
  attempts_per_check: 5,
  attempt_timeout_sec: 8,
  test_url: "https://www.google.com/generate_204",
  notify_on_unavailable: true,
  notify_on_recovery: true,
  notify_cooldown_minutes: 45,
  last_auto_run_at: null,
};
