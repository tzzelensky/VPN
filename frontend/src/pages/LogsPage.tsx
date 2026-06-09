import { useCallback, useEffect, useRef, useState } from "react";
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

function LogPanel({
  title,
  stream,
  dnsNote,
}: {
  title: string;
  stream: XrayLogStreamDto;
  dnsNote?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream.lines]);

  const statusLabel =
    stream.status === "ok"
      ? `${stream.lines.length} строк`
      : stream.message ?? stream.status;

  return (
    <section className="xray-log-panel">
      <div className="xray-log-panel-head">
        <h3 className="xray-log-panel-title">{title}</h3>
        <span className="muted xray-log-panel-meta">
          {stream.path ? (
            <span title={stream.path} className="xray-log-path">
              {stream.path}
            </span>
          ) : (
            "путь не задан"
          )}
          {dnsNote ? " · DNS log" : null}
        </span>
        <span className={`xray-log-status xray-log-status--${stream.status}`}>{statusLabel}</span>
      </div>
      <div ref={bodyRef} className="xray-log-body">
        {stream.status === "ok" && stream.lines.length > 0 ? (
          stream.lines.map((line, i) => {
            const kinds = stream.highlights[i] ?? [];
            const cls = kinds.length ? kinds.map((k) => `xray-log-hl-${k}`).join(" ") : "";
            return (
              <div key={i} className={cls ? `xray-log-line ${cls}` : "xray-log-line"}>
                {line || "\u00a0"}
              </div>
            );
          })
        ) : (
          <p className="xray-log-placeholder muted">{statusLabel}</p>
        )}
      </div>
    </section>
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

  const selected = servers.find((s) => s.id === serverId);

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className="page-head">
        <h1>Логи Xray</h1>
        <p className="muted page-sub">
          Просмотр access/error логов на VPN-сервере, смена loglevel и перезапуск Xray.
        </p>
      </div>

      {msg ? <div className={`banner banner--${msg.type}`}>{msg.text}</div> : null}

      <div className="card xray-logs-toolbar">
        <label className="field">
          <span className="field-label">Сервер</span>
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : "")}
            disabled={loading || levelBusy}
          >
            <option value="">— выберите —</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.host} ({s.host}){s.vless_deployed ? "" : " · не развёрнут"}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">loglevel</span>
          <select
            value={snapshot?.log.loglevel ?? "warning"}
            onChange={(e) => void onLevelChange(e.target.value as XrayLogLevel)}
            disabled={!serverId || loading || levelBusy}
            title="Сохраняет конфиг и перезапускает Xray"
          >
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <div className="xray-logs-actions">
          <button type="button" className="btn" onClick={() => void loadLogs()} disabled={!serverId || loading}>
            {loading ? "Загрузка…" : "Обновить"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClear} disabled={!serverId || loading}>
            Очистить логи
          </button>
          <button type="button" className="btn btn-secondary" onClick={copyLogs} disabled={!snapshot}>
            Скопировать логи
          </button>
          <label className="xray-logs-auto">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              disabled={!serverId}
            />
            Автообновление ({AUTO_REFRESH_MS / 1000} с)
          </label>
        </div>
      </div>

      {snapshot ? (
        <div className="xray-logs-meta card stack-sm">
          <p className="muted" style={{ margin: 0 }}>
            <strong>{snapshot.server_name}</strong> · {snapshot.host} · конфиг:{" "}
            <code className="xray-log-path">{snapshot.config_path}</code>
            {" · "}
            Xray: {snapshot.xray_running ? (
              <span className="ok-text">запущен</span>
            ) : (
              <span className="err-text">не запущен</span>
            )}
            {snapshot.log.dnsLog ? " · DNS log включён" : null}
          </p>
          {snapshot.hint ? <p className="banner banner--warn" style={{ margin: 0 }}>{snapshot.hint}</p> : null}
        </div>
      ) : selected && !loading ? (
        <p className="muted">Выберите сервер или нажмите «Обновить».</p>
      ) : null}

      {snapshot ? (
        <div className="xray-logs-grid">
          <LogPanel title="Error log" stream={snapshot.error} dnsNote={snapshot.log.dnsLog} />
          <LogPanel
            title="Access log"
            stream={snapshot.access}
            dnsNote={snapshot.log.dnsLog}
          />
        </div>
      ) : null}

      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "1rem" }}>
        Показаны последние {TAIL_LINES} строк. Секреты (UUID, ключи) маскируются. Строки с error, failed,
        timeout, TLS, REALITY, DNS и др. подсвечиваются.
      </p>
    </DashboardLayout>
  );
}
