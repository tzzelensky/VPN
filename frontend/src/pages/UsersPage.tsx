import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type SVGProps } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  bulkDeleteInactiveUsers,
  createUser,
  deleteUser,
  loadAutoCommunicationsConfig,
  notifyUserExpired,
  notifyUserExpiring,
  patchUser,
  pushAllUserClients,
  renewUserSubscription,
  resetUserTraffic,
  setUserTrafficUsed,
  syncUserStatsFromServers,
  type CreateUserPayload,
  type ServerDto,
  type UserDto,
  userPreview,
} from "../api";
import {
  formatNotifyExpiredError,
  formatNotifyExpiryError,
  setExpiryDaysBefore,
  userExpiredNotifyEligible,
  userExpiryBellEligible,
} from "../expiryNotify";
import { isAdminMobileShell } from "../adminMobile";
import { subscriptionLabel } from "../subscriptionLabel";
import { usePanelTabParam } from "../lib/panelTabRoute";
import DashboardLayout from "../components/DashboardLayout";
import CreateSubscriptionLoader from "../components/CreateSubscriptionLoader";
import PageLoadingState from "../components/PageLoadingState";
import Spinner from "../components/Spinner";
import UserModal from "../components/UserModal";
import TrafficUsedSlider from "../components/TrafficUsedSlider";
import WebAppPreviewPanel from "../components/WebAppPreviewPanel";
import { usePanelSettings } from "../panelSettingsContext";
import { useModalEscape } from "../hooks/useModalEscape";
import { notifyUsersChanged, USERS_CHANGED_EVENT } from "../usersEvents";
import { readUsersListCache, writeUsersListCache } from "../usersListCache";
import { prefetchUsersInBackground, USERS_CACHE_UPDATED_EVENT } from "../usersPrefetch";
import { hideUserId, pruneHiddenUserIds, readHiddenUserIds, unhideUserId } from "../usersHidden";

const BYTES_PER_GB = 1073741824;
const DAY_MS = 24 * 60 * 60 * 1000;
const SYNC_STATS_TIMEOUT_MS = 45_000;
const PREVIEW_CONCURRENCY = 2;
const PREVIEW_TIMEOUT_MS = 12_000;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function usedBytes(u: UserDto): number {
  return (Number(u.traffic_up) || 0) + (Number(u.traffic_down) || 0);
}

function formatUsedGb(u: UserDto): string {
  return `${(usedBytes(u) / BYTES_PER_GB).toFixed(2)} GB`;
}

function ruDaysWord(n: number): string {
  const abs = Math.abs(Math.floor(n)) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return "дней";
  if (d === 1) return "день";
  if (d >= 2 && d <= 4) return "дня";
  return "дней";
}

function nodesCountLabel(u: UserDto, previewCount: number | undefined, deployedTotal: number): string {
  if (!clientAlive(u)) return "0";
  const base = u.subscription_nodes_count;
  if (base != null) {
    if (previewCount != null && previewCount > base) return String(previewCount);
    return String(base);
  }
  if (previewCount != null) return String(previewCount);
  const servers = u.subscription_server_ids?.length ?? 0;
  const vault = u.config_vault_links_count ?? u.config_vault_links?.length ?? 0;
  const manual = u.extra_vless_links?.length ?? 0;
  if (servers + vault + manual > 0) return String(servers + vault + manual);
  if (servers > 0) return String(servers);
  if (u.subscription_server_count > 0) return String(u.subscription_server_count);
  if (deployedTotal > 0) return String(deployedTotal + vault);
  return "—";
}

function nodesSubLabel(u: UserDto): string {
  if (!clientAlive(u)) return "неактивна";
  const servers = u.subscription_server_ids?.length ?? 0;
  const vault = u.config_vault_links_count ?? u.config_vault_links?.length ?? 0;
  if (servers > 0 && vault > 0) return `${servers} + ${vault} хран.`;
  if (servers > 0) {
    return u.subscription_server_count === 0 ? `все (${servers})` : `${servers} узл.`;
  }
  if (u.subscription_server_count > 0) return `≤ ${u.subscription_server_count}`;
  return vault > 0 ? `+${vault} хран.` : "все";
}

function trafficPercent(u: UserDto): number {
  if (!u.total_gb || u.total_gb <= 0) return 0;
  const lim = u.total_gb * BYTES_PER_GB;
  return Math.min(100, (usedBytes(u) / lim) * 100);
}

function isBotAutoEmail(email: string): boolean {
  return /@tg\.vpn$/i.test((email ?? "").trim());
}

function expiryPill(u: UserDto): { text: string; variant: "ok" | "bad" | "muted" } {
  if (!u.expiry_time) return { text: "без срока", variant: "muted" };
  const now = Date.now();
  if (u.expiry_time <= now) return { text: "истёк", variant: "bad" };
  const days = Math.floor((startOfLocalDay(u.expiry_time) - startOfLocalDay(now)) / DAY_MS);
  if (days <= 0) return { text: "сегодня", variant: "ok" };
  if (days === 1) return { text: "1 день", variant: "ok" };
  if (days >= 2 && days <= 4) return { text: `через ${days} дня`, variant: "ok" };
  return { text: `через ${days} дней`, variant: "ok" };
}

function expirySortKeyNearest(u: UserDto): number {
  return u.expiry_time > 0 ? u.expiry_time : Number.POSITIVE_INFINITY;
}

function expirySortKeyFurthest(u: UserDto): number {
  return u.expiry_time > 0 ? u.expiry_time : Number.MAX_SAFE_INTEGER;
}

/** Текст подсказки: до какой даты и времени действует подписка (expiry_time — момент окончания в браузере). */
function formatExpiryDetailText(u: UserDto): string {
  if (!u.expiry_time || u.expiry_time <= 0) return "Подписка без ограничения по дате и времени.";
  const d = new Date(u.expiry_time);
  return `Действует до: ${d.toLocaleString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

type SortTri = 0 | 1 | 2;

function clientAlive(u: UserDto): boolean {
  if (!u.enable) return false;
  if (u.expiry_time > 0 && u.expiry_time <= Date.now()) return false;
  if (u.total_gb > 0) {
    const lim = u.total_gb * BYTES_PER_GB;
    if (usedBytes(u) >= lim) return false;
  }
  return true;
}

function matchesUserSearch(u: UserDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return String(u.id).includes(q) || String(u.name ?? "").toLowerCase().includes(q);
}

function IconPencil(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function IconCopy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <rect x={9} y={9} width={13} height={13} rx={2} />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconTrash(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function IconSync(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M21 21v-5h-5" />
    </svg>
  );
}

function IconBell(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconResetTraffic(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M9 12h6" />
    </svg>
  );
}

function IconEye(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPower(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M12 2v10" />
      <path d="M18.36 6.64a9 9 0 1 1-12.72 0" />
    </svg>
  );
}

function IconRenew(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M12 14v4M10 16h4" />
    </svg>
  );
}

type UserModalState = { kind: "closed" } | { kind: "create" } | { kind: "edit"; userId: number };
const USERS_TABS = ["active", "inactive", "preview"] as const;

export default function UsersPage({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tab: activeTab, setTab: setActiveTab } = usePanelTabParam("/users", USERS_TABS);
  const panel = usePanelSettings();
  const manualTrafficAdjust = panel.settings?.security.manualTrafficAdjust === true;
  const webAppPreviewEnabled = panel.settings?.ui.webAppPreviewEnabled !== false;
  const [users, setUsers] = useState<UserDto[]>(() => readUsersListCache()?.users ?? []);
  const [pageLoading, setPageLoading] = useState(() => !(readUsersListCache()?.users?.length));
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previews, setPreviews] = useState<Record<number, { count: number }>>(
    () => readUsersListCache()?.previews ?? {},
  );
  const [modal, setModal] = useState<UserModalState>({ kind: "closed" });
  const [deployedServers, setDeployedServers] = useState<ServerDto[]>(
    () => readUsersListCache()?.deployedServers ?? [],
  );
  const [toggleBusyId, setToggleBusyId] = useState<number | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);
  const [copyBusyId, setCopyBusyId] = useState<number | null>(null);
  const [notifyBusyId, setNotifyBusyId] = useState<number | null>(null);
  const [resetBusyId, setResetBusyId] = useState<number | null>(null);
  const [renewBusyId, setRenewBusyId] = useState<number | null>(null);
  const [trafficAdjustBusyId, setTrafficAdjustBusyId] = useState<number | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [expandedInfoId, setExpandedInfoId] = useState<number | null>(null);
  const [expirySort, setExpirySort] = useState<SortTri>(0);
  const [trafficSort, setTrafficSort] = useState<SortTri>(0);
  const [expiryTipUserId, setExpiryTipUserId] = useState<number | null>(null);
  const [inactiveDeleteOpen, setInactiveDeleteOpen] = useState(false);
  const [inactiveDeleteBusy, setInactiveDeleteBusy] = useState(false);
  const [inactiveSelectedIds, setInactiveSelectedIds] = useState<number[]>([]);
  const [inactiveDeleteSendMessage, setInactiveDeleteSendMessage] = useState(false);
  const [inactiveDeleteMessage, setInactiveDeleteMessage] = useState("");
  const [inactiveDeleteWarnOpen, setInactiveDeleteWarnOpen] = useState(false);
  const [inactiveDeletePendingIds, setInactiveDeletePendingIds] = useState<number[]>([]);
  useModalEscape(() => {
    if (inactiveDeleteBusy) return;
    if (inactiveDeleteWarnOpen) {
      setInactiveDeleteWarnOpen(false);
      setInactiveDeletePendingIds([]);
      return;
    }
    if (inactiveDeleteOpen) setInactiveDeleteOpen(false);
  }, (inactiveDeleteOpen || inactiveDeleteWarnOpen) && !inactiveDeleteBusy);
  const [mobileShell, setMobileShell] = useState(() => isAdminMobileShell());
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenUserIds, setHiddenUserIds] = useState<number[]>(() => readHiddenUserIds());
  const [showHiddenUsers, setShowHiddenUsers] = useState(false);
  const [usersHelpOpen, setUsersHelpOpen] = useState(false);
  const [notifyHints, setNotifyHints] = useState({ daysBefore: 3, lowGb: 30, expiryOn: true, trafficOn: true });
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const statsSyncRunningRef = useRef(false);

  const sortedUsers = useMemo(() => {
    const arr = [...users];
    if (expirySort === 1) {
      arr.sort((a, b) => expirySortKeyNearest(a) - expirySortKeyNearest(b) || a.id - b.id);
    } else if (expirySort === 2) {
      arr.sort((a, b) => expirySortKeyFurthest(b) - expirySortKeyFurthest(a) || a.id - b.id);
    } else if (trafficSort === 1) {
      arr.sort((a, b) => usedBytes(a) - usedBytes(b) || a.id - b.id);
    } else if (trafficSort === 2) {
      arr.sort((a, b) => usedBytes(b) - usedBytes(a) || a.id - b.id);
    }
    return arr;
  }, [users, expirySort, trafficSort]);

  const inactiveUsers = useMemo(
    () => sortedUsers.filter((u) => u.expiry_time > 0 && u.expiry_time <= Date.now()),
    [sortedUsers],
  );
  const activeUsers = useMemo(
    () => sortedUsers.filter((u) => !(u.expiry_time > 0 && u.expiry_time <= Date.now())),
    [sortedUsers],
  );
  const hiddenUserIdSet = useMemo(() => new Set(hiddenUserIds), [hiddenUserIds]);
  const activeUsersListed = useMemo(
    () => (showHiddenUsers ? activeUsers : activeUsers.filter((u) => !hiddenUserIdSet.has(u.id))),
    [activeUsers, showHiddenUsers, hiddenUserIdSet],
  );
  const inactiveUsersListed = useMemo(
    () => (showHiddenUsers ? inactiveUsers : inactiveUsers.filter((u) => !hiddenUserIdSet.has(u.id))),
    [inactiveUsers, showHiddenUsers, hiddenUserIdSet],
  );
  const visibleUsers = activeTab === "inactive" ? inactiveUsersListed : activeUsersListed;
  const filteredUsers = useMemo(
    () => visibleUsers.filter((u) => matchesUserSearch(u, searchQuery)),
    [visibleUsers, searchQuery],
  );
  const inactiveSelectedUsers = useMemo(
    () => inactiveUsers.filter((u) => inactiveSelectedIds.includes(u.id)),
    [inactiveUsers, inactiveSelectedIds],
  );
  const inactiveMissingTgUsers = useMemo(
    () => inactiveSelectedUsers.filter((u) => !String(u.tg_id ?? "").trim()),
    [inactiveSelectedUsers],
  );

  useEffect(() => {
    void loadAutoCommunicationsConfig()
      .then((cfg) => {
        setExpiryDaysBefore(cfg.expiry.days_before);
        setNotifyHints({
          daysBefore: Math.max(1, Math.floor(Number(cfg.expiry.days_before) || 3)),
          lowGb: Math.max(1, Math.floor(Number(cfg.traffic.low_gb_threshold) || 30)),
          expiryOn: cfg.expiry.enabled === true,
          trafficOn: cfg.traffic.enabled === true,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = Math.floor(Number(searchParams.get("user") || 0));
    if (id <= 0) return;
    if (!users.some((u) => u.id === id)) return;
    setModal((cur) => (cur.kind === "edit" && cur.userId === id ? cur : { kind: "edit", userId: id }));
  }, [searchParams, users]);

  const closeUserModal = useCallback(() => {
    setModal({ kind: "closed" });
    if (searchParams.has("user")) {
      const next = new URLSearchParams(searchParams);
      next.delete("user");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const openWebAppPreview = useCallback(
    (u: UserDto) => {
      if (!webAppPreviewEnabled) return;
      const tg = Math.floor(Number(String(u.tg_id || "").trim()));
      if (!Number.isFinite(tg) || tg <= 0) {
        setMsg({ type: "err", text: "У клиента нет Telegram ID" });
        return;
      }
      setModal({ kind: "closed" });
      navigate(`/users/preview?tgId=${tg}`);
    },
    [navigate, webAppPreviewEnabled],
  );

  useEffect(() => {
    if (webAppPreviewEnabled) return;
    if (activeTab === "preview") setActiveTab("active");
  }, [webAppPreviewEnabled, activeTab, setActiveTab]);

  useEffect(() => {
    if (expiryTipUserId == null) return;
    const closeTip = () => setExpiryTipUserId(null);
    const onDocDown = (e: MouseEvent) => {
      const el = document.getElementById(`ud-expiry-host-${expiryTipUserId}`);
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      closeTip();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTip();
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", closeTip);
    window.addEventListener("scroll", closeTip, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", closeTip);
      window.removeEventListener("scroll", closeTip, true);
    };
  }, [expiryTipUserId]);

  useEffect(() => {
    setMobileShell(isAdminMobileShell());
    const mq = window.matchMedia("(max-width: 960px)");
    const onMq = () => setMobileShell(isAdminMobileShell());
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  const tableLocked =
    refreshing ||
    deleteBusyId !== null ||
    notifyBusyId !== null ||
    resetBusyId !== null ||
    renewBusyId !== null ||
    syncBusy ||
    inactiveDeleteBusy;

  function onHideUserToggle(u: UserDto) {
    if (hiddenUserIdSet.has(u.id)) {
      setHiddenUserIds(unhideUserId(u.id));
    } else {
      setHiddenUserIds(hideUserId(u.id));
    }
  }

  function renderHideUserButton(u: UserDto, className?: string) {
    const isHidden = hiddenUserIdSet.has(u.id);
    return (
      <button
        type="button"
        className={`ud-hide-user-btn ${isHidden && showHiddenUsers ? "ud-hide-user-btn--revealed" : ""} ${className ?? ""}`.trim()}
        title={isHidden ? "Вернуть в список" : "Скрыть из списка"}
        aria-label={isHidden ? "Вернуть в список" : "Скрыть из списка"}
        onClick={() => onHideUserToggle(u)}
      >
        <IconEye />
      </button>
    );
  }

  const applyUsersSnapshot = useCallback((users: UserDto[], deployedServers: ServerDto[]) => {
    setUsers(users);
    setDeployedServers(deployedServers);
  }, []);

  const commitTrafficUsed = useCallback(
    async (u: UserDto, usedGb: number) => {
      setTrafficAdjustBusyId(u.id);
      setMsg(null);
      try {
        const r = await setUserTrafficUsed(u.id, usedGb);
        setUsers((cur) => {
          const next = cur.map((row) => (row.id === r.user.id ? r.user : row));
          writeUsersListCache({
            users: next,
            previews: readUsersListCache()?.previews ?? {},
            deployedServers: readUsersListCache()?.deployedServers ?? deployedServers,
          });
          return next;
        });
        notifyUsersChanged();
      } catch (err) {
        setMsg({ type: "err", text: String(err) });
        throw err;
      } finally {
        setTrafficAdjustBusyId(null);
      }
    },
    [deployedServers],
  );

  function renderTrafficCell(u: UserDto, opts?: { mobile?: boolean }) {
    const pct = trafficPercent(u);
    if (manualTrafficAdjust && u.total_gb > 0) {
      return (
        <TrafficUsedSlider
          user={u}
          className={opts?.mobile ? "users-mobile-traffic-slider" : undefined}
          disabled={trafficAdjustBusyId === u.id || tableLocked}
          onCommit={(gb) => commitTrafficUsed(u, gb)}
        />
      );
    }
    return (
      <>
        <div className={opts?.mobile ? "users-mobile-traffic-value" : "ud-traffic-used"}>{formatUsedGb(u)}</div>
        <div
          className={`ud-traffic-bar-wrap${opts?.mobile ? " users-mobile-traffic-bar" : ""}`}
          title={u.total_gb > 0 ? `Лимит ${u.total_gb} GB` : "Без лимита"}
        >
          <div className="ud-traffic-bar-fill" style={{ width: `${u.total_gb > 0 ? pct : 0}%` }} />
        </div>
        <div className="ud-traffic-cap muted">{u.total_gb > 0 ? `${u.total_gb} GB` : "∞"}</div>
      </>
    );
  }

  const loadUsersSnapshot = useCallback(async () => {
    const data = await prefetchUsersInBackground({ force: true });
    applyUsersSnapshot(data.users, data.deployedServers);
    return { users: data.users, deployedServers: data.deployedServers };
  }, [applyUsersSnapshot]);

  const loadPreviewCounts = useCallback(async (nextUsers: UserDto[], nextDeployedServers: ServerDto[]) => {
    previewAbortRef.current?.abort();
    const ac = new AbortController();
    previewAbortRef.current = ac;
    const prev = readUsersListCache()?.previews ?? {};
    const pv: Record<number, { count: number }> = { ...prev };
    const queue = [...nextUsers];

    async function fetchCount(id: number): Promise<number> {
      if (ac.signal.aborted) return pv[id]?.count ?? 0;
      try {
        const p = await Promise.race([
          userPreview(id),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), PREVIEW_TIMEOUT_MS)),
        ]);
        return p.count;
      } catch {
        return pv[id]?.count ?? 0;
      }
    }

    async function worker() {
      while (queue.length > 0 && !ac.signal.aborted) {
        const u = queue.shift();
        if (!u) break;
        const count = await fetchCount(u.id);
        if (ac.signal.aborted) return;
        pv[u.id] = { count };
        setPreviews((cur) => ({ ...cur, [u.id]: { count } }));
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(PREVIEW_CONCURRENCY, Math.max(1, nextUsers.length)) }, () => worker()),
    );
    if (ac.signal.aborted) return;
    writeUsersListCache({
      users: nextUsers,
      previews: pv,
      deployedServers: nextDeployedServers,
    });
  }, []);

  const schedulePreviewCounts = useCallback(
    (nextUsers: UserDto[], nextDeployedServers: ServerDto[]) => {
      if (previewTimerRef.current != null) window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = window.setTimeout(() => {
        previewTimerRef.current = null;
        void loadPreviewCounts(nextUsers, nextDeployedServers);
      }, 800);
    },
    [loadPreviewCounts],
  );

  const runBackgroundStatsSync = useCallback(async () => {
    if (statsSyncRunningRef.current) return;
    statsSyncRunningRef.current = true;
    setStatsRefreshing(true);
    try {
      const result = await Promise.race([
        syncUserStatsFromServers(),
        new Promise<"timeout">((resolve) => window.setTimeout(() => resolve("timeout"), SYNC_STATS_TIMEOUT_MS)),
      ]);
      if (result !== "timeout" && result.errors?.length) {
        const errs = result.errors.filter((e) => e !== "timeout");
        if (errs.length) {
          setMsg({ type: "err", text: `Статистика с узлов: ${errs.join("; ")}` });
        }
      }
      if (result !== "timeout") {
        const synced = await loadUsersSnapshot();
        schedulePreviewCounts(synced.users, synced.deployedServers);
      }
    } catch {
      /* список уже показан */
    } finally {
      statsSyncRunningRef.current = false;
      setStatsRefreshing(false);
    }
  }, [loadUsersSnapshot, schedulePreviewCounts]);

  const refresh = useCallback(
    async (opts?: { silent?: boolean; skipSync?: boolean }) => {
      if (!opts?.silent) setRefreshing(true);
      try {
        const snapshot = await loadUsersSnapshot();
        schedulePreviewCounts(snapshot.users, snapshot.deployedServers);
        if (!opts?.skipSync) {
          void runBackgroundStatsSync();
        }
      } finally {
        if (!opts?.silent) setRefreshing(false);
      }
    },
    [loadUsersSnapshot, runBackgroundStatsSync, schedulePreviewCounts],
  );

  useEffect(() => {
    const cached = readUsersListCache();
    if (cached?.users?.length) {
      applyUsersSnapshot(cached.users, cached.deployedServers);
      if (Object.keys(cached.previews).length > 0) setPreviews(cached.previews);
    }

    void (async () => {
      try {
        const data = await prefetchUsersInBackground({ force: !cached?.users?.length });
        applyUsersSnapshot(data.users, data.deployedServers);
        schedulePreviewCounts(data.users, data.deployedServers);
        void runBackgroundStatsSync();
      } catch (e) {
        setMsg({ type: "err", text: String(e) });
      } finally {
        setPageLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- начальная загрузка один раз
  }, []);

  useEffect(() => {
    const onCache = (e: Event) => {
      const detail = (e as CustomEvent<{ users: UserDto[]; deployedServers: ServerDto[]; previews: Record<number, { count: number }> }>).detail;
      if (!detail?.users) return;
      applyUsersSnapshot(detail.users, detail.deployedServers);
      if (Object.keys(detail.previews ?? {}).length > 0) setPreviews(detail.previews);
    };
    window.addEventListener(USERS_CACHE_UPDATED_EVENT, onCache);
    return () => window.removeEventListener(USERS_CACHE_UPDATED_EVENT, onCache);
  }, [applyUsersSnapshot]);

  useEffect(() => {
    const onUsersChanged = () => {
      void refresh({ silent: true, skipSync: true }).catch((e) => setMsg({ type: "err", text: String(e) }));
    };
    window.addEventListener(USERS_CHANGED_EVENT, onUsersChanged);
    return () => window.removeEventListener(USERS_CHANGED_EVENT, onUsersChanged);
  }, [refresh]);

  useEffect(() => {
    if (users.length === 0) return;
    setHiddenUserIds((cur) => {
      const pruned = pruneHiddenUserIds(users.map((u) => u.id));
      if (pruned.length === cur.length && pruned.every((id, i) => id === cur[i])) return cur;
      return pruned;
    });
  }, [users]);

  useEffect(() => {
    if (hiddenUserIds.length === 0) setShowHiddenUsers(false);
  }, [hiddenUserIds.length]);

  useEffect(() => {
    setInactiveSelectedIds((cur) => cur.filter((id) => inactiveUsers.some((u) => u.id === id)));
  }, [inactiveUsers]);

  useEffect(() => {
    if (!inactiveDeleteOpen) return;
    setInactiveSelectedIds(inactiveUsers.map((u) => u.id));
  }, [inactiveDeleteOpen, inactiveUsers]);

  async function onSubmitEdit(id: number, payload: CreateUserPayload) {
    const { user } = await patchUser(id, payload);
    setUsers((prev) => {
      const next = prev.map((u) => (u.id === user.id ? user : u));
      writeUsersListCache({ users: next, previews, deployedServers });
      return next;
    });
    setMsg({ type: "ok", text: `Сохранено: «${user.name}».` });
  }

  function onCreateUser(payload: CreateUserPayload) {
    setMsg(null);
    setCreatingUser(true);
    void (async () => {
      try {
        const { user } = await createUser(payload);
        await prefetchUsersInBackground({ force: true });
        notifyUsersChanged();
        setMsg({ type: "ok", text: `Создан клиент «${user.name}». Подписка: ${user.subscription_url}` });
      } catch (e) {
        setMsg({ type: "err", text: String(e) });
      } finally {
        setCreatingUser(false);
      }
    })();
  }

  async function onPushAll() {
    setSyncBusy(true);
    setMsg(null);
    try {
      await pushAllUserClients();
      setMsg({ type: "ok", text: "Клиенты отправлены на серверы (синхронизация)." });
      await refresh();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSyncBusy(false);
    }
  }

  async function performDeleteInactiveSelected(ids: number[]) {
    const selected = inactiveUsers.filter((u) => ids.includes(u.id));
    if (selected.length === 0) {
      setMsg({ type: "err", text: "Выберите хотя бы одну неактивную подписку." });
      return;
    }

    const rollbackUsers = users;
    const rollbackPreviews = previews;
    const selectedSet = new Set(selected.map((u) => u.id));
    setUsers((cur) => cur.filter((u) => !selectedSet.has(u.id)));
    setPreviews((cur) => {
      const next = { ...cur };
      for (const id of selectedSet) delete next[id];
      return next;
    });
    writeUsersListCache({
      users: rollbackUsers.filter((u) => !selectedSet.has(u.id)),
      previews: Object.fromEntries(Object.entries(rollbackPreviews).filter(([k]) => !selectedSet.has(Number(k)))),
      deployedServers,
    });
    setInactiveDeleteOpen(false);
    setInactiveDeleteWarnOpen(false);
    setInactiveDeletePendingIds([]);
    setInactiveDeleteSendMessage(false);
    setInactiveDeleteMessage("");
    setInactiveSelectedIds([]);
    setInactiveDeleteBusy(true);
    setMsg({ type: "ok", text: `Удаляем ${selected.length} неактивных подписок…` });
    try {
      const result = await bulkDeleteInactiveUsers({
        user_ids: selected.map((u) => u.id),
        send_message: inactiveDeleteSendMessage,
        message: inactiveDeleteSendMessage ? inactiveDeleteMessage.trim() : "",
      });
      await refresh();

      const parts = [`Удалено ${result.deleted} из ${result.attempted} истёкших подписок.`];
      if (inactiveDeleteSendMessage) {
        parts.push(`Сообщение отправлено: ${result.notified}.`);
        if (result.notify_failures.length > 0) {
          parts.push(`Не удалось отправить: ${result.notify_failures.map((x) => x.user_name).join(", ")}.`);
        }
      }
      if (result.delete_failures.length > 0) {
        parts.push(`Не удалены: ${result.delete_failures.map((x) => x.user_name).join(", ")}.`);
      }
      setMsg({ type: result.delete_failures.length > 0 ? "err" : "ok", text: parts.join(" ") });
    } catch (e) {
      setUsers(rollbackUsers);
      setPreviews(rollbackPreviews);
      writeUsersListCache({
        users: rollbackUsers,
        previews: rollbackPreviews,
        deployedServers,
      });
      await refresh().catch(() => undefined);
      setMsg({ type: "err", text: String(e) });
    } finally {
      setInactiveDeleteBusy(false);
    }
  }

  async function onDeleteInactiveSelected() {
    if (inactiveSelectedUsers.length === 0) {
      setMsg({ type: "err", text: "Выберите хотя бы одну неактивную подписку." });
      return;
    }
    if (inactiveDeleteSendMessage && !inactiveDeleteMessage.trim()) {
      setMsg({ type: "err", text: "Введите текст сообщения перед удалением." });
      return;
    }
    if (inactiveDeleteSendMessage && inactiveMissingTgUsers.length > 0) {
      setInactiveDeletePendingIds(inactiveSelectedUsers.map((u) => u.id));
      setInactiveDeleteWarnOpen(true);
      return;
    }
    await performDeleteInactiveSelected(inactiveSelectedUsers.map((u) => u.id));
  }

  function expiryTooltipStyle(userId: number): CSSProperties {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return { position: "fixed", top: 72, left: 12 };
    }
    const host = document.getElementById(`ud-expiry-host-${userId}`);
    if (!host) return { position: "fixed", top: 72, left: 12 };
    const rect = host.getBoundingClientRect();
    const maxWidth = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - maxWidth - 12));
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 140));
    return {
      position: "fixed",
      left,
      top,
      maxWidth,
      zIndex: 9999,
    };
  }

  function renderExpiryControl(u: UserDto, ex: { text: string; variant: "ok" | "bad" | "muted" }, className?: string) {
    return (
      <div className={`ud-expiry-wrap ${className ?? ""}`.trim()} id={`ud-expiry-host-${u.id}`}>
        <button
          type="button"
          className={`ud-pill ud-pill-expiry ud-expiry-${ex.variant} ud-expiry-pill-btn`}
          title="Нажмите, чтобы показать дату и время окончания"
          aria-expanded={expiryTipUserId === u.id}
          onClick={(e) => {
            e.stopPropagation();
            setExpiryTipUserId((id) => (id === u.id ? null : u.id));
          }}
        >
          {ex.text}
        </button>
        {expiryTipUserId === u.id ? (
          <div className="ud-expiry-tooltip" role="tooltip" style={expiryTooltipStyle(u.id)}>
            {formatExpiryDetailText(u)}
          </div>
        ) : null}
      </div>
    );
  }

  function toggleUser(u: UserDto) {
    void (async () => {
      setToggleBusyId(u.id);
      setMsg(null);
      try {
        await patchUser(u.id, { enable: !u.enable });
        await refresh();
      } catch (err) {
        setMsg({ type: "err", text: String(err) });
      } finally {
        setToggleBusyId(null);
      }
    })();
  }

  async function onRenewInactive(u: UserDto) {
    const trafficNote =
      u.total_gb > 0
        ? "Использованный трафик будет обнулён по лимиту тарифа."
        : "Трафик безлимитный — сброс не нужен.";
    if (
      !confirm(
        `Продлить «${u.name}» на 30 дней?\n\nНовый срок от сегодня.\n${trafficNote}\nКлиенту уйдёт сообщение в Telegram.`,
      )
    ) {
      return;
    }
    setRenewBusyId(u.id);
    setMsg(null);
    const startedAt = Date.now();
    try {
      const r = await renewUserSubscription(u.id);
      // Даём доиграть заливку строки, пока пользователь ещё в «Неактивных».
      const minMs = 1200;
      const left = minMs - (Date.now() - startedAt);
      if (left > 0) await new Promise((resolve) => window.setTimeout(resolve, left));
      await refresh();
      const until = r.user.expiry_time
        ? new Date(r.user.expiry_time).toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "—";
      const tgNote = r.telegram_notified
        ? " Клиенту отправлено уведомление."
        : r.telegram_error
          ? ` Telegram: ${r.telegram_error}`
          : String(u.tg_id || "").trim()
            ? ""
            : " Telegram не указан — сообщение не отправлено.";
      setMsg({
        type: "ok",
        text: `«${u.name}» продлена до ${until}${r.traffic_reset ? ", трафик обнулён" : ""}.${tgNote}`,
      });
    } catch (err) {
      setMsg({ type: "err", text: String(err) });
    } finally {
      setRenewBusyId(null);
    }
  }

  function renderRenewInactiveButton(u: UserDto) {
    if (activeTab !== "inactive") return null;
    return (
      <button
        type="button"
        className={`ud-tool ud-tool-success${renewBusyId === u.id ? " is-busy" : ""}`}
        title="Продлить на 30 дней и уведомить клиента"
        aria-label="Продлить"
        disabled={renewBusyId === u.id || tableLocked}
        onClick={() => void onRenewInactive(u)}
      >
        {renewBusyId === u.id ? <Spinner /> : <IconRenew />}
      </button>
    );
  }

  function renderUserToolbar(u: UserDto, opts?: { mobile?: boolean }) {
    const mobile = opts?.mobile === true;
    return (
      <div className="ud-toolbar" role="group" aria-label="Действия по клиенту">
        {renderRenewInactiveButton(u)}
        <button
          type="button"
          className="ud-tool"
          title="Изменить"
          aria-label="Изменить"
          disabled={tableLocked}
          onClick={() => setModal({ kind: "edit", userId: u.id })}
        >
          <IconPencil />
        </button>
        {webAppPreviewEnabled ? (
          <button
            type="button"
            className="ud-tool"
            title="Превью WebApp"
            aria-label="Превью WebApp"
            disabled={!String(u.tg_id || "").trim()}
            onClick={() => openWebAppPreview(u)}
          >
            <IconEye />
          </button>
        ) : null}
        {mobile ? (
          <button
            type="button"
            className={`ud-tool ${u.enable ? "ud-tool-success" : "ud-tool-danger"}`}
            title={u.enable ? "Выключить" : "Включить"}
            aria-label={u.enable ? "Выключить" : "Включить"}
            disabled={toggleBusyId === u.id || tableLocked}
            onClick={() => toggleUser(u)}
          >
            {toggleBusyId === u.id ? <Spinner /> : <IconPower />}
          </button>
        ) : null}
        <button
          type="button"
          className="ud-tool"
          title="Отправить список UUID клиентов на все развёрнутые серверы"
          aria-label="Отправить UUID на серверы"
          disabled={syncBusy}
          onClick={() => void onPushAll()}
        >
          <IconSync />
        </button>
        <button
          type="button"
          className="ud-tool"
          title="Обнулить трафик"
          aria-label="Обнулить трафик"
          disabled={resetBusyId === u.id || tableLocked}
          onClick={() => {
            if (!confirm(`Обнулить трафик у «${u.name}»?`)) return;
            void (async () => {
              setResetBusyId(u.id);
              setMsg(null);
              try {
                await resetUserTraffic(u.id);
                setMsg({ type: "ok", text: `Трафик «${u.name}» обнулён.` });
                await refresh();
              } catch (err) {
                setMsg({ type: "err", text: String(err) });
              } finally {
                setResetBusyId(null);
              }
            })();
          }}
        >
          {resetBusyId === u.id ? <Spinner /> : <IconResetTraffic />}
        </button>
        <button
          type="button"
          className="ud-tool"
          title="Копировать URL подписки"
          aria-label="Копировать URL подписки"
          disabled={copyBusyId === u.id}
          onClick={() => {
            setCopyBusyId(u.id);
            void navigator.clipboard.writeText(u.subscription_url).finally(() => {
              window.setTimeout(() => setCopyBusyId((id) => (id === u.id ? null : id)), 500);
            });
          }}
        >
          <IconCopy />
        </button>
        {userExpiryBellEligible(u) ? (
          <button
            type="button"
            className={`ud-tool${userExpiredNotifyEligible(u) ? " ud-tool-warn" : ""}`}
            title={
              userExpiredNotifyEligible(u)
                ? "Подписка истекла — отправить в Telegram"
                : "Напоминание в Telegram (истекает ≤ 3 суток)"
            }
            aria-label={
              userExpiredNotifyEligible(u) ? "Уведомить об истечении подписки" : "Напоминание в Telegram"
            }
            disabled={notifyBusyId === u.id || tableLocked}
            onClick={() => {
              void (async () => {
                setNotifyBusyId(u.id);
                setMsg(null);
                const expired = userExpiredNotifyEligible(u);
                try {
                  if (expired) {
                    await notifyUserExpired(u.id);
                    setMsg({ type: "ok", text: `Telegram: подписка «${u.name}» истекла.` });
                  } else {
                    await notifyUserExpiring(u.id);
                    setMsg({ type: "ok", text: `Telegram: напоминание «${u.name}».` });
                  }
                } catch (err) {
                  setMsg({
                    type: "err",
                    text: expired ? formatNotifyExpiredError(String(err)) : formatNotifyExpiryError(String(err)),
                  });
                } finally {
                  setNotifyBusyId(null);
                }
              })();
            }}
          >
            {notifyBusyId === u.id ? <Spinner /> : <IconBell />}
          </button>
        ) : null}
        <button
          type="button"
          className="ud-tool ud-tool-danger"
          title="Удалить клиента"
          aria-label="Удалить"
          disabled={tableLocked || deleteBusyId === u.id}
          onClick={async () => {
            if (!confirm(`Удалить «${u.name}»?`)) return;
            setDeleteBusyId(u.id);
            setMsg(null);
            try {
              await deleteUser(u.id);
              await refresh();
            } catch (err) {
              setMsg({ type: "err", text: String(err) });
            } finally {
              setDeleteBusyId(null);
            }
          }}
        >
          {deleteBusyId === u.id ? <Spinner /> : <IconTrash />}
        </button>
      </div>
    );
  }

  function renderUserOnlineStatus(u: UserDto) {
    if (u.stats_synced_at) {
      return (
        <span
          className={`ud-pill ${u.online ? "ud-pill-online" : "ud-pill-offline"}`}
          title={
            u.online
              ? "По данным Xray есть активные соединения для этого клиента"
              : "Нет активных соединений по последнему опросу узлов"
          }
        >
          {u.online ? "Онлайн" : "Офлайн"}
        </span>
      );
    }
    return (
      <span className="ud-pill ud-pill-stats-unknown" title="Ещё не было успешного опроса узлов">
        —
      </span>
    );
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <div className="users-hero-top">
          <div className="users-hero-title-row">
            <h1>Пользователи</h1>
            <button
              type="button"
              className={`users-help-toggle${usersHelpOpen ? " open" : ""}`}
              aria-expanded={usersHelpOpen}
              aria-controls="users-help-panel"
              onClick={() => setUsersHelpOpen((v) => !v)}
            >
              <span className="users-help-toggle-label">Справка</span>
              <span className="users-help-toggle-chevron" aria-hidden>
                {usersHelpOpen ? "▾" : "▸"}
              </span>
            </button>
          </div>
          <div className="users-hero-actions">
            <button
              type="button"
              className="primary"
              disabled={refreshing}
              onClick={() => setModal({ kind: "create" })}
            >
              Новый клиент
            </button>
          </div>
        </div>
        <div
          id="users-help-panel"
          className={`users-help-panel${usersHelpOpen ? " open" : ""}`}
          aria-hidden={!usersHelpOpen}
        >
          <div className="users-help-grid">
            <article className="users-help-card">
              <div className="users-help-card-kicker">Раздел</div>
              <h3 className="users-help-card-title">Клиенты и подписки</h3>
              <p className="users-help-card-text">
                Список VPN-клиентов: трафик, срок, онлайн и быстрые действия — без открытия карточки.
              </p>
            </article>
            <article className="users-help-card">
              <div className="users-help-card-kicker">Срок</div>
              <h3 className="users-help-card-title">
                {notifyHints.expiryOn
                  ? `Пуш за ${notifyHints.daysBefore} ${ruDaysWord(notifyHints.daysBefore)}`
                  : "Автопуш выключен"}
              </h3>
              <p className="users-help-card-text">
                {notifyHints.expiryOn
                  ? `Telegram-напоминание уходит, когда до окончания осталось ≤ ${notifyHints.daysBefore} дн. Нужен Chat ID.`
                  : "Напоминания о сроке сейчас отключены в автокоммуникациях."}
              </p>
            </article>
            <article className="users-help-card">
              <div className="users-help-card-kicker">Трафик</div>
              <h3 className="users-help-card-title">
                {notifyHints.trafficOn
                  ? `Пуш при ≤ ${notifyHints.lowGb} ГБ`
                  : "Автопуш выключен"}
              </h3>
              <p className="users-help-card-text">
                {notifyHints.trafficOn
                  ? `Сначала предупреждение, когда осталось ≤ ${notifyHints.lowGb} ГБ, затем ещё одно при полном исчерпании. Нужен Chat ID.`
                  : "Напоминания о трафике сейчас отключены в автокоммуникациях."}
              </p>
            </article>
          </div>
        </div>
        {creatingUser ? <CreateSubscriptionLoader /> : null}
        {msg && !creatingUser ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
      </section>

      <UserModal
        open={modal.kind !== "closed"}
        mode={modal.kind === "edit" ? "edit" : "create"}
        user={modal.kind === "edit" ? users.find((u) => u.id === modal.userId) ?? null : null}
        deployedServers={deployedServers}
        onClose={closeUserModal}
        onOpenWebAppPreview={webAppPreviewEnabled ? openWebAppPreview : undefined}
        onCreate={async (p) => {
          await onCreateUser(p);
        }}
        onUpdate={onSubmitEdit}
      />

      {inactiveDeleteOpen ? (
        <div className="modal-backdrop">
          <div className="modal users-inactive-delete-modal">
            <div className="modal-head">
              <h2>Удаление неактивных подписок</h2>
              <button
                type="button"
                className="ghost modal-close"
                onClick={() => setInactiveDeleteOpen(false)}
                disabled={inactiveDeleteBusy}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <div className="modal-body users-inactive-delete-body">
              <p className="sub" style={{ marginTop: 0, marginBottom: "0.8rem" }}>
                Выберите истёкшие подписки для удаления. При желании можно отправить Telegram-сообщение перед удалением.
              </p>
              <div className="users-inactive-delete-tools">
                <button
                  type="button"
                  className="ghost"
                  disabled={inactiveDeleteBusy || inactiveUsers.length === 0}
                  onClick={() => setInactiveSelectedIds(inactiveUsers.map((u) => u.id))}
                >
                  Выбрать все
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={inactiveDeleteBusy || inactiveSelectedIds.length === 0}
                  onClick={() => setInactiveSelectedIds([])}
                >
                  Снять выбор
                </button>
                <span className="field-hint">
                  Выбрано: {inactiveSelectedIds.length} из {inactiveUsers.length}
                </span>
              </div>
              <div className="users-inactive-delete-list">
                {inactiveUsers.map((u) => {
                  const checked = inactiveSelectedIds.includes(u.id);
                  return (
                    <label key={u.id} className="users-inactive-delete-item">
                      <span className="users-inactive-delete-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={inactiveDeleteBusy}
                          onChange={() =>
                            setInactiveSelectedIds((cur) =>
                              checked ? cur.filter((id) => id !== u.id) : [...cur, u.id].sort((a, b) => a - b),
                            )
                          }
                        />
                      </span>
                      <span className="users-inactive-delete-item-main">
                        <span className="users-inactive-delete-item-name">
                          {subscriptionLabel(u)}
                        </span>
                        <span className="users-inactive-delete-item-meta">
                          {u.expiry_time > 0 ? new Date(u.expiry_time).toLocaleString("ru-RU") : "Без даты"}
                          {u.tg_id ? ` · TG ${u.tg_id}` : " · без Telegram"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="users-inactive-delete-message-row">
                <div className="users-inactive-delete-message-copy">
                  <span className="users-inactive-delete-message-title">Отправить сообщение</span>
                  <span className="field-hint">Telegram перед удалением</span>
                </div>
                <button
                  type="button"
                  className={`toggle ${inactiveDeleteSendMessage ? "on" : ""}`}
                  disabled={inactiveDeleteBusy}
                  aria-pressed={inactiveDeleteSendMessage}
                  aria-label="Отправить сообщение перед удалением"
                  onClick={() => setInactiveDeleteSendMessage((v) => !v)}
                />
              </div>
              {inactiveDeleteSendMessage ? (
                <div className="form-field users-inactive-delete-message-field">
                  <label htmlFor="inactive-delete-message">Текст сообщения</label>
                  <textarea
                    id="inactive-delete-message"
                    className="users-inactive-delete-message-input"
                    value={inactiveDeleteMessage}
                    disabled={inactiveDeleteBusy}
                    onChange={(e) => setInactiveDeleteMessage(e.target.value)}
                    placeholder="Например: Ваша подписка истекла и была удалена. При необходимости оформите новую."
                    rows={4}
                  />
                </div>
              ) : null}
            </div>
            <div className="modal-footer users-inactive-modal-footer">
              <button
                type="button"
                className="ghost"
                onClick={() => setInactiveDeleteOpen(false)}
                disabled={inactiveDeleteBusy}
              >
                Отмена
              </button>
              <button
                type="button"
                className="danger"
                disabled={
                  inactiveDeleteBusy ||
                  inactiveSelectedIds.length === 0 ||
                  (inactiveDeleteSendMessage && !inactiveDeleteMessage.trim())
                }
                onClick={() => void onDeleteInactiveSelected()}
              >
                {inactiveDeleteBusy ? (
                  <>
                    <Spinner /> Удаление…
                  </>
                ) : inactiveDeleteSendMessage ? (
                  "Отправить и удалить"
                ) : (
                  "Удалить"
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {inactiveDeleteWarnOpen ? (
        <div className="modal-backdrop">
          <div className="modal users-inactive-warn-modal">
            <div className="modal-head">
              <h2>Не у всех есть Telegram ID</h2>
              <button
                type="button"
                className="ghost modal-close"
                onClick={() => {
                  setInactiveDeleteWarnOpen(false);
                  setInactiveDeletePendingIds([]);
                }}
                disabled={inactiveDeleteBusy}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="sub" style={{ marginTop: 0, marginBottom: "0.8rem" }}>
                У этих пользователей нет `tg_id`, поэтому сообщение им не отправится. Подписки всё равно можно удалить.
              </p>
              <div className="users-inactive-warn-list">
                {inactiveMissingTgUsers.map((u) => (
                  <div key={u.id} className="users-inactive-warn-item">
                    {subscriptionLabel(u)}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer users-inactive-modal-footer">
              <button
                type="button"
                className="ghost"
                disabled={inactiveDeleteBusy}
                onClick={() => {
                  setInactiveDeleteWarnOpen(false);
                  setInactiveDeletePendingIds([]);
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                className="danger"
                disabled={inactiveDeleteBusy}
                onClick={() => void performDeleteInactiveSelected(inactiveDeletePendingIds)}
              >
                Продолжить удаление
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="panel users-dash-panel">
        <div className="users-dash-top">
          <h1 className="users-dash-title">Список</h1>
          <div className="users-dash-actions">
            <div className="users-dash-refresh-col">
              {hiddenUserIds.length > 0 ? (
                <button
                  type="button"
                  className={`ud-show-hidden-btn ${showHiddenUsers ? "active" : ""}`}
                  title={showHiddenUsers ? "Снова скрыть" : `Показать скрытых (${hiddenUserIds.length})`}
                  aria-label={showHiddenUsers ? "Снова скрыть" : "Показать скрытых пользователей"}
                  aria-pressed={showHiddenUsers}
                  onClick={() => setShowHiddenUsers((v) => !v)}
                >
                  <IconEye />
                </button>
              ) : (
                <span className="ud-show-hidden-btn ud-show-hidden-btn--placeholder" aria-hidden="true" />
              )}
              <button
                type="button"
                className="ghost ud-sync-all"
                disabled={refreshing}
                onClick={() => void refresh()}
                title="Обновить список и статистику трафика/онлайн с узлов"
              >
                {refreshing ? (
                  <>
                    <Spinner /> Обновление…
                  </>
                ) : (
                  "Обновить"
                )}
              </button>
            </div>
            {refreshing ? (
              <span className="section-loading" title="Обновление…">
                <Spinner /> Обновление…
              </span>
            ) : null}
            {!refreshing && statsRefreshing ? (
              <span className="section-loading" title="Фоновое обновление данных">
                <Spinner /> Обновление данных…
              </span>
            ) : null}
          </div>
        </div>
        <div className="users-dash-filters">
          <div className="users-tabs" role="tablist" aria-label="Фильтр подписок">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "active"}
              className={`users-tab-button ${activeTab === "active" ? "active" : ""}`}
              onClick={() => setActiveTab("active")}
            >
              Активные
              <span className="users-tab-count">{activeUsersListed.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "inactive"}
              className={`users-tab-button ${activeTab === "inactive" ? "active" : ""}`}
              onClick={() => setActiveTab("inactive")}
            >
              Неактивные
              <span className="users-tab-count">{inactiveUsersListed.length}</span>
            </button>
            {webAppPreviewEnabled ? (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "preview"}
                className={`users-tab-button ${activeTab === "preview" ? "active" : ""}`}
                onClick={() => setActiveTab("preview")}
              >
                Превью WebApp
              </button>
            ) : null}
          </div>
          <div className="users-dash-filters-right">
            {activeTab === "inactive" ? (
              <button
                type="button"
                className="users-inline-danger"
                disabled={inactiveUsersListed.length === 0 || tableLocked}
                onClick={() => setInactiveDeleteOpen(true)}
              >
                Удалить неактивные
              </button>
            ) : null}
            {activeTab !== "preview" ? (
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по названию"
              className="users-search-input"
              autoComplete="off"
            />
            ) : null}
          </div>
        </div>
        {activeTab === "preview" && webAppPreviewEnabled ? (
          <WebAppPreviewPanel />
        ) : pageLoading && users.length === 0 ? (
          <PageLoadingState />
        ) : filteredUsers.length === 0 ? (
          <p className="sub" style={{ marginBottom: 0 }}>
            {searchQuery.trim()
              ? "Ничего не найдено."
              : activeTab === "inactive"
                ? "Нет истёкших подписок."
                : "Пока нет активных подписок — нажмите «Новый клиент» или «+» в шапке панели."}
          </p>
        ) : mobileShell ? (
          <div className="users-mobile-list">
            {filteredUsers.map((u) => {
              const ex = expiryPill(u);
              const alive = clientAlive(u);
              return (
                <article
                  key={u.id}
                  className={`users-mobile-card${renewBusyId === u.id ? " users-mobile-card--renewing" : ""}${hiddenUserIdSet.has(u.id) && showHiddenUsers ? " users-mobile-card--hidden-preview" : ""}`}
                >
                  <div className="users-mobile-card-head">
                    <div className="users-mobile-card-title-wrap">
                      <div className="ud-client-line users-mobile-card-title">
                        <span className={`ud-client-dot ${alive ? "ud-client-dot-on" : "ud-client-dot-off"}`} aria-hidden />
                        <span className="ud-client-name">{u.name}</span>
                      </div>
                      {renderHideUserButton(u, "ud-hide-user-btn--mobile")}
                    </div>
                    {renderExpiryControl(u, ex, "users-mobile-card-expiry")}
                    <div className="users-mobile-card-online">{renderUserOnlineStatus(u)}</div>
                  </div>

                  <div className="users-mobile-traffic">
                    <div className="users-mobile-stat-label">Трафик</div>
                    {renderTrafficCell(u, { mobile: true })}
                  </div>

                  {renderUserToolbar(u, { mobile: true })}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap admin-mobile-scroll-x users-dash-wrap">
            <table className="users-dash-table">
              <thead>
                <tr>
                  <th className="ud-th-actions">Действия</th>
                  <th>Включить</th>
                  <th>Онлайн</th>
                  <th>Клиент</th>
                  <th>
                    <button
                      type="button"
                      className="ud-th-sort"
                      title={
                        trafficSort === 0
                          ? "Нажмите: сначала меньше израсходовано"
                          : trafficSort === 1
                            ? "Нажмите: сначала больше израсходовано"
                            : "Нажмите: обычный порядок"
                      }
                      onClick={() => {
                        setExpirySort(0);
                        setTrafficSort((s) => ((s + 1) % 3) as SortTri);
                      }}
                    >
                      Трафик
                      {trafficSort === 1 ? <span className="ud-th-sort-mark"> ↑</span> : null}
                      {trafficSort === 2 ? <span className="ud-th-sort-mark"> ↓</span> : null}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="ud-th-sort"
                      title={
                        trafficSort === 0
                          ? "Нажмите: сначала меньше израсходовано"
                          : trafficSort === 1
                            ? "Нажмите: сначала больше израсходовано"
                            : "Нажмите: обычный порядок"
                      }
                      onClick={() => {
                        setExpirySort(0);
                        setTrafficSort((s) => ((s + 1) % 3) as SortTri);
                      }}
                    >
                      Общий трафик
                      {trafficSort === 1 ? <span className="ud-th-sort-mark"> ↑</span> : null}
                      {trafficSort === 2 ? <span className="ud-th-sort-mark"> ↓</span> : null}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="ud-th-sort"
                      title={
                        expirySort === 0
                          ? "Нажмите: сначала ближайшая дата окончания"
                          : expirySort === 1
                            ? "Нажмите: сначала самая дальняя дата окончания"
                            : "Нажмите: обычный порядок"
                      }
                      onClick={() => {
                        setTrafficSort(0);
                        setExpirySort((s) => ((s + 1) % 3) as SortTri);
                      }}
                    >
                      Дата окончания
                      {expirySort === 1 ? <span className="ud-th-sort-mark"> ↑</span> : null}
                      {expirySort === 2 ? <span className="ud-th-sort-mark"> ↓</span> : null}
                    </button>
                  </th>
                  <th>Устройства</th>
                  <th className="ud-th-nodes">Узлы</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const ex = expiryPill(u);
                  const alive = clientAlive(u);
                  const emailLine =
                    !isBotAutoEmail(u.email) && u.email.trim() !== u.name.trim() ? (
                      <div className="ud-client-email muted">{u.email}</div>
                    ) : null;
                  const infoOpen = expandedInfoId === u.id && Boolean((u.comment || "").trim());
                  return (
                    <tr
                      key={u.id}
                      className={`ud-row${renewBusyId === u.id ? " ud-row--renewing" : ""}${hiddenUserIdSet.has(u.id) && showHiddenUsers ? " ud-row--hidden-preview" : ""}`}
                    >
                      <td className="ud-td-actions">
                        {renewBusyId === u.id ? <span className="ud-renew-fill-bar" aria-hidden="true" /> : null}
                        <div className="ud-toolbar" role="group" aria-label="Действия по клиенту">
                          {renderRenewInactiveButton(u)}
                          <button
                            type="button"
                            className="ud-tool"
                            title="Изменить"
                            aria-label="Изменить"
                            disabled={tableLocked}
                            onClick={() => setModal({ kind: "edit", userId: u.id })}
                          >
                            <IconPencil />
                          </button>
                          {webAppPreviewEnabled ? (
                            <button
                              type="button"
                              className="ud-tool"
                              title="Превью WebApp"
                              aria-label="Превью WebApp"
                              disabled={!String(u.tg_id || "").trim()}
                              onClick={() => openWebAppPreview(u)}
                            >
                              <IconEye />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ud-tool"
                            title="Отправить список UUID клиентов на все развёрнутые серверы"
                            aria-label="Отправить UUID на серверы"
                            disabled={syncBusy}
                            onClick={() => void onPushAll()}
                          >
                            <IconSync />
                          </button>
                          <button
                            type="button"
                            className="ud-tool"
                            title="Обнулить трафик"
                            aria-label="Обнулить трафик"
                            disabled={resetBusyId === u.id || tableLocked}
                            onClick={() => {
                              if (!confirm(`Обнулить трафик у «${u.name}»?`)) return;
                              void (async () => {
                                setResetBusyId(u.id);
                                setMsg(null);
                                try {
                                  await resetUserTraffic(u.id);
                                  setMsg({ type: "ok", text: `Трафик «${u.name}» обнулён.` });
                                  await refresh();
                                } catch (err) {
                                  setMsg({ type: "err", text: String(err) });
                                } finally {
                                  setResetBusyId(null);
                                }
                              })();
                            }}
                          >
                            {resetBusyId === u.id ? <Spinner /> : <IconResetTraffic />}
                          </button>
                          <button
                            type="button"
                            className="ud-tool"
                            title="Копировать URL подписки"
                            aria-label="Копировать URL подписки"
                            disabled={copyBusyId === u.id}
                            onClick={() => {
                              setCopyBusyId(u.id);
                              void navigator.clipboard.writeText(u.subscription_url).finally(() => {
                                window.setTimeout(() => setCopyBusyId((id) => (id === u.id ? null : id)), 500);
                              });
                            }}
                          >
                            <IconCopy />
                          </button>
                          {userExpiryBellEligible(u) ? (
                            <button
                              type="button"
                              className={`ud-tool${userExpiredNotifyEligible(u) ? " ud-tool-warn" : ""}`}
                              title={
                                userExpiredNotifyEligible(u)
                                  ? "Подписка истекла — отправить в Telegram"
                                  : "Напоминание в Telegram (истекает ≤ 3 суток)"
                              }
                              aria-label={
                                userExpiredNotifyEligible(u)
                                  ? "Уведомить об истечении подписки"
                                  : "Напоминание в Telegram"
                              }
                              disabled={notifyBusyId === u.id || tableLocked}
                              onClick={() => {
                                void (async () => {
                                  setNotifyBusyId(u.id);
                                  setMsg(null);
                                  const expired = userExpiredNotifyEligible(u);
                                  try {
                                    if (expired) {
                                      await notifyUserExpired(u.id);
                                      setMsg({ type: "ok", text: `Telegram: подписка «${u.name}» истекла.` });
                                    } else {
                                      await notifyUserExpiring(u.id);
                                      setMsg({ type: "ok", text: `Telegram: напоминание «${u.name}».` });
                                    }
                                  } catch (err) {
                                    setMsg({
                                      type: "err",
                                      text: expired
                                        ? formatNotifyExpiredError(String(err))
                                        : formatNotifyExpiryError(String(err)),
                                    });
                                  } finally {
                                    setNotifyBusyId(null);
                                  }
                                })();
                              }}
                            >
                              {notifyBusyId === u.id ? <Spinner /> : <IconBell />}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ud-tool ud-tool-danger"
                            title="Удалить клиента"
                            aria-label="Удалить"
                            disabled={tableLocked || deleteBusyId === u.id}
                            onClick={async () => {
                              if (!confirm(`Удалить «${u.name}»?`)) return;
                              setDeleteBusyId(u.id);
                              setMsg(null);
                              try {
                                await deleteUser(u.id);
                                await refresh();
                              } catch (err) {
                                setMsg({ type: "err", text: String(err) });
                              } finally {
                                setDeleteBusyId(null);
                              }
                            }}
                          >
                            {deleteBusyId === u.id ? <Spinner /> : <IconTrash />}
                          </button>
                        </div>
                      </td>
                      <td className="ud-td-toggle">
                        <div className="toggle-cell">
                          <button
                            type="button"
                            className={`toggle toggle-sm ${u.enable ? "on" : ""}`}
                            disabled={toggleBusyId === u.id || tableLocked}
                            title={u.enable ? "Отключить" : "Включить"}
                            aria-pressed={u.enable}
                            onClick={(e) => {
                              e.stopPropagation();
                              void (async () => {
                                setToggleBusyId(u.id);
                                setMsg(null);
                                try {
                                  await patchUser(u.id, { enable: !u.enable });
                                  await refresh();
                                } catch (err) {
                                  setMsg({ type: "err", text: String(err) });
                                } finally {
                                  setToggleBusyId(null);
                                }
                              })();
                            }}
                          />
                          {toggleBusyId === u.id ? (
                            <span className="cell-spinner" title="Сохранение…">
                              <Spinner />
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {u.stats_synced_at ? (
                          <span
                            className={`ud-pill ${u.online ? "ud-pill-online" : "ud-pill-offline"}`}
                            title={
                              u.online
                                ? "По данным Xray есть активные соединения для этого клиента"
                                : "Нет активных соединений по последнему опросу узлов"
                            }
                          >
                            {u.online ? "Онлайн" : "Офлайн"}
                          </span>
                        ) : (
                          <span className="ud-pill ud-pill-stats-unknown" title="Ещё не было успешного опроса узлов">
                            —
                          </span>
                        )}
                      </td>
                      <td className="ud-td-client">
                        <div className="ud-client-line">
                          <span className={`ud-client-dot ${alive ? "ud-client-dot-on" : "ud-client-dot-off"}`} aria-hidden />
                          <button
                            type="button"
                            className={`ud-client-name-btn ${infoOpen ? "open" : ""}`}
                            onClick={() =>
                              setExpandedInfoId((cur) => {
                                if (!(u.comment || "").trim()) return null;
                                return cur === u.id ? null : u.id;
                              })
                            }
                            title={(u.comment || "").trim() ? "Показать/скрыть информацию о клиенте" : "Информация о клиенте не указана"}
                          >
                            <span className="ud-client-name">{u.name}</span>
                          </button>
                        </div>
                        {emailLine}
                        {infoOpen ? <div className="ud-client-info-pop">{u.comment}</div> : null}
                      </td>
                      <td className="ud-td-traffic">{renderTrafficCell(u)}</td>
                      <td>
                        <span className="ud-pill ud-pill-total">{formatUsedGb(u)}</span>
                      </td>
                      <td className="ud-td-expiry">{renderExpiryControl(u, ex)}</td>
                      <td>
                        <span
                          className="ud-pill ud-pill-total"
                          title={
                            u.device_limit_active
                              ? `Подключено устройств: ${u.devices_registered ?? 0} из ${u.device_limit_total ?? u.device_limit_count}`
                              : "Лимит устройств выключен"
                          }
                        >
                          {u.device_limit_active ? (u.devices_registered ?? 0) : u.online_devices}
                          {u.device_limit_active ? ` / ${u.device_limit_total ?? u.device_limit_count}` : ""}
                        </span>
                      </td>
                      <td className="ud-td-nodes">
                        <div className="ud-nodes-cell">
                          <div className="ud-nodes-body">
                            <div className="ud-nodes-main">{nodesCountLabel(u, previews[u.id]?.count, deployedServers.length)}</div>
                            <div className="muted ud-nodes-sub">{nodesSubLabel(u)}</div>
                          </div>
                          {renderHideUserButton(u)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardLayout>
  );
}
