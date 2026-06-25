import type { ServerRow, UserRow } from "./db.js";
import { applyUsersTrafficSnapshot, getUser, listDeployedServers, updateServer, updateUserRow } from "./db.js";
import { isDeviceLimitActiveForUser } from "./deviceLimitEffective.js";
import {
  TZADMIN_VLESS_TAG,
  sshExecCommand,
  sshReadRemoteFile,
  type SshConfig,
  type SshLog,
} from "./ssh.js";
import { resolveConfigPath } from "./userSync.js";

export type UserTrafficAgg = { up: number; down: number; online: number; online_ips?: string[] };

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Адрес для `xray api … --server=…` (упрощённый api.listen или legacy inbound tag api). */
export function parseXrayApiServerForStatsQuery(config: Record<string, unknown>): string | null {
  const inbounds = config.inbounds;
  if (Array.isArray(inbounds)) {
    for (const raw of inbounds) {
      const ib = raw as Record<string, unknown>;
      if (ib.tag !== "api") continue;
      const listenRaw = ib.listen;
      const listen =
        listenRaw === "0.0.0.0" || listenRaw === "::" ? "127.0.0.1" : String(listenRaw ?? "127.0.0.1");
      const port = Number(ib.port);
      if (!Number.isFinite(port) || port <= 0) continue;
      if (listen.includes(":") && !listen.startsWith("[")) {
        return `[${listen}]:${port}`;
      }
      if (listen.startsWith("[") && listen.includes("]")) {
        return `${listen}:${port}`;
      }
      return `${listen}:${port}`;
    }
  }

  const api = config.api as Record<string, unknown> | undefined;
  if (api && typeof api.listen === "string" && api.listen.trim()) {
    return api.listen.trim();
  }
  return null;
}

/** Соответствие ключа статистики Xray (`email` клиента) → UUID клиента `id`. */
export function buildStatKeyToUuidMap(config: Record<string, unknown>): Map<string, string> {
  const m = new Map<string, string>();
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) return m;
  const vlessInbounds = inbounds.filter(
    (x) => String((x as { protocol?: string }).protocol ?? "").toLowerCase() === "vless",
  ) as Record<string, unknown>[];
  const tagged = vlessInbounds.find((x) => String((x as { tag?: string }).tag ?? "") === TZADMIN_VLESS_TAG);
  const preferred = tagged ? [tagged] : vlessInbounds;
  for (const ib of preferred) {
    const settings = (ib.settings as Record<string, unknown>) ?? {};
    const clients = (settings.clients as Array<Record<string, unknown>>) ?? [];
    for (const c of clients) {
      const id = String(c.id ?? "").trim();
      if (!id) continue;
      const em = String(c.email ?? id).trim() || id;
      m.set(em, id);
      m.set(em.toLowerCase(), id);
      m.set(id, id);
      m.set(id.toLowerCase(), id);
    }
  }
  return m;
}

type StatRow = { name?: string; value?: number | string; Name?: string; Value?: number | string };

/** Значение счётчика в JSON от `xray api`: число, строка int64, иногда вложенный объект Long. */
function coerceStatCounter(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
    try {
      const bi = BigInt(raw.trim());
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      if (bi > max) return Number.MAX_SAFE_INTEGER;
      return Math.max(0, Number(bi));
    } catch {
      return 0;
    }
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.low === "number") {
      const unsigned = o.unsigned === true;
      const hi = typeof o.high === "number" ? o.high : 0;
      const lo = o.low >>> 0;
      if (!unsigned && hi === 0) return Math.max(0, lo);
      if (unsigned && hi === 0) return Math.max(0, lo);
    }
  }
  return 0;
}

function statRowNameValue(row: StatRow): { name?: string; value: number } {
  const name =
    typeof row.name === "string"
      ? row.name
      : typeof row.Name === "string"
        ? row.Name
        : undefined;
  const raw = row.value ?? row.Value;
  return { name, value: coerceStatCounter(raw) };
}

function normalizeStatList(raw: unknown): StatRow[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const cands = [o.stat, o.Stat, o.stats, o.Stats];
  for (const c of cands) {
    if (c == null) continue;
    if (Array.isArray(c)) return c as StatRow[];
    if (typeof c === "object") return [c as StatRow];
  }
  return [];
}

function firstJsonObject(s: string): unknown {
  const i = s.indexOf("{");
  if (i < 0) throw new Error("statsquery: нет JSON в выводе");
  return JSON.parse(s.slice(i)) as unknown;
}

/** Разбор вывода `xray api statsquery` → байты по ключу email в счётчике. */
export function parseStatsQueryStdout(stdout: string): Map<string, UserTrafficAgg> {
  const raw = firstJsonObject(stdout) as Record<string, unknown>;
  const list = normalizeStatList(raw);
  const byKey = new Map<string, UserTrafficAgg>();
  for (const row of list) {
    const { name, value: val } = statRowNameValue(row);
    if (typeof name !== "string" || !name.startsWith("user>>>")) continue;
    const parts = name.split(">>>");
    /* traffic: user>>>email>>>traffic>>>uplink; online: user>>>email>>>online */
    if (parts.length < 3) continue;
    const emailKey = parts[1] ?? "";
    if (!emailKey) continue;
    let cur = byKey.get(emailKey);
    if (!cur) {
      cur = { up: 0, down: 0, online: 0 };
      byKey.set(emailKey, cur);
    }
    const seg2 = (parts[2] ?? "").toLowerCase();
    if (parts.length === 3 && seg2 === "online") {
      cur.online = Math.max(cur.online, val);
      continue;
    }
    if (parts.length >= 4 && seg2 === "traffic") {
      const seg3 = (parts[3] ?? "").toLowerCase();
      if (seg3 === "uplink") cur.up = val;
      else if (seg3 === "downlink") cur.down = val;
    }
  }
  return byKey;
}

function mergeKeyMapIntoUuidMap(
  rawByKey: Map<string, UserTrafficAgg>,
  keyToUuid: Map<string, string>,
): Map<string, UserTrafficAgg> {
  const out = new Map<string, UserTrafficAgg>();
  for (const [key, v] of rawByKey) {
    const uuid = keyToUuid.get(key) ?? keyToUuid.get(key.toLowerCase());
    if (!uuid) continue;
    const nk = uuid.trim().toLowerCase();
    const cur = out.get(nk) ?? { up: 0, down: 0, online: 0 };
    cur.up += v.up;
    cur.down += v.down;
    cur.online = Math.max(cur.online, v.online);
    out.set(nk, cur);
  }
  return out;
}

function sshCfg(row: ServerRow): SshConfig {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

function buildStatsQueryCommand(apiListen: string): string {
  const srv = shellQuote(apiListen);
  return [
    "PATH=/usr/local/bin:/usr/bin:/usr/local/x-ui/bin:$PATH",
    "X=$(command -v xray 2>/dev/null || true)",
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray-linux-amd64 ] && X=/usr/local/x-ui/bin/xray-linux-amd64',
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray ] && X=/usr/local/x-ui/bin/xray',
    '[ -z "$X" ] && [ -x /usr/local/bin/xray ] && X=/usr/local/bin/xray',
    '[ -z "$X" ] && [ -x /usr/bin/xray ] && X=/usr/bin/xray',
    '[ -n "$X" ] || { echo "xray binary not found for statsquery" >&2; exit 127; }',
    `"$X" api statsquery --server=${srv}`,
  ].join("; ");
}

/** Один вызов на узел: список онлайн-аккаунтов (Xray ≥ с RPC GetAllOnlineUsers). */
function buildOnlineIpListCommand(apiListen: string, email: string): string {
  const srv = shellQuote(apiListen);
  const em = shellQuote(email);
  return [
    "PATH=/usr/local/bin:/usr/bin:/usr/local/x-ui/bin:$PATH",
    "X=$(command -v xray 2>/dev/null || true)",
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray-linux-amd64 ] && X=/usr/local/x-ui/bin/xray-linux-amd64',
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray ] && X=/usr/local/x-ui/bin/xray',
    '[ -z "$X" ] && [ -x /usr/local/bin/xray ] && X=/usr/local/bin/xray',
    '[ -z "$X" ] && [ -x /usr/bin/xray ] && X=/usr/bin/xray',
    '[ -n "$X" ] || exit 0',
    `"$X" api statsonlineiplist --server=${srv} --email=${em} 2>/dev/null || true`,
  ].join("; ");
}

function parseOnlineIpList(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (!trimmed || /unknown command|not found|No help topic/i.test(trimmed)) return [];
  try {
    const raw = firstJsonObject(trimmed) as Record<string, unknown>;
    const ips = raw.ips ?? raw.Ips;
    if (ips && typeof ips === "object" && !Array.isArray(ips)) {
      return Object.keys(ips as Record<string, unknown>).map((x) => x.trim()).filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}

function parseOnlineIpCount(stdout: string): number {
  return parseOnlineIpList(stdout).length;
}

function mergeOnlineIpLists(into: string[], add: string[]): void {
  const seen = new Set(into.map((x) => x.toLowerCase()));
  for (const ip of add) {
    const n = ip.trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(n);
  }
}

function emailsForUuid(config: Record<string, unknown>, uuid: string): string[] {
  const want = uuid.trim().toLowerCase();
  if (!want) return [];
  const out = new Set<string>();
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) return [];
  for (const raw of inbounds) {
    const ib = raw as Record<string, unknown>;
    if (String(ib.protocol ?? "").toLowerCase() !== "vless") continue;
    const clients = ((ib.settings as Record<string, unknown> | undefined)?.clients as Array<Record<string, unknown>>) ?? [];
    for (const c of clients) {
      const id = String(c.id ?? "").trim();
      if (id.toLowerCase() !== want) continue;
      const em = String(c.email ?? id).trim() || id;
      out.add(em);
    }
  }
  return [...out];
}

export async function listOnlineIpsForUserOnServer(row: ServerRow, user: UserRow, log?: SshLog): Promise<string[]> {
  const path = await resolveConfigPath(row, log);
  const cfg = sshCfg(row);
  const raw = await sshReadRemoteFile(cfg, path, log);
  const config = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  const apiSrv = parseXrayApiServerForStatsQuery(config);
  if (!apiSrv) return [];
  const emails = emailsForUuid(config, user.vless_uuid);
  if (emails.length === 0) emails.push(user.vless_uuid);
  const out: string[] = [];
  for (const email of emails) {
    const r = await sshExecCommand(cfg, buildOnlineIpListCommand(apiSrv, email), log);
    mergeOnlineIpLists(out, parseOnlineIpList(r.stdout));
  }
  return out;
}

export async function countOnlineIpsForUserOnServer(row: ServerRow, user: UserRow, log?: SshLog): Promise<number> {
  const ips = await listOnlineIpsForUserOnServer(row, user, log);
  return ips.length;
}

function buildOnlineUsersCommand(apiListen: string): string {
  const srv = shellQuote(apiListen);
  return [
    "PATH=/usr/local/bin:/usr/bin:/usr/local/x-ui/bin:$PATH",
    "X=$(command -v xray 2>/dev/null || true)",
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray-linux-amd64 ] && X=/usr/local/x-ui/bin/xray-linux-amd64',
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray ] && X=/usr/local/x-ui/bin/xray',
    '[ -z "$X" ] && [ -x /usr/local/bin/xray ] && X=/usr/local/bin/xray',
    '[ -z "$X" ] && [ -x /usr/bin/xray ] && X=/usr/bin/xray',
    '[ -n "$X" ] || exit 0',
    `"$X" api statsgetallonlineusers --server=${srv} 2>/dev/null || true`,
  ].join("; ");
}

const XRAY_ALT_CONFIG_PATHS_FOR_STATS = [
  "/usr/local/x-ui/bin/config.json",
  "/etc/x-ui/xray/config.json",
];

async function readConfigAndPull(
  row: ServerRow,
  configPath: string,
  log?: SshLog,
): Promise<{ host: string; byUuid: Map<string, UserTrafficAgg>; warn?: string }> {
  const cfg = sshCfg(row);
  const raw = await sshReadRemoteFile(cfg, configPath, log);
  const config = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  const apiSrv = parseXrayApiServerForStatsQuery(config);
  if (!apiSrv) {
    return {
      host: row.host,
      byUuid: new Map(),
      warn: "нет api.listen / inbound api — выполните синхронизацию конфига на узлы (деплой / сохранение клиента).",
    };
  }
  const keyToUuid = buildStatKeyToUuidMap(config);
  const r = await sshExecCommand(cfg, buildStatsQueryCommand(apiSrv), log);
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || r.stdout.trim() || `xray api exit ${r.code}`);
  }
  let rawStats: Map<string, UserTrafficAgg>;
  try {
    rawStats = parseStatsQueryStdout(r.stdout);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`statsquery JSON: ${msg}`);
  }
  const byUuid = mergeKeyMapIntoUuidMap(rawStats, keyToUuid);
  const rOnline = await sshExecCommand(cfg, buildOnlineUsersCommand(apiSrv), log);
  mergeOnlineUsersStdout(rOnline.stdout, keyToUuid, byUuid);
  return { host: row.host, byUuid };
}

function mergeOnlineUsersStdout(
  stdout: string,
  keyToUuid: Map<string, string>,
  byUuid: Map<string, UserTrafficAgg>,
): void {
  const trimmed = stdout.trim();
  if (!trimmed || /unknown command|not found|No help topic/i.test(trimmed)) return;
  let raw: Record<string, unknown>;
  try {
    raw = firstJsonObject(trimmed) as Record<string, unknown>;
  } catch {
    return;
  }
  const arr = raw.users ?? raw.Users;
  if (!Array.isArray(arr)) return;
  for (const line of arr) {
    if (typeof line !== "string") continue;
    const parts = line.split(">>>");
    if (parts.length < 3) continue;
    if (String(parts[0]).toLowerCase() !== "user") continue;
    const email = String(parts[1] ?? "");
    if (!email) continue;
    if (String(parts[parts.length - 1] ?? "").toLowerCase() !== "online") continue;
    const uuid = keyToUuid.get(email) ?? keyToUuid.get(email.toLowerCase());
    if (!uuid) continue;
    const nk = uuid.trim().toLowerCase();
    const agg = byUuid.get(nk);
    if (agg) agg.online = Math.max(agg.online, 1);
  }
}

/**
 * Снимает счётчики user>>>… с одного узла (localhost на сервере = API Xray).
 */
export async function pullTrafficFromServer(
  row: ServerRow,
  log?: SshLog,
): Promise<{ host: string; byUuid: Map<string, UserTrafficAgg>; warn?: string }> {
  const path = await resolveConfigPath(row, log);
  try {
    return await readConfigAndPull(row, path, log);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const dialErr =
      /failed to dial|connection refused|no such host|deadline exceeded|i\/o timeout/i.test(msg) ||
      /127\.0\.0\.1:\d+/.test(msg);
    // Узлы под 3x-ui часто используют отдельный config path. Если в БД остался системный путь,
    // пробуем только для чтения x-ui config, не трогая сервисы 3x-ui.
    if (!dialErr) throw e;
    for (const altPath of XRAY_ALT_CONFIG_PATHS_FOR_STATS) {
      if (altPath === path) continue;
      try {
        const pulled = await readConfigAndPull(row, altPath, log);
        updateServer(row.id, { xray_config_path: altPath });
        return pulled;
      } catch {
        /* пробуем следующий путь */
      }
    }
    throw e;
  }
}

/** Суммирует трафик и онлайн по всем развёрнутым узлам (один UUID может быть на нескольких серверах). */
export async function pullTrafficFromAllDeployedServers(log?: SshLog): Promise<{
  byUuid: Map<string, UserTrafficAgg>;
  errors: string[];
  warns: string[];
}> {
  const errors: string[] = [];
  const warns: string[] = [];
  const merged = new Map<string, UserTrafficAgg>();
  const servers = listDeployedServers();
  if (servers.length === 0) {
    warns.push("Нет развёрнутых серверов — нечего опрашивать.");
    return { byUuid: merged, errors, warns };
  }
  for (const row of servers) {
    try {
      const { host, byUuid, warn } = await pullTrafficFromServer(row, log);
      if (warn) warns.push(`${host}: ${warn}`);
      for (const [uuid, v] of byUuid) {
        const nk = uuid.trim().toLowerCase();
        const cur = merged.get(nk) ?? { up: 0, down: 0, online: 0 };
        cur.up += v.up;
        cur.down += v.down;
        cur.online += Math.max(0, Math.floor(Number(v.online) || 0));
        merged.set(nk, cur);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.host}: ${msg}`);
    }
  }
  return { byUuid: merged, errors, warns };
}

/** Собрать уникальные IP онлайн-сессий клиента со всех узлов. */
export async function collectOnlineIpsForUser(user: UserRow, log?: SshLog): Promise<string[]> {
  const ips: string[] = [];
  for (const row of listDeployedServers()) {
    try {
      mergeOnlineIpLists(ips, await listOnlineIpsForUserOnServer(row, user, log));
    } catch {
      /* skip node */
    }
  }
  return ips;
}

/** Суммарный трафик/онлайн с узлов для одного клиента (только чтение, без записи в БД). */
export async function peekUserTrafficFromServers(user: UserRow, log?: SshLog): Promise<UserTrafficAgg> {
  const uuid = user.vless_uuid;
  const uuidKey = uuid.trim().toLowerCase();
  const merged = new Map<string, UserTrafficAgg>();
  const onlineIps: string[] = [];
  for (const row of listDeployedServers()) {
    try {
      const { byUuid } = await pullTrafficFromServer(row, log);
      const hit = byUuid.get(uuidKey) ?? byUuid.get(uuid);
      if (hit) {
        const cur = merged.get(uuidKey) ?? { up: 0, down: 0, online: 0 };
        cur.up += hit.up;
        cur.down += hit.down;
        cur.online += Math.max(0, Math.floor(Number(hit.online) || 0));
        merged.set(uuidKey, cur);
      }
      if (isDeviceLimitActiveForUser(user)) {
        mergeOnlineIpLists(onlineIps, await listOnlineIpsForUserOnServer(row, user, log));
      }
    } catch {
      /* skip */
    }
  }
  const out = merged.get(uuidKey) ?? { up: 0, down: 0, online: 0 };
  if (isDeviceLimitActiveForUser(user) && onlineIps.length > 0) {
    out.online = Math.max(out.online, onlineIps.length);
    out.online_ips = onlineIps;
  }
  return out;
}

const subPeekCache = new Map<string, { at: number; peek: UserTrafficAgg }>();
const SUB_PEEK_TTL_MS = 28_000;
const subPeekRefreshInflight = new Set<string>();

function subscriptionPeekCacheKey(user: Pick<UserRow, "sub_token" | "id">): string {
  return String(user.sub_token ?? "").trim() || String(user.id);
}

/** Синхронный peek для GET подписки: только кэш, без SSH на критическом пути. */
export function getCachedSubscriptionPeek(user: UserRow): UserTrafficAgg | null {
  const key = subscriptionPeekCacheKey(user);
  const slot = subPeekCache.get(key);
  if (!slot || Date.now() - slot.at >= SUB_PEEK_TTL_MS) return null;
  return slot.peek;
}

/** Фоновое обновление кэша peek (не блокирует ответ /sub). */
export function scheduleSubscriptionPeekRefresh(user: UserRow, log?: SshLog): void {
  const key = subscriptionPeekCacheKey(user);
  const now = Date.now();
  const slot = subPeekCache.get(key);
  if (slot && now - slot.at < SUB_PEEK_TTL_MS) return;
  if (subPeekRefreshInflight.has(key)) return;
  subPeekRefreshInflight.add(key);
  void peekUserTrafficFromServers(user, log)
    .then((peek) => {
      subPeekCache.set(key, { at: Date.now(), peek });
    })
    .catch(() => {})
    .finally(() => {
      subPeekRefreshInflight.delete(key);
    });
}

/** Кэшированный peek для GET подписки — не SSH на каждый запрос клиента. */
export async function peekUserTrafficForSubscription(user: UserRow, log?: SshLog): Promise<UserTrafficAgg> {
  const key = subscriptionPeekCacheKey(user);
  const now = Date.now();
  const slot = subPeekCache.get(key);
  if (slot && now - slot.at < SUB_PEEK_TTL_MS) return slot.peek;
  const peek = await peekUserTrafficFromServers(user, log);
  subPeekCache.set(key, { at: now, peek });
  return peek;
}

/** Не опрашивать SSH на каждый запрос подписки (клиенты дергают URL часто). */
const SUB_TRAFFIC_SYNC_MIN_MS = 32_000;
const subTrafficLastAttempt = new Map<string, number>();
const subTrafficInflight = new Map<string, Promise<void>>();

/**
 * Обновить в БД traffic_up/down и online для одного пользователя по всем узлам.
 * Вызывать при GET подписки — тогда v2rayTun и др. видят актуальный `subscription-userinfo`.
 */
export async function refreshUserTrafficFromServersIfDue(user: UserRow, log?: SshLog): Promise<void> {
  const key = user.sub_token;
  const prevRun = subTrafficInflight.get(key);
  if (prevRun) {
    await prevRun.catch(() => {});
    return;
  }
  const now = Date.now();
  if (now - (subTrafficLastAttempt.get(key) ?? 0) < SUB_TRAFFIC_SYNC_MIN_MS) return;

  const job = (async () => {
    const uuid = user.vless_uuid;
    const uuidKey = uuid.trim().toLowerCase();
    const merged = new Map<string, UserTrafficAgg>();
    const servers = listDeployedServers();
    for (const row of servers) {
      try {
        const { byUuid } = await pullTrafficFromServer(row, log);
        const hit = byUuid.get(uuidKey) ?? byUuid.get(uuid);
        if (!hit) continue;
        const cur = merged.get(uuidKey) ?? { up: 0, down: 0, online: 0 };
        cur.up += hit.up;
        cur.down += hit.down;
        cur.online += Math.max(0, Math.floor(Number(hit.online) || 0));
        merged.set(uuidKey, cur);
      } catch {
        /* узел недоступен — пропускаем */
      }
    }
    const fresh = getUser(user.id);
    if (!fresh) return;
    const agg = merged.get(uuidKey);
    if (agg) {
      applyUsersTrafficSnapshot(
        [
          {
            vless_uuid: fresh.vless_uuid,
            traffic_up: agg.up,
            traffic_down: agg.down,
            online_count: Math.max(0, Math.floor(Number(agg.online) || 0)),
          },
        ],
        Date.now(),
      );
    } else {
      // Нет raw-снимка с узлов: не трогаем traffic_up/down, чтобы не "накручивать"
      // накопленные значения в дельту. Обновляем только онлайн-снимок и метку sync.
      updateUserRow(fresh.id, {
        online_snapshot: 0,
        online_devices: 0,
        stats_synced_at: Date.now(),
      });
    }
    subTrafficLastAttempt.set(key, Date.now());
  })();

  subTrafficInflight.set(key, job);
  try {
    await job;
  } finally {
    if (subTrafficInflight.get(key) === job) subTrafficInflight.delete(key);
  }
}
