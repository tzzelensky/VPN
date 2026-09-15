import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listServers, type ServerDto, type UserDto } from "../api";
import { SECTION_NAV_ICONS } from "../adminNavIcons";
import DashboardLayout from "../components/DashboardLayout";
import {
  computeDashboardStats,
  formatTrafficAmount,
  isExpirySoon,
  isTrafficSoon,
  remainingTrafficGb,
  sumTrafficBytes,
} from "../dashboardStats";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { searchHomeIndex, type HomeSearchHit, type HomeSearchKind } from "../homeSearchIndex";
import { isAdminMobileShell } from "../adminMobile";
import { normalizeSectionOrder, PANEL_NAV_SECTIONS } from "../panelNavUtils";
import { usePanelSettings } from "../panelSettingsContext";
import type { PanelSectionKey } from "../panelSettingsTypes";
import { prefetchUsersInBackground, USERS_CACHE_UPDATED_EVENT } from "../usersPrefetch";
import {
  ensureOnlineStatsSynced,
  getOnlineStatsStatus,
  ONLINE_STATS_EVENT,
  type OnlineStatsEventDetail,
} from "../onlineStatsSync";
import { readUsersListCache } from "../usersListCache";

const KIND_ORDER: HomeSearchKind[] = ["section", "tab", "user", "server"];
const KIND_LABEL: Record<HomeSearchKind, string> = {
  section: "Разделы",
  tab: "Вкладки",
  user: "Клиенты",
  server: "Серверы",
};
const ATTENTION_LIMIT = 5;

function greetingForHour(hour: number): string {
  if (hour < 5 || hour >= 23) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

function isMacShortcut(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

function formatExpiry(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function attentionLine(u: UserDto, now: number): string {
  const parts: string[] = [];
  if (isExpirySoon(u, now) && u.expiry_time > 0) parts.push(`до ${formatExpiry(u.expiry_time)}`);
  if (isTrafficSoon(u)) {
    const gb = remainingTrafficGb(u);
    parts.push(gb != null ? `осталось ${gb} ГБ` : "мало трафика");
  }
  return parts.join(" · ") || "Требует внимания";
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function KpiValue({ value, loading }: { value: number | null; loading: boolean }) {
  const animated = useAnimatedNumber(loading && value == null ? null : (value ?? 0));
  if (loading && value == null) return <span className="home-kpi__value home-kpi__value--skeleton">—</span>;
  return <span className="home-kpi__value">{animated ?? 0}</span>;
}

export default function HomePage({ onLogout }: { onLogout: () => void }) {
  const nav = useNavigate();
  const panel = usePanelSettings();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [users, setUsers] = useState<UserDto[]>(() => readUsersListCache()?.users ?? []);
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [usersLoading, setUsersLoading] = useState(() => readUsersListCache() == null);
  const [onlineLoading, setOnlineLoading] = useState(() => getOnlineStatsStatus() !== "ready");
  const [serversLoading, setServersLoading] = useState(true);
  const [modHint, setModHint] = useState("Ctrl");

  const visibleKeys = useMemo(() => {
    const order = normalizeSectionOrder(panel.settings?.sectionOrder);
    const keys = new Set<PanelSectionKey>();
    for (const key of order) {
      if (panel.settings?.sections[key] !== false) keys.add(key);
    }
    if (keys.size === 0) {
      for (const s of PANEL_NAV_SECTIONS) keys.add(s.key);
    }
    return keys;
  }, [panel.settings]);

  useEffect(() => {
    setModHint(isMacShortcut() ? "⌘" : "Ctrl");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void prefetchUsersInBackground()
      .then((cache) => {
        if (!cancelled) setUsers(cache.users);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    void ensureOnlineStatsSynced();
    void listServers()
      .then((list) => {
        if (!cancelled) setServers(list);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setServersLoading(false);
      });
    const onCache = (e: Event) => {
      const detail = (e as CustomEvent<{ users?: UserDto[] }>).detail;
      if (detail?.users) setUsers(detail.users);
    };
    const onOnline = (e: Event) => {
      const detail = (e as CustomEvent<OnlineStatsEventDetail>).detail;
      if (!detail) return;
      if (detail.status === "loading") {
        setOnlineLoading(true);
        return;
      }
      if (detail.status === "ready") {
        if (detail.users) setUsers(detail.users);
        setOnlineLoading(false);
      }
    };
    window.addEventListener(USERS_CACHE_UPDATED_EVENT, onCache);
    window.addEventListener(ONLINE_STATS_EVENT, onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener(USERS_CACHE_UPDATED_EVENT, onCache);
      window.removeEventListener(ONLINE_STATS_EVENT, onOnline);
    };
  }, []);

  useEffect(() => {
    if (isAdminMobileShell()) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, []);

  const hits = useMemo(
    () => searchHomeIndex({ query, visibleKeys, users, servers }),
    [query, visibleKeys, users, servers],
  );

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (selected >= hits.length) setSelected(0);
  }, [hits.length, selected]);

  const go = useCallback(
    (path: string) => {
      nav(path);
    },
    [nav],
  );

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query) {
        e.preventDefault();
        setQuery("");
      } else {
        searchRef.current?.blur();
      }
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (i + 1) % hits.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (i - 1 + hits.length) % hits.length);
    }
  };

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const hit = hits[selected] ?? hits[0];
    if (hit) go(hit.path);
  };

  const stats = useMemo(() => computeDashboardStats(users), [users]);
  const traffic = useMemo(() => sumTrafficBytes(users), [users]);
  const serverRows = useMemo(() => homeServerRows(servers, users), [servers, users]);
  const maxServerClients = useMemo(
    () => serverRows.reduce((m, r) => Math.max(m, r.clients), 0),
    [serverRows],
  );
  const attentionNow = Date.now();
  const attention = useMemo(() => {
    const now = Date.now();
    return users
      .filter((u) => u.enable && (isExpirySoon(u, now) || isTrafficSoon(u)))
      .sort((a, b) => (a.expiry_time || Infinity) - (b.expiry_time || Infinity))
      .slice(0, ATTENTION_LIMIT);
  }, [users]);

  const searching = query.trim().length > 0;
  const grouped = useMemo(() => {
    const map = new Map<HomeSearchKind, HomeSearchHit[]>();
    for (const kind of KIND_ORDER) map.set(kind, []);
    for (const hit of hits) map.get(hit.kind)?.push(hit);
    return KIND_ORDER.map((kind) => ({ kind, items: map.get(kind) ?? [] })).filter((g) => g.items.length > 0);
  }, [hits]);
  const hitIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    hits.forEach((hit, i) => map.set(`${hit.kind}:${hit.path}:${hit.title}`, i));
    return map;
  }, [hits]);

  const panelTitle = panel.settings?.panel.title || "Панель управления";
  const brand = panel.settings?.panel.brandName || panelTitle;
  const greeting = greetingForHour(new Date().getHours());
  const usersVisible = visibleKeys.has("users");
  const serversVisible = visibleKeys.has("servers");

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className="home-page">
        <section className="panel home-hero">
          <p className="home-hero__kicker">{greeting}</p>
          <h1 className="home-hero__title">{brand}</h1>
          <p className="home-hero__sub">Командный центр: поиск по разделам, клиентам и серверам.</p>
          <form className="home-search" onSubmit={onSearchSubmit} role="search">
            <span className="home-search__icon" aria-hidden>
              <SearchIcon />
            </span>
            <input
              ref={searchRef}
              type="search"
              className="home-search__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Поиск по разделам, вкладкам, клиентам и серверам"
              autoComplete="off"
              spellCheck={false}
              aria-label="Поиск по панели"
              aria-controls={searching ? "home-search-results" : undefined}
              aria-expanded={searching}
            />
            <kbd className="home-search__kbd" title="Фокус поиска">
              {modHint}K
            </kbd>
          </form>
        </section>

        {searching ? (
          <section className="panel home-results" id="home-search-results" aria-live="polite">
            {hits.length === 0 ? (
              <p className="home-results__empty">Ничего не найдено. Попробуйте название раздела или имя клиента.</p>
            ) : (
              grouped.map((group) => (
                  <div key={group.kind} className="home-results__group">
                    <h2 className="home-results__label">{KIND_LABEL[group.kind]}</h2>
                    <ul className="home-results__list">
                      {group.items.map((hit) => {
                        const key = `${hit.kind}:${hit.path}:${hit.title}`;
                        const index = hitIndexByKey.get(key) ?? 0;
                        const Icon = hit.sectionKey ? SECTION_NAV_ICONS[hit.sectionKey] : null;
                        return (
                          <li key={key}>
                            <Link
                              to={hit.path}
                              className={`home-results__item${index === selected ? " is-active" : ""}`}
                              onMouseEnter={() => setSelected(index)}
                            >
                              {Icon ? (
                                <span className="home-results__icon">
                                  <Icon />
                                </span>
                              ) : null}
                              <span className="home-results__text">
                                <span className="home-results__title">{hit.title}</span>
                                <span className="home-results__sub">{hit.subtitle}</span>
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
              ))
            )}
          </section>
        ) : (
          <>
            <section className="home-kpi-grid" aria-label="Сводка">
              <KpiCard
                label="Клиентов"
                value={stats.totalClients}
                loading={usersLoading}
                to={usersVisible ? "/users/active" : undefined}
                tone="total"
              />
              <KpiCard
                label="Онлайн"
                value={onlineLoading ? 0 : stats.onlineCount}
                loading={onlineLoading}
                to={usersVisible ? "/users/active" : undefined}
                tone="online"
              />
              <KpiCard
                label="Скоро истечёт"
                value={stats.expiringSoonCount}
                loading={usersLoading}
                to={usersVisible ? "/users/active" : undefined}
                tone="warn"
              />
              <TrafficKpiCard
                total={traffic.total}
                up={traffic.up}
                down={traffic.down}
                loading={usersLoading}
                to={usersVisible ? "/users/active" : undefined}
              />
            </section>

            <div className="home-split">
              <section className="panel home-attention">
                <div className="home-attention__head">
                  <h2 className="home-section-title">Истекающие подписки</h2>
                  {usersVisible ? (
                    <Link to="/users/active" className="home-attention__all">
                      Все в Пользователях
                    </Link>
                  ) : null}
                </div>
                {attention.length === 0 ? (
                  <p className="home-attention__empty">Истекающих подписок нет — всё спокойно.</p>
                ) : (
                  <ul className="home-attention__list">
                    {attention.map((u) => (
                      <li key={u.id}>
                        <Link
                          to={usersVisible ? `/users/active?user=${u.id}` : "/home"}
                          className="home-attention__row"
                        >
                          <span className="home-attention__name">{u.name}</span>
                          <span className="home-attention__meta">{attentionLine(u, attentionNow)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel home-servers">
                <div className="home-attention__head">
                  <h2 className="home-section-title">
                    Серверы
                    {servers.length > 0 ? (
                      <span className="home-servers__count">{servers.length}</span>
                    ) : null}
                  </h2>
                  {serversVisible ? (
                    <Link to="/servers" className="home-attention__all">
                      Все серверы
                    </Link>
                  ) : null}
                </div>
                {serversLoading && servers.length === 0 ? (
                  <p className="home-attention__empty">Загрузка узлов…</p>
                ) : serverRows.length === 0 ? (
                  <p className="home-attention__empty">Серверов пока нет — добавьте узел в разделе «Сервера».</p>
                ) : (
                  <ul className="home-servers__list">
                    {serverRows.map((row) => {
                      const pct = maxServerClients > 0 ? Math.round((row.clients / maxServerClients) * 100) : 0;
                      const inner = (
                        <>
                          <span className="home-servers__flag" aria-hidden>
                            {row.flag || "•"}
                          </span>
                          <span className="home-servers__body">
                            <span className="home-servers__name">{row.name}</span>
                            <span className="home-servers__host">{row.host}</span>
                            <span className="home-servers__meta">
                              <span className={`home-servers__badge home-servers__badge--${row.sshTone}`}>{row.sshText}</span>
                              {row.stack.map((tag) => (
                                <span key={tag} className="home-servers__badge home-servers__badge--ok">
                                  {tag}
                                </span>
                              ))}
                            </span>
                            <span className="home-servers__bar" aria-hidden>
                              <span className="home-servers__bar-fill" style={{ width: `${pct}%` }} />
                            </span>
                          </span>
                          <span className="home-servers__clients">
                            <strong>{row.clients}</strong>
                            <span>кл.</span>
                          </span>
                        </>
                      );
                      return (
                        <li key={row.id}>
                          {serversVisible ? (
                            <Link to="/servers" className="home-servers__row">
                              {inner}
                            </Link>
                          ) : (
                            <div className="home-servers__row home-servers__row--static">{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function TrafficKpiCard({
  total,
  up,
  down,
  loading,
  to,
}: {
  total: number;
  up: number;
  down: number;
  loading: boolean;
  to?: string;
}) {
  const inner = (
    <>
      <span className="home-kpi__label">Трафик</span>
      {loading && total === 0 ? (
        <span className="home-kpi__value home-kpi__value--skeleton">—</span>
      ) : (
        <span className="home-kpi__value">{formatTrafficAmount(total)}</span>
      )}
      <span className="home-kpi__hint">
        по счётчикам клиентов · ↑ {formatTrafficAmount(up)} · ↓ {formatTrafficAmount(down)}
      </span>
    </>
  );
  const cls = `home-kpi home-kpi--traffic${to ? " home-kpi--link" : ""}`;
  if (to) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function KpiCard({
  label,
  value,
  loading,
  to,
  tone,
}: {
  label: string;
  value: number;
  loading: boolean;
  to?: string;
  tone: "total" | "online" | "warn";
}) {
  const inner = (
    <>
      <span className="home-kpi__label">{label}</span>
      <KpiValue value={loading && value === 0 ? null : value} loading={loading} />
    </>
  );
  const cls = `home-kpi home-kpi--${tone}${to ? " home-kpi--link" : ""}`;
  if (to) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

type HomeServerRow = {
  id: number;
  name: string;
  host: string;
  flag: string;
  clients: number;
  sshTone: "ok" | "warn" | "bad";
  sshText: string;
  stack: string[];
};

function sshStatus(server: ServerDto): { tone: "ok" | "warn" | "bad"; text: string } {
  if (server.last_ssh_ok) return { tone: "ok", text: "SSH OK" };
  if (server.last_error) return { tone: "bad", text: "SSH error" };
  return { tone: "warn", text: "Не проверялся" };
}

function serverStack(server: ServerDto): string[] {
  const tags: string[] = [];
  if (server.vless_deployed) tags.push("VLESS");
  if (server.hysteria2_deployed) tags.push("Hy2");
  if (server.trojan_deployed) tags.push("Trojan");
  return tags;
}

function userOnServer(u: UserDto, serverId: number, deployedIds: Set<number>): boolean {
  const ids = u.subscription_server_ids ?? [];
  if (ids.length > 0) return ids.includes(serverId);
  return deployedIds.has(serverId);
}

function homeServerRows(servers: ServerDto[], users: UserDto[]): HomeServerRow[] {
  const deployedIds = new Set(
    servers.filter((s) => s.vless_deployed || s.hysteria2_deployed || s.trojan_deployed).map((s) => s.id),
  );
  return servers.map((s) => {
    const ssh = sshStatus(s);
    const counted =
      typeof s.subscription_users_total === "number"
        ? s.subscription_users_total
        : users.filter((u) => userOnServer(u, s.id, deployedIds)).length;
    return {
      id: s.id,
      name: s.name || s.host,
      host: s.host,
      flag: s.country_flag || "",
      clients: counted,
      sshTone: ssh.tone,
      sshText: ssh.text,
      stack: serverStack(s),
    };
  });
}
