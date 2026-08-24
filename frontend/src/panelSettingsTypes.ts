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

export type TelegramButtonColors = Record<
  | "menuHome"
  | "menuSubscription"
  | "menuPay"
  | "menuBuyGb"
  | "menuBuyDevice"
  | "menuAdminClients"
  | "deleteSubscription"
  | "createNewSubscription"
  | "pickSubscription"
  | "comboOffer"
  | "applyPromo"
  | "buyWhitelist"
  | "sendAppeal"
  | "askAi"
  | "inviteFriend",
  string
>;

export type PanelSettings = {
  panel: {
    title: string;
    subtitle: string;
    avatarPath: string | null;
    brandName: string;
    telegramFooter: string;
    /** Ключевое слово «отзыва» на витрине → /login (только мобильная кнопка). */
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
    webAppNewDesign: boolean;
    /** Показывать функционал «Превью WebApp» в админ-панели. */
    webAppPreviewEnabled: boolean;
  };
  sections: Record<PanelSectionKey, boolean>;
  sectionOrder: PanelSectionKey[];
  telegram: {
    adminIds: number[];
    adminClientsButtonEnabled: boolean;
    notifyNewUsers: boolean;
    notifySurveyResponses: boolean;
    notifyBroadcastErrors: boolean;
    notifyServerErrors: boolean;
    testMode: boolean;
    login2faEnabled: boolean;
    /** Вход в мобильную админку из Telegram WebApp (5 тапов по аватарке, только Admin ID). */
    webAppAdminPanelEnabled: boolean;
    buttonColors: TelegramButtonColors;
    aiAssistantEnabled: boolean;
    geminiModel: string;
  };
  security: {
    maskSecrets: boolean;
    confirmDangerousActions: boolean;
    autoLogoutMinutes: number | null;
    showDiagnosticDetails: boolean;
    /** Регулировка потраченных ГБ слайдером на странице пользователей. */
    manualTrafficAdjust: boolean;
  };
  maintenance: { enabled: boolean };
  vpnDisplay: {
    serverOrder: number[];
    entryOrder: string[];
  };
  updatedAt: number;
};

export type PanelSectionMeta = {
  key: PanelSectionKey;
  path: string;
  label: string;
  description: string;
};

export type PanelSettingsResponse = {
  settings: PanelSettings;
  meta: { sections: PanelSectionMeta[] };
  telegram: {
    botTokenConfigured: boolean;
    botTokenMasked: string;
    geminiApiKeyConfigured: boolean;
    geminiApiKeyMasked: string;
    adminIds: number[];
  };
  avatarUrl: string | null;
};
