export type PanelTheme = "system" | "light" | "dark";
export type PanelAccent = "blue" | "green" | "purple" | "orange" | "red" | string;

export type PanelSectionKey =
  | "servers"
  | "users"
  | "logs"
  | "experiments"
  | "subscription_shop"
  | "communications"
  | "support_appeals"
  | "referral_program"
  | "promo_codes"
  | "config_vault"
  | "whitelist_vault"
  | "dropper_game";

export type PanelSettings = {
  panel: {
    title: string;
    subtitle: string;
    avatarPath: string | null;
    brandName: string;
    telegramFooter: string;
  };
  ui: {
    theme: PanelTheme;
    accentColor: PanelAccent;
    compactMode: boolean;
    showHints: boolean;
    timezone: string;
  };
  sections: Record<PanelSectionKey, boolean>;
  /** Порядок пунктов меню (перетаскивание в настройках «Разделы»). */
  sectionOrder: PanelSectionKey[];
  telegram: {
    adminIds: number[];
    notifyNewUsers: boolean;
    notifySurveyResponses: boolean;
    notifyBroadcastErrors: boolean;
    notifyServerErrors: boolean;
    testMode: boolean;
  };
  security: {
    maskSecrets: boolean;
    confirmDangerousActions: boolean;
    autoLogoutMinutes: number | null;
    showDiagnosticDetails: boolean;
  };
  maintenance: {
    enabled: boolean;
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
  { key: "experiments", path: "/experiments", label: "Эксперименты", description: "Тестовые конфигурации" },
  { key: "subscription_shop", path: "/subscription-shop", label: "Подписки", description: "Тарифы и магазин" },
  { key: "communications", path: "/communications", label: "Коммуникации", description: "Рассылки и опросы" },
  { key: "support_appeals", path: "/support-appeals", label: "Обращения", description: "Обращения в поддержку" },
  { key: "referral_program", path: "/referral-program", label: "Реферальная программа", description: "Рефералы и награды" },
  { key: "promo_codes", path: "/promo-codes", label: "Промокоды", description: "Скидки и промокоды" },
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
  { key: "dropper_game", path: "/dropper-game", label: "Игра", description: "Мини-игра в боте" },
];

export const DEFAULT_SECTION_ORDER: PanelSectionKey[] = PANEL_SECTION_META.map((s) => s.key);

export function normalizeSectionOrder(raw: unknown): PanelSectionKey[] {
  const all = DEFAULT_SECTION_ORDER;
  if (!Array.isArray(raw)) return [...all];
  const seen = new Set<PanelSectionKey>();
  const out: PanelSectionKey[] = [];
  for (const item of raw) {
    const k = String(item).trim() as PanelSectionKey;
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

export function defaultPanelSettings(): PanelSettings {
  const sections = {} as Record<PanelSectionKey, boolean>;
  for (const s of PANEL_SECTION_META) sections[s.key] = true;
  return {
    panel: {
      title: "Панель управления",
      subtitle: "Управление пользователями, коммуникациями и сервисами",
      avatarPath: null,
      brandName: "HSN",
      telegramFooter: "",
    },
    ui: {
      theme: "system",
      accentColor: "blue",
      compactMode: false,
      showHints: true,
      timezone: "Europe/Moscow",
    },
    sections,
    sectionOrder: [...DEFAULT_SECTION_ORDER],
    telegram: {
      adminIds: [],
      notifyNewUsers: false,
      notifySurveyResponses: true,
      notifyBroadcastErrors: true,
      notifyServerErrors: true,
      testMode: false,
    },
    security: {
      maskSecrets: true,
      confirmDangerousActions: true,
      autoLogoutMinutes: null,
      showDiagnosticDetails: true,
    },
    maintenance: { enabled: false },
    updatedAt: Date.now(),
  };
}
