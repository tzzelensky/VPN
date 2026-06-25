export type AutoTrafficNotifyConfig = {
  enabled: boolean;
  /** Остаток трафика (ГБ), ниже которого отправляется предупреждение. */
  low_gb_threshold: number;
  /** Интервал проверки, минуты. */
  interval_minutes: number;
  skip_test_subscriptions: boolean;
  low_message: string;
  empty_message: string;
  source_label_low: string;
  source_label_empty: string;
};

export type AutoExpiryNotifyConfig = {
  enabled: boolean;
  /** За сколько суток до окончания слать напоминание. */
  days_before: number;
  /** Устаревшее поле — проверка идёт каждую минуту, отправка в notify_hour:notify_minute. */
  interval_minutes: number;
  /** Время ежедневной отправки (часовой пояс панели, по умолчанию Екатеринбург). */
  notify_hour: number;
  notify_minute: number;
  skip_test_subscriptions: boolean;
  warn_same_day_message: string;
  warn_days_message: string;
  expired_message: string;
  source_label_warn: string;
  source_label_expired: string;
};

export type AutoCommunicationsConfig = {
  traffic: AutoTrafficNotifyConfig;
  expiry: AutoExpiryNotifyConfig;
  updated_at: string;
};

export function defaultAutoTrafficNotifyConfig(): AutoTrafficNotifyConfig {
  return {
    enabled: true,
    low_gb_threshold: 30,
    interval_minutes: 10,
    skip_test_subscriptions: true,
    low_message:
      "<b>Внимание: трафик почти закончился.</b>\n\n" +
      "Подписка: <b>{subscription}</b>\n" +
      "У вас осталось примерно <b>{remaining_gb}</b> (меньше {threshold_gb} ГБ).\n\n" +
      "Чтобы не потерять доступ, докупите пакет трафика.",
    empty_message:
      "<b>Трафик закончился.</b>\n\n" +
      "Подписка: <b>{subscription}</b>\n" +
      "Лимит по подписке исчерпан, доступ может быть ограничен.\n\n" +
      "Нажмите «Докупить ГБ», чтобы сразу пополнить баланс.",
    source_label_low: "Авто: мало трафика (<{threshold_gb} ГБ)",
    source_label_empty: "Авто: трафик закончился",
  };
}

export function defaultAutoExpiryNotifyConfig(): AutoExpiryNotifyConfig {
  return {
    enabled: true,
    days_before: 3,
    interval_minutes: 15,
    notify_hour: 12,
    notify_minute: 0,
    skip_test_subscriptions: true,
    warn_same_day_message:
      "<b>Подписка «{subscription}» заканчивается уже сегодня!</b>\n\n" +
      "Для продолжения пользования подпиской оплатите её.",
    warn_days_message:
      "<b>Подписка «{subscription}» заканчивается</b> {days_phrase}.\n\n" +
      "Для продолжения пользования подпиской <b>оплатите</b> её.",
    expired_message:
      "<b>Подписка «{subscription}» истекла.</b>\n\n" +
      "Продлите подписку, чтобы продолжить пользоваться сервисом.",
    source_label_warn: "Авто: срок подписки (≤{days_before} дн.)",
    source_label_expired: "Авто: подписка истекла",
  };
}

export function defaultAutoCommunicationsConfig(): AutoCommunicationsConfig {
  return {
    traffic: defaultAutoTrafficNotifyConfig(),
    expiry: defaultAutoExpiryNotifyConfig(),
    updated_at: new Date().toISOString(),
  };
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normStr(raw: unknown, fallback: string, maxLen: number): string {
  const s = String(raw ?? "").trim();
  if (!s) return fallback;
  return s.slice(0, maxLen);
}

export function normalizeAutoTrafficNotifyConfig(raw: unknown): AutoTrafficNotifyConfig {
  const d = defaultAutoTrafficNotifyConfig();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled !== false,
    low_gb_threshold: clampInt(o.low_gb_threshold, 1, 500, d.low_gb_threshold),
    interval_minutes: clampInt(o.interval_minutes, 1, 1440, d.interval_minutes),
    skip_test_subscriptions: o.skip_test_subscriptions !== false,
    low_message: normStr(o.low_message, d.low_message, 4000),
    empty_message: normStr(o.empty_message, d.empty_message, 4000),
    source_label_low: normStr(o.source_label_low, d.source_label_low, 160),
    source_label_empty: normStr(o.source_label_empty, d.source_label_empty, 160),
  };
}

export function normalizeAutoExpiryNotifyConfig(raw: unknown): AutoExpiryNotifyConfig {
  const d = defaultAutoExpiryNotifyConfig();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled !== false,
    days_before: clampInt(o.days_before, 1, 30, d.days_before),
    interval_minutes: clampInt(o.interval_minutes, 1, 1440, d.interval_minutes),
    notify_hour: clampInt(o.notify_hour, 0, 23, d.notify_hour),
    notify_minute: clampInt(o.notify_minute, 0, 59, d.notify_minute),
    skip_test_subscriptions: o.skip_test_subscriptions !== false,
    warn_same_day_message: normStr(o.warn_same_day_message, d.warn_same_day_message, 4000),
    warn_days_message: normStr(o.warn_days_message, d.warn_days_message, 4000),
    expired_message: normStr(o.expired_message, d.expired_message, 4000),
    source_label_warn: normStr(o.source_label_warn, d.source_label_warn, 160),
    source_label_expired: normStr(o.source_label_expired, d.source_label_expired, 160),
  };
}

export function normalizeAutoCommunicationsConfig(raw: unknown): AutoCommunicationsConfig {
  const d = defaultAutoCommunicationsConfig();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  return {
    traffic: normalizeAutoTrafficNotifyConfig(o.traffic),
    expiry: normalizeAutoExpiryNotifyConfig(o.expiry),
    updated_at: String(o.updated_at ?? d.updated_at),
  };
}

export function fillAutoMessageTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}
