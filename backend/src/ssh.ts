import { Client } from "ssh2";
import { decryptSecret } from "./crypto.js";
import {
  deriveRealityPublicKeyFromPrivateLocal,
  ensureRealityPublicKeyOnHintsFromConfig,
  extractVlessLinkHintsFromConfig,
  streamSettingsOfInbound,
  type ServerLinkHints,
} from "./vlessLinkHints.js";
import path from "node:path";
import { generateX25519RealityKeyPair, randomRealityShortId } from "./realityKeygen.js";

export type SshConfig = {
  host: string;
  port: number;
  username: string;
  passwordEnc: string;
};

export type SshLog = (message: string) => void;
/** maxIPs и uplinkSpeed/downlinkSpeed через policy.levels[level]; у клиента выставляется `level`. */
export type ManagedClientInput = { id: string; deviceLimit?: number; speedLimitMbps?: number };

const SPEED_POLICY_BASE = 10000;
const COMBINED_POLICY_BASE = 50000;

/** Уровень политики = base + N, где N — max одновременных исходящих IP для UUID. */
export function deviceLimitPolicyLevel(maxIps: number): number {
  const n = Math.max(1, Math.floor(maxIps));
  return 200 + n;
}

function speedLimitPolicyLevel(mbps: number): number {
  const m = Math.max(1, Math.min(9999, Math.floor(mbps)));
  return SPEED_POLICY_BASE + m;
}

function combinedLimitPolicyLevel(maxIps: number, mbps: number): number {
  const n = Math.max(1, Math.min(99, Math.floor(maxIps)));
  const m = Math.max(1, Math.min(9999, Math.floor(mbps)));
  return COMBINED_POLICY_BASE + n * 10000 + m;
}

export function clientPolicyLevel(entry: Pick<ManagedClientInput, "deviceLimit" | "speedLimitMbps">): number {
  const dev = Number(entry.deviceLimit);
  const spd = Number(entry.speedLimitMbps);
  const hasDev = Number.isFinite(dev) && dev > 0;
  const hasSpd = Number.isFinite(spd) && spd > 0;
  if (!hasDev && !hasSpd) return 0;
  if (hasDev && !hasSpd) return deviceLimitPolicyLevel(Math.floor(dev));
  if (!hasDev && hasSpd) return speedLimitPolicyLevel(Math.floor(spd));
  return combinedLimitPolicyLevel(Math.floor(dev), Math.floor(spd));
}

function xraySpeedMbpsTag(mbps: number): string {
  return `${Math.max(1, Math.floor(mbps))}M`;
}
export const TZADMIN_XRAY_CONFIG_PATH = "/etc/tzadmin-xray/config.json";

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

function isTzadminManagedConfigPath(configPath: string): boolean {
  return configPath.includes("/tzadmin-xray/");
}

async function restartTzadminXrayService(conn: Client, configPath: string, log?: SshLog): Promise<void> {
  const launcher = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "PATH=/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin:/usr/local/x-ui/bin:$PATH",
    `CONFIG_PATH=${JSON.stringify(configPath)}`,
    "PID=$(pgrep -x xray 2>/dev/null | head -n1 || true)",
    `if [ -z "$PID" ]; then PID=$(pgrep -f 'xray-linux-amd64|/usr/local/x-ui/bin/xray|/usr/local/bin/xray|/usr/bin/xray' 2>/dev/null | head -n1 || true); fi`,
    'X=""',
    'CWD=""',
    'BIN=""',
    'if [ -n "$PID" ]; then',
    '  X=$(readlink -f "/proc/$PID/exe" 2>/dev/null || true)',
    '  CWD=$(readlink -f "/proc/$PID/cwd" 2>/dev/null || true)',
    `  BIN=$(tr '\\000' ' ' < "/proc/$PID/cmdline" 2>/dev/null | cut -d' ' -f1)`,
    '  if [ ! -x "$X" ] && [ -n "$BIN" ]; then',
    '    case "$BIN" in',
    '      /*) CAND="$BIN" ;;',
    '      *) CAND="$CWD/$BIN" ;;',
    "    esac",
    '    [ -x "$CAND" ] && X="$CAND"',
    "  fi",
    "fi",
    "for CAND in /usr/local/x-ui/bin/xray-linux-amd64 /usr/local/x-ui/bin/xray /usr/local/sbin/xray /usr/local/bin/xray /usr/sbin/xray /usr/bin/xray; do",
    '  if [ ! -x "$X" ] && [ -x "$CAND" ]; then X="$CAND"; fi',
    "done",
    `[ -x "$X" ] || X="$(command -v xray 2>/dev/null || true)"`,
    'if [ -x "$X" ]; then',
    '  exec "$X" -config "$CONFIG_PATH"',
    "fi",
    'if [ -n "$BIN" ] && [ -n "$CWD" ]; then',
    '  cd "$CWD"',
    '  exec "$BIN" -config "$CONFIG_PATH"',
    "fi",
    'echo "xray binary not found" >&2',
    "exit 20",
  ].join("\n");
  const unit = [
    "[Unit]",
    "Description=TZAdmin Managed Xray Service",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    "ExecStart=/etc/tzadmin-xray/launch.sh",
    "Restart=always",
    "RestartSec=3",
    "LimitNOFILE=1048576",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n");
  const launcherB64 = Buffer.from(launcher, "utf8").toString("base64");
  const unitB64 = Buffer.from(unit, "utf8").toString("base64");
  const script = [
    "set -e",
    "install -d -m 0755 /etc/tzadmin-xray",
    `printf %s ${shellQuote(launcherB64)} | base64 -d > /etc/tzadmin-xray/launch.sh`,
    "chmod 0755 /etc/tzadmin-xray/launch.sh",
    `printf %s ${shellQuote(unitB64)} | base64 -d > /etc/systemd/system/tzadmin-xray.service`,
    "systemctl daemon-reload",
    "systemctl unmask tzadmin-xray >/dev/null 2>&1 || true",
    "systemctl enable tzadmin-xray >/dev/null 2>&1 || true",
    "systemctl restart tzadmin-xray",
    "systemctl is-active tzadmin-xray >/dev/null",
  ].join("; ");
  const r = await exec(conn, `bash -lc ${JSON.stringify(script)}`);
  if (r.code === 0) return;
  const text = (r.stderr || r.stdout || "").trim();
  if (r.code === 20) throw new Error("На сервере не найден бинарник xray");
  throw new Error(`tzadmin-xray restart: ${text || `exit ${r.code}`}`);
}

async function restartXray(conn: Client, configPath: string, log?: SshLog): Promise<void> {
  if (isTzadminManagedConfigPath(configPath)) {
    log?.("Перезапуск отдельного сервиса панели tzadmin-xray…");
    await restartTzadminXrayService(conn, configPath, log);
    return;
  }
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
  const levelKeys = new Set<string>(["0", ...Object.keys(levels)]);
  for (const k of levelKeys) {
    const lv = { ...(levels[k] || {}) };
    lv.statsUserUplink = true;
    lv.statsUserDownlink = true;
    lv.statsUserOnline = true;
    levels[k] = lv;
  }
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

/** Добавляет в config.policy.levels записи maxIPs и uplinkSpeed/downlinkSpeed. Вызывать до ensureXrayStatsPolicyApi. */
export function ensureClientPolicyLevels(
  config: Record<string, unknown>,
  clientEntries: ManagedClientInput[],
): void {
  const prevPol = (config.policy as Record<string, unknown>) || {};
  const levels = { ...((prevPol.levels as Record<string, Record<string, unknown>>) || {}) };
  const byLevel = new Map<
    number,
    { maxIPs?: number; speedLimitMbps?: number }
  >();
  for (const e of clientEntries) {
    const dev = Number(e.deviceLimit);
    const spd = Number(e.speedLimitMbps);
    const hasDev = Number.isFinite(dev) && dev > 0;
    const hasSpd = Number.isFinite(spd) && spd > 0;
    if (!hasDev && !hasSpd) continue;
    const lv = clientPolicyLevel(e);
    const cur = byLevel.get(lv) ?? {};
    if (hasDev) cur.maxIPs = Math.floor(dev);
    if (hasSpd) cur.speedLimitMbps = Math.floor(spd);
    byLevel.set(lv, cur);
  }
  for (const [lvNum, spec] of byLevel) {
    const k = String(lvNum);
    const lv = { ...(levels[k] || {}) };
    if (spec.maxIPs != null) lv.maxIPs = spec.maxIPs;
    else delete lv.maxIPs;
    if (spec.speedLimitMbps != null) {
      const tag = xraySpeedMbpsTag(spec.speedLimitMbps);
      lv.uplinkSpeed = tag;
      lv.downlinkSpeed = tag;
    } else {
      delete lv.uplinkSpeed;
      delete lv.downlinkSpeed;
    }
    levels[k] = lv;
  }
  config.policy = { ...prevPol, levels };
}

/** @deprecated Используйте ensureClientPolicyLevels. */
export function ensureDeviceLimitPolicyLevels(
  config: Record<string, unknown>,
  clientEntries: ManagedClientInput[],
): void {
  ensureClientPolicyLevels(config, clientEntries);
}

function buildManagedClients(
  prevList: Array<Record<string, unknown>>,
  clientEntries: ManagedClientInput[],
  defaultFlow: string,
  forceFlow: boolean,
): Array<Record<string, unknown>> {
  const prevById = new Map(prevList.map((c) => [String(c.id ?? "").toLowerCase(), c]));
  return clientEntries.map((entry) => {
    const id = String(entry.id ?? "").trim();
    const prev = prevById.get(id.toLowerCase());
    const base: Record<string, unknown> = prev && typeof prev === "object" ? { ...prev } : {};
    const flow = String(base.flow ?? "").trim();
    const out: Record<string, unknown> = {
      ...base,
      id,
      email: String(base.email ?? id).trim() || id,
    };
    delete out.limitIp;
    out.level = clientPolicyLevel(entry);
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

function buildMinimalConfig(clientEntries: ManagedClientInput[], vlessPort: number): Record<string, unknown> {
  const clients = clientEntries.map((entry) => {
    const id = String(entry.id ?? "").trim();
    const level = clientPolicyLevel(entry);
    return {
      id,
      email: id,
      level,
    };
  });
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
  ensureClientPolicyLevels(cfg, clientEntries);
  ensureXrayStatsPolicyApi(cfg);
  return cfg;
}

function buildManagedInbound(clientEntries: ManagedClientInput[], vlessPort: number): Record<string, unknown> {
  const clients = clientEntries.map((entry) => {
    const id = String(entry.id ?? "").trim();
    const level = clientPolicyLevel(entry);
    return {
      id,
      email: id,
      level,
      flow: "xtls-rprx-vision",
    };
  });
  const sni = (process.env.TZADMIN_REALITY_SNI ?? "www.oracle.com").trim() || "www.oracle.com";
  const sid = (process.env.TZADMIN_REALITY_SID ?? randomRealityShortId()).trim() || randomRealityShortId();
  const kp = generateX25519RealityKeyPair();
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
      security: "reality",
      realitySettings: {
        show: false,
        dest: `${sni}:443`,
        xver: 0,
        serverNames: [sni],
        privateKey: kp.privateKey,
        publicKey: kp.publicKey,
        shortIds: [sid],
        fingerprint: "chrome",
        spiderX: "/",
      },
    },
    tag: TZADMIN_VLESS_TAG,
  };
}

function realityFromInboundOrNew(ib?: Record<string, unknown>): {
  sni: string;
  sid: string;
  privateKey: string;
  publicKey: string;
  fingerprint: string;
  spiderX: string;
} {
  const sniDefault = (process.env.TZADMIN_REALITY_SNI ?? "www.oracle.com").trim() || "www.oracle.com";
  const sidDefault = (process.env.TZADMIN_REALITY_SID ?? randomRealityShortId()).trim() || randomRealityShortId();
  const ss = ib ? streamSettingsOfInbound(ib) : {};
  const rs = ((ss.realitySettings as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const serverNames = Array.isArray(rs.serverNames) ? rs.serverNames : [];
  const shortIds = Array.isArray(rs.shortIds) ? rs.shortIds : [];
  const sni =
    (typeof rs.serverName === "string" && rs.serverName.trim()) ||
    (typeof serverNames[0] === "string" && String(serverNames[0]).trim()) ||
    sniDefault;
  const sid =
    (typeof rs.shortId === "string" && rs.shortId.trim()) ||
    (typeof shortIds[0] === "string" && String(shortIds[0]).trim()) ||
    sidDefault;
  const priv = typeof rs.privateKey === "string" ? rs.privateKey.trim() : "";
  let pub = typeof rs.publicKey === "string" ? rs.publicKey.trim() : "";
  let privateKey = priv;
  if (!privateKey) {
    const kp = generateX25519RealityKeyPair();
    privateKey = kp.privateKey;
    pub = kp.publicKey;
  }
  if (!pub) pub = deriveRealityPublicKeyFromPrivateLocal(privateKey);
  if (!pub) pub = generateX25519RealityKeyPair().publicKey;
  const fingerprint = (typeof rs.fingerprint === "string" && rs.fingerprint.trim()) || "chrome";
  const spiderX = (typeof rs.spiderX === "string" && rs.spiderX.trim()) || "/";
  return { sni, sid, privateKey, publicKey: pub, fingerprint, spiderX };
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

function parseXrayApiServer(config: Record<string, unknown>): string | null {
  const inbounds = config.inbounds;
  if (Array.isArray(inbounds)) {
    for (const raw of inbounds) {
      const ib = raw as Record<string, unknown>;
      if (String(ib.tag ?? "") !== "api") continue;
      const listenRaw = ib.listen;
      const listen =
        listenRaw === "0.0.0.0" || listenRaw === "::" ? "127.0.0.1" : String(listenRaw ?? "127.0.0.1");
      const port = Number(ib.port);
      if (!Number.isFinite(port) || port <= 0) continue;
      if (listen.includes(":") && !listen.startsWith("[")) return `[${listen}]:${port}`;
      if (listen.startsWith("[") && listen.includes("]")) return `${listen}:${port}`;
      return `${listen}:${port}`;
    }
  }
  const api = config.api as Record<string, unknown> | undefined;
  if (api && typeof api.listen === "string" && api.listen.trim()) {
    return api.listen.trim();
  }
  return null;
}

function pickInboundForApiUserOps(config: Record<string, unknown>, preferredPort: number): Record<string, unknown> | null {
  const inbounds = Array.isArray(config.inbounds) ? (config.inbounds as Record<string, unknown>[]) : [];
  const managed = inbounds.find((ib) => String(ib.tag ?? "") === TZADMIN_VLESS_TAG);
  if (managed) return managed;
  const idx = findCandidateVlessInboundIndex(inbounds, preferredPort);
  if (idx < 0) return null;
  return inbounds[idx] ?? null;
}

function xrayBinaryDetectScript(): string {
  return [
    "PATH=/usr/local/bin:/usr/bin:/usr/local/x-ui/bin:$PATH",
    "X=$(command -v xray 2>/dev/null || true)",
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray-linux-amd64 ] && X=/usr/local/x-ui/bin/xray-linux-amd64',
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray ] && X=/usr/local/x-ui/bin/xray',
    '[ -z "$X" ] && [ -x /usr/local/bin/xray ] && X=/usr/local/bin/xray',
    '[ -z "$X" ] && [ -x /usr/bin/xray ] && X=/usr/bin/xray',
    '[ -n "$X" ] || { echo "xray binary not found for api user ops" >&2; exit 127; }',
  ].join("; ");
}

export async function alterInboundUsersViaApi(
  cfg: SshConfig,
  opts: {
    configPath: string;
    preferredVlessPort: number;
    addUuids?: string[];
    addClients?: ManagedClientInput[];
    removeUuids?: string[];
  },
  log?: SshLog,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const detail = await withSsh(
      cfg,
      async (conn) => {
        const raw = await sftpReadFile(conn, opts.configPath);
        const config = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
        const apiServer = parseXrayApiServer(config);
        if (!apiServer) throw new Error("xray api.listen не найден");
        const inbound = pickInboundForApiUserOps(config, opts.preferredVlessPort);
        if (!inbound) throw new Error("не найден VLESS inbound для API user ops");
        const tag = String(inbound.tag ?? "").trim();
        if (!tag) throw new Error("VLESS inbound без tag, API user ops невозможен");
        const sec = String(streamSettingsOfInbound(inbound).security ?? "").toLowerCase();
        const defaultFlow = sec === "reality" ? "xtls-rprx-vision" : "";
        const addById = new Map<string, ManagedClientInput>();
        for (const id of opts.addUuids ?? []) {
          const norm = String(id ?? "").trim();
          if (!norm) continue;
          addById.set(norm.toLowerCase(), { id: norm });
        }
        for (const c of opts.addClients ?? []) {
          const norm = String(c.id ?? "").trim();
          if (!norm) continue;
          addById.set(norm.toLowerCase(), {
            id: norm,
            deviceLimit: c.deviceLimit,
            speedLimitMbps: c.speedLimitMbps,
          });
        }
        const addClients = [...addById.values()];
        const removeUuids = [...new Set((opts.removeUuids ?? []).map((x) => String(x).trim()).filter(Boolean))];
        if (addClients.length === 0 && removeUuids.length === 0) return "no-op";

        if (addClients.length > 0) {
          const clients = addClients.map((entry) => {
            const level = clientPolicyLevel(entry);
            return {
              id: String(entry.id),
              email: String(entry.id),
              level,
              ...(defaultFlow ? { flow: defaultFlow } : {}),
            };
          });
          const payload = {
            inbounds: [
              {
                tag,
                protocol: "vless",
                settings: {
                  clients,
                  decryption: "none",
                },
              },
            ],
          };
          const aduB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
          const cmd = [
            xrayBinaryDetectScript(),
            `API=${shellQuote(apiServer)}`,
            "TMP=/tmp/tzadmin-adu-$$.json",
            `printf %s ${shellQuote(aduB64)} | base64 -d > \"$TMP\"`,
            "\"$X\" api adu --server=\"$API\" \"$TMP\"",
            "RC=$?",
            "rm -f \"$TMP\"",
            "[ \"$RC\" -eq 0 ] || exit \"$RC\"",
          ].join("; ");
          const r = await exec(conn, `bash -lc ${JSON.stringify(cmd)}`);
          if (r.code !== 0) {
            const txt = (r.stderr || r.stdout || "").trim();
            throw new Error(`xray api adu failed: ${txt || `exit ${r.code}`}`);
          }
        }

        if (removeUuids.length > 0) {
          const cmd = [
            xrayBinaryDetectScript(),
            `API=${shellQuote(apiServer)}`,
            `TAG=${shellQuote(tag)}`,
            ...removeUuids.map((id) => `"$X" api rmu --server="$API" -tag="$TAG" ${shellQuote(id)}`),
          ].join("; ");
          const r = await exec(conn, `bash -lc ${JSON.stringify(cmd)}`);
          if (r.code !== 0) {
            const txt = (r.stderr || r.stdout || "").trim();
            throw new Error(`xray api rmu failed: ${txt || `exit ${r.code}`}`);
          }
        }

        log?.(`Xray API user ops OK on inbound tag=${tag}: +${addClients.length}, -${removeUuids.length}`);
        return `ok +${addClients.length} -${removeUuids.length}`;
      },
      log,
    );
    return { ok: true, detail };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
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
  opts: { clientUuids?: string[]; clientEntries?: ManagedClientInput[]; vlessPort: number; configPath: string },
  log?: SshLog,
): Promise<{ ok: boolean; detail: string; backup?: string; hints?: ServerLinkHints }> {
  const backup = `${opts.configPath}.bak.${Date.now()}`;
  const byId = new Map<string, ManagedClientInput>();
  for (const c of opts.clientEntries ?? []) {
    const id = String(c.id ?? "").trim();
    if (!id) continue;
    byId.set(id.toLowerCase(), {
      id,
      ...(Number.isFinite(Number(c.deviceLimit)) && Number(c.deviceLimit) > 0
        ? { deviceLimit: Math.floor(Number(c.deviceLimit)) }
        : {}),
      ...(Number.isFinite(Number(c.speedLimitMbps)) && Number(c.speedLimitMbps) > 0
        ? { speedLimitMbps: Math.floor(Number(c.speedLimitMbps)) }
        : {}),
    });
  }
  for (const rawId of opts.clientUuids ?? []) {
    const id = String(rawId ?? "").trim();
    if (!id) continue;
    if (!byId.has(id.toLowerCase())) byId.set(id.toLowerCase(), { id });
  }
  const clientEntries = [...byId.values()];
  const clientUuids = clientEntries.map((x) => x.id);
  const xuiConfigMode = /\/x-ui\//.test(opts.configPath);
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
            if (xuiConfigMode) {
              const rows = inbounds as Record<string, unknown>[];
              // На x-ui не держим отдельный tzadmin inbound: x-ui может удалять его при reload.
              // Синхронизируем UUID прямо в рабочий VLESS inbound.
              if (idx >= 0) {
                rows.splice(idx, 1);
                log?.("x-ui режим: удалён tzadmin-vless, используем только существующий inbound x-ui.");
              }
              const candIdx = findCandidateVlessInboundIndex(rows, opts.vlessPort);
              if (candIdx >= 0) {
                const cand = { ...(rows[candIdx] as Record<string, unknown>) };
                const candSettings = (cand.settings as Record<string, unknown>) ?? {};
                const candPrev = (candSettings.clients as Array<Record<string, unknown>>) ?? [];
                const defaultFlow = defaultClientFlowForInbound(cand, candPrev);
                const forceFlow = shouldForceClientFlowForInbound(cand);
                candSettings.clients = buildManagedClients(candPrev, clientEntries, defaultFlow, forceFlow);
                candSettings.decryption = "none";
                cand.settings = candSettings;
                rows[candIdx] = cand;
                parsed.inbounds = rows;
                config = parsed;
                log?.(`x-ui режим: клиенты синхронизированы в inbound порт ${Number(cand.port) || 0}.`);
              } else {
                config = buildMinimalConfig(clientEntries, opts.vlessPort);
                log?.("VLESS inbound не найден — записан минимальный конфиг.");
              }
            } else if (idx >= 0) {
              const ib = inbounds[idx] as Record<string, unknown>;
              const settings = (ib.settings as Record<string, unknown>) ?? {};
              const prevList = (settings.clients as Array<Record<string, unknown>>) ?? [];
              // Управляемый inbound панели держим простым (как «рабочий» узел): VLESS TCP security=none.
              const managedPort = chooseManagedPort(inbounds as Record<string, unknown>[], opts.vlessPort);
              const rp = realityFromInboundOrNew(ib);
              const managed = buildManagedInbound(clientEntries, managedPort);
              const defaultFlow = defaultClientFlowForInbound(managed, prevList) || "xtls-rprx-vision";
              const forceFlow = shouldForceClientFlowForInbound(managed);
              managed.settings = {
                ...(managed.settings as Record<string, unknown>),
                clients: buildManagedClients(prevList, clientEntries, defaultFlow, forceFlow),
              };
              managed.streamSettings = {
                network: "tcp",
                security: "reality",
                realitySettings: {
                  show: false,
                  dest: `${rp.sni}:443`,
                  xver: 0,
                  serverNames: [rp.sni],
                  privateKey: rp.privateKey,
                  publicKey: rp.publicKey,
                  shortIds: [rp.sid],
                  fingerprint: rp.fingerprint,
                  spiderX: rp.spiderX,
                },
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
                candSettings.clients = buildManagedClients(candPrev, clientEntries, defaultFlow, forceFlow);
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
                candSettings.clients = buildManagedClients(candPrev, clientEntries, defaultFlow, forceFlow);
                candSettings.decryption = "none";
                cand.settings = candSettings;
                rows[candIdx] = cand;
                log?.(`Клиенты синхронизированы в существующий inbound порт ${Number(cand.port) || 0}.`);
              }
              const managedPort = chooseManagedPort(rows, opts.vlessPort);
              if (managedPort !== opts.vlessPort) {
                log?.(`Порт ${opts.vlessPort} занят другим VLESS inbound, managed inbound создан на ${managedPort}.`);
              }
              rows.push(buildManagedInbound(clientEntries, managedPort));
              parsed.inbounds = rows;
              config = parsed;
              log?.(`Создан отдельный inbound «${TZADMIN_VLESS_TAG}» (${clientUuids.length} UUID).`);
            }
          } else {
            config = buildMinimalConfig(clientEntries, opts.vlessPort);
            log?.("Некорректные inbounds — записан минимальный конфиг.");
          }
        } catch {
          config = buildMinimalConfig(clientEntries, opts.vlessPort);
          log?.("Файл отсутствует или не JSON — записан минимальный конфиг.");
        }
        ensureClientPolicyLevels(config, clientEntries);
        ensureXrayStatsPolicyApi(config);

        hints = extractVlessLinkHintsFromConfig(config, opts.vlessPort);
        ensureRealityPublicKeyOnHintsFromConfig(config, hints, opts.vlessPort);

        const json = JSON.stringify(config, null, 2);
        log?.(`Запись ${opts.configPath} (${json.length} байт)…`);
        await sftpWriteFile(conn, opts.configPath, Buffer.from(json, "utf8"));

        log?.("Перезапуск Xray…");
        await restartXray(conn, opts.configPath, log);

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
  opts: { configPath: string; vlessPort: number; clientUuids?: string[]; clientEntries?: ManagedClientInput[] },
  log?: SshLog,
): Promise<{ ok: boolean; detail: string; hints?: ServerLinkHints }> {
  return deployOrSyncVless(
    cfg,
    {
      clientUuids: opts.clientUuids ?? [],
      clientEntries: opts.clientEntries ?? [],
      vlessPort: opts.vlessPort,
      configPath: opts.configPath,
    },
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
        await restartXray(conn, opts.configPath, log);
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
