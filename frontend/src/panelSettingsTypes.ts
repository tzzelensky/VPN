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
  | "telegram_proxies"
  | "dropper_game"
  | "device_limit"
  | "daily_gift";

export type PanelSubscriptionBanner = {
  enabled: boolean;
  text: string;
  telegramUrl: string;
  telegramLinkText: string;
};

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
  };
  security: {
    maskSecrets: boolean;
    confirmDangerousActions: boolean;
    autoLogoutMinutes: number | null;
    showDiagnosticDetails: boolean;
  };
  maintenance: { enabled: boolean };
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
    adminIds: number[];
  };
  avatarUrl: string | null;
};
