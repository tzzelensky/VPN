import { Client } from "ssh2";
import { decryptSecret } from "./crypto.js";
import {
  ensureRealityPublicKeyOnHintsFromConfig,
  extractVlessLinkHintsFromConfig,
  streamSettingsOfInbound,
  type ServerLinkHints,
} from "./vlessLinkHints.js";
import path from "node:path";

export type SshConfig = {
  host: string;
  port: number;
  username: string;
  passwordEnc: string;
};

export type SshLog = (message: string) => void;

function exec(conn: Client, cmd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code: number | null) => resolve({ code, stdout, stderr }))
        .on("data", (d: Buffer) => {
          stdout += d.toString();
        })
        .stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
    });
  });
}

export async function withSsh<T>(cfg: SshConfig, fn: (conn: Client) => Promise<T>, log?: SshLog): Promise<T> {
  const password = decryptSecret(cfg.passwordEnc);
  const conn = new Client();
  log?.(`SSH: подключение к ${cfg.host}:${cfg.port}…`);
  await new Promise<void>((resolve, reject) => {
    conn
      .on("ready", () => {
        log?.("SSH: сессия открыта.");
        resolve();
      })
      .on("error", reject)
      .connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password,
        readyTimeout: 20000,
      });
  });
  try {
    return await fn(conn);
  } finally {
    conn.end();
    log?.("SSH: сессия закрыта.");
  }
}

function sftpReadFile(conn: Client, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.readFile(remotePath, (e2, data) => {
        if (e2) reject(e2);
        else resolve(data as Buffer);
      });
    });
  });
}

function sftpWriteFile(conn: Client, remotePath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.writeFile(remotePath, data, (e2) => {
        if (e2) reject(e2);
        else resolve();
      });
    });
  });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function restartXray(conn: Client, log?: SshLog): Promise<void> {
  const xrayProcPattern = "xray-linux-amd64|/usr/local/x-ui/bin/xray|/usr/local/bin/xray|/usr/bin/xray|(^|/)xray(\\s|$)";
  const hasAnyXrayProc = async (): Promise<boolean> => {
    const byName = await exec(conn, "pgrep -x xray >/dev/null 2>&1; echo $?");
    if (byName.stdout.trim() === "0") return true;
    const byPath = await exec(conn, `pgrep -f '${xrayProcPattern}' >/dev/null 2>&1; echo $?`);
    return byPath.stdout.trim() === "0";
  };
  const unitPath = await exec(
    conn,
    "systemctl show -p FragmentPath --value x-ui.service 2>/dev/null || true",
  );
  const hasXuiUnit = Boolean((unitPath.stdout || "").trim()) && !/(not-found|\/dev\/null)/i.test(unitPath.stdout);
  const xuiBin = await exec(conn, "test -x /usr/local/x-ui/x-ui && echo OK || true");
  const hasXuiBin = xuiBin.stdout.includes("OK");
  const xuiActive = await exec(
    conn,
    "systemctl is-active x-ui 2>/dev/null || systemctl is-active x-ui.service 2>/dev/null || true",
  );
  const xuiProc = await exec(conn, "pgrep -f '/usr/local/x-ui/x-ui' >/dev/null 2>&1; echo $?");
  const shouldUseXui =
    (hasXuiUnit && (xuiActive.stdout.trim() === "active" || xuiProc.stdout.trim() === "0")) ||
    (hasXuiBin && xuiProc.stdout.trim() === "0");

  if (shouldUseXui) {
    log?.("Обнаружен x-ui: пробуем HUP xray, затем reload x-ui (USR1), затем restart x-ui.");
    const hup = await exec(
      conn,
      `pkill -HUP -x xray 2>/dev/null || pkill -HUP -f '${xrayProcPattern}' 2>/dev/null || true`,
    );
    const hupErr = (hup.stderr || hup.stdout || "").trim();
    if (hupErr) log?.(`HUP xray: ${hupErr}`);
    if (await hasAnyXrayProc()) return;

    const rel = await exec(
      conn,
      "systemctl reload x-ui 2>/dev/null || systemctl reload x-ui.service 2>/dev/null || pkill -USR1 -f '/usr/local/x-ui/x-ui' 2>/dev/null || true",
    );
    const relErr = (rel.stderr || rel.stdout || "").trim();
    if (relErr) log?.(`reload x-ui: ${relErr}`);
    if (await hasAnyXrayProc()) return;

    const rst = await exec(conn, "systemctl restart x-ui 2>/dev/null || systemctl restart x-ui.service 2>/dev/null || true");
    const rstErr = (rst.stderr || rst.stdout || "").trim();
    if (rstErr) log?.(`restart x-ui: ${rstErr}`);
    if (await hasAnyXrayProc()) return;
    throw new Error("x-ui активен, но процесс xray не найден после HUP/reload/restart x-ui");
  }

  const restartCmds = ["systemctl restart xray", "systemctl restart xray.service", "service xray restart"];
  let lastError = "не удалось перезапустить xray";
  for (const c of restartCmds) {
    log?.(`Выполнение: ${c}`);
    const r = await exec(conn, c);
    if (r.code !== 0) {
      const err = (r.stderr || r.stdout || "").trim();
      if (err) lastError = `${c}: ${err}`;
      continue;
    }
    // Не вызываем несколько restart подряд: это может уронить сервис в start-limit-hit.
    const active = await exec(
      conn,
      "systemctl is-active xray 2>/dev/null || systemctl is-active xray.service 2>/dev/null || true",
    );
    if (active.stdout.trim() === "active") return;

    const hasProc = await exec(conn, "pgrep -x xray >/dev/null 2>&1; echo $?");
    if (hasProc.stdout.trim() === "0") return;

    const status = await exec(conn, "systemctl status xray --no-pager 2>/dev/null || true");
    const text = (status.stderr || status.stdout || "").trim();
    if (text) lastError = `${c}: xray не активен после restart.\n${text.slice(0, 700)}`;
  }
  throw new Error(lastError);
}

/** Inbound VLESS, которым управляет панель (список UUID клиентов). */
export const TZADMIN_VLESS_TAG = "tzadmin-vless";

/**
 * Включает stats + policy (per-user uplink/downlink/online) и API StatsService.
 * Без `email` у клиента VLESS Xray не ведёт user>>>…>>>traffic (см. документацию stats).
 */
export function ensureXrayStatsPolicyApi(config: Record<string, unknown>): void {
  if (!config.stats) config.stats = {};
  const prevPol = (config.policy as Record<string, unknown>) || {};
  const levels = { ...((prevPol.levels as Record<string, Record<string, unknown>>) || {}) };
  const z = { ...(levels["0"] || {}) };
  z.statsUserUplink = true;
  z.statsUserDownlink = true;
  z.statsUserOnline = true;
  levels["0"] = z;
  config.policy = { ...prevPol, levels };

  const prevApi = (config.api as Record<string, unknown>) || {};
  const services = new Set<string>();
  for (const s of Array.isArray(prevApi.services) ? (prevApi.services as string[]) : []) {
    if (typeof s === "string" && s) services.add(s);
  }
  services.add("StatsService");
  const api: Record<string, unknown> = {
    ...prevApi,
    tag: String(prevApi.tag || "api"),
    services: [...services],
  };
  config.api = api;

  const inbounds = Array.isArray(config.inbounds) ? [...(config.inbounds as Record<string, unknown>[])] : [];
  const apiIdx = inbounds.findIndex((ib) => String(ib?.tag ?? "") === "api");
  const hasApiListen = typeof (config.api as Record<string, unknown>).listen === "string";

  if (hasApiListen) {
    // Уже есть api.listen — не добавляем второй inbound api (иначе bind: address already in use).
    if (apiIdx >= 0) {
      inbounds.splice(apiIdx, 1);
      config.inbounds = inbounds;
    }
  } else if (apiIdx >= 0) {
    // x-ui часто держит inbound tag=api как tunnel на случайном localhost-порту — не перетираем.
    const proto = String((inbounds[apiIdx] as Record<string, unknown>).protocol ?? "").toLowerCase();
    if (proto && proto !== "dokodemo-door") {
      config.inbounds = inbounds;
    } else {
      const apiInbound: Record<string, unknown> = {
        ...(apiIdx >= 0 ? inbounds[apiIdx] : {}),
        tag: "api",
        listen: "127.0.0.1",
        port: 10085,
        protocol: "dokodemo-door",
        settings: {
          address: "127.0.0.1",
          ...(apiIdx >= 0 ? (((inbounds[apiIdx].settings as Record<string, unknown>) || {}) as Record<string, unknown>) : {}),
        },
      };
      inbounds[apiIdx] = apiInbound;
      config.inbounds = inbounds;
      delete (config.api as Record<string, unknown>).listen;
    }
  } else {
    const apiInbound: Record<string, unknown> = {
      tag: "api",
      listen: "127.0.0.1",
      port: 10085,
      protocol: "dokodemo-door",
      settings: {
        address: "127.0.0.1",
      },
    };
    inbounds.push(apiInbound);
    config.inbounds = inbounds;
    delete (config.api as Record<string, unknown>).listen;
  }

  const prevRouting = (config.routing as Record<string, unknown>) || {};
  const rules = Array.isArray(prevRouting.rules) ? [...(prevRouting.rules as Record<string, unknown>[])] : [];
  const hasApiRoute = rules.some(
    (r) =>
      String(r?.type ?? "").toLowerCase() === "field" &&
      Array.isArray(r.inboundTag) &&
      (r.inboundTag as unknown[]).some((t) => String(t) === "api") &&
      String(r.outboundTag ?? "") === "api",
  );
  if (!hasApiRoute) {
    rules.push({
      type: "field",
      inboundTag: ["api"],
      outboundTag: "api",
    });
  }
  config.routing = { ...prevRouting, rules };
}

function buildManagedClients(
  prevList: Array<Record<string, unknown>>,
  clientUuids: string[],
  defaultFlow: string,
  forceFlow: boolean,
): Array<Record<string, unknown>> {
  const prevById = new Map(prevList.map((c) => [String(c.id ?? "").toLowerCase(), c]));
  return clientUuids.map((id) => {
    const prev = prevById.get(id.toLowerCase());
    const base: Record<string, unknown> = prev && typeof prev === "object" ? { ...prev } : {};
    const flow = String(base.flow ?? "").trim();
    const out: Record<string, unknown> = {
      ...base,
      id,
      email: String(base.email ?? id).trim() || id,
      level: Number(base.level ?? 0) || 0,
    };
    if (defaultFlow && (forceFlow || !flow)) out.flow = defaultFlow;
    return out;
  });
}

function defaultClientFlowForInbound(
  ib: Record<string, unknown>,
  prevList: Array<Record<string, unknown>>,
): string {
  for (const c of prevList) {
    const f = String(c?.flow ?? "").trim();
    if (f) return f;
  }
  const sec = String(streamSettingsOfInbound(ib).security ?? "").toLowerCase();
  if (sec === "reality") return "xtls-rprx-vision";
  return "";
}

function shouldForceClientFlowForInbound(ib: Record<string, unknown>): boolean {
  const sec = String(streamSettingsOfInbound(ib).security ?? "").toLowerCase();
  return sec === "reality";
}

function findCandidateVlessInboundIndex(
  inbounds: Record<string, unknown>[],
  preferredPort: number,
): number {
  const vlessIdx = inbounds
    .map((ib, i) => ({ ib, i }))
    .filter(({ ib }) => String(ib.protocol ?? "").toLowerCase() === "vless");
  if (vlessIdx.length === 0) return -1;

  const samePort = vlessIdx.find(({ ib }) => Number(ib.port) === preferredPort);
  if (samePort) return samePort.i;

  const secure = vlessIdx.find(({ ib }) => {
    const sec = String(streamSettingsOfInbound(ib as Record<string, unknown>).security ?? "").toLowerCase();
    return sec === "reality" || sec === "tls";
  });
  if (secure) return secure.i;

  return vlessIdx[0]!.i;
}

function buildMinimalConfig(clientUuids: string[], vlessPort: number): Record<string, unknown> {
  const clients = [...new Set(clientUuids.filter(Boolean))].map((id) => ({
    id,
    email: id,
    level: 0,
  }));
  const cfg: Record<string, unknown> = {
    log: { loglevel: "warning" },
    stats: {},
    policy: {
      levels: {
        "0": {
          statsUserUplink: true,
          statsUserDownlink: true,
          statsUserOnline: true,
        },
      },
    },
    api: {
      tag: "api",
      services: ["StatsService"],
    },
    inbounds: [
      {
        listen: "0.0.0.0",
        port: vlessPort,
        protocol: "vless",
        settings: {
          clients,
          decryption: "none",
        },
        streamSettings: {
          network: "tcp",
          security: "none",
        },
        tag: TZADMIN_VLESS_TAG,
      },
    ],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
    routing: {
      rules: [{ type: "field", inboundTag: ["api"], outboundTag: "api" }],
    },
  };
  ensureXrayStatsPolicyApi(cfg);
  return cfg;
}

function buildManagedInbound(clientUuids: string[], vlessPort: number): Record<string, unknown> {
  const clients = [...new Set(clientUuids.filter(Boolean))].map((id) => ({
    id,
    email: id,
    level: 0,
  }));
  return {
    listen: "0.0.0.0",
    port: vlessPort,
    protocol: "vless",
    settings: {
      clients,
      decryption: "none",
    },
    streamSettings: {
      network: "tcp",
      security: "none",
    },
    tag: TZADMIN_VLESS_TAG,
  };
}

function chooseManagedPort(inbounds: Record<string, unknown>[], preferredPort: number): number {
  const occupied = new Set<number>();
  for (const ib of inbounds) {
    if (String(ib.protocol ?? "").toLowerCase() !== "vless") continue;
    if (String(ib.tag ?? "") === TZADMIN_VLESS_TAG) continue;
    const p = Number(ib.port);
    if (Number.isFinite(p) && p > 0) occupied.add(p);
  }
  if (!occupied.has(preferredPort)) return preferredPort;
  const candidates = [8433, 8443, 2053, 2083, 2087, 2096];
  for (const p of candidates) {
    if (!occupied.has(p)) return p;
  }
  let p = preferredPort + 1;
  while (p < 65535 && occupied.has(p)) p++;
  return p < 65535 ? p : preferredPort;
}

export async function testSshConnection(
  cfg: SshConfig,
  log?: SshLog,
): Promise<{ ok: boolean; detail: string }> {
  try {
    await withSsh(
      cfg,
      async (conn) => {
        log?.("Проверка: echo TZADMIN_OK");
        const r = await exec(conn, "echo TZADMIN_OK");
        if (!r.stdout.includes("TZADMIN_OK")) {
          throw new Error(`Неожиданный вывод: ${r.stdout.slice(0, 200)}`);
        }
        log?.("Проверка SSH успешна.");
      },
      log,
    );
    return { ok: true, detail: "SSH OK" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  }
}

const XRAY_CONFIG_PATHS = [
  "/usr/local/x-ui/bin/config.json",
  "/etc/x-ui/xray/config.json",
  "/usr/local/etc/xray/config.json",
  "/etc/xray/config.json",
];

function parseXrayConfigPathFromCmdline(cmdline: string): string | null {
  const m = cmdline.match(/(?:^|\s)-(?:config|c)\s+(\S+)/);
  if (!m?.[1]) return null;
  return m[1].trim().replace(/^['"]|['"]$/g, "");
}

export async function detectXrayConfigPath(cfg: SshConfig, log?: SshLog): Promise<string | null> {
  return withSsh(
    cfg,
    async (conn) => {
      const pidOut = await exec(
        conn,
        "sh -lc 'pgrep -f \"xray-linux-amd|/usr/local/bin/xray|/usr/bin/xray\" | head -n1 || true'",
      );
      const pid = pidOut.stdout.trim();
      if (pid) {
        const cmdline = await exec(
          conn,
          `sh -lc 'if [ -r "/proc/${pid}/cmdline" ]; then tr "\\000" " " < "/proc/${pid}/cmdline"; fi'`,
        );
        const cwdOut = await exec(
          conn,
          `sh -lc 'if [ -L "/proc/${pid}/cwd" ]; then readlink -f "/proc/${pid}/cwd"; fi'`,
        );
        const cwd = cwdOut.stdout.trim();
        const runningCfgRaw = parseXrayConfigPathFromCmdline(cmdline.stdout);
        if (runningCfgRaw) {
          const runningCfg = path.posix.isAbsolute(runningCfgRaw)
            ? runningCfgRaw
            : cwd
              ? path.posix.join(cwd, runningCfgRaw)
              : runningCfgRaw;
          log?.(`Проверка config из процесса xray: ${runningCfg}…`);
          const r = await exec(conn, `test -f ${shellQuote(runningCfg)} && echo OK || true`);
          if (r.stdout.includes("OK")) return runningCfg;
        }
      }

      for (const p of XRAY_CONFIG_PATHS) {
        log?.(`Проверка наличия ${p}…`);
        const r = await exec(conn, `test -f ${shellQuote(p)} && echo OK || true`);
        if (r.stdout.includes("OK")) return p;
      }
      return null;
    },
    log,
  );
}

/**
 * Первоначальная схема: inbound с тегом «tzadmin-vless» — только clients и порт из панели;
 * иначе полная замена минимальным VLESS (TCP, без TLS) на порту узла из панели.
 * Укажите в панели тот же порт, что слушает этот inbound.
 */
export async function deployOrSyncVless(
  cfg: SshConfig,
  opts: { clientUuids: string[]; vlessPort: number; configPath: string },
  log?: SshLog,
): Promise<{ ok: boolean; detail: string; backup?: string; hints?: ServerLinkHints }> {
  const backup = `${opts.configPath}.bak.${Date.now()}`;
  const clientUuids = [...new Set(opts.clientUuids.filter(Boolean))];
  let hints: ServerLinkHints | undefined;

  try {
    const detail = await withSsh(
      cfg,
      async (conn) => {
        log?.(`Резервная копия (если файл был): ${backup}`);
        await exec(
          conn,
          `test -f ${shellQuote(opts.configPath)} && cp ${shellQuote(opts.configPath)} ${shellQuote(backup)} || true`,
        );

        await exec(conn, `mkdir -p $(dirname ${shellQuote(opts.configPath)})`);

        let config: Record<string, unknown>;
        try {
          log?.(`Чтение текущего конфига: ${opts.configPath}`);
          const raw = await sftpReadFile(conn, opts.configPath);
          const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
          const inbounds = parsed.inbounds;
          if (Array.isArray(inbounds)) {
            const idx = inbounds.findIndex((ib) => (ib as { tag?: string }).tag === TZADMIN_VLESS_TAG);
            if (idx >= 0) {
              const ib = inbounds[idx] as Record<string, unknown>;
              const settings = (ib.settings as Record<string, unknown>) ?? {};
              const prevList = (settings.clients as Array<Record<string, unknown>>) ?? [];
              // Управляемый inbound панели держим простым (как «рабочий» узел): VLESS TCP security=none.
              const managedPort = chooseManagedPort(inbounds as Record<string, unknown>[], opts.vlessPort);
              const managed = buildManagedInbound(clientUuids, managedPort);
              managed.settings = {
                ...(managed.settings as Record<string, unknown>),
                clients: buildManagedClients(prevList, clientUuids, "", false),
              };
              if (managedPort !== opts.vlessPort) {
                log?.(
                  `Порт ${opts.vlessPort} занят другим VLESS inbound, managed inbound перенесён на ${managedPort}.`,
                );
              }
              const curPort = Number(ib.port);
              if (Number.isFinite(curPort) && curPort > 0 && curPort !== managedPort) {
                log?.(`Обновлён порт managed inbound: ${curPort} -> ${managedPort}.`);
              }
              inbounds[idx] = managed;
              // Backup для x-ui: поддерживаем клиентов и в "рабочем" inbound,
              // чтобы подписка не падала, если x-ui потом удалит tzadmin-vless.
              const rowsAll = inbounds as Record<string, unknown>[];
              const candIdx = findCandidateVlessInboundIndex(rowsAll, opts.vlessPort);
              if (candIdx >= 0 && candIdx !== idx) {
                const cand = { ...(rowsAll[candIdx] as Record<string, unknown>) };
                const candSettings = (cand.settings as Record<string, unknown>) ?? {};
                const candPrev = (candSettings.clients as Array<Record<string, unknown>>) ?? [];
                const defaultFlow = defaultClientFlowForInbound(cand, candPrev);
                const forceFlow = shouldForceClientFlowForInbound(cand);
                candSettings.clients = buildManagedClients(candPrev, clientUuids, defaultFlow, forceFlow);
                candSettings.decryption = "none";
                cand.settings = candSettings;
                rowsAll[candIdx] = cand;
                log?.(`Backup sync клиентов выполнен в inbound порт ${Number(cand.port) || 0}.`);
              }
              parsed.inbounds = inbounds;
              config = parsed;
              log?.(`Обновлён только inbound «${TZADMIN_VLESS_TAG}» (${clientUuids.length} UUID).`);
            } else {
              const rows = inbounds as Record<string, unknown>[];
              const candIdx = findCandidateVlessInboundIndex(rows, opts.vlessPort);
              if (candIdx >= 0) {
                const cand = { ...(rows[candIdx] as Record<string, unknown>) };
                const candSettings = (cand.settings as Record<string, unknown>) ?? {};
                const candPrev = (candSettings.clients as Array<Record<string, unknown>>) ?? [];
                const defaultFlow = defaultClientFlowForInbound(cand, candPrev);
                const forceFlow = shouldForceClientFlowForInbound(cand);
                candSettings.clients = buildManagedClients(candPrev, clientUuids, defaultFlow, forceFlow);
                candSettings.decryption = "none";
                cand.settings = candSettings;
                rows[candIdx] = cand;
                log?.(`Клиенты синхронизированы в существующий inbound порт ${Number(cand.port) || 0}.`);
              }
              const managedPort = chooseManagedPort(rows, opts.vlessPort);
              if (managedPort !== opts.vlessPort) {
                log?.(`Порт ${opts.vlessPort} занят другим VLESS inbound, managed inbound создан на ${managedPort}.`);
              }
              rows.push(buildManagedInbound(clientUuids, managedPort));
              parsed.inbounds = rows;
              config = parsed;
              log?.(`Создан отдельный inbound «${TZADMIN_VLESS_TAG}» (${clientUuids.length} UUID).`);
            }
          } else {
            config = buildMinimalConfig(clientUuids, opts.vlessPort);
            log?.("Некорректные inbounds — записан минимальный конфиг.");
          }
        } catch {
          config = buildMinimalConfig(clientUuids, opts.vlessPort);
          log?.("Файл отсутствует или не JSON — записан минимальный конфиг.");
        }
        ensureXrayStatsPolicyApi(config);

        hints = extractVlessLinkHintsFromConfig(config, opts.vlessPort);
        ensureRealityPublicKeyOnHintsFromConfig(config, hints, opts.vlessPort);

        const json = JSON.stringify(config, null, 2);
        log?.(`Запись ${opts.configPath} (${json.length} байт)…`);
        await sftpWriteFile(conn, opts.configPath, Buffer.from(json, "utf8"));

        log?.("Перезапуск Xray…");
        await restartXray(conn, log);

        return "Конфиг обновлён.";
      },
      log,
    );
    return { ok: true, detail, backup, hints };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  }
}

/** Синхронизировать список UUID клиентов на сервере с БД (все пользователи + UUID узла). */
export async function syncServerClientUuids(
  cfg: SshConfig,
  opts: { configPath: string; vlessPort: number; clientUuids: string[] },
  log?: SshLog,
): Promise<{ ok: boolean; detail: string; hints?: ServerLinkHints }> {
  return deployOrSyncVless(
    cfg,
    { clientUuids: opts.clientUuids, vlessPort: opts.vlessPort, configPath: opts.configPath },
    log,
  );
}

export async function removeClientUuidFromTzadmin(
  cfg: SshConfig,
  opts: {
    configPath: string;
    vlessPort: number;
    removeUuid: string;
    fallbackServerUuid: string | null;
  },
  log?: SshLog,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const detail = await withSsh(
      cfg,
      async (conn) => {
        log?.(`Чтение ${opts.configPath}…`);
        const raw = await sftpReadFile(conn, opts.configPath);
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
        } catch {
          throw new Error("Не удалось разобрать JSON конфига");
        }
        const inbounds = parsed.inbounds;
        if (!Array.isArray(inbounds)) throw new Error("Нет inbounds");
        const idx = inbounds.findIndex((ib: { tag?: string }) => (ib as { tag?: string }).tag === TZADMIN_VLESS_TAG);
        if (idx < 0) throw new Error(`Не найден inbound с тегом ${TZADMIN_VLESS_TAG}`);
        const ib = inbounds[idx] as Record<string, unknown>;
        const settings = (ib.settings as Record<string, unknown>) ?? {};
        let clients = (settings.clients as Array<Record<string, unknown>>) ?? [];
        clients = clients.filter((c) => String(c.id) !== opts.removeUuid);
        if (clients.length === 0 && opts.fallbackServerUuid) {
          const fid = opts.fallbackServerUuid;
          clients = [{ id: fid, email: fid, level: 0 }];
          log?.("Клиентов не осталось — восстановлен только UUID узла.");
        } else {
          clients = clients.map((c) => {
            const id = String(c.id ?? "");
            return {
              ...c,
              id,
              email: String(c.email ?? id).trim() || id,
              level: Number(c.level ?? 0) || 0,
            };
          });
        }
        settings.clients = clients;
        ib.settings = settings;
        inbounds[idx] = ib;
        parsed.inbounds = inbounds;
        ensureXrayStatsPolicyApi(parsed);
        log?.(`Запись ${opts.configPath}…`);
        await sftpWriteFile(conn, opts.configPath, Buffer.from(JSON.stringify(parsed, null, 2), "utf8"));
        await restartXray(conn, log);
        return "Клиент удалён из inbound.";
      },
      log,
    );
    return { ok: true, detail };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function installXrayIfMissing(cfg: SshConfig, log?: SshLog): Promise<{ ok: boolean; detail: string }> {
  try {
    const detail = await withSsh(
      cfg,
      async (conn) => {
        log?.("Проверка: command -v xray");
        const which = await exec(conn, "command -v xray || true");
        if (which.stdout.trim()) {
          log?.("Xray уже в PATH.");
          return "Xray уже установлен на сервере.";
        }
        log?.("Запуск официального install-release.sh (может занять несколько минут)…");
        const install =
          'bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install -u root';
        const r = await exec(conn, install);
        if (r.stdout) log?.(`stdout (фрагмент): ${r.stdout.slice(-800)}`);
        if (r.stderr) log?.(`stderr (фрагмент): ${r.stderr.slice(-800)}`);
        if (r.code !== 0) {
          throw new Error(r.stderr.slice(0, 500) || r.stdout.slice(0, 500) || `exit ${r.code}`);
        }
        return "Xray установлен. При необходимости перезапустите сервис вручную.";
      },
      log,
    );
    return { ok: true, detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  }
}

/** SFTP: прочитать удалённый файл (одна SSH-сессия). */
export async function sshReadRemoteFile(cfg: SshConfig, remotePath: string, log?: SshLog): Promise<Buffer> {
  return withSsh(cfg, (conn) => sftpReadFile(conn, remotePath), log);
}

/** Выполнить команду на сервере (одна SSH-сессия). */
export async function sshExecCommand(
  cfg: SshConfig,
  cmd: string,
  log?: SshLog,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return withSsh(cfg, (conn) => exec(conn, cmd), log);
}
