import type { ServerDto, UserDto } from "./api";
import { PANEL_NAV_SECTIONS } from "./panelNavUtils";
import type { PanelSectionKey } from "./panelSettingsTypes";

export const ADMIN_HOME_PATH = "/home";

export type HomeCatalogKind = "section" | "tab";
export type HomeSearchKind = HomeCatalogKind | "user" | "server";

export type HomeCatalogEntry = {
  kind: HomeCatalogKind;
  sectionKey: PanelSectionKey;
  path: string;
  title: string;
  subtitle: string;
  keywords: string[];
};

export type HomeSearchHit = {
  kind: HomeSearchKind;
  path: string;
  title: string;
  subtitle: string;
  sectionKey?: PanelSectionKey;
};

const SECTION_KEYWORDS: Record<PanelSectionKey, string[]> = {
  servers: ["vps", "узлы", "xray", "ssh", "ноды", "node"],
  users: ["клиенты", "подписки", "клиент", "user", "telegram"],
  logs: ["xray", "error", "access", "ai", "журнал", "диагностика"],
  subscription_shop: ["тарифы", "магазин", "оплата", "выручка", "shop", "цены"],
  communications: ["рассылки", "опросы", "телеграм", "broadcast", "mailing"],
  support_appeals: ["поддержка", "тикеты", "жалобы", "tickets"],
  referral_program: ["рефералы", "друзья", "награды", "invite"],
  promo_codes: ["промокоды", "скидки", "купон", "promo"],
  config_vault: ["vless", "trojan", "hysteria", "hy2", "ключи", "конфиг", "vault"],
  whitelist_vault: ["бс", "whitelist", "глушилки", "happ", "белые"],
  telegram_proxies: ["прокси", "mtproto", "telegram", "proxy"],
  roulette_game: ["игра", "призы", "дроппер", "dropper", "колесо"],
  device_limit: ["слоты", "лимит", "гаджеты", "device", "места"],
  daily_gift: ["подарок", "награда", "ежедневно", "gift", "unbox"],
};

const TABS: Array<Omit<HomeCatalogEntry, "kind"> & { kind?: "tab" }> = [
  { sectionKey: "users", path: "/users/active", title: "Активные", subtitle: "Пользователи", keywords: ["клиенты", "подписки"] },
  { sectionKey: "users", path: "/users/inactive", title: "Неактивные", subtitle: "Пользователи", keywords: ["истёкшие", "отключённые"] },
  { sectionKey: "users", path: "/users/preview", title: "Превью WebApp", subtitle: "Пользователи", keywords: ["миниапп", "telegram", "webapp"] },
  { sectionKey: "logs", path: "/logs/error", title: "Error log", subtitle: "Логи", keywords: ["ошибки", "xray"] },
  { sectionKey: "logs", path: "/logs/access", title: "Access log", subtitle: "Логи", keywords: ["доступ", "xray"] },
  { sectionKey: "subscription_shop", path: "/subscription-shop/settings", title: "Тарифы", subtitle: "Подписки", keywords: ["планы", "цены"] },
  { sectionKey: "subscription_shop", path: "/subscription-shop/combo", title: "Комбо-подписки", subtitle: "Подписки", keywords: ["наборы"] },
  { sectionKey: "subscription_shop", path: "/subscription-shop/payment-sessions", title: "Сессии оплаты", subtitle: "Подписки", keywords: ["платежи", "оплата"] },
  { sectionKey: "subscription_shop", path: "/subscription-shop/revenue", title: "Выручка", subtitle: "Подписки", keywords: ["отчёт", "деньги"] },
  { sectionKey: "communications", path: "/communications/mailings", title: "Рассылки", subtitle: "Коммуникации", keywords: ["сообщения", "telegram"] },
  { sectionKey: "communications", path: "/communications/triggermailing", title: "Триггерные рассылки", subtitle: "Коммуникации", keywords: ["авто", "события"] },
  { sectionKey: "communications", path: "/communications/surveys", title: "Опросы", subtitle: "Коммуникации", keywords: ["опрос", "голоса"] },
  { sectionKey: "communications", path: "/communications/auto", title: "Авто-рассылки", subtitle: "Коммуникации", keywords: ["автоматически"] },
  { sectionKey: "communications", path: "/communications/history", title: "История отправок", subtitle: "Коммуникации", keywords: ["журнал"] },
  { sectionKey: "referral_program", path: "/referral-program/settings", title: "Настройки рефералов", subtitle: "Реферальная программа", keywords: [] },
  { sectionKey: "referral_program", path: "/referral-program/report", title: "Отчёт по рефералам", subtitle: "Реферальная программа", keywords: [] },
  { sectionKey: "referral_program", path: "/referral-program/history", title: "История изменений", subtitle: "Реферальная программа", keywords: [] },
  { sectionKey: "promo_codes", path: "/promo-codes/promos", title: "Промокоды", subtitle: "Промоакции", keywords: ["купон", "код"] },
  { sectionKey: "promo_codes", path: "/promo-codes/discounts", title: "Скидки", subtitle: "Промоакции", keywords: ["очередь", "рулетка"] },
  { sectionKey: "whitelist_vault", path: "/whitelist-vault/keys", title: "VLESS-ключи БС", subtitle: "Белые списки", keywords: ["whitelist"] },
  { sectionKey: "whitelist_vault", path: "/whitelist-vault/purchase", title: "Покупка белых списков", subtitle: "Белые списки", keywords: ["цена"] },
  { sectionKey: "whitelist_vault", path: "/whitelist-vault/instruction", title: "Инструкция БС", subtitle: "Белые списки", keywords: [] },
  { sectionKey: "whitelist_vault", path: "/whitelist-vault/history", title: "История покупок БС", subtitle: "Белые списки", keywords: [] },
  { sectionKey: "roulette_game", path: "/roulette-game/roulette", title: "Рулетка", subtitle: "Рулетка", keywords: ["колесо", "призы"] },
  { sectionKey: "roulette_game", path: "/roulette-game/tickets", title: "Билеты", subtitle: "Рулетка", keywords: ["тикеты"] },
  { sectionKey: "roulette_game", path: "/roulette-game/reports", title: "Отчёты рулетки", subtitle: "Рулетка", keywords: [] },
  { sectionKey: "device_limit", path: "/device-limit/settings", title: "Настройки устройств", subtitle: "Ограничение по устройствам", keywords: [] },
  { sectionKey: "device_limit", path: "/device-limit/subscriptions", title: "Подписки устройств", subtitle: "Ограничение по устройствам", keywords: [] },
  { sectionKey: "device_limit", path: "/device-limit/purchases", title: "Покупки мест", subtitle: "Ограничение по устройствам", keywords: ["слоты"] },
  { sectionKey: "device_limit", path: "/device-limit/events", title: "Журнал устройств", subtitle: "Ограничение по устройствам", keywords: [] },
  { sectionKey: "device_limit", path: "/device-limit/diagnose", title: "Диагностика устройств", subtitle: "Ограничение по устройствам", keywords: [] },
];

export const HOME_SEARCH_CATALOG: HomeCatalogEntry[] = [
  ...PANEL_NAV_SECTIONS.map((s) => ({
    kind: "section" as const,
    sectionKey: s.key,
    path: s.path,
    title: s.label,
    subtitle: s.description,
    keywords: SECTION_KEYWORDS[s.key],
  })),
  ...TABS.map((t) => ({
    kind: "tab" as const,
    sectionKey: t.sectionKey,
    path: t.path,
    title: t.title,
    subtitle: t.subtitle,
    keywords: t.keywords,
  })),
];

export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").trim();
}

function tokensOf(query: string): string[] {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean);
}

function haystackOf(parts: Array<string | number | null | undefined>): string {
  return normalizeSearchText(parts.filter((p) => p != null && String(p).trim() !== "").join(" "));
}

function matchesTokens(haystack: string, tokens: string[]): boolean {
  return tokens.every((t) => haystack.includes(t));
}

export function userHomePath(user: UserDto): string {
  const tab = user.enable ? "active" : "inactive";
  return `/users/${tab}?user=${user.id}`;
}

export function searchHomeIndex(opts: {
  query: string;
  visibleKeys: Set<PanelSectionKey>;
  users: UserDto[];
  servers: ServerDto[];
}): HomeSearchHit[] {
  const tokens = tokensOf(opts.query);
  if (tokens.length === 0) return [];

  const catalogHits: HomeSearchHit[] = [];
  for (const entry of HOME_SEARCH_CATALOG) {
    if (!opts.visibleKeys.has(entry.sectionKey)) continue;
    const hay = haystackOf([entry.title, entry.subtitle, ...entry.keywords, entry.sectionKey, entry.path]);
    if (!matchesTokens(hay, tokens)) continue;
    catalogHits.push({
      kind: entry.kind,
      path: entry.path,
      title: entry.title,
      subtitle: entry.subtitle,
      sectionKey: entry.sectionKey,
    });
  }

  const userHits: HomeSearchHit[] = [];
  if (opts.visibleKeys.has("users")) {
    for (const u of opts.users) {
      const hay = haystackOf([u.id, u.name, u.tg_id, u.email, u.comment]);
      if (!matchesTokens(hay, tokens)) continue;
      userHits.push({
        kind: "user",
        path: userHomePath(u),
        title: u.name || `Клиент #${u.id}`,
        subtitle: u.tg_id ? `Telegram ${u.tg_id}` : `ID ${u.id}`,
        sectionKey: "users",
      });
      if (userHits.length >= 8) break;
    }
  }

  const serverHits: HomeSearchHit[] = [];
  if (opts.visibleKeys.has("servers")) {
    for (const s of opts.servers) {
      const hay = haystackOf([s.id, s.name, s.host, s.country_code, s.country_flag]);
      if (!matchesTokens(hay, tokens)) continue;
      serverHits.push({
        kind: "server",
        path: "/servers",
        title: s.name || s.host,
        subtitle: s.host,
        sectionKey: "servers",
      });
      if (serverHits.length >= 6) break;
    }
  }

  return [...catalogHits, ...userHits, ...serverHits];
}
