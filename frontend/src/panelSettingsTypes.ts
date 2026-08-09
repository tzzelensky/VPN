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
    subscriptionBanner: PanelSubscriptionBanner;
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
