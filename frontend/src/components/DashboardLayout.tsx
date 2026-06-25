import { ReactNode, useCallback, useEffect, useRef, useState, type SVGProps } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { createUser, listServers, logout, type CreateUserPayload, type ServerDto, type UserDto } from "../api";
import { isAdminMobileShell, isAdminMobileScrollArea } from "../adminMobile";
import { computeDashboardStats, isExpirySoon, isTrafficSoon, remainingTrafficGb, type DashboardStats } from "../dashboardStats";
import { clearUsersListCache, readUsersListCache } from "../usersListCache";
import { notifyUsersChanged } from "../usersEvents";
import { prefetchUsersInBackground, USERS_CACHE_UPDATED_EVENT } from "../usersPrefetch";
import AdminSidebarThemeDock from "./AdminSidebarThemeDock";
import AdminSettingsButton from "./AdminSettingsButton";
import PanelSettingsModal from "./PanelSettingsModal";
import UserModal from "./UserModal";
import { useAutoLogout } from "../useAutoLogout";
import { usePanelSettings } from "../panelSettingsContext";
import { normalizeSectionOrder } from "../panelNavUtils";
import type { PanelSectionKey } from "../panelSettingsTypes";

type NavItem = { to: string; label: string; Icon: (p: SVGProps<SVGSVGElement>) => ReactNode; sectionKey: PanelSectionKey };

function IconServers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="2" y="3" width="20" height="6" rx="1" />
      <rect x="2" y="15" width="20" height="6" rx="1" />
      <circle cx="7" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconUsers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconShop(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function IconComms(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconAppeals(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M6 21v-2a6 6 0 0 1 12 0v2" />
    </svg>
  );
}

function IconReferral(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconConfigVault(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M21 8v13H3V8" />
      <path d="M1 8h22v-3a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v3z" />
      <path d="M10 12h4" />
    </svg>
  );
}

function IconWhiteFlag(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M5 21V4" strokeLinecap="round" />
      <path
        d="M5 4h13l-2.2 2.8L18 10H5V4z"
        fill="currentColor"
        fillOpacity="0.22"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPromo(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconExperiments(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M9 3h6l1 3h3a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3l1-3Z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

function IconLogs(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}

function IconProxy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconGame(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 12h4M8 10v4M15 11h.01M18 13h.01" />
    </svg>
  );
}

function IconDevice(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function IconGift(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M12 8v13M3 12h18M12 8c-2.5 0-4-1.5-4-3.5S9.5 1 12 1s4 1.5 4 3.5S14.5 8 12 8z" />
    </svg>
  );
}

function IconLogout(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function ExpiryNotifyStatusIcon({ status, hint }: { status: "sent" | "waiting" | "error"; hint?: string }) {
  const title = hint || (status === "sent" ? "Доставлено" : status === "waiting" ? "Ожидает отправки" : "Ошибка");
  if (status === "sent") {
    return (
      <span className="admin-expiry-notify-icon admin-expiry-notify-icon--sent" title={title} aria-label={title}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.18" />
          <path
            d="M8 12.5l2.5 2.5L16 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "waiting") {
    return (
      <span className="admin-expiry-notify-icon admin-expiry-notify-icon--wait" title={title} aria-label={title}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="admin-expiry-notify-icon admin-expiry-notify-icon--err" title={title} aria-label={title}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const NAV_ITEMS: NavItem[] = [
  { to: "/servers", label: "Сервера", Icon: IconServers, sectionKey: "servers" },
  { to: "/users", label: "Пользователи", Icon: IconUsers, sectionKey: "users" },
  { to: "/logs", label: "Логи", Icon: IconLogs, sectionKey: "logs" },
  { to: "/experiments", label: "Эксперименты", Icon: IconExperiments, sectionKey: "experiments" },
  { to: "/subscription-shop", label: "Подписки", Icon: IconShop, sectionKey: "subscription_shop" },
  { to: "/communications", label: "Коммуникации", Icon: IconComms, sectionKey: "communications" },
  { to: "/support-appeals", label: "Обращения", Icon: IconAppeals, sectionKey: "support_appeals" },
  { to: "/referral-program", label: "Реферальная программа", Icon: IconReferral, sectionKey: "referral_program" },
  { to: "/promo-codes", label: "Промоакции", Icon: IconPromo, sectionKey: "promo_codes" },
  { to: "/config-vault", label: "Конфиг-хранилище", Icon: IconConfigVault, sectionKey: "config_vault" },
  { to: "/whitelist-vault", label: "Белые списки", Icon: IconWhiteFlag, sectionKey: "whitelist_vault" },
  { to: "/telegram-proxies", label: "Прокси", Icon: IconProxy, sectionKey: "telegram_proxies" },
  { to: "/dropper-game", label: "Игра", Icon: IconGame, sectionKey: "dropper_game" },
  { to: "/daily-gift", label: "Ежедневный подарок", Icon: IconGift, sectionKey: "daily_gift" },
  { to: "/device-limit", label: "Устройства", Icon: IconDevice, sectionKey: "device_limit" },
];

function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="admin-sidebar-nav">
      {items.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => (isActive ? "admin-sidebar-link active" : "admin-sidebar-link")}
          onClick={onNavigate}
          title={label}
        >
          <span className="admin-sidebar-link-icon">
            <Icon />
          </span>
          <span className="admin-sidebar-link-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function DashboardLayout({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  const nav = useNavigate();
  const location = useLocation();
  const panel = usePanelSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDragX, setDrawerDragX] = useState<number | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(296);
  const [mobileShell, setMobileShell] = useState(() => isAdminMobileShell());
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsUsers, setStatsUsers] = useState<UserDto[]>(() => readUsersListCache()?.users ?? []);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsPanelOpen, setStatsPanelOpen] = useState<null | "online" | "warn">(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deployedServers, setDeployedServers] = useState<ServerDto[]>([]);
  const [createServersLoading, setCreateServersLoading] = useState(false);
  const [createFlash, setCreateFlash] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const statsBarRef = useRef<HTMLDivElement>(null);
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;

  const refreshStats = useCallback(async () => {
    const cached = readUsersListCache();
    if (cached?.users?.length) {
      setStatsUsers(cached.users);
      setStats(computeDashboardStats(cached.users));
      setStatsLoading(false);
    } else {
      setStatsLoading(true);
    }
    try {
      const data = await prefetchUsersInBackground({ force: !cached?.users?.length });
      setStatsUsers(data.users);
      setStats(computeDashboardStats(data.users));
    } catch {
      if (!cached?.users?.length) {
        setStatsUsers([]);
        setStats(null);
      }
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (statsPanelOpen == null) return;
    const close = () => setStatsPanelOpen(null);
    const onDocDown = (e: MouseEvent) => {
      const el = statsBarRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      close();
    };
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Element && target.closest(".admin-stats-popover")) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [statsPanelOpen]);

  useEffect(() => {
    void refreshStats();
    const id = window.setInterval(() => void refreshStats(), 60_000);
    return () => window.clearInterval(id);
  }, [refreshStats, location.pathname]);

  useEffect(() => {
    const onCache = (e: Event) => {
      const detail = (e as CustomEvent<{ users: UserDto[] }>).detail;
      if (!detail?.users) return;
      setStatsUsers(detail.users);
      setStats(computeDashboardStats(detail.users));
      setStatsLoading(false);
    };
    window.addEventListener(USERS_CACHE_UPDATED_EVENT, onCache);
    return () => window.removeEventListener(USERS_CACHE_UPDATED_EVENT, onCache);
  }, []);

  useEffect(() => {
    setMobileShell(isAdminMobileShell());
    const mq = window.matchMedia("(max-width: 960px)");
    const onMq = () => setMobileShell(isAdminMobileShell());
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setDrawerDragX(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileShell) return;
    const measure = () => {
      if (drawerRef.current) setDrawerWidth(drawerRef.current.offsetWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [mobileShell]);

  useEffect(() => {
    if (!mobileShell) return;
    document.documentElement.classList.add("admin-mobile-app");
    return () => document.documentElement.classList.remove("admin-mobile-app");
  }, [mobileShell]);

  /** Меню следует за пальцем: вправо открывает, влево закрывает (можно остановить на полпути). */
  useEffect(() => {
    if (!mobileShell) return;
    const el = shellRef.current;
    if (!el) return;

    const COMMIT_RATIO = 0.38;
    const CANCEL_VERTICAL_PX = 72;
    let startX = 0;
    let startY = 0;
    let startOffset = 0;
    let drawerW = drawerWidth;
    let dragging = false;
    let decided = false;
    let scrollAreaTouch = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      scrollAreaTouch = isAdminMobileScrollArea(e.target);
      if (scrollAreaTouch) return;
      const t = e.touches[0];
      if (drawerOpenRef.current) {
        const el = e.target;
        if (!(el instanceof Element) || !el.closest(".admin-drawer-backdrop, .admin-drawer")) return;
      }
      if (drawerRef.current) drawerW = drawerRef.current.offsetWidth;
      startX = t.clientX;
      startY = t.clientY;
      startOffset = drawerOpenRef.current ? drawerW : 0;
      dragging = true;
      decided = false;
      setDrawerDragX(startOffset);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (scrollAreaTouch || !dragging || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dy) > CANCEL_VERTICAL_PX && Math.abs(dy) > Math.abs(dx)) {
          dragging = false;
          setDrawerDragX(null);
          return;
        }
        if (Math.abs(dx) <= Math.abs(dy) * 1.1) {
          dragging = false;
          setDrawerDragX(null);
          return;
        }
        decided = true;
      }

      const offset = Math.max(0, Math.min(drawerW, startOffset + dx));
      setDrawerDragX(offset);
      if (e.cancelable) e.preventDefault();
    };

    const finish = (clientX: number) => {
      if (!dragging) return;
      dragging = false;
      const dx = clientX - startX;
      const offset = Math.max(0, Math.min(drawerW, startOffset + dx));
      setDrawerDragX(null);
      setDrawerOpen(offset > drawerW * COMMIT_RATIO);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (scrollAreaTouch) {
        scrollAreaTouch = false;
        return;
      }
      const t = e.changedTouches[0];
      if (t) finish(t.clientX);
      else {
        dragging = false;
        setDrawerDragX(null);
      }
    };

    const onTouchCancel = () => {
      scrollAreaTouch = false;
      dragging = false;
      setDrawerDragX(null);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [mobileShell, drawerWidth]);

  async function doLogout(reason?: "idle") {
    setDrawerOpen(false);
    await logout();
    clearUsersListCache();
    onLogout();
    nav("/login", {
      replace: true,
      state: reason === "idle" ? { sessionExpired: true } : undefined,
    });
  }

  useAutoLogout(panel.settings?.security.autoLogoutMinutes, () => {
    void doLogout("idle");
  });

  async function openCreateClient() {
    setCreateFlash(null);
    setCreateOpen(true);
    const cached = readUsersListCache();
    if (cached?.deployedServers?.length) {
      setDeployedServers(cached.deployedServers);
      return;
    }
    if (deployedServers.length > 0 || createServersLoading) return;
    setCreateServersLoading(true);
    try {
      const data = await prefetchUsersInBackground();
      setDeployedServers(data.deployedServers);
    } catch {
      try {
        const servers = await listServers();
        setDeployedServers(servers.filter((s) => s.vless_deployed));
      } catch {
        setDeployedServers([]);
      }
    } finally {
      setCreateServersLoading(false);
    }
  }

  function onCreateClient(payload: CreateUserPayload) {
    setCreateFlash({ type: "ok", text: "Создаём клиента в фоне…" });
    void (async () => {
      try {
        const { user } = await createUser(payload);
        await prefetchUsersInBackground({ force: true });
        notifyUsersChanged();
        setCreateFlash({ type: "ok", text: `Клиент «${user.name}» создан.` });
      } catch (e) {
        setCreateFlash({ type: "err", text: String(e) });
      }
    })();
  }

  const statValue = (n: number | undefined) => (statsLoading && stats == null ? "…" : String(n ?? 0));
  const now = Date.now();
  const onlineUsers = statsUsers.filter((u) => u.online);
  const expiringSoonUsers = statsUsers
    .filter((u) => u.enable && (isExpirySoon(u, now) || isTrafficSoon(u)))
    .sort((a, b) => a.name.localeCompare(b.name, "ru-RU"));

  function formatSoonHint(u: UserDto): string {
    const parts: string[] = [];
    if (isExpirySoon(u, now) && u.expiry_time > now) {
      const days = Math.max(0, Math.ceil((u.expiry_time - now) / 86_400_000));
      parts.push(days <= 0 ? "сегодня" : days === 1 ? "1 день" : days <= 4 ? `${days} дня` : `${days} дней`);
    }
    const gb = remainingTrafficGb(u);
    if (isTrafficSoon(u) && gb != null) {
      parts.push(`${gb.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ГБ`);
    }
    return parts.join(" • ") || "скоро истекает";
  }

  const drawerVisible = drawerOpen || drawerDragX !== null;
  const drawerBackdropOpacity =
    drawerDragX !== null && drawerWidth > 0 ? Math.min(1, drawerDragX / drawerWidth) : drawerOpen ? 1 : 0;
  const drawerInlineTransform =
    drawerDragX !== null ? `translateX(${drawerDragX - drawerWidth}px)` : undefined;

  const navOrder = normalizeSectionOrder(panel.settings?.sectionOrder);
  const navByKey = new Map(NAV_ITEMS.map((item) => [item.sectionKey, item]));
  const visibleNav = navOrder
    .map((key) => navByKey.get(key))
    .filter((item): item is NavItem => item != null && panel.settings?.sections[item.sectionKey] !== false);
  const panelTitle = panel.settings?.panel.title ?? "Панель управления";
  const panelSubtitle = panel.settings?.panel.subtitle ?? "";
  const brandShort = panel.settings?.panel.brandName ?? panelTitle.split(" ")[0] ?? "VPN";
  const avatarSrc = panel.settings?.panel.avatarPath && panel.avatarUrl ? panel.avatarUrl : null;
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => {
    setAvatarBroken(false);
  }, [avatarSrc]);
  const sectionHiddenMsg = (location.state as { sectionHidden?: boolean } | null)?.sectionHidden;

  return (
    <div ref={shellRef} className={`admin-shell ${mobileShell ? "admin-shell--mobile" : ""}`.trim()}>
      {!mobileShell ? (
        <aside className="admin-sidebar" aria-label="Навигация">
          <div className="admin-sidebar-brand">
            {avatarSrc && !avatarBroken ? (
              <img
                src={avatarSrc}
                alt=""
                className="admin-sidebar-logo"
                width={40}
                height={40}
                onError={() => {
                  setAvatarBroken(true);
                  void panel.refresh();
                }}
              />
            ) : (
              <div className="admin-sidebar-logo admin-sidebar-logo--placeholder">{brandShort.slice(0, 2).toUpperCase()}</div>
            )}
            <div className="admin-sidebar-brand-text">
              <span className="admin-sidebar-brand-title">{brandShort}</span>
              <span className="admin-sidebar-brand-sub">{panelTitle}</span>
            </div>
          </div>
          <SidebarNav items={visibleNav} />
          <div className="admin-sidebar-footer">
            <AdminSidebarThemeDock />
            <AdminSettingsButton variant="full" onClick={() => setSettingsOpen(true)} />
          </div>
        </aside>
      ) : null}

      <div className="admin-content">
        <header className="admin-topbar">
          {mobileShell ? (
            <button
              type="button"
              className="admin-menu-btn"
              aria-label="Открыть меню"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <span className="admin-menu-btn-icon" aria-hidden />
            </button>
          ) : null}

          <div className="admin-topbar-leading">
            <h1 className="admin-topbar-title">{panelTitle}</h1>
            {panelSubtitle ? <p className="admin-topbar-sub">{panelSubtitle}</p> : null}
            <div ref={statsBarRef} className="admin-stats-wrap">
              <div className="admin-stats-bar" aria-label="Сводка по клиентам">
                <div className="admin-stats-segment">
                  <span className="admin-stats-label">Клиентов</span>
                  <span className="admin-stats-value">{statValue(stats?.totalClients)}</span>
                </div>
                <div className="admin-stats-divider" aria-hidden />
                <button
                  type="button"
                  className="admin-stats-segment admin-stats-segment--button admin-stats-segment--online"
                  aria-expanded={statsPanelOpen === "online"}
                  onClick={() => setStatsPanelOpen((prev) => (prev === "online" ? null : "online"))}
                >
                  <span className="admin-stats-label">Онлайн</span>
                  <span className="admin-stats-value">{statValue(stats?.onlineCount)}</span>
                </button>
                <div className="admin-stats-divider" aria-hidden />
                <button
                  type="button"
                  className="admin-stats-segment admin-stats-segment--button admin-stats-segment--warn"
                  aria-expanded={statsPanelOpen === "warn"}
                  onClick={() => setStatsPanelOpen((prev) => (prev === "warn" ? null : "warn"))}
                >
                  <span className="admin-stats-label">Скоро истекает</span>
                  <span className="admin-stats-value" title="Подписка ≤ 3 суток или трафик ≤ 30 ГБ">
                    {statValue(stats?.expiringSoonCount)}
                  </span>
                </button>
              </div>
              <div className={`admin-stats-popover ${statsPanelOpen ? "is-open" : ""}`.trim()} aria-hidden={statsPanelOpen == null}>
                {statsPanelOpen === "online" ? (
                  <>
                    <div className="admin-stats-popover-title">Сейчас онлайн</div>
                    <div className="admin-stats-popover-list">
                      {onlineUsers.length === 0 ? (
                        <div className="admin-stats-popover-empty">Сейчас никого нет онлайн.</div>
                      ) : (
                        onlineUsers.map((u) => (
                          <div key={u.id} className="admin-stats-popover-row">
                            <span className="admin-stats-popover-name">{u.name}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
                {statsPanelOpen === "warn" ? (
                  <>
                    <div className="admin-stats-popover-title">Скоро истекают</div>
                    <div className="admin-stats-popover-list">
                      {expiringSoonUsers.length === 0 ? (
                        <div className="admin-stats-popover-empty">Таких подписок сейчас нет.</div>
                      ) : (
                        expiringSoonUsers.map((u) => (
                          <div key={u.id} className="admin-stats-popover-row">
                            <span className="admin-stats-popover-name">{u.name}</span>
                            <span className="admin-stats-popover-meta">
                              {u.expiry_auto_notify_status && isExpirySoon(u, now) ? (
                                <ExpiryNotifyStatusIcon
                                  status={u.expiry_auto_notify_status}
                                  hint={u.expiry_auto_notify_hint}
                                />
                              ) : null}
                              {formatSoonHint(u)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="admin-create-client-btn"
              aria-label="Новый клиент"
              title="Новый клиент"
              onClick={() => void openCreateClient()}
            >
              +
            </button>
          </div>

          <button type="button" className="admin-logout-btn ghost" onClick={() => void doLogout()}>
            <IconLogout />
            <span>Выйти</span>
          </button>
        </header>

        {panel.settings?.maintenance.enabled ? (
          <div className="admin-maintenance-banner" role="status">
            Панель находится в режиме обслуживания
          </div>
        ) : null}
        {panel.settings?.telegram.testMode ? (
          <div className="admin-testmode-banner" role="status">
            Включён тестовый режим Telegram — массовые отправки только администратору
          </div>
        ) : null}
        {sectionHiddenMsg ? (
          <div className="flash err admin-section-hidden-banner">Раздел скрыт в настройках панели</div>
        ) : null}
        {createFlash ? <div className={`flash ${createFlash.type === "ok" ? "ok" : "err"}`}>{createFlash.text}</div> : null}

        <main className="admin-main">{children}</main>
      </div>

      <UserModal
        open={createOpen}
        mode="create"
        user={null}
        deployedServers={deployedServers}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreateClient}
        onUpdate={async () => {}}
      />

      {mobileShell && drawerVisible ? (
        <div
          className={`admin-drawer-backdrop ${drawerDragX !== null ? "admin-drawer-backdrop--dragging" : ""}`.trim()}
          role="presentation"
          style={{ opacity: drawerBackdropOpacity }}
          onClick={() => {
            setDrawerOpen(false);
            setDrawerDragX(null);
          }}
        />
      ) : null}

      {mobileShell ? (
        <aside
          ref={drawerRef}
          className={[
            "admin-drawer",
            drawerDragX === null && drawerOpen ? "admin-drawer--open" : "",
            drawerDragX !== null ? "admin-drawer--dragging" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={drawerInlineTransform ? { transform: drawerInlineTransform } : undefined}
          aria-hidden={!drawerVisible}
        >
          <div className="admin-drawer-head">
            <div className="admin-sidebar-brand admin-sidebar-brand--drawer">
              {avatarSrc && !avatarBroken ? (
                <img
                  src={avatarSrc}
                  alt=""
                  className="admin-sidebar-logo"
                  width={36}
                  height={36}
                  onError={() => {
                    setAvatarBroken(true);
                    void panel.refresh();
                  }}
                />
              ) : (
                <div className="admin-sidebar-logo admin-sidebar-logo--placeholder">{brandShort.slice(0, 2).toUpperCase()}</div>
              )}
              <div className="admin-sidebar-brand-text">
                <span className="admin-sidebar-brand-title">{brandShort}</span>
                <span className="admin-sidebar-brand-sub">{panelTitle}</span>
              </div>
            </div>
            <button type="button" className="ghost admin-drawer-close" aria-label="Закрыть меню" onClick={() => setDrawerOpen(false)}>
              ×
            </button>
          </div>
          <SidebarNav items={visibleNav} onNavigate={() => setDrawerOpen(false)} />
          <div className="admin-drawer-footer">
            <AdminSidebarThemeDock />
            <AdminSettingsButton variant="full" onClick={() => setSettingsOpen(true)} />
            <button type="button" className="primary admin-drawer-logout" onClick={() => void doLogout()}>
              Выйти
            </button>
          </div>
        </aside>
      ) : null}

      <PanelSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
