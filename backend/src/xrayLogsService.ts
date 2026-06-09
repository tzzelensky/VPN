import { getServer, type ServerRow } from "./db.js";
import {
  DEFAULT_LOG_TAIL_LINES,
  MAX_LOG_FILE_BYTES,
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
  sshReadRemoteFile,
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

async function resolveConfigPathForLogs(row: ServerRow): Promise<string> {
  if (row.vless_deployed) {
    return resolveConfigPath(row);
  }
  const detected = await detectXrayConfigPath(sshCfg(row));
  return detected ?? row.xray_config_path ?? TZADMIN_XRAY_CONFIG_PATH;
}

async function readConfig(row: ServerRow, configPath: string): Promise<Record<string, unknown>> {
  const raw = await sshReadRemoteFile(sshCfg(row), configPath);
  return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
}

async function isXrayRunning(row: ServerRow, configPath: string): Promise<boolean> {
  const cfg = sshCfg(row);
  if (isTzadminManagedConfigPath(configPath)) {
    const r = await sshExecCommand(cfg, "systemctl is-active tzadmin-xray 2>/dev/null || true");
    if (r.stdout.trim() === "active") return true;
  }
  const proc = await sshExecCommand(
    cfg,
    "pgrep -x xray >/dev/null 2>&1 && echo yes || pgrep -f 'xray-linux-amd|/usr/local/bin/xray' >/dev/null 2>&1 && echo yes || echo no",
  );
  return proc.stdout.trim().includes("yes");
}

async function tailRemoteFile(
  row: ServerRow,
  filePath: string | null,
  lineCap: number,
): Promise<LogStreamPayload> {
  const empty: LogStreamPayload = {
    path: filePath,
    status: "no_path",
    lines: [],
    highlights: [],
    message: "Путь к файлу не указан в конфиге.",
  };
  if (!filePath) return empty;

  const cap = Math.max(1, Math.min(MAX_LOG_TAIL_LINES, Math.floor(lineCap) || DEFAULT_LOG_TAIL_LINES));
  const cfg = sshCfg(row);
  const q = shellQuote(filePath);

  const exists = await sshExecCommand(cfg, `test -f ${q} && echo yes || echo no`);
  if (!exists.stdout.includes("yes")) {
    return {
      path: filePath,
      status: "not_found",
      lines: [],
      highlights: [],
      message:
        "Файл лога пока не создан. Включите loglevel warning/info/debug и попробуйте подключиться к VPN.",
    };
  }

  const size = await sshExecCommand(cfg, `wc -c < ${q} 2>/dev/null || echo 0`);
  const bytes = Number.parseInt(size.stdout.trim(), 10);
  if (Number.isFinite(bytes) && bytes > MAX_LOG_FILE_BYTES) {
    return {
      path: filePath,
      status: "too_large",
      lines: [],
      highlights: [],
      message: `Файл слишком большой (${bytes} байт). Очистите логи или уменьшите loglevel.`,
    };
  }

  const tail = await sshExecCommand(cfg, `tail -n ${cap} ${q} 2>&1`);
  const combined = `${tail.stdout}${tail.stderr ? (tail.stdout ? "\n" : "") + tail.stderr : ""}`.trimEnd();
  if (tail.code !== 0 && !combined) {
    const low = (tail.stderr || "").toLowerCase();
    const status: LogFileStatus = low.includes("permission denied") ? "permission_denied" : "unreadable";
    return {
      path: filePath,
      status,
      lines: [],
      highlights: [],
      message: tail.stderr.trim() || "Не удалось прочитать файл лога.",
    };
  }

  if (!combined) {
    return {
      path: filePath,
      status: "empty",
      lines: [],
      highlights: [],
      message: "Файл пуст.",
    };
  }

  const lines = combined.split(/\r?\n/).filter((l, i, arr) => i < arr.length - 1 || l.length > 0);
  const masked = lines.map((l) => maskSensitiveLogText(l));
  return {
    path: filePath,
    status: "ok",
    lines: masked,
    highlights: masked.map((l) => highlightKindsForLine(l)),
  };
}

function shouldEnsureLogFilePaths(configPath: string): boolean {
  return isTzadminManagedConfigPath(configPath) || configPath.includes("tzadmin-xray");
}

/** Дописать access/error в конфиг и перезапустить Xray, если путей ещё нет. */
async function ensureXrayLogFilePaths(row: ServerRow, configPath: string): Promise<ParsedXrayLogConfig> {
  const config = await readConfig(row, configPath);
  const cur = parseXrayLogConfig(config);
  if (cur.accessPath && cur.errorPath) return cur;
  if (cur.loglevel === "none") return cur;
  if (!shouldEnsureLogFilePaths(configPath)) return cur;

  const cfg = sshCfg(row);
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

  return parseXrayLogConfig(await readConfig(row, configPath));
}

async function tailFromJournal(
  row: ServerRow,
  kind: "access" | "error",
  lineCap: number,
): Promise<LogStreamPayload> {
  const cap = Math.max(1, Math.min(MAX_LOG_TAIL_LINES, Math.floor(lineCap) || DEFAULT_LOG_TAIL_LINES));
  const cfg = sshCfg(row);
  const r = await sshExecCommand(
    cfg,
    "journalctl -u tzadmin-xray -n 1000 --no-pager 2>/dev/null || journalctl -u xray -n 1000 --no-pager 2>/dev/null || true",
  );
  const all = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => l.length > 0);
  const filtered =
    kind === "error"
      ? all.filter((l) =>
          /\[(Error|Warning)\]|\berror\b|\bfailed\b|\brefused\b|\btimeout\b|handshake/i.test(l),
        )
      : all.filter((l) =>
          /\baccepted\b|received request|proxy\/|inbound:|connection opened|tcp:/i.test(l),
        );
  const slice = filtered.slice(-cap);
  const masked = slice.map((l) => maskSensitiveLogText(l));
  if (masked.length === 0) {
    return {
      path: "journalctl",
      status: "empty",
      lines: [],
      highlights: [],
      message:
        kind === "error"
          ? "Нет строк в journalctl. Нажмите «Обновить» после настройки путей или подключитесь к VPN."
          : "Нет access-строк в journalctl. Подключите клиента или включите loglevel info/debug.",
    };
  }
  return {
    path: "journalctl (tzadmin-xray / xray)",
    status: "ok",
    lines: masked,
    highlights: masked.map((l) => highlightKindsForLine(l)),
  };
}

async function tailLogStream(
  row: ServerRow,
  filePath: string | null,
  kind: "access" | "error",
  lineCap: number,
  xrayRunning: boolean,
): Promise<LogStreamPayload> {
  if (!filePath) {
    if (xrayRunning) return tailFromJournal(row, kind, lineCap);
    return {
      path: null,
      status: "no_path",
      lines: [],
      highlights: [],
      message: "Путь к файлу не указан в конфиге. Для tzadmin-xray пути будут добавлены автоматически.",
    };
  }
  const file = await tailRemoteFile(row, filePath, lineCap);
  if (
    xrayRunning &&
    (file.status === "not_found" || file.status === "empty" || file.status === "permission_denied")
  ) {
    const journal = await tailFromJournal(row, kind, lineCap);
    if (journal.status === "ok" && journal.lines.length > 0) {
      return {
        ...journal,
        message: file.message ? `${file.message} Показан journalctl.` : "Показан journalctl (файл лога пуст или недоступен).",
      };
    }
  }
  return file;
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
  opts?: { lines?: number; includeAccess?: boolean; includeError?: boolean },
): Promise<XrayLogsSnapshot> {
  const row = getServer(serverId);
  if (!row) throw new Error("server_not_found");

  const lineCap = opts?.lines ?? DEFAULT_LOG_TAIL_LINES;
  const includeAccess = opts?.includeAccess !== false;
  const includeError = opts?.includeError !== false;

  let configPath: string;
  try {
    configPath = await resolveConfigPathForLogs(row);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }

  let config: Record<string, unknown>;
  try {
    config = await readConfig(row, configPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Не удалось прочитать конфиг Xray: ${msg}`);
  }

  let logCfg = parseXrayLogConfig(config);
  if ((!logCfg.accessPath || !logCfg.errorPath) && logCfg.loglevel !== "none") {
    logCfg = await ensureXrayLogFilePaths(row, configPath);
  }
  const xrayRunning = await isXrayRunning(row, configPath);

  const access = includeAccess
    ? await tailLogStream(row, logCfg.accessPath, "access", lineCap, xrayRunning)
    : {
        path: logCfg.accessPath,
        status: "no_path" as LogFileStatus,
        lines: [],
        highlights: [],
        message: "Не запрошен.",
      };

  const error = includeError
    ? await tailRemoteFile(row, logCfg.errorPath, lineCap)
    : {
        path: logCfg.errorPath,
        status: "no_path" as LogFileStatus,
        lines: [],
        highlights: [],
        message: "Не запрошен.",
      };

  const hint =
    buildHint(logCfg, xrayRunning) ??
    (logCfg.accessPath && logCfg.errorPath
      ? null
      : "Пути к файлам логов добавлены в конфиг. Если панели пустые — подключите VPN-клиента или выберите loglevel info/debug.");

  return {
    server_id: row.id,
    server_name: row.name,
    host: row.host,
    config_path: configPath,
    log: logCfg,
    xray_running: xrayRunning,
    access,
    error,
    hint,
  };
}

export async function setXrayLogLevel(serverId: number, loglevel: XrayLogLevel): Promise<XrayLogsSnapshot> {
  if (!isXrayLogLevel(loglevel)) throw new Error("invalid_loglevel");
  const row = getServer(serverId);
  if (!row) throw new Error("server_not_found");

  const configPath = await resolveConfigPathForLogs(row);

  await sshExecCommand(sshCfg(row), `install -d -m 0755 ${shellQuote(TZADMIN_LOG_DIR)} 2>/dev/null || true`);

  await mutateXrayConfigAndRestart(
    sshCfg(row),
    configPath,
    (config) => {
      applyXrayLogConfig(config, {
        loglevel,
        ensureFilePaths: loglevel !== "none",
      });
    },
  );

  return fetchXrayLogsSnapshot(serverId);
}

export async function clearXrayLogFiles(
  serverId: number,
  targets: ("access" | "error")[],
): Promise<{ cleared: string[]; errors: string[] }> {
  const row = getServer(serverId);
  if (!row) throw new Error("server_not_found");

  const configPath = await resolveConfigPathForLogs(row);
  const config = await readConfig(row, configPath);
  const logCfg = parseXrayLogConfig(config);
  const cfg = sshCfg(row);
  const cleared: string[] = [];
  const errors: string[] = [];

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
    const r = await sshExecCommand(cfg, `: > ${q} 2>&1 || truncate -s 0 ${q} 2>&1`);
    if (r.code === 0) cleared.push(t.path);
    else errors.push(`${t.path}: ${(r.stderr || r.stdout).trim() || "ошибка очистки"}`);
  }

  return { cleared, errors };
}
