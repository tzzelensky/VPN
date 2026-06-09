import type { PanelSectionKey, PanelSectionMeta, PanelSettings } from "./panelSettingsTypes";

export const PANEL_NAV_SECTIONS: PanelSectionMeta[] = [
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
    description: "VLESS/Trojan/Hysteria2, подписки и проверка",
  },
  {
    key: "whitelist_vault",
    path: "/whitelist-vault",
    label: "Белые списки",
    description: "VLESS-ключи белых списков, назначение и проверка",
  },
  { key: "dropper_game", path: "/dropper-game", label: "Игра", description: "Мини-игра в боте" },
];

const PATH_TO_KEY: Record<string, PanelSectionKey> = {
  "/servers": "servers",
  "/users": "users",
  "/logs": "logs",
  "/experiments": "experiments",
  "/subscription-shop": "subscription_shop",
  "/communications": "communications",
  "/support-appeals": "support_appeals",
  "/referral-program": "referral_program",
  "/promo-codes": "promo_codes",
  "/config-vault": "config_vault",
  "/whitelist-vault": "whitelist_vault",
  "/dropper-game": "dropper_game",
};

function normPath(path: string): string {
  return path.replace(/\/$/, "") || path;
}

export function normalizeSectionOrder(raw: unknown): PanelSectionKey[] {
  const all = PANEL_NAV_SECTIONS.map((s) => s.key);
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

export function orderSectionsMeta(meta: PanelSectionMeta[], order?: PanelSectionKey[]): PanelSectionMeta[] {
  const norm = normalizeSectionOrder(order ?? meta.map((m) => m.key));
  const byKey = new Map(meta.map((m) => [m.key, m]));
  return norm.map((k) => byKey.get(k)).filter((m): m is PanelSectionMeta => m != null);
}

export function getFirstVisiblePath(
  settings: PanelSettings | null | undefined,
  meta: PanelSectionMeta[],
): string {
  const list = meta.length > 0 ? meta : PANEL_NAV_SECTIONS;
  if (!settings) return list[0]?.path ?? "/servers";
  for (const s of list) {
    if (settings.sections[s.key] !== false) return s.path;
  }
  return list[0]?.path ?? "/servers";
}

export function isSectionPathVisible(
  path: string,
  settings: PanelSettings | null | undefined,
  meta: PanelSectionMeta[],
): boolean {
  if (!settings) return true;
  const list = meta.length > 0 ? meta : PANEL_NAV_SECTIONS;
  const key = PATH_TO_KEY[normPath(path)];
  if (!key) return true;
  if (settings.sections[key] !== false) return true;
  const anyVisible = list.some((s) => settings.sections[s.key] !== false);
  if (!anyVisible) {
    return normPath(path) === normPath(getFirstVisiblePath(settings, list));
  }
  return false;
}
