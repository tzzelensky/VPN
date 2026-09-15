import type { Client } from "ssh2";
import { getServer, type ServerRow } from "./db.js";
import {
  DEFAULT_LOG_TAIL_LINES,
  LOG_TRIM_KEEP_BYTES,
  LOG_TRIM_TRIGGER_BYTES,
  MAX_LOG_TAIL_LINES,
  TZADMIN_DEFAULT_ACCESS_LOG,
  TZADMIN_DEFAULT_ERROR_LOG,
  TZADMIN_LOG_DIR,
  applyXrayLogConfig,
  isXrayLogLevel,
  maskSensitiveLogText,
  parseXrayLogConfig,
  shellQuote,
  highlightKindsForLine,
  type LogFileStatus,
  type ParsedXrayLogConfig,
  type XrayLogLevel,
} from "./xrayLogUtil.js";
import {
  TZADMIN_XRAY_CONFIG_PATH,
  detectXrayConfigPath,
  isTzadminManagedConfigPath,
  mutateXrayConfigAndRestart,
  sshExecCommand,
  sshExecOn,
  sshSftpReadOn,
  withSsh,
  type SshConfig,
} from "./ssh.js";
import { resolveConfigPath } from "./userSync.js";

function sshCfg(row: ServerRow): SshConfig {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

export type LogStreamPayload = {
  path: string | null;
  status: LogFileStatus;
  lines: string[];
  highlights: ReturnType<typeof highlightKindsForLine>[];
  message?: string;
};

export type XrayLogsSnapshot = {
  server_id: number;
  server_name: string;
  host: string;
  config_path: string;
  log: ParsedXrayLogConfig;
  xray_running: boolean;
  access: LogStreamPayload;
  error: LogStreamPayload;
  hint: string | null;
};

const SNAPSHOT_CACHE_TTL_MS = 3000;
const snapshotCache = new Map<string, { at: number; snapshot: XrayLogsSnapshot }>();

function cacheKey(serverId: number, lines: number, includeAccess: boolean, includeError: boolean): string {
  return `${serverId}:${lines}:${includeAccess ? "a" : ""}${includeError ? "e" : ""}`;
}

function emptyStream(path: string | null, status: LogFileStatus, message?: string): LogStreamPayload {
  return { path, status, lines: [], highlights: [], message };
}

function toPayload(path: string | null, status: LogFileStatus, lines: string[], message?: string): LogStreamPayload {
  const masked = lines.map((l) => maskSensitiveLogText(l));
  return {
    path,
    status,
    lines: masked,
    highlights: masked.map((l) => highlightKindsForLine(l)),
    message,
  };
}

function parseStreamBlock(out: string, tag: "ACCESS" | "ERROR"): LogStreamPayload {
  const statusM = out.match(new RegExp(`___STREAM_${tag}_STATUS___(.+)`));
  const pathM = out.match(new RegExp(`___STREAM_${tag}_PATH___(.*)`));
  const msgM = out.match(new RegExp(`___STREAM_${tag}_MSG___(.*)`));
  const status = (statusM?.[1]?.trim() || "unreadable") as LogFileStatus;
  const pathRaw = pathM?.[1]?.trim();
  const path = pathRaw || null;
  const message = msgM?.[1]?.trim() || undefined;

  const begin = `___STREAM_${tag}_BEGIN___`;
  const end = `___STREAM_${tag}_END___`;
  const bi = out.indexOf(begin);
  const ei = out.indexOf(end);
  let lines: string[] = [];
  if (bi >= 0 && ei > bi) {
    const body = out.slice(bi + begin.length, ei).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    if (body) {
      lines = body.split(/\r?\n/).filter((l, i, arr) => i < arr.length - 1 || l.length > 0);
    }
  }

  if (status === "ok" && lines.length === 0) {
    return toPayload(path, "empty", [], message ?? "Файл пуст.");
  }
  return toPayload(path, status, status === "ok" ? lines : [], message);
}

function buildBatchScript(opts: {
  accessPath: string | null;
  errorPath: string | null;
  includeAccess: boolean;
  includeError: boolean;
  lineCap: number;
  managedService: boolean;
}): string {
  const lines = Math.max(1, Math.min(MAX_LOG_TAIL_LINES, opts.lineCap));
  return `
set +e
TRIM_TRIGGER=${LOG_TRIM_TRIGGER_BYTES}
TRIM_KEEP=${LOG_TRIM_KEEP_BYTES}
LINES=${lines}
ACCESS_PATH=${shellQuote(opts.includeAccess ? opts.accessPath || "" : "")}
ERROR_PATH=${shellQuote(opts.includeError ? opts.errorPath || "" : "")}
WANT_ACCESS=${opts.includeAccess ? "1" : "0"}
WANT_ERROR=${opts.includeError ? "1" : "0"}
MANAGED=${opts.managedService ? "1" : "0"}

RUNNING=0
if [ "$MANAGED" = "1" ]; then
  st=$(systemctl is-active tzadmin-xray 2>/dev/null || true)
  if [ "$st" = "active" ]; then RUNNING=1; fi
fi
if [ "$RUNNING" = "0" ]; then
  if pgrep -x xray >/dev/null 2>&1 || pgrep -f 'xray-linux-amd|/usr/local/bin/xray' >/dev/null 2>&1; then
    RUNNING=1
  fi
fi
echo "___RUNNING___$RUNNING"

trim_keep_tail() {
  local f="$1"
  local tag="$2"
  if [ -z "$f" ]; then
    echo "___STREAM_\${tag}_STATUS___no_path"
    echo "___STREAM_\${tag}_MSG___Путь к файлу не указан в конфиге."
    echo "___STREAM_\${tag}_BEGIN___"
    echo "___STREAM_\${tag}_END___"
    return
  fi
  if [ ! -f "$f" ]; then
    echo "___STREAM_\${tag}_STATUS___not_found"
    echo "___STREAM_\${tag}_MSG___Файл лога пока не создан."
    echo "___STREAM_\${tag}_BEGIN___"
    echo "___STREAM_\${tag}_END___"
    return
  fi
  local bytes
  bytes=$(wc -c < "$f" 2>/dev/null | tr -d ' \\t\\n' || echo 0)
  if [ -n "$bytes" ] && [ "$bytes" -gt "$TRIM_TRIGGER" ] 2>/dev/null; then
    local tmp="\${f}.trim.$$"
    if tail -c "$TRIM_KEEP" "$f" > "$tmp" 2>/dev/null && mv "$tmp" "$f" 2>/dev/null; then
      :
    else
      rm -f "$tmp" 2>/dev/null
    fi
  fi
  echo "___STREAM_\${tag}_PATH___$f"
  local errf
  errf=$(mktemp 2>/dev/null || echo /tmp/xray-tail-err.$$)
  local out
  out=$(tail -n "$LINES" "$f" 2>"$errf")
  local code=$?
  local err
  err=$(cat "$errf" 2>/dev/null)
  rm -f "$errf" 2>/dev/null
  if [ $code -ne 0 ] && [ -z "$out" ]; then
    low=$(printf '%s' "$err" | tr '[:upper:]' '[:lower:]')
    case "$low" in
      *permission*denied*) echo "___STREAM_\${tag}_STATUS___permission_denied" ;;
      *) echo "___STREAM_\${tag}_STATUS___unreadable" ;;
    esac
    echo "___STREAM_\${tag}_MSG___Не удалось прочитать файл лога."
    echo "___STREAM_\${tag}_BEGIN___"
    echo "___STREAM_\${tag}_END___"
    return
  fi
  if [ -z "$out" ]; then
    echo "___STREAM_\${tag}_STATUS___empty"
    echo "___STREAM_\${tag}_MSG___Файл пуст."
    echo "___STREAM_\${tag}_BEGIN___"
    echo "___STREAM_\${tag}_END___"
    return
  fi
  echo "___STREAM_\${tag}_STATUS___ok"
  echo "___STREAM_\${tag}_BEGIN___"
  printf '%s\\n' "$out"
  echo "___STREAM_\${tag}_END___"
}

if [ "$WANT_ACCESS" = "1" ]; then
  trim_keep_tail "$ACCESS_PATH" "ACCESS"
fi
if [ "$WANT_ERROR" = "1" ]; then
  trim_keep_tail "$ERROR_PATH" "ERROR"
fi
`.trim();
}

async function resolveConfigPathForLogs(row: ServerRow): Promise<string> {
  if (row.vless_deployed) {
    return resolveConfigPath(row);
  }
  const detected = await detectXrayConfigPath(sshCfg(row));
  return detected ?? row.xray_config_path ?? TZADMIN_XRAY_CONFIG_PATH;
}

async function readConfigOn(conn: Client, configPath: string): Promise<Record<string, unknown>> {
  const raw = await sshSftpReadOn(conn, configPath);
  return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
}

function shouldEnsureLogFilePaths(configPath: string): boolean {
  return isTzadminManagedConfigPath(configPath) || configPath.includes("tzadmin-xray");
}

async function ensureXrayLogFilePaths(row: ServerRow, configPath: string): Promise<ParsedXrayLogConfig> {
  const cfg = sshCfg(row);
  const cur = await withSsh(cfg, async (conn) => {
    const config = await readConfigOn(conn, configPath);
    return parseXrayLogConfig(config);
  });

  if (cur.accessPath && cur.errorPath) return cur;
  if (cur.loglevel === "none") return cur;
  if (!shouldEnsureLogFilePaths(configPath)) return cur;

  await sshExecCommand(
    cfg,
    `install -d -m 0755 ${shellQuote(TZADMIN_LOG_DIR)} 2>/dev/null || true; touch ${shellQuote(TZADMIN_DEFAULT_ACCESS_LOG)} ${shellQuote(TZADMIN_DEFAULT_ERROR_LOG)} 2>/dev/null; chmod 0644 ${shellQuote(TZADMIN_DEFAULT_ACCESS_LOG)} ${shellQuote(TZADMIN_DEFAULT_ERROR_LOG)} 2>/dev/null || true`,
  );

  await mutateXrayConfigAndRestart(cfg, configPath, (parsed) => {
    applyXrayLogConfig(parsed, {
      loglevel: cur.loglevel === "none" ? "warning" : cur.loglevel,
      ensureFilePaths: true,
    });
  });

  return withSsh(cfg, async (conn) => parseXrayLogConfig(await readConfigOn(conn, configPath)));
}

async function journalFallbackOn(
  conn: Client,
  kind: "access" | "error",
  lineCap: number,
): Promise<LogStreamPayload> {
  const cap = Math.max(1, Math.min(MAX_LOG_TAIL_LINES, Math.floor(lineCap) || DEFAULT_LOG_TAIL_LINES));
  const r = await sshExecOn(
    conn,
    "journalctl -u tzadmin-xray -n 1000 --no-pager 2>/dev/null || journalctl -u xray -n 1000 --no-pager 2>/dev/null || true",
  );
  const all = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => l.length > 0);
  const filtered =
    kind === "error"
      ? all.filter((l) =>
          /\[(Error|Warning)\]|\berror\b|\bfailed\b|\brejected\b|\brefused\b|\btimeout\b|handshake/i.test(l),
        )
      : all.filter((l) =>
          /\baccepted\b|received request|proxy\/|inbound:|connection opened|tcp:/i.test(l),
        );
  const slice = filtered.slice(-cap);
  if (slice.length === 0) {
    return emptyStream(
      "journalctl",
      "empty",
      kind === "error"
        ? "Нет строк в journalctl. Нажмите «Обновить» после настройки путей или подключитесь к VPN."
        : "Нет access-строк в journalctl. Подключите клиента или включите loglevel info/debug.",
    );
  }
  return toPayload("journalctl (tzadmin-xray / xray)", "ok", slice);
}

function buildHint(log: ParsedXrayLogConfig, xrayRunning: boolean): string | null {
  if (log.loglevel === "none") {
    return "loglevel = none — Xray почти не пишет логи. Выберите warning, info или debug.";
  }
  if (!xrayRunning) {
    return "Процесс Xray не запущен на сервере. Проверьте сервис tzadmin-xray или x-ui.";
  }
  return null;
}

export async function fetchXrayLogsSnapshot(
  serverId: number,
  opts?: { lines?: number; includeAccess?: boolean; includeError?: boolean; skipCache?: boolean },
): Promise<XrayLogsSnapshot> {
  const row = getServer(serverId);
  if (!row) throw new Error("server_not_found");

  const lineCap = opts?.lines ?? DEFAULT_LOG_TAIL_LINES;
  const includeAccess = opts?.includeAccess !== false;
  const includeError = opts?.includeError !== false;
  const key = cacheKey(serverId, lineCap, includeAccess, includeError);

  if (!opts?.skipCache) {
    const hit = snapshotCache.get(key);
    if (hit && Date.now() - hit.at < SNAPSHOT_CACHE_TTL_MS) {
      return hit.snapshot;
    }
  }

  let configPath: string;
  try {
    configPath = await resolveConfigPathForLogs(row);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }

  const cfg = sshCfg(row);
  const managed = isTzadminManagedConfigPath(configPath);

  const snapshot = await withSsh(cfg, async (conn) => {
    let logCfg: ParsedXrayLogConfig;
    try {
      logCfg = parseXrayLogConfig(await readConfigOn(conn, configPath));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Не удалось прочитать конфиг Xray: ${msg}`);
    }

    if (
      (!logCfg.accessPath || !logCfg.errorPath) &&
      logCfg.loglevel !== "none" &&
      shouldEnsureLogFilePaths(configPath)
    ) {
      throw Object.assign(new Error("needs_ensure_paths"), { code: "needs_ensure_paths" as const });
    }

    const script = buildBatchScript({
      accessPath: logCfg.accessPath,
      errorPath: logCfg.errorPath,
      includeAccess,
      includeError,
      lineCap,
      managedService: managed,
    });
    const r = await sshExecOn(conn, script);
    const out = `${r.stdout}\n${r.stderr}`;
    const running = /___RUNNING___1/.test(out);

    let access = includeAccess
      ? parseStreamBlock(out, "ACCESS")
      : emptyStream(logCfg.accessPath, "no_path", "Не запрошен.");
    let error = includeError
      ? parseStreamBlock(out, "ERROR")
      : emptyStream(logCfg.errorPath, "no_path", "Не запрошен.");

    if (
      includeAccess &&
      running &&
      (access.status === "not_found" || access.status === "empty" || access.status === "permission_denied")
    ) {
      const journal = await journalFallbackOn(conn, "access", lineCap);
      if (journal.status === "ok" && journal.lines.length > 0) {
        access = {
          ...journal,
          message: access.message
            ? `${access.message} Показан journalctl.`
            : "Показан journalctl (файл лога пуст или недоступен).",
        };
      }
    }
    if (
      includeError &&
      running &&
      (error.status === "not_found" || error.status === "empty" || error.status === "permission_denied")
    ) {
      const journal = await journalFallbackOn(conn, "error", lineCap);
      if (journal.status === "ok" && journal.lines.length > 0) {
        error = {
          ...journal,
          message: error.message
            ? `${error.message} Показан journalctl.`
            : "Показан journalctl (файл лога пуст или недоступен).",
        };
      }
    }

    const hint =
      buildHint(logCfg, running) ??
      (logCfg.accessPath && logCfg.errorPath
        ? null
        : "Пути к файлам логов добавлены в конфиг. Если панели пустые — подключите VPN-клиента или выберите loglevel info/debug.");

    return {
      server_id: row.id,
      server_name: row.name,
      host: row.host,
      config_path: configPath,
      log: logCfg,
      xray_running: running,
      access,
      error,
      hint,
    };
  }).catch(async (e: unknown) => {
    const err = e as Error & { code?: string };
    if (err.code === "needs_ensure_paths") {
      await ensureXrayLogFilePaths(row, configPath);
      return fetchXrayLogsSnapshot(serverId, { ...opts, skipCache: true });
    }
    throw e;
  });

  snapshotCache.set(key, { at: Date.now(), snapshot });
  return snapshot;
}

export function invalidateXrayLogsSnapshotCache(serverId?: number): void {
  if (serverId == null) {
    snapshotCache.clear();
    return;
  }
  for (const k of snapshotCache.keys()) {
    if (k.startsWith(`${serverId}:`)) snapshotCache.delete(k);
  }
}

export async function setXrayLogLevel(serverId: number, loglevel: XrayLogLevel): Promise<XrayLogsSnapshot> {
  if (!isXrayLogLevel(loglevel)) throw new Error("invalid_loglevel");
  const row = getServer(serverId);
  if (!row) throw new Error("server_not_found");

  const configPath = await resolveConfigPathForLogs(row);

  await sshExecCommand(sshCfg(row), `install -d -m 0755 ${shellQuote(TZADMIN_LOG_DIR)} 2>/dev/null || true`);

  await mutateXrayConfigAndRestart(sshCfg(row), configPath, (config) => {
    applyXrayLogConfig(config, {
      loglevel,
      ensureFilePaths: loglevel !== "none",
    });
  });

  invalidateXrayLogsSnapshotCache(serverId);
  return fetchXrayLogsSnapshot(serverId, { skipCache: true });
}

export async function clearXrayLogFiles(
  serverId: number,
  targets: ("access" | "error")[],
): Promise<{ cleared: string[]; errors: string[] }> {
  const row = getServer(serverId);
  if (!row) throw new Error("server_not_found");

  const configPath = await resolveConfigPathForLogs(row);
  const cfg = sshCfg(row);
  const cleared: string[] = [];
  const errors: string[] = [];

  await withSsh(cfg, async (conn) => {
    const config = await readConfigOn(conn, configPath);
    const logCfg = parseXrayLogConfig(config);
    const paths: { key: "access" | "error"; path: string | null }[] = [
      { key: "access", path: logCfg.accessPath },
      { key: "error", path: logCfg.errorPath },
    ];

    for (const t of paths) {
      if (!targets.includes(t.key)) continue;
      if (!t.path) {
        errors.push(`${t.key}: путь не задан в конфиге`);
        continue;
      }
      const q = shellQuote(t.path);
      const r = await sshExecOn(conn, `: > ${q} 2>&1 || truncate -s 0 ${q} 2>&1`);
      if (r.code === 0) cleared.push(t.path);
      else errors.push(`${t.path}: ${(r.stderr || r.stdout).trim() || "ошибка очистки"}`);
    }
  });

  invalidateXrayLogsSnapshotCache(serverId);
  return { cleared, errors };
}

/** Size-based trim: keep last LOG_TRIM_KEEP_BYTES if file > LOG_TRIM_TRIGGER_BYTES. */
export async function trimXrayLogFilesIfLarge(
  serverId: number,
): Promise<{ trimmed: string[]; skipped: string[]; errors: string[] }> {
  const row = getServer(serverId);
  if (!row) throw new Error("server_not_found");

  const configPath = await resolveConfigPathForLogs(row);
  const cfg = sshCfg(row);
  const trimmed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  await withSsh(cfg, async (conn) => {
    const config = await readConfigOn(conn, configPath);
    const logCfg = parseXrayLogConfig(config);
    const paths = [logCfg.accessPath, logCfg.errorPath].filter(Boolean) as string[];
    for (const p of paths) {
      const q = shellQuote(p);
      const script = `
f=${q}
if [ ! -f "$f" ]; then echo SKIP; exit 0; fi
bytes=$(wc -c < "$f" 2>/dev/null | tr -d ' \\t\\n' || echo 0)
if [ -z "$bytes" ] || [ "$bytes" -le ${LOG_TRIM_TRIGGER_BYTES} ]; then echo SKIP:$bytes; exit 0; fi
tmp="\${f}.trim.$$"
if tail -c ${LOG_TRIM_KEEP_BYTES} "$f" > "$tmp" 2>/dev/null && mv "$tmp" "$f" 2>/dev/null; then
  echo TRIM:$bytes
else
  rm -f "$tmp" 2>/dev/null
  echo ERR
  exit 1
fi
`.trim();
      const r = await sshExecOn(conn, script);
      const out = (r.stdout || "").trim();
      if (out.startsWith("TRIM:")) trimmed.push(p);
      else if (out.startsWith("SKIP")) skipped.push(p);
      else if (r.code !== 0 || out.startsWith("ERR")) {
        errors.push(`${p}: ${(r.stderr || out || "trim failed").trim()}`);
      } else skipped.push(p);
    }
  });

  if (trimmed.length) invalidateXrayLogsSnapshotCache(serverId);
  return { trimmed, skipped, errors };
}
