export type TriggerButtonKind = "callback" | "url";

export type TriggerButton = {
  text: string;
  kind: TriggerButtonKind;
  /** callback_data для бота, напр. pay, home, mysub */
  callback?: string;
  url?: string;
};

export type TriggerMessageVariant = {
  id: string;
  name: string;
  weight: number;
  text_html: string;
  image_data_url?: string;
  buttons: TriggerButton[];
};

export type TriggerScheduleKind =
  | "immediate"
  | "delay_minutes"
  | "days_before_expiry"
  | "days_after_expiry"
  | "days_inactive";

export type TriggerMessageStep = {
  id: string;
  name: string;
  enabled: boolean;
  schedule_kind: TriggerScheduleKind;
  /** delay_minutes | days (зависит от schedule_kind) */
  schedule_value: number;
  text_html: string;
  image_data_url?: string;
  buttons: TriggerButton[];
  variants?: TriggerMessageVariant[];
};

export type TriggerCampaignId =
  | "welcome_series"
  | "abandoned_purchase"
  | "subscription_expiry"
  | "user_return"
  | "payment_success"
  | "subscription_renewal"
  | "trial_expiry"
  | "inactivity"
  | "news"
  | "promotions"
  | "payment_error"
  | "suspicious_payment"
  | "tariff_change"
  | "device_limit";

export type TriggerAudience = "all" | "active" | "expired" | "new" | "paid" | "unpaid";

export type TriggerCampaign = {
  id: TriggerCampaignId;
  title: string;
  description: string;
  enabled: boolean;
  priority: number;
  steps: TriggerMessageStep[];
  /** для news / promotions */
  manual_audience?: TriggerAudience;
};

export type TriggerStepStats = {
  triggered: number;
  sent: number;
  delivered: number;
  clicks: number;
  payments: number;
  revenue_rub: number;
  payment_delay_ms_sum: number;
  payment_delay_count: number;
};

export type TriggerMailingsConfig = {
  /** Глобальный выключатель всех триггерных рассылок */
  globally_enabled: boolean;
  campaigns: TriggerCampaign[];
  updated_at: string;
};

export type TriggerQueueItem = {
  id: string;
  campaign_id: TriggerCampaignId;
  step_id: string;
  chain_id: string;
  tg_chat_id: number;
  tg_user_id: number;
  user_id?: number;
  scheduled_at: string;
  priority: number;
  variant_id?: string;
  meta?: Record<string, unknown>;
  sent_at?: string;
  cancelled_at?: string;
  cancel_reason?: string;
};

export type TriggerSentLog = {
  id: string;
  campaign_id: TriggerCampaignId;
  step_id: string;
  variant_id?: string;
  chain_id: string;
  tg_chat_id: number;
  tg_user_id: number;
  user_id?: number;
  sent_at: string;
  message_id?: number;
};

export type TriggerUserMeta = {
  last_activity_at?: string;
  last_trigger_sent_at?: string;
  bot_blocked?: boolean;
  has_ever_paid?: boolean;
  /** Telegram @username без «@» — снимок при /start и активности в боте. */
  tg_username?: string;
  /** chain_id -> campaign_id */
  active_chains?: Record<string, TriggerCampaignId>;
  /** ключи вида campaign:step для периодических триггеров */
  fired_keys?: Record<string, string>;
};

export type TriggerMailingsStore = {
  config: TriggerMailingsConfig;
  queue: TriggerQueueItem[];
  stats: Record<string, Record<string, TriggerStepStats>>;
  user_meta: Record<string, TriggerUserMeta>;
  sent_log: TriggerSentLog[];
  /** Версия обновления текстов по умолчанию; см. migrateTriggerCopyTexts. */
  copy_refresh_version?: number;
};

export const TRIGGER_COPY_REFRESH_VERSION = 1;

/** Цепочки, для которих при bump версии подтягиваются тексты и кнопки из дефолтов. */
export const TRIGGER_COPY_CAMPAIGN_IDS: TriggerCampaignId[] = [
  "welcome_series",
  "abandoned_purchase",
  "subscription_expiry",
  "user_return",
  "trial_expiry",
  "inactivity",
];

export const TRIGGER_MIN_GAP_MS = 6 * 60 * 60 * 1000;
export const TRIGGER_PAYMENT_ATTRIBUTION_MS = 7 * 24 * 60 * 60 * 1000;

export const TRIGGER_CAMPAIGN_PRIORITY: Record<TriggerCampaignId, number> = {
  payment_success: 10,
  payment_error: 20,
  suspicious_payment: 25,
  subscription_expiry: 30,
  abandoned_purchase: 40,
  user_return: 50,
  subscription_renewal: 55,
  tariff_change: 56,
  device_limit: 57,
  trial_expiry: 58,
  welcome_series: 60,
  inactivity: 61,
  news: 62,
  promotions: 63,
};

function btn(text: string, callback: string): TriggerButton {
  return { text, kind: "callback", callback };
}

function step(
  id: string,
  name: string,
  schedule_kind: TriggerScheduleKind,
  schedule_value: number,
  text_html: string,
  buttons: TriggerButton[] = [],
): TriggerMessageStep {
  return { id, name, enabled: true, schedule_kind, schedule_value, text_html, buttons };
}

export function defaultTriggerMailingsConfig(): TriggerMailingsConfig {
  return {
    globally_enabled: true,
    updated_at: new Date().toISOString(),
    campaigns: [
      {
        id: "welcome_series",
        title: "Приветственная серия",
        description: "Первый запуск бота — серия из 3 сообщений для новых гостей без подписки.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.welcome_series,
        steps: [
          step(
            "w1",
            "Сообщение 1",
            "immediate",
            0,
            "Рады видеть вас! 👋\n\nМы поможем подключить VPN за пару минут — быстро, просто и на всех ваших устройствах.\n\nВыберите тариф, который подойдёт именно вам. Если понадобится помощь — мы рядом.",
            [btn("Выбрать тариф", "pay")],
          ),
          step(
            "w2",
            "Сообщение 2 (+1 ч)",
            "delay_minutes",
            60,
            "Здравствуйте!\n\nНапоминаем: VPN уже готов к подключению, оформление займёт меньше минуты.\n\nБудем рады помочь, если возникнут вопросы.",
            [btn("Выбрать тариф", "pay")],
          ),
          step(
            "w3",
            "Сообщение 3 (+24 ч)",
            "delay_minutes",
            1440,
            "Добрый день!\n\nМногие подключаются именно сегодня и остаются довольны стабильной работой.\n\nПопробуйте без лишних сложностей — мы с удовольствием поможем.",
            [btn("Выбрать тариф", "pay")],
          ),
        ],
      },
      {
        id: "abandoned_purchase",
        title: "Брошенная покупка",
        description: "Пользователь открыл тарифы и начал оформление, но не оплатил.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.abandoned_purchase,
        steps: [
          step(
            "a1",
            "+15 мин",
            "delay_minutes",
            15,
            "Здравствуйте!\n\nПохоже, вы не завершили оформление — остался всего один шаг: подтвердить оплату.\n\nМы сохранили ваш выбор, продолжить можно в один клик.",
            [btn("Продолжить оплату", "pay")],
          ),
          step(
            "a2",
            "+6 ч",
            "delay_minutes",
            360,
            "Добрый день!\n\nВаш заказ всё ещё ждёт оплаты. Если что-то помешало — не переживайте, вернуться к оформлению можно в любой момент.",
            [btn("Продолжить оплату", "pay")],
          ),
          step(
            "a3",
            "+24 ч",
            "delay_minutes",
            1440,
            "Здравствуйте!\n\nМы заметили, что оплата так и не была завершена. Если VPN всё ещё актуален для вас — с радостью поможем продолжить оформление.",
            [btn("Продолжить оплату", "pay")],
          ),
        ],
      },
      {
        id: "subscription_expiry",
        title: "Окончание подписки",
        description: "Напоминания за 7/3/1 день, в день окончания, через сутки и через 3 дня после.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.subscription_expiry,
        steps: [
          step(
            "e7",
            "За 7 дней",
            "days_before_expiry",
            7,
            "Здравствуйте!\n\nНапоминаем: до окончания подписки осталось <b>7 дней</b>.\n\nПродлите заранее — так VPN не прервётся ни на минуту.",
            [btn("Продлить подписку", "pay")],
          ),
          step(
            "e3",
            "За 3 дня",
            "days_before_expiry",
            3,
            "Добрый день!\n\nЧерез <b>3 дня</b> срок подписки истечёт.\n\nРекомендуем продлить сейчас — это займёт пару минут.",
            [btn("Продлить подписку", "pay")],
          ),
          step(
            "e1",
            "За 1 день",
            "days_before_expiry",
            1,
            "Здравствуйте!\n\nЗавтра заканчивается срок вашей подписки.\n\nПродлите сегодня, чтобы оставаться на связи без перерывов.",
            [btn("Продлить подписку", "pay")],
          ),
          step(
            "e0",
            "В день окончания",
            "days_before_expiry",
            0,
            "Добрый день!\n\nСегодня — последний день действия подписки.\n\nПродлите сейчас, и VPN продолжит работать без остановки.",
            [btn("Продлить подписку", "pay")],
          ),
          step(
            "e_after1",
            "Через сутки после",
            "days_after_expiry",
            1,
            "Здравствуйте!\n\nВаша подписка завершилась вчера.\n\nБудем рады видеть вас снова — продлить можно в один клик, все настройки сохранены.",
            [btn("Продлить подписку", "pay")],
          ),
          step(
            "e_after3",
            "+3 дня после",
            "days_after_expiry",
            3,
            "Добрый день!\n\nПрошло 3 дня с момента окончания подписки.\n\nЕсли вы скучаете по стабильному VPN — мы с удовольствием поможем вернуться.",
            [btn("Продлить подписку", "pay")],
          ),
        ],
      },
      {
        id: "user_return",
        title: "Возврат пользователя",
        description: "После окончания подписки — через 3, 7 и 30 дней.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.user_return,
        steps: [
          step(
            "r3",
            "+3 дня",
            "days_after_expiry",
            3,
            "Здравствуйте!\n\nVPN сейчас отключён, но мы сохранили все ваши настройки.\n\nБудем рады видеть вас снова — продлить подписку можно в один клик.",
            [btn("Продлить подписку", "pay")],
          ),
          step(
            "r7",
            "+7 дней",
            "days_after_expiry",
            7,
            "Добрый день!\n\nМы давно вас не видели и хотели напомнить: ваш VPN ждёт возвращения.\n\nПродлите подписку — и всё снова заработает как прежде.",
            [btn("Продлить подписку", "pay")],
          ),
          step(
            "r30",
            "+30 дней",
            "days_after_expiry",
            30,
            "Здравствуйте!\n\nПрошёл месяц с момента окончания подписки.\n\nМы по-прежнему на связи и будем рады помочь вернуться — все настройки на месте.",
            [btn("Продлить подписку", "pay")],
          ),
        ],
      },
      {
        id: "payment_success",
        title: "Успешная оплата",
        description: "После подтверждения платежа администратором.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.payment_success,
        steps: [
          step(
            "ps1",
            "Подтверждение",
            "immediate",
            0,
            "✅ <b>Оплата получена.</b>\n\nПодписка успешно активирована.",
            [btn("Получить конфиг", "sub"), btn("Инструкция", "home")],
          ),
        ],
      },
      {
        id: "subscription_renewal",
        title: "Продление подписки",
        description: "После оплаты продления существующей подписки.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.subscription_renewal,
        steps: [
          step(
            "sr1",
            "Благодарность",
            "immediate",
            0,
            "Спасибо за продление!\n\nНовая дата окончания:\n\n<b>{{expiry_date}}</b>",
            [btn("Моя подписка", "sub")],
          ),
        ],
      },
      {
        id: "trial_expiry",
        title: "Пробный период",
        description: "За сутки до и после окончания бесплатного тарифа.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.trial_expiry,
        steps: [
          step(
            "t1",
            "За сутки",
            "days_before_expiry",
            1,
            "Здравствуйте!\n\nБесплатный доступ скоро завершится.\n\nЧтобы VPN не отключился, выберите подходящий тариф — мы поможем с подключением.",
            [btn("Выбрать тариф", "pay")],
          ),
          step(
            "t0",
            "После окончания",
            "days_after_expiry",
            0,
            "Добрый день!\n\nБесплатный период подошёл к концу.\n\nБудем рады продолжить работу вместе — выберите тариф и оставайтесь на связи.",
            [btn("Выбрать тариф", "pay")],
          ),
        ],
      },
      {
        id: "inactivity",
        title: "Давно не открывал бота",
        description: "Нет активности 14, 30 или 60 дней.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.inactivity,
        steps: [
          step(
            "i14",
            "14 дней",
            "days_inactive",
            14,
            "Здравствуйте!\n\nВы давно не заглядывали к нам — надеемся, у вас всё хорошо!\n\nЕсли нужен VPN или хотите продлить подписку — мы на связи и будем рады помочь.",
            [btn("Продлить подписку", "pay"), btn("Главное меню", "home")],
          ),
          step(
            "i30",
            "30 дней",
            "days_inactive",
            30,
            "Добрый день!\n\nМы заметили, что вы давно не заходили в бот.\n\nЕсли VPN снова актуален — продлите подписку или откройте меню, мы рядом.",
            [btn("Продлить подписку", "pay"), btn("Главное меню", "home")],
          ),
          step(
            "i60",
            "60 дней",
            "days_inactive",
            60,
            "Здравствуйте!\n\nПрошло уже два месяца с вашего последнего визита — мы по-прежнему работаем и будем рады вас видеть.\n\nПродлите подписку или загляните в меню, когда будет удобно.",
            [btn("Продлить подписку", "pay"), btn("Главное меню", "home")],
          ),
        ],
      },
      {
        id: "news",
        title: "Новости",
        description: "Массовая рассылка новостей по выбранной аудитории.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.news,
        manual_audience: "all",
        steps: [
          step("n1", "Сообщение", "immediate", 0, "📢 <b>Новости</b>\n\nТекст новости…", []),
        ],
      },
      {
        id: "promotions",
        title: "Акции",
        description: "Промо-рассылка со скидкой или бонусом.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.promotions,
        manual_audience: "active",
        steps: [
          step(
            "p1",
            "Акция",
            "immediate",
            0,
            "🎉 Только сегодня скидка 20%.",
            [btn("Выбрать тариф", "pay")],
          ),
        ],
      },
      {
        id: "payment_error",
        title: "Ошибка оплаты",
        description: "Администратор отклонил чек.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.payment_error,
        steps: [
          step(
            "pe1",
            "Отказ",
            "immediate",
            0,
            "К сожалению, оплата не подтверждена.\n\nПроверьте чек и отправьте ещё раз.",
            [btn("Продолжить оплату", "pay")],
          ),
        ],
      },
      {
        id: "suspicious_payment",
        title: "Подозрительный платёж",
        description: "Сумма не совпала или найден дубликат — ручная проверка.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.suspicious_payment,
        steps: [
          step(
            "sp1",
            "На проверке",
            "immediate",
            0,
            "Платёж отправлен на ручную проверку.\n\nОбычно это занимает несколько минут.",
            [btn("Главное меню", "home")],
          ),
        ],
      },
      {
        id: "tariff_change",
        title: "Изменение тарифа",
        description: "Администратор изменил подписку пользователя.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.tariff_change,
        steps: [
          step("tc1", "Обновление", "immediate", 0, "Ваш тариф был обновлён.", [btn("Моя подписка", "sub")]),
        ],
      },
      {
        id: "device_limit",
        title: "Лимит устройств",
        description: "Достигнут лимит устройств на аккаунте.",
        enabled: true,
        priority: TRIGGER_CAMPAIGN_PRIORITY.device_limit,
        steps: [
          step(
            "dl1",
            "Лимит",
            "immediate",
            0,
            "На вашем аккаунте достигнут лимит устройств.",
            [btn("Управление устройствами", "sub")],
          ),
        ],
      },
    ],
  };
}

function emptyStats(): TriggerStepStats {
  return {
    triggered: 0,
    sent: 0,
    delivered: 0,
    clicks: 0,
    payments: 0,
    revenue_rub: 0,
    payment_delay_ms_sum: 0,
    payment_delay_count: 0,
  };
}

function normButton(raw: unknown): TriggerButton | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.text ?? "").trim();
  if (!text) return null;
  const kind = o.kind === "url" ? "url" : "callback";
  if (kind === "url") {
    const url = String(o.url ?? "").trim();
    if (!url) return null;
    return { text, kind, url };
  }
  return { text, kind, callback: String(o.callback ?? "home").trim() || "home" };
}

function normVariant(raw: unknown): TriggerMessageVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const name = String(o.name ?? "").trim();
  if (!id || !name) return null;
  const buttons = Array.isArray(o.buttons) ? o.buttons.map(normButton).filter(Boolean) as TriggerButton[] : [];
  return {
    id,
    name,
    weight: Math.max(1, Math.floor(Number(o.weight) || 50)),
    text_html: String(o.text_html ?? ""),
    ...(typeof o.image_data_url === "string" && o.image_data_url.trim() ? { image_data_url: o.image_data_url.trim() } : {}),
    buttons,
  };
}

function normStep(raw: unknown, fallback?: TriggerMessageStep): TriggerMessageStep | null {
  if (!raw || typeof raw !== "object") return fallback ?? null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? fallback?.id ?? "").trim();
  if (!id) return fallback ?? null;
  const schedule_kind = (
    ["immediate", "delay_minutes", "days_before_expiry", "days_after_expiry", "days_inactive"] as const
  ).includes(o.schedule_kind as TriggerScheduleKind)
    ? (o.schedule_kind as TriggerScheduleKind)
    : (fallback?.schedule_kind ?? "immediate");
  const buttons = Array.isArray(o.buttons)
    ? o.buttons.map(normButton).filter(Boolean) as TriggerButton[]
    : (fallback?.buttons ?? []);
  const variants = Array.isArray(o.variants)
    ? o.variants.map(normVariant).filter(Boolean) as TriggerMessageVariant[]
    : fallback?.variants;
  return {
    id,
    name: String(o.name ?? fallback?.name ?? id),
    enabled: o.enabled === false ? false : (fallback?.enabled ?? true),
    schedule_kind,
    schedule_value: Number.isFinite(Number(o.schedule_value))
      ? Math.max(0, Math.floor(Number(o.schedule_value)))
      : (fallback?.schedule_value ?? 0),
    text_html: String(o.text_html ?? fallback?.text_html ?? ""),
    ...(typeof o.image_data_url === "string" && o.image_data_url.trim()
      ? { image_data_url: o.image_data_url.trim() }
      : fallback?.image_data_url
        ? { image_data_url: fallback.image_data_url }
        : {}),
    buttons,
    ...(variants?.length ? { variants } : {}),
  };
}

function normCampaign(raw: unknown, fallback: TriggerCampaign): TriggerCampaign {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const stepMap = new Map(fallback.steps.map((s) => [s.id, s]));
  const stepsRaw = Array.isArray(o.steps) ? o.steps : [];
  const steps: TriggerMessageStep[] = [];
  for (const sr of stepsRaw) {
    const fb = stepMap.get(String((sr as Record<string, unknown>).id ?? ""));
    const ns = normStep(sr, fb);
    if (ns) steps.push(ns);
  }
  for (const fb of fallback.steps) {
    if (!steps.some((s) => s.id === fb.id)) steps.push(fb);
  }
  const aud = String(o.manual_audience ?? fallback.manual_audience ?? "").trim();
  const manual_audience = (
    ["all", "active", "expired", "new", "paid", "unpaid"] as TriggerAudience[]
  ).includes(aud as TriggerAudience)
    ? (aud as TriggerAudience)
    : fallback.manual_audience;
  return {
    ...fallback,
    title: String(o.title ?? fallback.title),
    description: String(o.description ?? fallback.description),
    enabled: o.enabled === false ? false : fallback.enabled,
    priority: Number.isFinite(Number(o.priority)) ? Math.floor(Number(o.priority)) : fallback.priority,
    steps,
    ...(manual_audience ? { manual_audience } : {}),
  };
}

export function normalizeTriggerMailingsConfig(raw: unknown): TriggerMailingsConfig {
  const defaults = defaultTriggerMailingsConfig();
  if (!raw || typeof raw !== "object") return defaults;
  const o = raw as Record<string, unknown>;
  const byId = new Map(defaults.campaigns.map((c) => [c.id, c]));
  const campaigns: TriggerCampaign[] = [];
  if (Array.isArray(o.campaigns)) {
    for (const cr of o.campaigns) {
      const id = String((cr as Record<string, unknown>).id ?? "") as TriggerCampaignId;
      const fb = byId.get(id);
      if (fb) campaigns.push(normCampaign(cr, fb));
    }
  }
  for (const fb of defaults.campaigns) {
    if (!campaigns.some((c) => c.id === fb.id)) campaigns.push(fb);
  }
  return {
    globally_enabled: o.globally_enabled === false ? false : true,
    campaigns,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : new Date().toISOString(),
  };
}

export function normalizeTriggerMailingsStore(raw: unknown): TriggerMailingsStore {
  const defaults = defaultTriggerMailingsConfig();
  if (!raw || typeof raw !== "object") {
    return { config: defaults, queue: [], stats: {}, user_meta: {}, sent_log: [] };
  }
  const o = raw as Record<string, unknown>;
  const config = normalizeTriggerMailingsConfig(o.config ?? defaults);
  const queue = Array.isArray(o.queue) ? (o.queue as TriggerQueueItem[]) : [];
  const stats = (o.stats && typeof o.stats === "object" ? o.stats : {}) as TriggerMailingsStore["stats"];
  const user_meta = (o.user_meta && typeof o.user_meta === "object" ? o.user_meta : {}) as TriggerMailingsStore["user_meta"];
  const sent_log = Array.isArray(o.sent_log) ? (o.sent_log as TriggerSentLog[]) : [];
  const copy_refresh_version = Number.isFinite(Number(o.copy_refresh_version))
    ? Math.floor(Number(o.copy_refresh_version))
    : undefined;
  for (const c of config.campaigns) {
    if (!stats[c.id]) stats[c.id] = {};
    for (const s of c.steps) {
      if (!stats[c.id]![s.id]) stats[c.id]![s.id] = emptyStats();
      if (s.variants) {
        for (const v of s.variants) {
          const vk = `${s.id}__${v.id}`;
          if (!stats[c.id]![vk]) stats[c.id]![vk] = emptyStats();
        }
      }
    }
  }
  return { config, queue, stats, user_meta, sent_log, ...(copy_refresh_version != null ? { copy_refresh_version } : {}) };
}

export function statsKey(stepId: string, variantId?: string): string {
  return variantId ? `${stepId}__${variantId}` : stepId;
}
