import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DashboardLayout from "../components/DashboardLayout";
import {
  clearServerXrayLogs,
  fetchServerXrayLogs,
  listServers,
  patchServerXrayLogLevel,
  type ServerDto,
  type XrayLogLevel,
  type XrayLogStreamDto,
  type XrayLogsSnapshotDto,
} from "../api";

const LOG_LEVELS: XrayLogLevel[] = ["none", "error", "warning", "info", "debug"];
const TAIL_LINES = 300;
const AUTO_REFRESH_MS = 4000;
const LS_SERVER = "xray_logs_server_id";
const LS_AUTO = "xray_logs_auto_refresh";

type LogTab = "error" | "access";

const MASK_RE =
  /(\*{8,}|\[masked\]|(?:\*{4}-){3}\*{4}|\*{8}-\*{4}-\*{4}-\*{4}-\*{12})/g;

function isMaskedPart(part: string): boolean {
  return /(\*{8,}|\[masked\]|(?:\*{4}-){3}\*{4}|\*{8}-\*{4}-\*{4}-\*{4}-\*{12})/.test(part);
}

function IconServer() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="3" width="20" height="6" rx="1.5" />
      <rect x="2" y="11" width="20" height="6" rx="1.5" />
      <circle cx="6" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="6" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="20" cy="18" r="2" />
      <circle cx="8" cy="6" r="2" />
    </svg>
  );
}

function IconRefresh({ spin }: { spin?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={spin ? "xray-icon-spin" : undefined}
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" strokeLinecap="round" />
    </svg>
  );
}

function IconFullscreen({ exit }: { exit?: boolean }) {
  return exit ? (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconEmpty() {
  return (
    <svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="12" y="8" width="40" height="48" rx="4" opacity="0.35" />
      <path d="M22 22h20M22 30h14M22 38h18" strokeLinecap="round" opacity="0.5" />
      <circle cx="46" cy="46" r="12" fill="var(--surface)" stroke="currentColor" />
      <path d="M41 46l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function lineLevelClass(line: string): string {
  if (/\[ERROR\]|\berror\b/i.test(line)) return "xray-log-lvl-error";
  if (/\[WARNING\]|\bwarning\b/i.test(line)) return "xray-log-lvl-warn";
  if (/\[INFO\]|200 OK|\baccepted\b/i.test(line)) return "xray-log-lvl-info";
  return "";
}

function LogLineContent({ line }: { line: string }) {
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const parts = line.split(MASK_RE);

  if (parts.length === 1) return <>{line || "\u00a0"}</>;

  let maskIdx = 0;
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (isMaskedPart(part)) {
          const idx = maskIdx++;
          const open = revealed.has(idx);
          return (
            <button
              key={i}
              type="button"
              className={`xray-log-secret${open ? " is-revealed" : ""}`}
              title={open ? "Секрет замаскирован сервером" : "Нажмите, чтобы показать маску"}
              onClick={() =>
                setRevealed((prev) => {
                  const next = new Set(prev);
                  if (next.has(idx)) next.delete(idx);
                  else next.add(idx);
                  return next;
                })
              }
            >
              {part}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function highlightSearch(text: string, query: string): ReactNode {
  if (!query.trim()) return text;
  const q = query.trim();
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let pos = 0;
  let idx = lower.indexOf(needle, pos);
  while (idx !== -1) {
    if (idx > pos) nodes.push(text.slice(pos, idx));
    nodes.push(
      <mark key={idx} className="xray-log-search-hit">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    pos = idx + q.length;
    idx = lower.indexOf(needle, pos);
  }
  if (pos < text.length) nodes.push(text.slice(pos));
  return nodes;
}

function LogTerminal({
  stream,
  search,
  tailHint,
}: {
  stream: XrayLogStreamDto;
  search: string;
  tailHint: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const q = search.trim().toLowerCase();

  const visibleLines = useMemo(() => {
    if (!q) return stream.lines.map((line, i) => ({ line, i }));
    return stream.lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.toLowerCase().includes(q));
  }, [stream.lines, q]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream.lines, search]);

  const isEmpty = stream.status === "ok" && stream.lines.length === 0;
  const isFilteredEmpty = stream.status === "ok" && stream.lines.length > 0 && visibleLines.length === 0;

  return (
    <>
      <div ref={bodyRef} className="xray-terminal-body">
        {stream.status === "ok" && stream.lines.length > 0 ? (
          visibleLines.map(({ line, i }) => {
            const kinds = stream.highlights[i] ?? [];
            const hl = kinds.map((k) => `xray-log-hl-${k}`).join(" ");
            const lvl = lineLevelClass(line);
            const cls = ["xray-log-line", hl, lvl].filter(Boolean).join(" ");
            return (
              <div key={i} className={cls}>
                {q ? (
                  highlightSearch(line, search)
                ) : (
                  <LogLineContent line={line} />
                )}
              </div>
            );
          })
        ) : isEmpty ? (
          <div className="xray-log-empty">
            <IconEmpty />
            <p className="xray-log-empty-title">Здесь пока ничего нет</p>
            <p className="xray-log-empty-sub">Логи отсутствуют или файл пуст</p>
          </div>
        ) : isFilteredEmpty ? (
          <div className="xray-log-empty">
            <IconSearch />
            <p className="xray-log-empty-title">Ничего не найдено</p>
            <p className="xray-log-empty-sub">Попробуйте другой запрос</p>
          </div>
        ) : (
          <div className="xray-log-empty xray-log-empty--muted">
            <p className="xray-log-empty-title">{stream.message ?? stream.status}</p>
          </div>
        )}
      </div>
      <div className="xray-terminal-footer">
        <span>{tailHint}</span>
        {stream.path ? (
          <span className="xray-terminal-footer-path" title={stream.path}>
            {stream.path}
          </span>
        ) : null}
      </div>
    </>
  );
}

export default function LogsPage({ onLogout }: { onLogout: () => void }) {
  const [servers, setServers] = useState<ServerDto[]>([]);
  const [serverId, setServerId] = useState<number | "">("");
  const [snapshot, setSnapshot] = useState<XrayLogsSnapshotDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [levelBusy, setLevelBusy] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem(LS_AUTO) === "1");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<LogTab>("error");
  const [search, setSearch] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadServers = useCallback(async () => {
    const list = await listServers();
    setServers(list);
    const saved = Number(localStorage.getItem(LS_SERVER));
    const pick =
      list.find((s) => s.id === saved)?.id ??
      list.find((s) => s.vless_deployed)?.id ??
      list[0]?.id;
    if (pick) setServerId(pick);
  }, []);

  const loadLogs = useCallback(async (silent = false) => {
    if (!serverId || typeof serverId !== "number") return;
    if (!silent) setLoading(true);
    setMsg(null);
    try {
      const data = await fetchServerXrayLogs(serverId, TAIL_LINES);
      setSnapshot(data);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    loadServers().catch((e) => setMsg({ type: "err", text: String(e) }));
  }, [loadServers]);

  useEffect(() => {
    if (typeof serverId === "number") {
      localStorage.setItem(LS_SERVER, String(serverId));
      loadLogs().catch(() => {});
    }
  }, [serverId, loadLogs]);

  useEffect(() => {
    localStorage.setItem(LS_AUTO, autoRefresh ? "1" : "0");
    if (!autoRefresh || typeof serverId !== "number") return;
    const t = window.setInterval(() => {
      loadLogs(true).catch(() => {});
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [autoRefresh, serverId, loadLogs]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function onLevelChange(level: XrayLogLevel) {
    if (typeof serverId !== "number") return;
    setLevelBusy(true);
    setMsg(null);
    try {
      const data = await patchServerXrayLogLevel(serverId, level);
      setSnapshot(data);
      setMsg({ type: "ok", text: `loglevel = ${level}, конфиг сохранён, Xray перезапущен.` });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLevelBusy(false);
    }
  }

  async function onClear() {
    if (typeof serverId !== "number") return;
    if (!window.confirm("Очистить access и error логи на сервере?")) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await clearServerXrayLogs(serverId, ["access", "error"]);
      setSnapshot(r.snapshot);
      const parts = [];
      if (r.cleared.length) parts.push(`очищено: ${r.cleared.length}`);
      if (r.errors.length) parts.push(`ошибки: ${r.errors.join("; ")}`);
      setMsg({ type: r.errors.length ? "err" : "ok", text: parts.join(" · ") || "Готово." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }

  function copyLogs() {
    if (!snapshot) return;
    const chunks: string[] = [];
    const push = (label: string, stream: XrayLogStreamDto) => {
      chunks.push(`=== ${label} ===`);
      if (stream.status === "ok" && stream.lines.length) {
        chunks.push(stream.lines.join("\n"));
      } else {
        chunks.push(stream.message ?? stream.status);
      }
      chunks.push("");
    };
    push("Error log", snapshot.error);
    push("Access log", snapshot.access);
    const text = chunks.join("\n").trim();
    void navigator.clipboard.writeText(text).then(
      () => setMsg({ type: "ok", text: "Логи скопированы в буфер обмена." }),
      () => setMsg({ type: "err", text: "Не удалось скопировать." }),
    );
  }

  const logLevel = snapshot?.log.loglevel ?? "warning";
  const loggingOff = logLevel === "none";
  const activeStream = snapshot ? (activeTab === "error" ? snapshot.error : snapshot.access) : null;
  const tailHint = `Показаны последние ${TAIL_LINES} строк · секреты маскируются · error/failed/TLS/REALITY/DNS подсвечиваются`;

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className={`xray-logs-page${fullscreen ? " xray-logs-page--fullscreen-active" : ""}`}>
        <header className="xray-logs-head">
          <h1 className="xray-logs-title">Логи Xray</h1>
          <p className="xray-logs-sub">
            Просмотр access/error логов на VPN-сервере, смена loglevel и перезапуск Xray.
          </p>
        </header>

        {msg ? <div className={`banner banner--${msg.type}`}>{msg.text}</div> : null}

        <div className="xray-logs-toolbar card">
          <div className="xray-logs-toolbar-main">
            <label className="xray-select-wrap">
              <span className="xray-select-icon" aria-hidden>
                <IconServer />
              </span>
              <select
                className="xray-select"
                value={serverId}
                onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : "")}
                disabled={loading || levelBusy}
                aria-label="Сервер"
              >
                <option value="">— выберите сервер —</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.host} ({s.host}){s.vless_deployed ? "" : " · не развёрнут"}
                  </option>
                ))}
              </select>
            </label>

            <label className="xray-select-wrap">
              <span className="xray-select-icon" aria-hidden>
                <IconSliders />
              </span>
              <select
                className="xray-select"
                value={logLevel}
                onChange={(e) => void onLevelChange(e.target.value as XrayLogLevel)}
                disabled={!serverId || loading || levelBusy}
                title="Сохраняет конфиг и перезапускает Xray"
                aria-label="Уровень логирования"
              >
                {LOG_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    loglevel: {l}
                  </option>
                ))}
              </select>
            </label>

            {loggingOff ? (
              <span className="badge warn xray-logs-badge-warn">Логирование отключено</span>
            ) : null}
          </div>

          <div className="xray-logs-toolbar-actions">
            <div className="xray-logs-refresh-group">
              <button
                type="button"
                className="btn xray-btn-primary"
                onClick={() => void loadLogs()}
                disabled={!serverId || loading}
              >
                <IconRefresh spin={loading} />
                {loading ? "Загрузка…" : "Обновить"}
              </button>
              <div className="xray-auto-switch">
                <button
                  type="button"
                  className={`toggle toggle-sm ${autoRefresh ? "on" : ""}`}
                  aria-pressed={autoRefresh}
                  aria-label="Автообновление"
                  disabled={!serverId}
                  onClick={() => setAutoRefresh((v) => !v)}
                />
                <span className="xray-auto-switch-label">Авто ({AUTO_REFRESH_MS / 1000} с)</span>
              </div>
            </div>
            <button type="button" className="btn btn-secondary xray-btn-icon" onClick={copyLogs} disabled={!snapshot}>
              <IconCopy />
              Скопировать
            </button>
            <button
              type="button"
              className="btn btn-danger xray-btn-icon"
              onClick={() => void onClear()}
              disabled={!serverId || loading}
            >
              <IconTrash />
              Очистить
            </button>
          </div>
        </div>

        {snapshot ? (
          <div className="xray-logs-status card">
            <span className="xray-logs-status-name">{snapshot.server_name}</span>
            <span className="xray-logs-status-sep">·</span>
            <span>{snapshot.host}</span>
            <span className="xray-logs-status-sep">·</span>
            <span>
              Xray:{" "}
              {snapshot.xray_running ? (
                <span className="badge ok">запущен</span>
              ) : (
                <span className="badge warn">не запущен</span>
              )}
            </span>
            {snapshot.log.dnsLog ? (
              <>
                <span className="xray-logs-status-sep">·</span>
                <span className="badge muted">DNS log</span>
              </>
            ) : null}
            {snapshot.hint ? (
              <p className="xray-logs-hint">
                {snapshot.hint}
                {loggingOff ? (
                  <span className="badge warn xray-logs-badge-warn xray-logs-badge-warn--inline">
                    loglevel = none — Xray почти не пишет логи
                  </span>
                ) : null}
              </p>
            ) : loggingOff ? (
              <p className="xray-logs-hint">
                <span className="badge warn xray-logs-badge-warn xray-logs-badge-warn--inline">
                  loglevel = none — Xray почти не пишет логи
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        {snapshot && activeStream ? (
          <div className={`xray-terminal card${fullscreen ? " xray-terminal--fullscreen" : ""}`}>
            <div className="xray-terminal-toolbar">
              <div className="xray-log-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={`xray-log-tab${activeTab === "error" ? " active" : ""}`}
                  aria-selected={activeTab === "error"}
                  onClick={() => setActiveTab("error")}
                >
                  Error log
                  <span className="xray-log-tab-count">{snapshot.error.lines.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`xray-log-tab${activeTab === "access" ? " active" : ""}`}
                  aria-selected={activeTab === "access"}
                  onClick={() => setActiveTab("access")}
                >
                  Access log
                  <span className="xray-log-tab-count">{snapshot.access.lines.length}</span>
                </button>
              </div>
              <div className="xray-terminal-tools">
                <label className="xray-log-search">
                  <IconSearch />
                  <input
                    ref={searchRef}
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск по логам… (Ctrl+F)"
                    aria-label="Поиск по логам"
                  />
                </label>
                <button
                  type="button"
                  className="ghost xray-terminal-fs-btn"
                  onClick={() => setFullscreen((v) => !v)}
                  title={fullscreen ? "Выйти из полноэкранного режима (Esc)" : "На весь экран"}
                  aria-label={fullscreen ? "Свернуть" : "Развернуть на весь экран"}
                >
                  <IconFullscreen exit={fullscreen} />
                </button>
              </div>
            </div>
            <LogTerminal stream={activeStream} search={search} tailHint={tailHint} />
          </div>
        ) : !loading && serverId ? (
          <div className="card xray-logs-placeholder card">Нажмите «Обновить», чтобы загрузить логи.</div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
