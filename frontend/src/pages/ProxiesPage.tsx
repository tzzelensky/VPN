import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import DashboardLayout from "../components/DashboardLayout";
import {
  checkAllTelegramProxies,
  checkTelegramProxy,
  createTelegramProxy,
  deleteTelegramProxy,
  fetchTelegramProxyDetails,
  fetchTelegramProxyLogs,
  generateMtprotoSecretApi,
  listTelegramProxyEvents,
  loadTelegramProxies,
  patchTelegramProxySettings,
  purgeServerTelegramProxies,
  suggestTelegramProxyPort,
  updateTelegramProxy,
  type TelegramProxiesOverviewDto,
  type TelegramProxyDto,
  type TelegramProxyEventDto,
  type TelegramProxyServerDto,
  type TelegramProxySettingsDto,
  type TelegramProxyStatusDto,
  type TelegramProxyTypeDto,
} from "../api";
import { usePanelSettings } from "../panelSettingsContext";

const STATUS_LABEL: Record<TelegramProxyStatusDto | "none", string> = {
  available: "Доступен",
  unavailable: "Недоступен",
  auth_error: "Ошибка авторизации",
  timeout: "Таймаут",
  unknown: "Не проверялся",
  checking: "Проверяется",
  none: "Нет прокси",
};

const TYPE_LABEL: Record<TelegramProxyTypeDto, string> = {
  mtproto: "MTProto",
  socks5: "SOCKS5",
  http: "HTTP",
};

const JOURNAL_PAGE_SIZE = 25;

const CREATE_PROGRESS_STAGES: Array<{ until: number; label: string }> = [
  { until: 22, label: "Подготовка данных…" },
  { until: 48, label: "Подключение к серверу…" },
  { until: 78, label: "Развёртывание прокси…" },
  { until: 92, label: "Запуск сервиса…" },
  { until: 100, label: "Готово" },
];

function createProgressLabel(progress: number): string {
  for (const stage of CREATE_PROGRESS_STAGES) {
    if (progress <= stage.until) return stage.label;
  }
  return CREATE_PROGRESS_STAGES[CREATE_PROGRESS_STAGES.length - 1].label;
}

type BusyAction =
  | "create"
  | "check-all"
  | "check-one"
  | "purge"
  | "settings"
  | "edit"
  | "restart"
  | null;

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}

function parseErr(e: unknown): string {
  if (e instanceof Error) {
    try {
      const j = JSON.parse(e.message) as { error?: string };
      if (j.error) return j.error;
    } catch {
      /* ignore */
    }
    return e.message;
  }
  return String(e);
}

function statusPillClass(status: TelegramProxyStatusDto): string {
  if (status === "auth_error") return "proxy-status-pill--auth_error";
  if (status === "timeout") return "proxy-status-pill--timeout";
  return `proxy-status-pill--${status}`;
}

function generateClientCredentials(): { username: string; password: string } {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rand = (n: number) => {
    let s = "";
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  };
  return { username: `tg${rand(8)}`, password: rand(16) };
}

function CopyableSecret({
  text,
  copyValue,
  masked,
  label,
  onCopy,
}: {
  text: string;
  copyValue: string;
  masked: boolean;
  label: string;
  onCopy: (text: string, label: string) => void;
}) {
  if (!text) return null;
  return (
    <code
      className={`vault-uri${masked ? "" : " vault-uri--copy"}`}
      title={masked ? undefined : "Нажмите, чтобы скопировать"}
      onClick={() => {
        if (!masked && copyValue) onCopy(copyValue, label);
      }}
      onKeyDown={(e) => {
        if (!masked && copyValue && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onCopy(copyValue, label);
        }
      }}
      role={masked ? undefined : "button"}
      tabIndex={masked ? undefined : 0}
    >
      {text}
    </code>
  );
}

function ProxyModal({
  title,
  onClose,
  wide,
  children,
  footer,
  footerClassName,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  footerClassName?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div
        className={`modal vault-modal proxy-modal${wide ? " modal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="proxy-modal-title"
      >
        <div className="modal-head">
          <h2 id="proxy-modal-title">{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className={`modal-footer${footerClassName ? ` ${footerClassName}` : ""}`}>{footer}</div> : null}
      </div>
    </div>
  );
}

export default function ProxiesPage({ onLogout }: { onLogout: () => void }) {
  const { confirmDangerous, maskSecret } = usePanelSettings();
  const [data, setData] = useState<TelegramProxiesOverviewDto | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [search, setSearch] = useState("");
  const [filterServer, setFilterServer] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterActive, setFilterActive] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [journalPage, setJournalPage] = useState(1);
  const [events, setEvents] = useState<TelegramProxyEventDto[]>([]);

  const [viewProxy, setViewProxy] = useState<TelegramProxyDto | null>(null);
  const [viewSecrets, setViewSecrets] = useState(false);
  const [viewProxyLogs, setViewProxyLogs] = useState<string | null>(null);

  function closeViewProxy() {
    setViewProxy(null);
    setViewProxyLogs(null);
    setViewSecrets(false);
  }
  const [editProxy, setEditProxy] = useState<TelegramProxyDto | null>(null);
  const [deleteProxy, setDeleteProxy] = useState<TelegramProxyDto | null>(null);
  const [purgeServer, setPurgeServer] = useState<TelegramProxyServerDto | null>(null);

  const [formServerId, setFormServerId] = useState<number | "">("");
  const [formType, setFormType] = useState<TelegramProxyTypeDto>("mtproto");
  const [formName, setFormName] = useState("");
  const [formPort, setFormPort] = useState("");
  const [formAuth, setFormAuth] = useState(true);
  const [formUser, setFormUser] = useState("");
  const [formPass, setFormPass] = useState("");
  const [formSecret, setFormSecret] = useState("");
  const [formAutoGen, setFormAutoGen] = useState(true);
  const [formActive, setFormActive] = useState(true);
  const [settingsForm, setSettingsForm] = useState<TelegramProxySettingsDto | null>(null);
  const [createProgress, setCreateProgress] = useState(0);

  const busy = busyAction !== null;

  useEffect(() => {
    if (busyAction !== "create") {
      setCreateProgress(0);
      return;
    }
    setCreateProgress(6);
    const id = window.setInterval(() => {
      setCreateProgress((p) => {
        if (p >= 92) return p;
        const step = p < 30 ? 2.6 : p < 60 ? 1.4 : 0.45;
        return Math.min(92, p + step);
      });
    }, 170);
    return () => window.clearInterval(id);
  }, [busyAction]);

  const showToast = useCallback((type: "ok" | "err", text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const reload = useCallback(async () => {
    const r = await loadTelegramProxies();
    setData(r);
    return r;
  }, []);

  useEffect(() => {
    void reload().catch((e) => showToast("err", parseErr(e)));
  }, [reload, showToast]);

  const servers = data?.servers ?? [];
  const serverName = useCallback(
    (id: number) => servers.find((s) => s.id === id)?.name ?? `#${id}`,
    [servers],
  );

  const proxies = useMemo(() => {
    let list = data?.proxies ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.host.toLowerCase().includes(q) ||
          String(p.port).includes(q),
      );
    }
    if (filterServer) list = list.filter((p) => p.server_id === Number(filterServer));
    if (filterType) list = list.filter((p) => p.type === filterType);
    if (filterStatus) list = list.filter((p) => p.status === filterStatus);
    if (filterActive === "1") list = list.filter((p) => p.active);
    if (filterActive === "0") list = list.filter((p) => !p.active);
    return list;
  }, [data?.proxies, search, filterServer, filterType, filterStatus, filterActive]);

  const filtersActive = Boolean(search || filterServer || filterType || filterStatus || filterActive);

  async function runBusy<T>(action: BusyAction, fn: () => Promise<T>): Promise<T | undefined> {
    setBusyAction(action);
    try {
      return await fn();
    } catch (e) {
      showToast("err", `Ошибка: ${parseErr(e)}`);
    } finally {
      setBusyAction(null);
    }
  }

  function resetFilters() {
    setSearch("");
    setFilterServer("");
    setFilterType("");
    setFilterStatus("");
    setFilterActive("");
  }

  function resetCreateForm(serverId?: number) {
    setFormServerId(serverId ?? (servers[0]?.id ?? ""));
    setFormType("mtproto");
    setFormName("");
    setFormPort("");
    setFormAuth(true);
    setFormUser("");
    setFormPass("");
    setFormSecret("");
    setFormAutoGen(true);
    setFormActive(true);
  }

  async function openCreate(serverId?: number) {
    resetCreateForm(serverId);
    const sid = serverId ?? servers[0]?.id;
    if (sid) {
      try {
        const { secret } = await generateMtprotoSecretApi();
        setFormSecret(secret);
        const { port } = await suggestTelegramProxyPort(sid, "mtproto");
        setFormPort(String(port));
      } catch {
        /* ignore */
      }
    }
    setCreateOpen(true);
  }

  async function onTypeChange(t: TelegramProxyTypeDto) {
    setFormType(t);
    if (formServerId === "") return;
    try {
      const { port } = await suggestTelegramProxyPort(Number(formServerId), t);
      setFormPort(String(port));
      if (t === "mtproto") {
        const { secret } = await generateMtprotoSecretApi();
        setFormSecret(secret);
        setFormAuth(true);
      } else {
        const creds = generateClientCredentials();
        setFormUser(creds.username);
        setFormPass(creds.password);
        setFormAuth(true);
      }
    } catch {
      /* ignore */
    }
  }

  async function handleCreate() {
    if (formServerId === "") {
      showToast("err", "Выберите сервер");
      return;
    }
    await runBusy("create", async () => {
      const r = await createTelegramProxy({
        server_id: Number(formServerId),
        name: formName.trim() || `${TYPE_LABEL[formType]} ${serverName(Number(formServerId))}`,
        type: formType,
        port: formPort ? Number(formPort) : undefined,
        auth_enabled: formType === "mtproto" ? true : formAuth,
        username: formUser || undefined,
        password: formPass || undefined,
        secret: formSecret || undefined,
        auto_generate: formAutoGen,
        active: formActive,
      });
      setCreateProgress(100);
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      setCreateOpen(false);
      await reload();
      setViewProxy(r.proxy);
      setViewSecrets(true);
      showToast("ok", "Прокси создан");
    });
  }

  async function handleCheckAll() {
    await runBusy("check-all", async () => {
      const r = await checkAllTelegramProxies();
      setData((prev) => (prev ? { ...prev, ...r, proxies: r.proxies } : r));
      showToast("ok", r.already_running ? "Проверка уже выполняется" : "Прокси проверены");
      window.setTimeout(() => void reload(), 3000);
    });
  }

  async function handleView(p: TelegramProxyDto) {
    await runBusy("check-one", async () => {
      const r = await fetchTelegramProxyDetails(p.id);
      setViewProxy(r.proxy);
      setViewSecrets(false);
      setViewProxyLogs(null);
    });
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("ok", `${label} скопировано`);
    } catch {
      showToast("err", "Не удалось скопировать");
    }
  }

  function deleteProxyInBackground(proxy: TelegramProxyDto) {
    const id = proxy.id;
    setDeleteProxy(null);
    setViewProxy((v) => (v?.id === id ? null : v));
    setEditProxy((v) => (v?.id === id ? null : v));
    setData((prev) =>
      prev
        ? {
            ...prev,
            proxies: prev.proxies.filter((p) => p.id !== id),
          }
        : prev,
    );
    void (async () => {
      try {
        await deleteTelegramProxy(id);
        await reload();
        showToast("ok", `Прокси «${proxy.name}» удалён`);
      } catch (e) {
        await reload();
        showToast("err", parseErr(e));
      }
    })();
  }

  function connectionCopyText(p: TelegramProxyDto): string {
    if (p.tg_link) {
      return p.tme_link ? `${p.tg_link}\n${p.tme_link}` : p.tg_link;
    }
    if (p.connection_text) return p.connection_text;
    const auth = p.auth_enabled && p.username ? `\nЛогин: ${p.username}\nПароль: ${p.password}` : "";
    return `${TYPE_LABEL[p.type]}\n${p.host}:${p.port}${auth}`;
  }

  const stats = data?.stats;

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className="proxy-page">
        <div className="proxy-page-head">
          <div className="proxy-page-head__text">
            <h1 className="page-title">Прокси</h1>
            <p className="vault-lead muted">
              Развертывание Telegram-прокси на добавленных серверах без влияния на VPN-подписки.
            </p>
          </div>
          <div className="proxy-page-head__actions vault-toolbar">
            <button
              type="button"
              className="btn primary"
              onClick={() => void openCreate()}
              disabled={busy || servers.length === 0}
            >
              {busyAction === "create" ? "Создание…" : "Создать прокси"}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void handleCheckAll()}>
              {busyAction === "check-all" ? "Проверка…" : "Проверить все"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setSettingsForm(data?.settings ?? null);
                setSettingsOpen(true);
              }}
            >
              Настройки автопроверки
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void runBusy(null, async () => {
                  const r = await listTelegramProxyEvents(300);
                  setEvents(r.events);
                  setJournalPage(1);
                  setJournalOpen(true);
                })
              }
            >
              Журнал
            </button>
          </div>
        </div>

        {!data?.telegram_configured && (
          <div className="vault-warn" role="status">
            Telegram-уведомления не настроены (укажите токен бота и ID админов в настройках панели).
          </div>
        )}

        {toast && (
          <div className={`vault-toast vault-toast--${toast.type}`} role="status">
            {toast.text}
          </div>
        )}

        <div className="vault-stats">
          <div className="vault-stat-card">
            <span className="vault-stat-label">Всего прокси</span>
            <strong>{stats?.total ?? 0}</strong>
          </div>
          <div className="vault-stat-card vault-stat-card--ok">
            <span className="vault-stat-label">Доступны</span>
            <strong>{stats?.available ?? 0}</strong>
          </div>
          <div className="vault-stat-card vault-stat-card--bad">
            <span className="vault-stat-label">Недоступны</span>
            <strong>{stats?.unavailable ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">MTProto</span>
            <strong>{stats?.mtproto ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">SOCKS5</span>
            <strong>{stats?.socks5 ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">HTTP</span>
            <strong>{stats?.http ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">Последняя автопроверка</span>
            <strong className="vault-stat-sm">{formatDt(stats?.last_auto_run_at ?? null)}</strong>
          </div>
        </div>

        <div className="proxy-filters-panel">
          <h2 className="proxy-filters-panel__title">Фильтры</h2>
          <div className="proxy-filters-grid">
            <label className="proxy-filters-search field">
              <span className="vault-stat-label">Поиск</span>
              <input
                className="input"
                placeholder="Название, host, порт…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="vault-stat-label">Сервер</span>
              <select className="input" value={filterServer} onChange={(e) => setFilterServer(e.target.value)}>
                <option value="">Все</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="vault-stat-label">Тип</span>
              <select className="input" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">Все</option>
                <option value="mtproto">MTProto</option>
                <option value="socks5">SOCKS5</option>
                <option value="http">HTTP</option>
              </select>
            </label>
            <label className="field">
              <span className="vault-stat-label">Статус</span>
              <select className="input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">Все</option>
                {Object.entries(STATUS_LABEL)
                  .filter(([k]) => k !== "none")
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span className="vault-stat-label">Активность</span>
              <select className="input" value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
                <option value="">Все</option>
                <option value="1">Активные</option>
                <option value="0">Отключённые</option>
              </select>
            </label>
            <button type="button" className="btn" disabled={!filtersActive || busy} onClick={resetFilters}>
              Сбросить
            </button>
            {filterServer && (() => {
              const s = servers.find((x) => String(x.id) === filterServer);
              if (!s || s.proxy_count === 0) return null;
              return (
                <button type="button" className="btn danger" disabled={busy} onClick={() => setPurgeServer(s)}>
                  Очистить на сервере
                </button>
              );
            })()}
          </div>
        </div>

        <section>
          <h2 className="proxy-section-title">Прокси</h2>
          <div className="proxy-table-panel" style={{ marginTop: "0.65rem" }}>
            {proxies.length === 0 ? (
              <div className="proxy-empty">
                <h3>Прокси пока не созданы</h3>
                <p>Создайте MTProto, SOCKS5 или HTTP proxy на одном из добавленных серверов.</p>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || servers.length === 0}
                  onClick={() => void openCreate()}
                >
                  Создать прокси
                </button>
              </div>
            ) : (
              <div className="proxy-table-wrap">
                <table className="proxy-table">
                  <thead>
                    <tr>
                      <th>Название</th>
                      <th>Тип</th>
                      <th>Сервер</th>
                      <th>Host</th>
                      <th>Порт</th>
                      <th>Авторизация</th>
                      <th>Статус</th>
                      <th>Проверка</th>
                      <th>Latency</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proxies.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{TYPE_LABEL[p.type]}</td>
                        <td>{serverName(p.server_id)}</td>
                        <td>{p.host}</td>
                        <td>{p.port}</td>
                        <td>{p.type === "mtproto" ? "secret" : p.auth_enabled ? "да" : "нет"}</td>
                        <td>
                          <span className={`proxy-status-pill ${statusPillClass(p.status)}`}>
                            {STATUS_LABEL[p.status]}
                          </span>
                        </td>
                        <td>{formatDt(p.last_check_at)}</td>
                        <td>{p.last_latency_ms != null ? `${p.last_latency_ms} мс` : "—"}</td>
                        <td>
                          <div className="proxy-row-actions">
                            <button type="button" className="btn btn-sm" title="Просмотр" onClick={() => void handleView(p)} disabled={busy}>
                              Просмотр
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              title="Проверить"
                              disabled={busy}
                              onClick={() =>
                                void runBusy("check-one", async () => {
                                  await checkTelegramProxy(p.id);
                                  await reload();
                                  showToast("ok", "Прокси проверен");
                                })
                              }
                            >
                              Проверить
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              title="Скопировать"
                              disabled={busy}
                              onClick={() => void copyText(connectionCopyText(p), "Данные")}
                            >
                              Копировать
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              title="Редактировать"
                              disabled={busy}
                              onClick={() => {
                                setEditProxy(p);
                                setFormName(p.name);
                                setFormPort(String(p.port));
                                setFormAuth(p.auth_enabled);
                                setFormUser(p.username);
                                setFormPass("");
                                setFormSecret("");
                                setFormActive(p.active);
                              }}
                            >
                              Изменить
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm danger"
                              title="Удалить"
                              disabled={busy}
                              onClick={() => setDeleteProxy(p)}
                            >
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {createOpen && (
        <ProxyModal
          title="Создать прокси"
          onClose={() => {
            if (busyAction === "create") return;
            setCreateOpen(false);
          }}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCreateOpen(false)} disabled={busyAction === "create"}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleCreate()}>
                {busyAction === "create" ? "Создание…" : "Создать прокси"}
              </button>
            </>
          }
        >
          <div className={`proxy-create-form${busyAction === "create" ? " proxy-create-form--loading" : ""}`}>
            {busyAction === "create" && (
              <div className="proxy-create-progress" role="status" aria-live="polite" aria-busy="true">
                <p className="proxy-create-progress__label">{createProgressLabel(createProgress)}</p>
                <div className="proxy-create-progress__track" aria-hidden>
                  <div className="proxy-create-progress__fill" style={{ width: `${createProgress}%` }} />
                </div>
                <p className="proxy-create-progress__meta">
                  <span>{Math.round(createProgress)}%</span>
                  <span className="muted">Развёртывание может занять до минуты</span>
                </p>
              </div>
            )}
          {formType === "mtproto" && (
            <p className="proxy-form-hint">
              MTProto FakeTLS (secret ee + hex). В ссылке t.me secret передаётся в hex, не base64.
            </p>
          )}
          {formType === "socks5" && (
            <p className="proxy-form-hint">
              После создания вы получите tg://socks и t.me/socks ссылку для подключения в Telegram.
            </p>
          )}
          {formType === "http" && (
            <p className="proxy-form-hint proxy-form-hint--warn">
              HTTP-прокси в Telegram настраивается вручную — одноразовые tg:// ссылки для него не поддерживаются.
            </p>
          )}
          <label className="field">
            <span>Сервер</span>
            <select
              className="input"
              value={formServerId}
              onChange={(e) => setFormServerId(e.target.value ? Number(e.target.value) : "")}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.host})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Тип прокси</span>
            <select className="input" value={formType} onChange={(e) => void onTypeChange(e.target.value as TelegramProxyTypeDto)}>
              <option value="mtproto">MTProto</option>
              <option value="socks5">SOCKS5</option>
              <option value="http">HTTP</option>
            </select>
          </label>
          <label className="field">
            <span>Название</span>
            <input className="input" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Необязательно" />
          </label>
          <label className="field">
            <span>Порт</span>
            <input className="input" value={formPort} onChange={(e) => setFormPort(e.target.value)} type="number" min={1} max={65535} />
          </label>
          <p className="proxy-form-hint proxy-form-hint--warn" style={{ marginTop: "-0.25rem" }}>
            Убедитесь, что порт не конфликтует с VPN/VLESS и открыт в firewall.
          </p>
          {formType === "mtproto" ? (
            <label className="field">
              <span>Secret</span>
              <div className="proxy-inline-field">
                <input className="input" value={formSecret} onChange={(e) => setFormSecret(e.target.value)} />
                <button type="button" className="btn" onClick={() => void generateMtprotoSecretApi().then((r) => setFormSecret(r.secret))}>
                  Сгенерировать
                </button>
              </div>
            </label>
          ) : (
            <>
              <div className="form-field shop-toggle-row proxy-form-toggle">
                <div>
                  <label>Авторизация включена</label>
                </div>
                <button type="button" className={`toggle ${formAuth ? "on" : ""}`} onClick={() => setFormAuth((v) => !v)} />
              </div>
              {!formAuth && (
                <p className="proxy-form-hint proxy-form-hint--warn">
                  Прокси без авторизации может использовать любой, кто узнает адрес и порт.
                </p>
              )}
              {formAuth && (
                <>
                  <label className="field">
                    <span>Логин</span>
                    <div className="proxy-inline-field">
                      <input className="input" value={formUser} onChange={(e) => setFormUser(e.target.value)} />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          const c = generateClientCredentials();
                          setFormUser(c.username);
                          setFormPass(c.password);
                        }}
                      >
                        Сгенерировать
                      </button>
                    </div>
                  </label>
                  <label className="field">
                    <span>Пароль</span>
                    <input className="input" value={formPass} onChange={(e) => setFormPass(e.target.value)} type="password" />
                  </label>
                </>
              )}
            </>
          )}
          <div className="proxy-form-toggles-row">
            <div className="proxy-form-toggle-item">
              <label>Автогенерация данных</label>
              <button type="button" className={`toggle toggle-sm ${formAutoGen ? "on" : ""}`} onClick={() => setFormAutoGen((v) => !v)} />
            </div>
            <div className="proxy-form-toggle-item">
              <label>Активен</label>
              <button type="button" className={`toggle toggle-sm ${formActive ? "on" : ""}`} onClick={() => setFormActive((v) => !v)} />
            </div>
          </div>
          </div>
        </ProxyModal>
      )}

      {viewProxy && (
        <ProxyModal
          title={viewProxy.name}
          wide
          onClose={closeViewProxy}
          footerClassName="proxy-modal-footer"
          footer={
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void (async () => {
                    try {
                      setViewProxyLogs("Загрузка…");
                      const r = await fetchTelegramProxyLogs(viewProxy.id);
                      setViewProxyLogs(r.logs);
                    } catch (e) {
                      setViewProxyLogs(null);
                      showToast("err", parseErr(e));
                    }
                  })()
                }
              >
                Логи сервиса
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void copyText(connectionCopyText(viewProxy), "Ссылка")}
              >
                Скопировать ссылку
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  void runBusy("check-one", async () => {
                    const r = await checkTelegramProxy(viewProxy.id);
                    setViewProxy(r.proxy);
                    await reload();
                    showToast("ok", "Прокси проверен");
                  })
                }
              >
                Проверить сейчас
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => {
                  setEditProxy(viewProxy);
                  setFormName(viewProxy.name);
                  setFormPort(String(viewProxy.port));
                  setFormAuth(viewProxy.auth_enabled);
                  setFormUser(viewProxy.username);
                  setFormPass("");
                  setFormSecret("");
                  setFormActive(viewProxy.active);
                }}
              >
                Редактировать
              </button>
              <button
                type="button"
                className="btn btn-sm danger"
                onClick={() => {
                  if (!confirmDangerous(`Удалить прокси «${viewProxy.name}»?`)) return;
                  deleteProxyInBackground(viewProxy);
                }}
              >
                Удалить
              </button>
            </>
          }
        >
          <p className="muted" style={{ marginTop: 0 }}>
            {TYPE_LABEL[viewProxy.type]} · {serverName(viewProxy.server_id)} · {viewProxy.host}:{viewProxy.port}
          </p>
          <p>
            <span className={`proxy-status-pill ${statusPillClass(viewProxy.status)}`}>{STATUS_LABEL[viewProxy.status]}</span>
            {viewProxy.last_latency_ms != null && <span className="muted"> · {viewProxy.last_latency_ms} мс</span>}
          </p>
          <dl className="vault-dl">
            <dt>Последняя проверка</dt>
            <dd>{formatDt(viewProxy.last_check_at)}</dd>
            {viewProxy.last_error && (
              <>
                <dt>Ошибка</dt>
                <dd className="err-text">{viewProxy.last_error}</dd>
              </>
            )}
          </dl>
          {viewProxy.type === "mtproto" && viewProxy.mtproto_sni && (
            <p className="muted" style={{ margin: "0 0 0.65rem" }}>
              FakeTLS SNI в secret: <strong>{viewProxy.mtproto_sni}</strong>
            </p>
          )}
          {(viewProxy.type === "mtproto" || viewProxy.type === "socks5") && (
            <>
              <p className="vault-stat-label">{viewProxy.type === "mtproto" ? "tg://proxy" : "tg://socks"}</p>
              <CopyableSecret
                text={viewSecrets ? (viewProxy.tg_link ?? "") : maskSecret(viewProxy.tg_link ?? "")}
                copyValue={viewProxy.tg_link ?? ""}
                masked={!viewSecrets}
                label="tg:// ссылка"
                onCopy={(t, l) => void copyText(t, l)}
              />
              <p className="vault-stat-label">{viewProxy.type === "mtproto" ? "t.me/proxy" : "t.me/socks"}</p>
              <CopyableSecret
                text={viewSecrets ? (viewProxy.tme_link ?? "") : "••••••••"}
                copyValue={viewProxy.tme_link ?? ""}
                masked={!viewSecrets}
                label="t.me ссылка"
                onCopy={(t, l) => void copyText(t, l)}
              />
            </>
          )}
          {viewProxy.type === "http" && (
            <>
              <p className="proxy-form-hint" style={{ marginBottom: "0.65rem" }}>
                Telegram не поддерживает одноразовые ссылки для HTTP-прокси — укажите host, порт и авторизацию вручную в
                настройках приложения.
              </p>
              <CopyableSecret
                text={
                  viewSecrets
                    ? (viewProxy.connection_text ?? `${viewProxy.host}:${viewProxy.port}`)
                    : `${viewProxy.host}:${viewProxy.port} · авторизация ${viewProxy.auth_enabled ? "да" : "нет"}`
                }
                copyValue={viewProxy.connection_text ?? `${viewProxy.host}:${viewProxy.port}`}
                masked={!viewSecrets}
                label="Данные подключения"
                onCopy={(t, l) => void copyText(t, l)}
              />
            </>
          )}
          {viewProxy.type === "socks5" && viewSecrets && viewProxy.connection_text && (
            <>
              <p className="vault-stat-label" style={{ marginTop: "0.75rem" }}>
                Подключение
              </p>
              <CopyableSecret
                text={viewProxy.connection_text}
                copyValue={viewProxy.connection_text}
                masked={false}
                label="Данные подключения"
                onCopy={(t, l) => void copyText(t, l)}
              />
            </>
          )}
          {!viewSecrets && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                if (!confirmDangerous("Эти данные дают доступ к прокси. Не передавайте их посторонним.")) return;
                setViewSecrets(true);
              }}
            >
              Показать секреты
            </button>
          )}
          {viewProxy.type === "mtproto" && viewProxy.last_error?.includes("simple-run") && (
            <p className="proxy-form-hint proxy-form-hint--warn" style={{ marginTop: "0.75rem" }}>
              Прокси развёрнут в устаревшем режиме. Откройте «Редактировать» и сохраните без изменений — или удалите и
              создайте заново, чтобы применить новый конфиг mtg.
            </p>
          )}
          {viewProxyLogs && (
            <>
              <p className="vault-stat-label" style={{ marginTop: "0.75rem" }}>
                Лог systemd (journalctl)
              </p>
              <pre className="proxy-service-log">{viewProxyLogs}</pre>
            </>
          )}
        </ProxyModal>
      )}

      {editProxy && (
        <ProxyModal
          title="Редактировать прокси"
          onClose={() => setEditProxy(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setEditProxy(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void runBusy("edit", async () => {
                    await updateTelegramProxy(editProxy.id, {
                      name: formName,
                      port: Number(formPort),
                      auth_enabled: formAuth,
                      username: formUser || undefined,
                      password: formPass || undefined,
                      secret: formSecret || undefined,
                      active: formActive,
                    });
                    setEditProxy(null);
                    await reload();
                    showToast("ok", "Прокси обновлён");
                  })
                }
              >
                {busyAction === "edit" ? "Сохранение…" : "Сохранить"}
              </button>
            </>
          }
        >
          <label className="field">
            <span>Название</span>
            <input className="input" value={formName} onChange={(e) => setFormName(e.target.value)} />
          </label>
          <label className="field">
            <span>Порт</span>
            <input className="input" value={formPort} onChange={(e) => setFormPort(e.target.value)} type="number" />
          </label>
          {editProxy.type !== "mtproto" && (
            <label className="check-row">
              <input type="checkbox" checked={formAuth} onChange={(e) => setFormAuth(e.target.checked)} />
              Авторизация
            </label>
          )}
          {editProxy.type !== "mtproto" && formAuth && (
            <>
              <label className="field">
                <span>Логин</span>
                <input className="input" value={formUser} onChange={(e) => setFormUser(e.target.value)} />
              </label>
              <label className="field">
                <span>Новый пароль (пусто = не менять)</span>
                <input className="input" value={formPass} onChange={(e) => setFormPass(e.target.value)} type="password" />
              </label>
            </>
          )}
          {editProxy.type === "mtproto" && (
            <label className="field">
              <span>Secret (пусто = не менять; новый secret = другой FakeTLS SNI)</span>
              <div className="proxy-inline-field">
                <input className="input" value={formSecret} onChange={(e) => setFormSecret(e.target.value)} />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void generateMtprotoSecretApi().then((r) => setFormSecret(r.secret))}
                >
                  Новый SNI
                </button>
              </div>
            </label>
          )}
          <label className="check-row">
            <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
            Активен
          </label>
        </ProxyModal>
      )}

      {deleteProxy && (
        <ProxyModal
          title="Удалить прокси?"
          onClose={() => setDeleteProxy(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDeleteProxy(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  if (!deleteProxy) return;
                  if (!confirmDangerous(`Удалить прокси «${deleteProxy.name}»?`)) return;
                  deleteProxyInBackground(deleteProxy);
                }}
              >
                Удалить прокси
              </button>
            </>
          }
        >
          <p>
            Вы действительно хотите удалить прокси «{deleteProxy.name}» с сервера «{serverName(deleteProxy.server_id)}»?
          </p>
        </ProxyModal>
      )}

      {purgeServer && (
        <ProxyModal
          title="Очистить прокси на сервере?"
          onClose={() => setPurgeServer(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPurgeServer(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() =>
                  void runBusy("purge", async () => {
                    if (
                      !confirmDangerous(
                        `Удалить все прокси с сервера «${purgeServer.name}»? VPN-подписки не будут затронуты.`,
                      )
                    ) {
                      return;
                    }
                    const r = await purgeServerTelegramProxies(purgeServer.id);
                    setPurgeServer(null);
                    setData(r);
                    showToast(
                      "ok",
                      `Прокси на сервере очищены${r.errors.length ? ` (ошибок: ${r.errors.length})` : ""}`,
                    );
                  })
                }
              >
                {busyAction === "purge" ? "Очистка…" : "Очистить прокси"}
              </button>
            </>
          }
        >
          <p>
            Будут удалены все прокси, созданные через панель на сервере «<b>{purgeServer.name}</b>». VPN-подписки и
            VLESS-настройки не должны быть изменены.
          </p>
        </ProxyModal>
      )}

      {settingsOpen && settingsForm && (
        <ProxyModal
          title="Автопроверка прокси"
          onClose={() => setSettingsOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void runBusy("settings", async () => {
                    const r = await patchTelegramProxySettings(settingsForm);
                    setData((prev) => (prev ? { ...prev, settings: r.settings, stats: r.stats } : prev));
                    setSettingsOpen(false);
                    showToast("ok", "Настройки автопроверки сохранены");
                  })
                }
              >
                {busyAction === "settings" ? "Сохранение…" : "Сохранить"}
              </button>
            </>
          }
        >
          <label className="check-row">
            <input
              type="checkbox"
              checked={settingsForm.auto_check_enabled}
              onChange={(e) => setSettingsForm({ ...settingsForm, auto_check_enabled: e.target.checked })}
            />
            Автопроверка включена
          </label>
          <label className="field">
            <span>Проверять каждые N минут</span>
            <input
              className="input"
              type="number"
              min={1}
              value={settingsForm.interval_minutes}
              onChange={(e) => setSettingsForm({ ...settingsForm, interval_minutes: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Количество попыток</span>
            <input
              className="input"
              type="number"
              min={1}
              value={settingsForm.attempts_per_check}
              onChange={(e) => setSettingsForm({ ...settingsForm, attempts_per_check: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Таймаут одной попытки (сек)</span>
            <input
              className="input"
              type="number"
              min={3}
              value={settingsForm.attempt_timeout_sec}
              onChange={(e) => setSettingsForm({ ...settingsForm, attempt_timeout_sec: Number(e.target.value) })}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settingsForm.notify_on_unavailable}
              onChange={(e) => setSettingsForm({ ...settingsForm, notify_on_unavailable: e.target.checked })}
            />
            Уведомлять в Telegram при недоступности
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settingsForm.notify_on_recovery}
              onChange={(e) => setSettingsForm({ ...settingsForm, notify_on_recovery: e.target.checked })}
            />
            Уведомлять при восстановлении
          </label>
          {!data?.telegram_configured && (
            <p className="vault-warn" style={{ marginTop: "0.75rem" }}>
              Telegram-бот не настроен — уведомления не будут отправляться.
            </p>
          )}
        </ProxyModal>
      )}

      {journalOpen && (() => {
        const journalTotalPages = Math.max(1, Math.ceil(events.length / JOURNAL_PAGE_SIZE));
        const safePage = Math.min(journalPage, journalTotalPages);
        const journalPageEvents = events.slice(
          (safePage - 1) * JOURNAL_PAGE_SIZE,
          safePage * JOURNAL_PAGE_SIZE,
        );
        return (
          <ProxyModal title="Журнал действий" wide onClose={() => setJournalOpen(false)}>
            {events.length === 0 ? (
              <div className="proxy-empty" style={{ padding: "1.5rem 0" }}>
                <p>Событий пока нет.</p>
              </div>
            ) : (
              <>
                <div className="vault-history-table proxy-journal-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Время</th>
                        <th>Тип</th>
                        <th>Сообщение</th>
                      </tr>
                    </thead>
                    <tbody>
                      {journalPageEvents.map((ev) => (
                        <tr key={ev.id}>
                          <td>{formatDt(ev.created_at)}</td>
                          <td>{ev.event_type}</td>
                          <td>{ev.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {journalTotalPages > 1 && (
                  <div className="proxy-journal-pagination" aria-label="Страницы журнала">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={safePage <= 1}
                      onClick={() => setJournalPage((p) => Math.max(1, p - 1))}
                    >
                      Назад
                    </button>
                    <span className="proxy-journal-pagination__info">
                      Страница {safePage} из {journalTotalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={safePage >= journalTotalPages}
                      onClick={() => setJournalPage((p) => Math.min(journalTotalPages, p + 1))}
                    >
                      Вперёд
                    </button>
                  </div>
                )}
              </>
            )}
          </ProxyModal>
        );
      })()}
    </DashboardLayout>
  );
}
