import { useCallback, useEffect, useMemo, useState, type SVGProps } from "react";
import {
  createUser,
  deleteUser,
  listServers,
  listUsers,
  notifyUserExpiring,
  patchUser,
  pushAllUserClients,
  resetUserTraffic,
  syncUserStatsFromServers,
  type CreateUserPayload,
  type ServerDto,
  type UserDto,
  userPreview,
} from "../api";
import { formatNotifyExpiryError, userExpiryNotifyEligible } from "../expiryNotify";
import DashboardLayout from "../components/DashboardLayout";
import ImportUserModal from "../components/ImportUserModal";
import Spinner from "../components/Spinner";
import UserModal from "../components/UserModal";

const BYTES_PER_GB = 1073741824;

function usedBytes(u: UserDto): number {
  return (Number(u.traffic_up) || 0) + (Number(u.traffic_down) || 0);
}

function formatUsedGb(u: UserDto): string {
  return `${(usedBytes(u) / BYTES_PER_GB).toFixed(2)} GB`;
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
  const days = Math.ceil((u.expiry_time - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { text: "истёк", variant: "bad" };
  if (days === 0) return { text: "сегодня", variant: "ok" };
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
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
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

type UserModalState = { kind: "closed" } | { kind: "create" } | { kind: "edit"; user: UserDto };

export default function UsersPage({ onLogout }: { onLogout: () => void }) {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [previews, setPreviews] = useState<Record<number, { count: number }>>({});
  const [modal, setModal] = useState<UserModalState>({ kind: "closed" });
  const [importOpen, setImportOpen] = useState(false);
  const [deployedServers, setDeployedServers] = useState<ServerDto[]>([]);
  const [toggleBusyId, setToggleBusyId] = useState<number | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);
  const [copyBusyId, setCopyBusyId] = useState<number | null>(null);
  const [notifyBusyId, setNotifyBusyId] = useState<number | null>(null);
  const [resetBusyId, setResetBusyId] = useState<number | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [expandedInfoId, setExpandedInfoId] = useState<number | null>(null);
  const [expirySort, setExpirySort] = useState<SortTri>(0);
  const [trafficSort, setTrafficSort] = useState<SortTri>(0);
  const [expiryTipUserId, setExpiryTipUserId] = useState<number | null>(null);

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

  useEffect(() => {
    if (expiryTipUserId == null) return;
    const onDocDown = (e: MouseEvent) => {
      const el = document.getElementById(`ud-expiry-host-${expiryTipUserId}`);
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setExpiryTipUserId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpiryTipUserId(null);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [expiryTipUserId]);

  const tableLocked =
    refreshing || deleteBusyId !== null || notifyBusyId !== null || resetBusyId !== null || syncBusy;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      try {
        const st = await syncUserStatsFromServers();
        if (st.errors?.length) {
          setMsg({ type: "err", text: `Статистика с узлов: ${st.errors.join("; ")}` });
        }
      } catch {
        /* список всё равно подтянем из БД */
      }
      const [u, servers] = await Promise.all([listUsers(), listServers()]);
      setUsers(u);
      setDeployedServers(servers.filter((s) => s.vless_deployed));
      const pv: Record<number, { count: number }> = {};
      await Promise.all(
        u.map(async (x) => {
          try {
            const p = await userPreview(x.id);
            pv[x.id] = { count: p.count };
          } catch {
            pv[x.id] = { count: 0 };
          }
        }),
      );
      setPreviews(pv);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch((e) => setMsg({ type: "err", text: String(e) }));
  }, [refresh]);

  async function onSubmitEdit(id: number, payload: CreateUserPayload) {
    const { user } = await patchUser(id, payload);
    setMsg({ type: "ok", text: `Сохранено: «${user.name}».` });
    await refresh();
  }

  async function onCreateUser(payload: CreateUserPayload) {
    const { user } = await createUser(payload);
    setMsg({ type: "ok", text: `Создан клиент «${user.name}». Подписка: ${user.subscription_url}` });
    await refresh();
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

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <div className="users-hero-top">
          <div>
            <h1>Пользователи</h1>
            <p className="sub users-hero-sub">
              Карточки в стиле панели: трафик, срок, действия. Импорт из x-ui — отдельным окном. Напоминание в Telegram
              за 3 суток до окончания — при указанном Chat ID.
            </p>
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={refreshing} onClick={() => setImportOpen(true)}>
              Импорт из x-ui
            </button>
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
        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
      </section>

      <UserModal
        open={modal.kind !== "closed"}
        mode={modal.kind === "edit" ? "edit" : "create"}
        user={modal.kind === "edit" ? modal.user : null}
        deployedServers={deployedServers}
        onClose={() => setModal({ kind: "closed" })}
        onCreate={async (p) => {
          await onCreateUser(p);
        }}
        onUpdate={onSubmitEdit}
      />

      <ImportUserModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={refresh}
        onMessage={setMsg}
      />

      <section className="panel">
        <div className="section-title-row users-dash-head">
          <h1 style={{ fontSize: "1.1rem", margin: 0 }}>Список</h1>
          <div className="users-dash-head-right">
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
                "Обновление"
              )}
            </button>
            {refreshing ? (
              <span className="section-loading" title="Обновление…">
                <Spinner /> Обновление…
              </span>
            ) : null}
          </div>
        </div>
        {users.length === 0 ? (
          <p className="sub" style={{ marginBottom: 0 }}>
            Пока нет клиентов — нажмите «Новый клиент» или «Импорт из x-ui».
          </p>
        ) : (
          <div className="table-wrap users-dash-wrap">
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
                {sortedUsers.map((u) => {
                  const pct = trafficPercent(u);
                  const ex = expiryPill(u);
                  const alive = clientAlive(u);
                  const emailLine =
                    !isBotAutoEmail(u.email) && u.email.trim() !== u.name.trim() ? (
                      <div className="ud-client-email muted">{u.email}</div>
                    ) : null;
                  const infoOpen = expandedInfoId === u.id && Boolean((u.comment || "").trim());
                  return (
                    <tr key={u.id} className="ud-row">
                      <td className="ud-td-actions">
                        <div className="ud-toolbar" role="group" aria-label="Действия по клиенту">
                          <button
                            type="button"
                            className="ud-tool"
                            title="Изменить"
                            aria-label="Изменить"
                            disabled={tableLocked}
                            onClick={() => setModal({ kind: "edit", user: u })}
                          >
                            <IconPencil />
                          </button>
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
                          {userExpiryNotifyEligible(u) ? (
                            <button
                              type="button"
                              className="ud-tool"
                              title="Напоминание в Telegram"
                              aria-label="Напоминание в Telegram"
                              disabled={notifyBusyId === u.id || tableLocked}
                              onClick={() => {
                                void (async () => {
                                  setNotifyBusyId(u.id);
                                  setMsg(null);
                                  try {
                                    await notifyUserExpiring(u.id);
                                    setMsg({ type: "ok", text: `Telegram: напоминание «${u.name}».` });
                                  } catch (err) {
                                    setMsg({ type: "err", text: formatNotifyExpiryError(String(err)) });
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
                      <td className="ud-td-traffic">
                        <div className="ud-traffic-used">{formatUsedGb(u)}</div>
                        <div className="ud-traffic-bar-wrap" title={u.total_gb > 0 ? `Лимит ${u.total_gb} GB` : "Без лимита"}>
                          <div className="ud-traffic-bar-fill" style={{ width: `${u.total_gb > 0 ? pct : 0}%` }} />
                        </div>
                        <div className="ud-traffic-cap muted">{u.total_gb > 0 ? `${u.total_gb} GB` : "∞"}</div>
                      </td>
                      <td>
                        <span className="ud-pill ud-pill-total">{formatUsedGb(u)}</span>
                      </td>
                      <td className="ud-td-expiry" id={`ud-expiry-host-${u.id}`}>
                        <div className="ud-expiry-wrap">
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
                            <div className="ud-expiry-tooltip" role="tooltip">
                              {formatExpiryDetailText(u)}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className="ud-pill ud-pill-total" title={u.device_limit_enabled ? `Лимит: ${u.device_limit_count}` : "Лимит устройств выключен"}>
                          {u.online_devices}
                          {u.device_limit_enabled ? ` / ${u.device_limit_count}` : ""}
                        </span>
                      </td>
                      <td className="ud-td-nodes">
                        <div className="ud-nodes-main">{previews[u.id]?.count ?? "—"}</div>
                        <div className="muted ud-nodes-sub">лимит {u.subscription_server_count > 0 ? `≤ ${u.subscription_server_count}` : "все"}</div>
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
