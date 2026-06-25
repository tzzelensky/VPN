export type TelegramProxyType = "mtproto" | "socks5" | "http";

export type TelegramProxyStatus =
  | "unknown"
  | "available"
  | "unavailable"
  | "auth_error"
  | "timeout"
  | "checking";

export type TelegramProxyRow = {
  id: number;
  server_id: number;
  name: string;
  type: TelegramProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
  secret: string;
  auth_enabled: boolean;
  active: boolean;
  status: TelegramProxyStatus;
  last_check_at: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
  service_name: string;
  config_path: string;
  last_notified_status: TelegramProxyStatus | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type TelegramProxyCheckRow = {
  id: number;
  proxy_id: number;
  checked_at: string;
  status: TelegramProxyStatus;
  latency_ms: number | null;
  error_message: string | null;
  triggered_by: "manual" | "auto";
  notification_sent: boolean;
};

export type TelegramProxyEventRow = {
  id: number;
  proxy_id: number | null;
  server_id: number | null;
  event_type: string;
  message: string;
  created_at: string;
};

export type TelegramProxySettings = {
  auto_check_enabled: boolean;
  interval_minutes: number;
  attempts_per_check: number;
  attempt_timeout_sec: number;
  notify_on_unavailable: boolean;
  notify_on_recovery: boolean;
  notify_cooldown_minutes: number;
  last_auto_run_at: string | null;
};

export const DEFAULT_TELEGRAM_PROXY_SETTINGS: TelegramProxySettings = {
  auto_check_enabled: true,
  interval_minutes: 15,
  attempts_per_check: 2,
  attempt_timeout_sec: 8,
  notify_on_unavailable: true,
  notify_on_recovery: true,
  notify_cooldown_minutes: 30,
  last_auto_run_at: null,
};

export const TELEGRAM_PROXY_SERVICE_PREFIX = "tzadmin-proxy-";
export const TELEGRAM_PROXY_CONFIG_ROOT = "/opt/tzadmin-proxy";
export const TELEGRAM_PROXY_BIN_DIR = `${TELEGRAM_PROXY_CONFIG_ROOT}/bin`;
export const TELEGRAM_PROXY_MTG_BIN = `${TELEGRAM_PROXY_BIN_DIR}/mtg`;
export const TELEGRAM_PROXY_MTPROXY_BIN = `${TELEGRAM_PROXY_BIN_DIR}/mtproto-proxy`;
export const TELEGRAM_PROXY_3PROXY_BIN = `${TELEGRAM_PROXY_BIN_DIR}/3proxy`;

export function telegramProxyServiceName(id: number): string {
  return `${TELEGRAM_PROXY_SERVICE_PREFIX}${id}`;
}

export function telegramProxyConfigDir(id: number): string {
  return `${TELEGRAM_PROXY_CONFIG_ROOT}/${id}`;
}
