import type { TelegramColoredButtonKey } from "./telegram/inlineButtonStyles.js";
import { DEFAULT_TELEGRAM_BUTTON_COLORS } from "./telegram/inlineButtonStyles.js";

export type PanelTheme = "system" | "light" | "dark";
export type PanelAccent = "blue" | "green" | "purple" | "orange" | "red" | string;

export type PanelSectionKey =
  | "servers"
  | "users"
  | "logs"
  | "subscription_shop"
  | "communications"
  | "support_appeals"
  | "referral_program"
  | "promo_codes"
  | "config_vault"
  | "whitelist_vault"
  | "telegram_proxies"
  | "roulette_game"
  | "device_limit"
  | "daily_gift";

export type PanelSubscriptionBanner = {
  enabled: boolean;
  text: string;
  /** Текст в Happ только для подписок с подключёнными белыми списками. */
  whitelistText: string;
  telegramUrl: string;
  telegramLinkText: string;
};

/** Публичная HTML-витрина (ДомКомфорт и аналоги) для браузеров на /goods|/sub. */
export type PanelDecoyShopItem = {
  name: string;
  description: string;
  price: string;
};

export type PanelDecoyShop = {
  title: string;
  brand: string;
  tagline: string;
  intro: string[];
  items: PanelDecoyShopItem[];
  note: string;
  footer: string;
};

export type TelegramButtonColors = Record<TelegramColoredButtonKey, string>;

export type PanelSettings = {
  panel: {
    title: string;
    subtitle: string;
    avatarPath: string | null;
    brandName: string;
    telegramFooter: string;
    /** Ключевое слово «отзыва» на витрине → переход на /login (мобильная кнопка). */
    shopReviewKeyword: string;
    subscriptionBanner: PanelSubscriptionBanner;
    decoyShop: PanelDecoyShop;
  };
  ui: {
    theme: PanelTheme;
    accentColor: PanelAccent;
    compactMode: boolean;
    showHints: boolean;
    timezone: string;
    /** Новый дизайн Telegram Mini App для пользователей. */
    webAppNewDesign: boolean;
    /** Показывать функционал «Превью WebApp» в админ-панели. */
    webAppPreviewEnabled: boolean;
  };
  sections: Record<PanelSectionKey, boolean>;
  /** Порядок пунктов меню (перетаскивание в настройках «Разделы»). */
  sectionOrder: PanelSectionKey[];
  telegram: {
    adminIds: number[];
    adminClientsButtonEnabled: boolean;
    notifyNewUsers: boolean;
    notifySurveyResponses: boolean;
    notifyBroadcastErrors: boolean;
    notifyServerErrors: boolean;
    testMode: boolean;
    /** Код входа в панель через Telegram (по умолчанию включено). */
    login2faEnabled: boolean;
    /** Вход в мобильную админку из Telegram WebApp (5 тапов по аватарке, только Admin ID). */
    webAppAdminPanelEnabled: boolean;
    /** HEX цвета кнопок бота (в API — primary / success / danger). */
    buttonColors: TelegramButtonColors;
    /** Показывать кнопку «Спросить AI» в боте (нужен ещё Gemini API key). */
    aiAssistantEnabled: boolean;
    /** Модель Gemini, например gemini-2.5-flash-lite. */
    geminiModel: string;
  };
  security: {
    maskSecrets: boolean;
    confirmDangerousActions: boolean;
    autoLogoutMinutes: number | null;
    showDiagnosticDetails: boolean;
    /** Регулировка потраченных ГБ слайдером на странице пользователей. */
    manualTrafficAdjust: boolean;
    /** Секретный URL-сегмент → страница входа (латиница, цифры, символы; без /). */
    panelAccessPath: string;
  };
  maintenance: {
    enabled: boolean;
  };
  /** Порядок элементов подписки в VPN-клиенте. */
  vpnDisplay: {
    /** @deprecated Миграция → entryOrder (только vless-id). */
    serverOrder: number[];
    /** vless:1 | hy2:1 | trojan:1 | vault:5 | whitelist:3 */
    entryOrder: string[];
  };
  updatedAt: number;
};

export const PANEL_SECTION_META: Array<{
  key: PanelSectionKey;
  path: string;
  label: string;
  description: string;
}> = [
  { key: "servers", path: "/servers", label: "Сервера", description: "Управление VPN-узлами" },
  { key: "users", path: "/users", label: "Пользователи", description: "Клиенты и подписки" },
  { key: "logs", path: "/logs", label: "Логи", description: "Логи Xray и диагностика" },
  { key: "subscription_shop", path: "/subscription-shop", label: "Подписки", description: "Тарифы и магазин" },
  { key: "communications", path: "/communications", label: "Коммуникации", description: "Рассылки и опросы" },
  { key: "support_appeals", path: "/support-appeals", label: "Обращения", description: "Обращения в поддержку" },
  { key: "referral_program", path: "/referral-program", label: "Реферальная программа", description: "Рефералы и награды" },
  { key: "promo_codes", path: "/promo-codes", label: "Промоакции", description: "Промокоды и очередь скидок" },
  {
    key: "config_vault",
    path: "/config-vault",
    label: "Конфиг-хранилище",
    description: "VLESS-ключи, подписки и проверка доступности",
  },
  {
    key: "whitelist_vault",
    path: "/whitelist-vault",
    label: "Белые списки",
    description: "VLESS-ключи белых списков, назначение и проверка",
  },
  {
    key: "telegram_proxies",
    path: "/telegram-proxies",
    label: "Прокси",
    description: "Развертывание и управление прокси для Telegram на добавленных серверах",
  },
  { key: "roulette_game", path: "/roulette-game", label: "Рулетка", description: "Рулетка, билеты и отчёты в WebApp" },
  {
    key: "device_limit",
    path: "/device-limit",
    label: "Ограничение по устройствам",
    description: "Лимиты устройств, докупка мест и журнал",
  },
  {
    key: "daily_gift",
    path: "/daily-gift",
    label: "Ежедневный подарок",
    description: "Ежедневные награды и напоминания в WebApp",
  },
];

export const DEFAULT_SECTION_ORDER: PanelSectionKey[] = PANEL_SECTION_META.map((s) => s.key);

export const DEFAULT_DECOY_SHOP: PanelDecoyShop = {
  title: "ДомКомфорт — подушки и текстиль для сна",
  brand: "ДомКомфорт",
  tagline: "Подушки, одеяла, наволочки — мягкий сон без лишнего шума",
  intro: [
    "Мы подбираем наполнители и ткани так, чтобы вам было удобно читать, отдыхать и засыпать в тишине своей спальни.",
    "В каталоге — ортопедические и декоративные подушки, комплекты постельного белья, пледы.",
  ],
  items: [
    { name: "Подушка «Облако»", description: "Мягкий холлофайбер, чехол из сатина", price: "от 1 890 ₽" },
    { name: "Одеяло «Тишина»", description: "Лёгкое всесезонное, микрофибра", price: "от 3 450 ₽" },
    { name: "Наволочки 50×70", description: "Комплект из двух, хлопок", price: "от 990 ₽" },
    { name: "Плед «Вечер»", description: "Фланель, тёплый оттенок льна", price: "от 2 290 ₽" },
  ],
  note: "Оставайтесь на связи — готовим новые позиции коллекции.",
  footer: "© ДомКомфорт · доставка по России",
};

export function normalizeDecoyShop(raw: unknown): PanelDecoyShop {
  const base = DEFAULT_DECOY_SHOP;
  if (!raw || typeof raw !== "object") return { ...base, intro: [...base.intro], items: base.items.map((i) => ({ ...i })) };
  const o = raw as Record<string, unknown>;
  const intro = Array.isArray(o.intro)
    ? o.intro.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 6)
    : [...base.intro];
  const itemsRaw = Array.isArray(o.items) ? o.items : base.items;
  const items: PanelDecoyShopItem[] = itemsRaw
    .slice(0, 8)
    .map((it) => {
      const row = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
      return {
        name: String(row.name ?? "").trim().slice(0, 80) || "Товар",
        description: String(row.description ?? "").trim().slice(0, 160),
        price: String(row.price ?? "").trim().slice(0, 40),
      };
    })
    .filter((i) => i.name);
  return {
    title: String(o.title ?? base.title).trim().slice(0, 120) || base.title,
    brand: String(o.brand ?? base.brand).trim().slice(0, 80) || base.brand,
    tagline: String(o.tagline ?? base.tagline).trim().slice(0, 160) || base.tagline,
    intro: intro.length > 0 ? intro : [...base.intro],
    items: items.length > 0 ? items : base.items.map((i) => ({ ...i })),
    note: String(o.note ?? base.note).trim().slice(0, 200),
    footer: String(o.footer ?? base.footer).trim().slice(0, 120) || base.footer,
  };
}

export function normalizeSectionOrder(raw: unknown): PanelSectionKey[] {
  const all = DEFAULT_SECTION_ORDER;
  if (!Array.isArray(raw)) return [...all];
  const seen = new Set<PanelSectionKey>();
  const out: PanelSectionKey[] = [];
  for (const item of raw) {
    let key = String(item).trim();
    if (key === "dropper_game") key = "roulette_game";
    const k = key as PanelSectionKey;
    if (!all.includes(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  for (const k of all) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

export function orderPanelSectionMeta(order: PanelSectionKey[]): Array<(typeof PANEL_SECTION_META)[number]> {
  const byKey = new Map(PANEL_SECTION_META.map((m) => [m.key, m]));
  return order.map((k) => byKey.get(k)).filter((m): m is (typeof PANEL_SECTION_META)[number] => m != null);
}

/** Нормализация порядка VPN-серверов: известные id из order, затем недостающие по возрастанию id. */
export function normalizeVpnServerOrder(order: unknown, deployedIds: number[]): number[] {
  const valid = new Set(deployedIds);
  const seen = new Set<number>();
  const out: number[] = [];
  if (Array.isArray(order)) {
    for (const x of order) {
      const id = Math.floor(Number(x));
      if (!Number.isFinite(id) || id <= 0 || !valid.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  const rest = deployedIds.filter((id) => !seen.has(id)).sort((a, b) => a - b);
  return [...out, ...rest];
}

/** Переставить выбранные id пользователя под эталонный порядок (состав сохраняется). */
export function reorderIdsByTemplate(userIds: number[], templateOrder: number[]): number[] {
  const set = new Set(userIds);
  const head = templateOrder.filter((id) => set.has(id));
  const headSet = new Set(head);
  const tail = userIds.filter((id) => !headSet.has(id));
  return [...head, ...tail];
}

export function defaultPanelSettings(): PanelSettings {
  const sections = {} as Record<PanelSectionKey, boolean>;
  for (const s of PANEL_SECTION_META) sections[s.key] = true;
  return {
    panel: {
      title: "Панель управления",
      subtitle: "Управление пользователями, коммуникациями и сервисами",
      avatarPath: null,
      brandName: "",
      telegramFooter: "",
      shopReviewKeyword: "",
      subscriptionBanner: {
        enabled: false,
        text: "",
        whitelistText: "",
        telegramUrl: "",
        telegramLinkText: "тех. поддержку",
      },
      decoyShop: {
        ...DEFAULT_DECOY_SHOP,
        intro: [...DEFAULT_DECOY_SHOP.intro],
        items: DEFAULT_DECOY_SHOP.items.map((i) => ({ ...i })),
      },
    },
    ui: {
      theme: "system",
      accentColor: "blue",
      compactMode: false,
      showHints: true,
      timezone: "Asia/Yekaterinburg",
      webAppNewDesign: false,
      webAppPreviewEnabled: true,
    },
    sections,
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    telegram: {
      adminIds: [],
      adminClientsButtonEnabled: true,
      notifyNewUsers: false,
      notifySurveyResponses: true,
      notifyBroadcastErrors: true,
      notifyServerErrors: true,
      testMode: false,
      login2faEnabled: false,
      webAppAdminPanelEnabled: true,
      buttonColors: { ...DEFAULT_TELEGRAM_BUTTON_COLORS },
      aiAssistantEnabled: true,
      geminiModel: "gemini-2.5-flash-lite",
    },
    security: {
      maskSecrets: true,
      confirmDangerousActions: true,
      autoLogoutMinutes: null,
      showDiagnosticDetails: true,
      manualTrafficAdjust: false,
      panelAccessPath: "",
    },
    maintenance: { enabled: false },
    vpnDisplay: { serverOrder: [], entryOrder: [] },
    updatedAt: Date.now(),
  };
}
