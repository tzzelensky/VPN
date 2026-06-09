import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import {
  checkAllConfigVaultKeys,
  checkConfigVaultKey,
  configVaultExportUrl,
  createConfigVaultKey,
  deleteConfigVaultKey,
  fetchConfigVaultKeyRaw,
  importConfigVaultKeys,
  listConfigVaultChecks,
  loadConfigVault,
  patchConfigVaultSettings,
  pollUntilVaultChecksDone,
  setConfigVaultSubscriptions,
  updateConfigVaultKey,
  type ConfigVaultCheckDto,
  type ConfigVaultKeyDto,
  type ConfigVaultOverviewDto,
  type ConfigVaultSettingsDto,
  type VlessCheckStatusDto,
} from "../api";
import { usePanelSettings } from "../panelSettingsContext";

const STATUS_LABEL: Record<VlessCheckStatusDto, string> = {
  available: "Доступен",
  unavailable: "Недоступен",
  unstable: "Нестабильно",
  never: "Не проверялся",
  checking: "Проверяется",
};

type FilterKey =
  | "all"
  | "in_subs"
  | "not_in_subs"
  | "available"
  | "unavailable"
  | "unstable"
  | "never";

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

export default function ConfigVaultPage({ onLogout }: { onLogout: () => void }) {
  const { confirmDangerous, maskSecret } = usePanelSettings();
  const [data, setData] = useState<ConfigVaultOverviewDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<"new" | "old" | "status" | "last_check">("new");

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const [viewKey, setViewKey] = useState<ConfigVaultKeyDto | null>(null);
  const [viewFullUri, setViewFullUri] = useState(false);
  const [viewRawUri, setViewRawUri] = useState<string | null>(null);

  const [editKey, setEditKey] = useState<ConfigVaultKeyDto | null>(null);
  const [historyKey, setHistoryKey] = useState<ConfigVaultKeyDto | null>(null);
  const [history, setHistory] = useState<ConfigVaultCheckDto[]>([]);
  const [historyFilter, setHistoryFilter] = useState<{ status: string; triggered: string }>({
    status: "",
    triggered: "",
  });

  const [formName, setFormName] = useState("");
  const [formUri, setFormUri] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formNotify, setFormNotify] = useState(true);
  const [importText, setImportText] = useState("");
  const [importPrefix, setImportPrefix] = useState("");
  const [settingsForm, setSettingsForm] = useState<ConfigVaultSettingsDto | null>(null);

  const showToast = useCallback((type: "ok" | "err", text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const reload = useCallback(async () => {
    const r = await loadConfigVault();
    setData(r);
    return r;
  }, []);

  useEffect(() => {
    void reload().catch((e) => showToast("err", parseErr(e)));
  }, [reload, showToast]);

  const keys = useMemo(() => {
    const list = data?.keys ?? [];
    const q = search.trim().toLowerCase();
    let out = list.filter((k) => {
      if (!q) return true;
      return k.name.toLowerCase().includes(q) || k.masked_uri.toLowerCase().includes(q);
    });
    if (filter === "in_subs") out = out.filter((k) => k.added_to_subscriptions);
    else if (filter === "not_in_subs") out = out.filter((k) => !k.added_to_subscriptions);
    else if (filter === "available") out = out.filter((k) => k.last_check_status === "available");
    else if (filter === "unavailable") out = out.filter((k) => k.last_check_status === "unavailable");
    else if (filter === "unstable") out = out.filter((k) => k.last_check_status === "unstable");
    else if (filter === "never") out = out.filter((k) => k.last_check_status === "never");
    const statusOrder: Record<VlessCheckStatusDto, number> = {
      unavailable: 0,
      unstable: 1,
      checking: 2,
      never: 3,
      available: 4,
    };
    out = [...out].sort((a, b) => {
      if (sortBy === "old") return a.id - b.id;
      if (sortBy === "status") return statusOrder[a.last_check_status] - statusOrder[b.last_check_status];
      if (sortBy === "last_check") {
        const ta = a.last_check_at ? Date.parse(a.last_check_at) : 0;
        const tb = b.last_check_at ? Date.parse(b.last_check_at) : 0;
        return tb - ta;
      }
      return b.id - a.id;
    });
    return out;
  }, [data?.keys, search, filter, sortBy]);

  async function runBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      showToast("err", parseErr(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function openView(k: ConfigVaultKeyDto) {
    setViewKey(k);
    setViewFullUri(false);
    setViewRawUri(k.raw_uri ?? null);
    if (!k.raw_uri) {
      const r = await runBusy(() => fetchConfigVaultKeyRaw(k.id));
      if (r?.key.raw_uri) setViewRawUri(r.key.raw_uri);
    }
  }

  async function openEdit(k: ConfigVaultKeyDto, prefilledUri?: string | null) {
    setEditKey(k);
    setFormName(k.name);
    setFormActive(k.active);
    setFormNotify(k.notify_on_fail);
    const uri = (prefilledUri ?? k.raw_uri ?? "").trim();
    if (uri) {
      setFormUri(uri);
      return;
    }
    setFormUri("");
    const r = await runBusy(() => fetchConfigVaultKeyRaw(k.id));
    if (r?.key.raw_uri) setFormUri(r.key.raw_uri);
  }

  async function openHistory(k: ConfigVaultKeyDto) {
    setHistoryKey(k);
    setHistoryFilter({ status: "", triggered: "" });
    const r = await runBusy(() => listConfigVaultChecks(k.id, { limit: 50 }));
    if (r) setHistory(r.checks);
  }

  async function reloadHistory() {
    if (!historyKey) return;
    const r = await runBusy(() =>
      listConfigVaultChecks(historyKey.id, {
        limit: 50,
        status: historyFilter.status || undefined,
        triggered_by: historyFilter.triggered || undefined,
      }),
    );
    if (r) setHistory(r.checks);
  }

  async function handleCreate() {
    await runBusy(async () => {
      await createConfigVaultKey({
        name: formName,
        raw_uri: formUri,
        active: formActive,
        notify_on_fail: formNotify,
      });
      await reload();
      setAddOpen(false);
      setFormName("");
      setFormUri("");
      showToast("ok", "Ключ добавлен в хранилище");
    });
  }

  async function handleImport() {
    await runBusy(async () => {
      const r = await importConfigVaultKeys({
        text: importText,
        name_prefix: importPrefix,
        active: formActive,
        notify_on_fail: formNotify,
      });
      setData((d) => (d ? { ...d, keys: r.keys } : d));
      setImportOpen(false);
      setImportText("");
      showToast(
        "ok",
        `Импорт: добавлено ${r.added}, дублей ${r.skipped_duplicates}, ошибок ${r.errors.length}`,
      );
    });
  }

  async function handleSaveEdit() {
    if (!editKey) return;
    if (editKey.added_to_subscriptions) {
      const ok = confirmDangerous(
        "Этот ключ уже добавлен в подписки. Изменения будут применены и к подпискам. Продолжить?",
      );
      if (!ok) return;
    }
    await runBusy(async () => {
      await updateConfigVaultKey(editKey.id, {
        name: formName,
        raw_uri: formUri,
        active: formActive,
        notify_on_fail: formNotify,
      });
      await reload();
      setEditKey(null);
      showToast("ok", "Ключ обновлен");
    });
  }

  async function handleDelete(k: ConfigVaultKeyDto) {
    const msg = k.added_to_subscriptions
      ? "Этот ключ добавлен в подписки. При удалении он также будет удален из подписок. Продолжить?"
      : `Удалить ключ «${k.name}»?`;
    if (!confirmDangerous(msg)) return;
    await runBusy(async () => {
      await deleteConfigVaultKey(k.id);
      await reload();
      if (viewKey?.id === k.id) setViewKey(null);
      showToast("ok", "Ключ удален");
    });
  }

  async function toggleSubs(k: ConfigVaultKeyDto, added: boolean) {
    await runBusy(async () => {
      await setConfigVaultSubscriptions(k.id, added);
      await reload();
      showToast("ok", added ? "Ключ добавлен в подписки" : "Ключ убран из подписок");
    });
  }

  async function checkOne(k: ConfigVaultKeyDto) {
    await runBusy(async () => {
      const r = await checkConfigVaultKey(k.id);
      await reload();
      if (viewKey?.id === k.id) setViewKey(r.key);
      showToast("ok", `Проверка: ${STATUS_LABEL[r.key.last_check_status] ?? r.key.last_check_status}`);
    });
  }

  function copyUri(uri: string) {
    if (!confirmDangerous("Ссылка содержит рабочий ключ доступа. Не передавайте ее посторонним.")) return;
    void navigator.clipboard.writeText(uri).then(
      () => showToast("ok", "Ключ скопирован"),
      () => showToast("err", "Не удалось скопировать"),
    );
  }

  function revealFull() {
    if (!confirmDangerous("Ссылка содержит рабочий ключ доступа. Не показывайте ее посторонним.")) return;
    setViewFullUri(true);
  }

  const stats = data?.stats;

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className="vault-page">
        <h1 className="page-title">Конфиг-хранилище</h1>
        <p className="vault-lead muted">
          Хранение ключей VLESS, Trojan и Hysteria2, управление добавлением в подписки и проверка доступности.
        </p>

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
            <span className="vault-stat-label">Всего ключей</span>
            <strong>{stats?.total ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">В подписках</span>
            <strong>{stats?.in_subscriptions ?? 0}</strong>
          </div>
          <div className="vault-stat-card vault-stat-card--ok">
            <span className="vault-stat-label">Доступны</span>
            <strong>{stats?.available ?? 0}</strong>
          </div>
          <div className="vault-stat-card vault-stat-card--bad">
            <span className="vault-stat-label">Недоступны</span>
            <strong>{stats?.unavailable ?? 0}</strong>
          </div>
          <div className="vault-stat-card vault-stat-card--warn">
            <span className="vault-stat-label">Нестабильны</span>
            <strong>{stats?.unstable ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">Не проверялись</span>
            <strong>{stats?.never ?? 0}</strong>
          </div>
          <div className="vault-stat-card">
            <span className="vault-stat-label">Последняя автопроверка</span>
            <strong className="vault-stat-sm">{formatDt(stats?.last_auto_run_at ?? null)}</strong>
          </div>
        </div>

        <div className="vault-toolbar">
          <button type="button" className="btn primary" disabled={busy} onClick={() => {
            setFormName("");
            setFormUri("");
            setFormActive(true);
            setFormNotify(true);
            setAddOpen(true);
          }}>
            Добавить ключ
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setImportOpen(true)}>
            Импорт списком
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void runBusy(async () => {
              const start = await checkAllConfigVaultKeys();
              if (start.already_running) {
                showToast("ok", "Проверка уже выполняется");
              } else {
                showToast("ok", `Проверка запущена (${start.total ?? 0} ключей)`);
              }
              await pollUntilVaultChecksDone(async () => {
                const r = await reload();
                return r ?? { keys: [] };
              }, start.total ?? 0);
              await reload();
              showToast("ok", "Проверка всех ключей завершена");
            })}
          >
            Проверить все сейчас
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
          <button type="button" className="btn" disabled={busy} onClick={() => setExportOpen(true)}>
            Экспорт
          </button>
        </div>

        <div className="vault-filters">
          <input
            className="input"
            placeholder="Поиск по названию или части ключа"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
            <option value="all">Все</option>
            <option value="in_subs">В подписках</option>
            <option value="not_in_subs">Не в подписках</option>
            <option value="available">Доступные</option>
            <option value="unavailable">Недоступные</option>
            <option value="unstable">Нестабильные</option>
            <option value="never">Не проверялись</option>
          </select>
          <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="new">Новые сверху</option>
            <option value="old">Старые сверху</option>
            <option value="status">По статусу</option>
            <option value="last_check">По последней проверке</option>
          </select>
        </div>

        {keys.length === 0 ? (
          <p className="muted vault-empty">Нет ключей. Добавьте ссылку (vless/trojan/hysteria2) или импортируйте список.</p>
        ) : (
          <div className="vault-list">
            {keys.map((k) => (
              <article key={k.id} className="vault-row">
                <div className="vault-row-main">
                  <div className="vault-row-title">
                    <strong>{k.name}</strong>
                    {k.added_to_subscriptions ? (
                      <span className="vault-badge vault-badge--subs">В подписках</span>
                    ) : (
                      <span className="vault-badge vault-badge--store">Не в подписках</span>
                    )}
                    {!k.active && <span className="vault-badge vault-badge--off">Отключён</span>}
                  </div>
                  <code className="vault-uri">{maskSecret(k.masked_uri)}</code>
                  <div className="vault-row-meta">
                    <span className={`vault-status vault-status--${k.last_check_status}`}>
                      {STATUS_LABEL[k.last_check_status]}
                    </span>
                    {k.last_check_latency_ms != null && (
                      <span className="muted">{k.last_check_latency_ms} мс</span>
                    )}
                    <span className="muted">Проверка: {formatDt(k.last_check_at)}</span>
                    <span className="muted">В подписках: {k.added_to_subscriptions ? "Да" : "Нет"}</span>
                  </div>
                </div>
                <div className="vault-row-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void openView(k)}>
                    Просмотр
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void openEdit(k)}>
                    Редактировать
                  </button>
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void checkOne(k)}>
                    Проверить
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => void toggleSubs(k, !k.added_to_subscriptions)}
                  >
                    {k.added_to_subscriptions ? "Убрать из подписок" : "Добавить в подписки"}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void openHistory(k)}>
                    История
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const uri = k.raw_uri;
                      if (uri) copyUri(uri);
                      else
                        void fetchConfigVaultKeyRaw(k.id).then((r) => {
                          if (r.key.raw_uri) copyUri(r.key.raw_uri);
                        });
                    }}
                  >
                    Скопировать
                  </button>
                  <button type="button" className="btn btn-sm danger" onClick={() => void handleDelete(k)}>
                    Удалить
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {addOpen && (
        <div className="modal-backdrop">
          <div className="modal modal--sm vault-modal">
            <div className="modal-head">
              <h2>Добавить ключ</h2>
              <button type="button" className="modal-close" onClick={() => setAddOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Название</span>
                <input className="input" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </label>
              <label className="field">
                <span>Ссылка (vless://, trojan://, hysteria2://)</span>
                <textarea
                  className="input"
                  rows={4}
                  value={formUri}
                  onChange={(e) => setFormUri(e.target.value)}
                  placeholder="vless://… или trojan://… или hysteria2://…"
                />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Активен
              </label>
              <label className="check-row">
                <input type="checkbox" checked={formNotify} onChange={(e) => setFormNotify(e.target.checked)} />
                Уведомлять при недоступности
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setAddOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleCreate()}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {editKey && (
        <div className="modal-backdrop">
          <div className="modal modal--sm vault-modal">
            <div className="modal-head">
              <h2>Редактировать ключ</h2>
              <button type="button" className="modal-close" onClick={() => setEditKey(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Название</span>
                <input className="input" value={formName} onChange={(e) => setFormName(e.target.value)} />
              </label>
              <label className="field">
                <span>Ссылка (vless://, trojan://, hysteria2://)</span>
                <textarea className="input" rows={4} value={formUri} onChange={(e) => setFormUri(e.target.value)} />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Активен
              </label>
              <label className="check-row">
                <input type="checkbox" checked={formNotify} onChange={(e) => setFormNotify(e.target.checked)} />
                Уведомлять при недоступности
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setEditKey(null)}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleSaveEdit()}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {viewKey && (
        <div className="modal-backdrop">
          <div className="modal vault-modal">
            <div className="modal-head">
              <h2>{viewKey.name}</h2>
              <button type="button" className="modal-close" onClick={() => setViewKey(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                <span className="muted">Ключ: </span>
                <code className="vault-uri">
                  {viewFullUri && viewRawUri ? viewRawUri : maskSecret(viewKey.masked_uri)}
                </code>
              </p>
              {!viewFullUri && (
                <button type="button" className="btn btn-sm" onClick={revealFull}>
                  Показать полностью
                </button>
              )}
              {viewRawUri && (
                <button type="button" className="btn btn-sm" onClick={() => copyUri(viewRawUri)}>
                  Скопировать ключ
                </button>
              )}
              <dl className="vault-dl">
                <dt>Статус</dt>
                <dd>{STATUS_LABEL[viewKey.last_check_status]}</dd>
                <dt>Последняя проверка</dt>
                <dd>{formatDt(viewKey.last_check_at)}</dd>
                <dt>Задержка</dt>
                <dd>{viewKey.last_check_latency_ms != null ? `${viewKey.last_check_latency_ms} мс` : "—"}</dd>
                <dt>Ошибка</dt>
                <dd>{viewKey.last_error ?? "—"}</dd>
                <dt>В подписках</dt>
                <dd>{viewKey.added_to_subscriptions ? "Да" : "Нет"}</dd>
                <dt>Активен</dt>
                <dd>{viewKey.active ? "Да" : "Нет"}</dd>
                <dt>Уведомления</dt>
                <dd>{viewKey.notify_on_fail ? "Включены" : "Выключены"}</dd>
              </dl>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" disabled={busy} onClick={() => void checkOne(viewKey)}>
                Проверить сейчас
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void toggleSubs(viewKey, !viewKey.added_to_subscriptions)}
              >
                {viewKey.added_to_subscriptions ? "Убрать из подписок" : "Добавить в подписки"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setViewKey(null);
                  void openEdit(viewKey, viewRawUri);
                }}
              >
                Редактировать
              </button>
              <button type="button" className="btn danger" onClick={() => void handleDelete(viewKey)}>
                Удалить
              </button>
              <button type="button" className="btn" onClick={() => setViewKey(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-backdrop">
          <div className="modal modal-import vault-modal">
            <div className="modal-head">
              <h2>Импорт списком</h2>
              <button type="button" className="modal-close" onClick={() => setImportOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Префикс названия (опционально)</span>
                <input className="input" value={importPrefix} onChange={(e) => setImportPrefix(e.target.value)} />
              </label>
              <label className="field">
                <span>Ссылки vless://, trojan://, hysteria2:// (по одной на строку)</span>
                <textarea className="input" rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setImportOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void handleImport()}>
                Импортировать
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && settingsForm && (
        <div className="modal-backdrop">
          <div className="modal modal--sm vault-modal">
            <div className="modal-head">
              <h2>Автопроверка</h2>
              <button type="button" className="modal-close" onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settingsForm.auto_check_enabled}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, auto_check_enabled: e.target.checked })
                  }
                />
                Автопроверка включена
              </label>
              <label className="field">
                <span>Интервал (минут)</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={settingsForm.interval_minutes}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, interval_minutes: Number(e.target.value) || 15 })
                  }
                />
              </label>
              <label className="field">
                <span>Попыток на проверку</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={settingsForm.attempts_per_check}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, attempts_per_check: Number(e.target.value) || 5 })
                  }
                />
              </label>
              <label className="field">
                <span>Таймаут попытки (сек)</span>
                <input
                  className="input"
                  type="number"
                  min={3}
                  value={settingsForm.attempt_timeout_sec}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, attempt_timeout_sec: Number(e.target.value) || 8 })
                  }
                />
              </label>
              <label className="field">
                <span>Тестовый URL</span>
                <input
                  className="input"
                  value={settingsForm.test_url}
                  onChange={(e) => setSettingsForm({ ...settingsForm, test_url: e.target.value })}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settingsForm.notify_on_unavailable}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, notify_on_unavailable: e.target.checked })
                  }
                />
                Уведомлять при недоступности
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settingsForm.notify_on_recovery}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, notify_on_recovery: e.target.checked })
                  }
                />
                Уведомлять при восстановлении
              </label>
              <label className="field">
                <span>Cooldown уведомлений (мин)</span>
                <input
                  className="input"
                  type="number"
                  min={5}
                  value={settingsForm.notify_cooldown_minutes}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      notify_cooldown_minutes: Number(e.target.value) || 45,
                    })
                  }
                />
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void runBusy(async () => {
                    await patchConfigVaultSettings(settingsForm);
                    await reload();
                    setSettingsOpen(false);
                    showToast("ok", "Настройки сохранены");
                  })
                }
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="modal-backdrop">
          <div className="modal modal--sm vault-modal">
            <div className="modal-head">
              <h2>Экспорт</h2>
              <button type="button" className="modal-close" onClick={() => setExportOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="vault-warn-sm">
                Экспорт содержит рабочие ссылки доступа. Не передавайте файл посторонним.
              </p>
              {(
                [
                  ["all", "Все ключи"],
                  ["active", "Только активные"],
                  ["subscriptions", "В подписках"],
                  ["available", "Доступные"],
                ] as const
              ).map(([mode, label]) => (
                <div key={mode} className="vault-export-row">
                  <span>{label}</span>
                  <a
                    className="btn btn-sm"
                    href={configVaultExportUrl(mode, "txt")}
                    download
                    onClick={() => setExportOpen(false)}
                  >
                    TXT
                  </a>
                  <a
                    className="btn btn-sm"
                    href={configVaultExportUrl(mode, "json")}
                    download
                    onClick={() => setExportOpen(false)}
                  >
                    JSON
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {historyKey && (
        <div className="modal-backdrop">
          <div className="modal vault-modal">
            <div className="modal-head">
              <h2>История: {historyKey.name}</h2>
              <button type="button" className="modal-close" onClick={() => setHistoryKey(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="vault-filters">
                <select
                  className="input"
                  value={historyFilter.status}
                  onChange={(e) => setHistoryFilter((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="">Все статусы</option>
                  <option value="available">Доступен</option>
                  <option value="unavailable">Недоступен</option>
                  <option value="unstable">Нестабильно</option>
                </select>
                <select
                  className="input"
                  value={historyFilter.triggered}
                  onChange={(e) => setHistoryFilter((f) => ({ ...f, triggered: e.target.value }))}
                >
                  <option value="">Все</option>
                  <option value="manual">Ручная</option>
                  <option value="auto">Авто</option>
                </select>
                <button type="button" className="btn btn-sm" onClick={() => void reloadHistory()}>
                  Применить
                </button>
              </div>
              <div className="vault-history-table">
                {history.length === 0 ? (
                  <p className="muted">Нет записей</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Время</th>
                        <th>Статус</th>
                        <th>Успех</th>
                        <th>Задержка</th>
                        <th>Источник</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((c) => (
                        <tr key={c.id}>
                          <td>{formatDt(c.checked_at)}</td>
                          <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                          <td>
                            {c.attempts_success}/{c.attempts_total}
                          </td>
                          <td>{c.avg_latency_ms ?? "—"}</td>
                          <td>{c.triggered_by === "auto" ? "Авто" : "Ручная"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
