import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TELEGRAM_PROXY_SETTINGS,
  telegramProxyConfigDir,
  telegramProxyServiceName,
  type TelegramProxyCheckRow,
  type TelegramProxyEventRow,
  type TelegramProxyRow,
  type TelegramProxySettings,
  type TelegramProxyStatus,
  type TelegramProxyType,
} from "./telegramProxiesTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const vaultPath = process.env.TELEGRAM_PROXIES_PATH ?? path.join(path.dirname(dataFile), "telegram_proxies.json");

type VaultFile = {
  next_proxy_id: number;
  next_check_id: number;
  next_event_id: number;
  proxies: TelegramProxyRow[];
  checks: TelegramProxyCheckRow[];
  events: TelegramProxyEventRow[];
  settings: TelegramProxySettings;
};

function emptyVault(): VaultFile {
  return {
    next_proxy_id: 1,
    next_check_id: 1,
    next_event_id: 1,
    proxies: [],
    checks: [],
    events: [],
    settings: { ...DEFAULT_TELEGRAM_PROXY_SETTINGS },
  };
}

function readVault(): VaultFile {
  try {
    if (!fs.existsSync(vaultPath)) return emptyVault();
    const parsed = JSON.parse(fs.readFileSync(vaultPath, "utf8")) as VaultFile;
    return {
      next_proxy_id: Math.max(1, Math.floor(Number(parsed.next_proxy_id) || 1)),
      next_check_id: Math.max(1, Math.floor(Number(parsed.next_check_id) || 1)),
      next_event_id: Math.max(1, Math.floor(Number(parsed.next_event_id) || 1)),
      proxies: (parsed.proxies ?? []).map(normalizeProxy).filter((x): x is TelegramProxyRow => x != null),
      checks: (parsed.checks ?? []).map(normalizeCheck).filter((x): x is TelegramProxyCheckRow => x != null),
      events: (parsed.events ?? []).map(normalizeEvent).filter((x): x is TelegramProxyEventRow => x != null),
      settings: normalizeSettings(parsed.settings),
    };
  } catch {
    return emptyVault();
  }
}

function writeVault(v: VaultFile): void {
  const dir = path.dirname(vaultPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${vaultPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), "utf8");
  fs.renameSync(tmp, vaultPath);
}

function mutateVault(fn: (v: VaultFile) => void): void {
  const v = readVault();
  fn(v);
  writeVault(v);
}

function normalizeProxyType(raw: unknown): TelegramProxyType | null {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "mtproto" || t === "socks5" || t === "http") return t;
  return null;
}

function normalizeStatus(raw: unknown): TelegramProxyStatus {
  const s = String(raw ?? "unknown").trim().toLowerCase();
  if (
    s === "available" ||
    s === "unavailable" ||
    s === "auth_error" ||
    s === "timeout" ||
    s === "checking"
  ) {
    return s;
  }
  return "unknown";
}

function normalizeProxy(raw: unknown): TelegramProxyRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Math.floor(Number(o.id));
  const server_id = Math.floor(Number(o.server_id));
  const type = normalizeProxyType(o.type);
  const port = Math.floor(Number(o.port));
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(server_id) || server_id <= 0 || !type) return null;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  const notified = o.last_notified_status != null ? normalizeStatus(o.last_notified_status) : null;
  return {
    id,
    server_id,
    name: String(o.name ?? "").trim().slice(0, 120) || `Прокси #${id}`,
    type,
    host: String(o.host ?? "").trim().slice(0, 255),
    port,
    username: String(o.username ?? "").slice(0, 120),
    password: String(o.password ?? "").slice(0, 200),
    secret: String(o.secret ?? "").slice(0, 256),
    auth_enabled: !(o.auth_enabled === false || o.auth_enabled === 0 || o.auth_enabled === "0"),
    active: !(o.active === false || o.active === 0 || o.active === "0"),
    status: normalizeStatus(o.status),
    last_check_at: o.last_check_at != null ? String(o.last_check_at) : null,
    last_latency_ms: Number.isFinite(Number(o.last_latency_ms)) ? Math.max(0, Math.floor(Number(o.last_latency_ms))) : null,
    last_error: o.last_error != null ? String(o.last_error).slice(0, 500) : null,
    service_name: String(o.service_name ?? "").trim() || telegramProxyServiceName(id),
    config_path: String(o.config_path ?? "").trim() || telegramProxyConfigDir(id),
    last_notified_status: notified === "unknown" || notified === "checking" ? null : notified,
    created_at: String(o.created_at ?? new Date().toISOString()),
    updated_at: String(o.updated_at ?? o.created_at ?? new Date().toISOString()),
    deleted_at: o.deleted_at != null ? String(o.deleted_at) : null,
  };
}

function normalizeCheck(raw: unknown): TelegramProxyCheckRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Math.floor(Number(o.id));
  const proxy_id = Math.floor(Number(o.proxy_id));
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(proxy_id) || proxy_id <= 0) return null;
  const trig = String(o.triggered_by ?? "manual").trim().toLowerCase();
  return {
    id,
    proxy_id,
    checked_at: String(o.checked_at ?? new Date().toISOString()),
    status: normalizeStatus(o.status),
    latency_ms: Number.isFinite(Number(o.latency_ms)) ? Math.max(0, Math.floor(Number(o.latency_ms))) : null,
    error_message: o.error_message != null ? String(o.error_message).slice(0, 500) : null,
    triggered_by: trig === "auto" ? "auto" : "manual",
    notification_sent: o.notification_sent === true || o.notification_sent === 1,
  };
}

function normalizeEvent(raw: unknown): TelegramProxyEventRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Math.floor(Number(o.id));
  if (!Number.isFinite(id) || id <= 0) return null;
  const proxy_id = o.proxy_id != null ? Math.floor(Number(o.proxy_id)) : null;
  const server_id = o.server_id != null ? Math.floor(Number(o.server_id)) : null;
  return {
    id,
    proxy_id: proxy_id != null && proxy_id > 0 ? proxy_id : null,
    server_id: server_id != null && server_id > 0 ? server_id : null,
    event_type: String(o.event_type ?? "info").slice(0, 80),
    message: String(o.message ?? "").slice(0, 2000),
    created_at: String(o.created_at ?? new Date().toISOString()),
  };
}

function normalizeSettings(raw: unknown): TelegramProxySettings {
  const base = { ...DEFAULT_TELEGRAM_PROXY_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    auto_check_enabled: !(o.auto_check_enabled === false || o.auto_check_enabled === 0),
    interval_minutes: Math.min(1440, Math.max(1, Math.floor(Number(o.interval_minutes) || base.interval_minutes))),
    attempts_per_check: Math.min(10, Math.max(1, Math.floor(Number(o.attempts_per_check) || base.attempts_per_check))),
    attempt_timeout_sec: Math.min(60, Math.max(3, Math.floor(Number(o.attempt_timeout_sec) || base.attempt_timeout_sec))),
    notify_on_unavailable: !(o.notify_on_unavailable === false || o.notify_on_unavailable === 0),
    notify_on_recovery: !(o.notify_on_recovery === false || o.notify_on_recovery === 0),
    notify_cooldown_minutes: Math.min(240, Math.max(5, Math.floor(Number(o.notify_cooldown_minutes) || base.notify_cooldown_minutes))),
    last_auto_run_at: o.last_auto_run_at != null ? String(o.last_auto_run_at) : null,
  };
}

export function getTelegramProxySettings(): TelegramProxySettings {
  return readVault().settings;
}

export function setTelegramProxySettings(patch: Partial<TelegramProxySettings>): TelegramProxySettings {
  let out = getTelegramProxySettings();
  mutateVault((v) => {
    v.settings = normalizeSettings({ ...v.settings, ...patch });
    out = v.settings;
  });
  return out;
}

export function listTelegramProxies(opts?: { server_id?: number; include_deleted?: boolean }): TelegramProxyRow[] {
  let rows = readVault().proxies;
  if (!opts?.include_deleted) rows = rows.filter((p) => !p.deleted_at);
  if (opts?.server_id != null && opts.server_id > 0) {
    rows = rows.filter((p) => p.server_id === opts.server_id);
  }
  return [...rows].sort((a, b) => b.id - a.id);
}

export function getTelegramProxy(id: number): TelegramProxyRow | undefined {
  return listTelegramProxies({ include_deleted: true }).find((p) => p.id === id && !p.deleted_at);
}

export function getTelegramProxyIncludingDeleted(id: number): TelegramProxyRow | undefined {
  return readVault().proxies.find((p) => p.id === id);
}

export function createTelegramProxyRow(
  input: Omit<
    TelegramProxyRow,
    "id" | "status" | "last_check_at" | "last_latency_ms" | "last_error" | "last_notified_status" | "created_at" | "updated_at" | "deleted_at" | "service_name" | "config_path"
  >,
): TelegramProxyRow {
  let row: TelegramProxyRow | null = null;
  mutateVault((v) => {
    const id = v.next_proxy_id++;
    row = normalizeProxy({
      ...input,
      id,
      status: "unknown",
      last_check_at: null,
      last_latency_ms: null,
      last_error: null,
      last_notified_status: null,
      service_name: telegramProxyServiceName(id),
      config_path: telegramProxyConfigDir(id),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    })!;
    v.proxies.push(row);
  });
  return row!;
}

export function updateTelegramProxyRow(id: number, patch: Partial<TelegramProxyRow>): TelegramProxyRow | null {
  let out: TelegramProxyRow | null = null;
  mutateVault((v) => {
    const idx = v.proxies.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const merged = normalizeProxy({
      ...v.proxies[idx],
      ...patch,
      id,
      updated_at: new Date().toISOString(),
    });
    if (!merged) return;
    v.proxies[idx] = merged;
    out = merged;
  });
  return out;
}

export function softDeleteTelegramProxyRow(id: number): TelegramProxyRow | null {
  return updateTelegramProxyRow(id, { deleted_at: new Date().toISOString(), active: false });
}

export function softDeleteProxiesForServer(serverId: number): number {
  const proxies = listTelegramProxies({ server_id: serverId });
  for (const p of proxies) {
    softDeleteTelegramProxyRow(p.id);
  }
  return proxies.length;
}

export function appendTelegramProxyCheck(
  input: Omit<TelegramProxyCheckRow, "id">,
): TelegramProxyCheckRow {
  let row: TelegramProxyCheckRow | null = null;
  mutateVault((v) => {
    const id = v.next_check_id++;
    row = normalizeCheck({ ...input, id })!;
    v.checks.push(row);
    if (v.checks.length > 50000) v.checks = v.checks.slice(-40000);
  });
  return row!;
}

export function listTelegramProxyChecks(proxyId?: number, limit = 100): TelegramProxyCheckRow[] {
  let rows = readVault().checks;
  if (proxyId != null && proxyId > 0) rows = rows.filter((c) => c.proxy_id === proxyId);
  return [...rows].sort((a, b) => b.id - a.id).slice(0, Math.max(1, limit));
}

export function appendTelegramProxyEvent(
  input: Omit<TelegramProxyEventRow, "id" | "created_at">,
): TelegramProxyEventRow {
  let row: TelegramProxyEventRow | null = null;
  mutateVault((v) => {
    const id = v.next_event_id++;
    row = normalizeEvent({
      ...input,
      id,
      created_at: new Date().toISOString(),
    })!;
    v.events.push(row);
    if (v.events.length > 20000) v.events = v.events.slice(-15000);
  });
  return row!;
}

export function listTelegramProxyEvents(limit = 200): TelegramProxyEventRow[] {
  return [...readVault().events].sort((a, b) => b.id - a.id).slice(0, Math.max(1, limit));
}

export function countProxiesByServer(serverId: number): number {
  return listTelegramProxies({ server_id: serverId }).length;
}
