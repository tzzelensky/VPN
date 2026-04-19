import { Client } from "ssh2";
import { decryptSecret } from "./crypto.js";
import { extractVlessLinkHintsFromConfig, type ServerLinkHints } from "./vlessLinkHints.js";

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
    log?.(
      "Обнаружен x-ui: применяем конфиг через x-ui (reload → при необходимости restart), не трогаем отдельный xray.service.",
    );
    let r = { code: 1 as number | null, stdout: "", stderr: "" };
    if (hasXuiUnit) {
      const reload = await exec(conn, "systemctl reload x-ui 2>/dev/null || systemctl reload x-ui.service 2>/dev/null");
      r = reload;
      if (reload.code !== 0) {
        r = await exec(conn, "systemctl restart x-ui 2>/dev/null || systemctl restart x-ui.service 2>/dev/null");
      }
    } else {
      // Нет systemd unit, но процесс x-ui запущен — шлём USR1 как у ExecReload в типовом unit.
      r = await exec(conn, "pkill -USR1 -f '/usr/local/x-ui/x-ui' 2>/dev/null || true");
    }
    if (r.code !== 0) {
      const err = (r.stderr || r.stdout || "").trim();
      log?.(`x-ui reload/restart не удался (${err || "no output"}), пробуем обычный xray.service…`);
    } else {
      const ok = await exec(conn, "pgrep -f 'xray-linux-amd64|/usr/local/bin/xray' >/dev/null 2>&1; echo $?");
      if (ok.stdout.trim() === "0") return;
      log?.("x-ui перезапущен, но процесс xray не найден — пробуем обычный xray.service…");
    }
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

export async function detectXrayConfigPath(cfg: SshConfig, log?: SshLog): Promise<string | null> {
  return withSsh(
    cfg,
    async (conn) => {
      for (const p of XRAY_CONFIG_PATHS) {
        log?.(`Проверка наличия ${p}…`);
        const r = await exec(conn, `test -f '${p}' && echo OK || true`);
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
              const prevById = new Map(prevList.map((c) => [String(c.id ?? "").toLowerCase(), c]));
              settings.clients = clientUuids.map((id) => {
                const prev = prevById.get(id.toLowerCase());
                const base: Record<string, unknown> = prev && typeof prev === "object" ? { ...prev } : {};
                return {
                  ...base,
                  id,
                  email: String(base.email ?? id).trim() || id,
                  level: Number(base.level ?? 0) || 0,
                };
              });
              ib.settings = settings;
              const curPort = Number(ib.port);
              if (Number.isFinite(curPort) && curPort > 0 && curPort !== opts.vlessPort) {
                log?.(
                  `Порт в конфиге inbound «${TZADMIN_VLESS_TAG}» = ${curPort}, в панели указано ${opts.vlessPort}. ` +
                    `Порт в конфиге НЕ меняю (иначе ломается TLS/Reality). Исправьте порт узла в панели под фактический.`,
                );
              } else {
                ib.port = opts.vlessPort;
              }
              inbounds[idx] = ib;
              parsed.inbounds = inbounds;
              config = parsed;
              log?.(`Обновлён только inbound «${TZADMIN_VLESS_TAG}» (${clientUuids.length} UUID).`);
            } else {
              config = buildMinimalConfig(clientUuids, opts.vlessPort);
              log?.(`Inbound «${TZADMIN_VLESS_TAG}» не найден — записан минимальный конфиг.`);
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

        hints = extractVlessLinkHintsFromConfig(config);

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
