import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONFIG_VAULT_SETTINGS,
  type ConfigVaultSettings,
  type ConfigVaultSubscriptionMode,
  type VlessCheckStatus,
  type VlessKeyCheckRow,
  type VlessKeyRow,
} from "./configVaultTypes.js";
import { defaultNameFromUri, maskProxyUri, parseProxyUri } from "./configVaultUri.js";
import { isValidConfigVaultUri } from "./extraVless.js";
import type { UserRow } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const vaultPath = process.env.CONFIG_VAULT_PATH ?? path.join(path.dirname(dataFile), "config_vault.json");

function normalizeSubscriptionMode(raw: unknown): ConfigVaultSubscriptionMode {
  const v = String(raw ?? "all").trim().toLowerCase();
  return v === "selected" ? "selected" : "all";
}

function normalizeUserIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const id = Math.floor(Number(x));
    if (Number.isFinite(id) && id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

function usersCountLabel(n: number): string {
  if (n === 0) return "0 пользователей";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} пользователь`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} пользователя`;
  return `${n} пользователей`;
}

type VaultFile = {
  next_key_id: number;
  next_check_id: number;
  keys: VlessKeyRow[];
  checks: VlessKeyCheckRow[];
  settings: ConfigVaultSettings;
};

function emptyVault(): VaultFile {
  return {
    next_key_id: 1,
    next_check_id: 1,
    keys: [],
    checks: [],
    settings: { ...DEFAULT_CONFIG_VAULT_SETTINGS },
  };
}

function normalizeSettings(raw: unknown): ConfigVaultSettings {
  const base = { ...DEFAULT_CONFIG_VAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const interval = Math.floor(Number(o.interval_minutes) || base.interval_minutes);
  const attempts = Math.floor(Number(o.attempts_per_check) || base.attempts_per_check);
  const timeout = Math.floor(Number(o.attempt_timeout_sec) || base.attempt_timeout_sec);
  const cooldown = Math.floor(Number(o.notify_cooldown_minutes) || base.notify_cooldown_minutes);
  const testUrl = String(o.test_url ?? base.test_url).trim() || base.test_url;
  return {
    auto_check_enabled: o.auto_check_enabled === true || o.auto_check_enabled === 1 || o.auto_check_enabled === "1",
    interval_minutes: Math.min(1440, Math.max(1, interval)),
    attempts_per_check: Math.min(10, Math.max(1, attempts)),
    attempt_timeout_sec: Math.min(60, Math.max(3, timeout)),
    test_url: testUrl.slice(0, 500),
    notify_on_unavailable: !(o.notify_on_unavailable === false || o.notify_on_unavailable === 0),
    notify_on_recovery: !(o.notify_on_recovery === false || o.notify_on_recovery === 0),
    notify_cooldown_minutes: Math.min(240, Math.max(5, cooldown)),
    last_auto_run_at: o.last_auto_run_at != null ? String(o.last_auto_run_at) : null,
  };
}

function normalizeKey(raw: unknown): VlessKeyRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Math.floor(Number(o.id));
  const raw_uri = String(o.raw_uri ?? "").trim();
  if (!Number.isFinite(id) || id <= 0 || !isValidConfigVaultUri(raw_uri)) return null;
  const parsed = parseProxyUri(raw_uri);
  if (!parsed) return null;
  const statusRaw = String(o.last_check_status ?? "never").trim().toLowerCase();
  const last_check_status: VlessCheckStatus =
    statusRaw === "available" ||
    statusRaw === "unavailable" ||
    statusRaw === "unstable" ||
    statusRaw === "checking"
      ? statusRaw
      : "never";
  const notifiedRaw = o.last_notified_status != null ? String(o.last_notified_status).trim().toLowerCase() : "";
  const last_notified_status: VlessCheckStatus | null =
    notifiedRaw === "available" || notifiedRaw === "unavailable" || notifiedRaw === "unstable"
      ? notifiedRaw
      : null;
  const subscription_mode = normalizeSubscriptionMode(o.subscription_mode);
  const subscription_user_ids = normalizeUserIds(o.subscription_user_ids);
  return {
    id,
    name: String(o.name ?? "").trim().slice(0, 120) || defaultNameFromUri(raw_uri),
    raw_uri,
    masked_uri: String(o.masked_uri ?? "").trim() || maskProxyUri(raw_uri),
    active: !(o.active === false || o.active === 0 || o.active === "0"),
    added_to_subscriptions:
      o.added_to_subscriptions === true || o.added_to_subscriptions === 1 || o.added_to_subscriptions === "1",
    subscription_mode,
    subscription_user_ids: subscription_mode === "selected" ? subscription_user_ids : [],
    last_check_at: o.last_check_at != null ? String(o.last_check_at) : null,
    last_check_status,
    last_check_latency_ms: Number.isFinite(Number(o.last_check_latency_ms))
      ? Math.max(0, Math.floor(Number(o.last_check_latency_ms)))
      : null,
    last_error: o.last_error != null ? String(o.last_error).slice(0, 500) : null,
    unavailable_since: o.unavailable_since != null ? String(o.unavailable_since) : null,
    notify_on_fail: !(o.notify_on_fail === false || o.notify_on_fail === 0 || o.notify_on_fail === "0"),
    last_notified_status,
    last_notify_at: o.last_notify_at != null ? String(o.last_notify_at) : null,
    parsed_address: parsed.address,
    parsed_port: parsed.port,
    parsed_uuid: parsed.uuid,
    parsed_network: parsed.network,
    parsed_security: parsed.security,
    parsed_flow: parsed.flow,
    parsed_sni: parsed.sni,
    parsed_fingerprint: parsed.fingerprint,
    parsed_public_key: parsed.publicKey,
    parsed_short_id: parsed.shortId,
    created_at: String(o.created_at ?? new Date().toISOString()),
    updated_at: String(o.updated_at ?? o.created_at ?? new Date().toISOString()),
  };
}

function normalizeCheck(raw: unknown): VlessKeyCheckRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Math.floor(Number(o.id));
  const key_id = Math.floor(Number(o.key_id));
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(key_id) || key_id <= 0) return null;
  const st = String(o.status ?? "").trim().toLowerCase();
  if (st !== "available" && st !== "unavailable" && st !== "unstable") return null;
  const trig = String(o.triggered_by ?? "manual").trim().toLowerCase();
  return {
    id,
    key_id,
    checked_at: String(o.checked_at ?? new Date().toISOString()),
    attempts_total: Math.max(1, Math.floor(Number(o.attempts_total) || 5)),
    attempts_success: Math.max(0, Math.floor(Number(o.attempts_success) || 0)),
    attempts_failed: Math.max(0, Math.floor(Number(o.attempts_failed) || 0)),
    avg_latency_ms: Number.isFinite(Number(o.avg_latency_ms)) ? Math.floor(Number(o.avg_latency_ms)) : null,
    min_latency_ms: Number.isFinite(Number(o.min_latency_ms)) ? Math.floor(Number(o.min_latency_ms)) : null,
    max_latency_ms: Number.isFinite(Number(o.max_latency_ms)) ? Math.floor(Number(o.max_latency_ms)) : null,
    status: st,
    error_message: o.error_message != null ? String(o.error_message).slice(0, 500) : null,
    triggered_by: trig === "auto" ? "auto" : "manual",
    notification_sent: o.notification_sent === true || o.notification_sent === 1 || o.notification_sent === "1",
  };
}

function readVault(): VaultFile {
  try {
    if (!fs.existsSync(vaultPath)) return emptyVault();
    const parsed = JSON.parse(fs.readFileSync(vaultPath, "utf8")) as Partial<VaultFile>;
    const keys = (Array.isArray(parsed.keys) ? parsed.keys : [])
      .map((x) => normalizeKey(x))
      .filter((x): x is VlessKeyRow => x != null);
    const checks = (Array.isArray(parsed.checks) ? parsed.checks : [])
      .map((x) => normalizeCheck(x))
      .filter((x): x is VlessKeyCheckRow => x != null);
    return {
      next_key_id: Number(parsed.next_key_id) > 0 ? Number(parsed.next_key_id) : 1,
      next_check_id: Number(parsed.next_check_id) > 0 ? Number(parsed.next_check_id) : 1,
      keys,
      checks,
      settings: normalizeSettings(parsed.settings),
    };
  } catch (e) {
    console.error("[config-vault] read failed:", e instanceof Error ? e.message : e);
    return emptyVault();
  }
}

function writeVault(vault: VaultFile): void {
  fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
  const tmp = `${vaultPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), "utf8");
  fs.renameSync(tmp, vaultPath);
}

function mutateVault(fn: (v: VaultFile) => void): void {
  const v = readVault();
  fn(v);
  writeVault(v);
}

export function listConfigVaultKeys(): VlessKeyRow[] {
  return [...readVault().keys].sort((a, b) => b.id - a.id);
}

export function getConfigVaultKey(id: number): VlessKeyRow | undefined {
  return readVault().keys.find((k) => k.id === id);
}

export function getConfigVaultSettings(): ConfigVaultSettings {
  return readVault().settings;
}

export function saveConfigVaultSettings(patch: Partial<ConfigVaultSettings>): ConfigVaultSettings {
  let out = getConfigVaultSettings();
  mutateVault((v) => {
    v.settings = normalizeSettings({ ...v.settings, ...patch });
    out = v.settings;
  });
  return out;
}

export function configVaultStats(): {
  total: number;
  in_subscriptions: number;
  available: number;
  unavailable: number;
  unstable: number;
  never: number;
  last_auto_run_at: string | null;
} {
  const keys = listConfigVaultKeys();
  const settings = getConfigVaultSettings();
  return {
    total: keys.length,
    in_subscriptions: keys.filter((k) => k.added_to_subscriptions).length,
    available: keys.filter((k) => k.last_check_status === "available").length,
    unavailable: keys.filter((k) => k.last_check_status === "unavailable").length,
    unstable: keys.filter((k) => k.last_check_status === "unstable").length,
    never: keys.filter((k) => k.last_check_status === "never").length,
    last_auto_run_at: settings.last_auto_run_at,
  };
}

export function subscriptionUrisFromVault(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of listConfigVaultKeys()) {
    if (!k.active || !k.added_to_subscriptions) continue;
    const uri = k.raw_uri.trim();
    const key = uri.toLowerCase();
    if (!uri || seen.has(key)) continue;
    seen.add(key);
    out.push(uri);
  }
  return out;
}

export function userReceivesConfigVaultKey(userId: number, key: VlessKeyRow): boolean {
  if (!key.active || !key.added_to_subscriptions) return false;
  if (key.subscription_mode === "all") return true;
  return key.subscription_user_ids.includes(userId);
}

export function subscriptionVaultUrisForUser(user: UserRow): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of listConfigVaultKeys()) {
    if (!userReceivesConfigVaultKey(user.id, k)) continue;
    const uri = k.raw_uri.trim();
    const key = uri.toLowerCase();
    if (!uri || seen.has(key)) continue;
    seen.add(key);
    out.push(uri);
  }
  return out;
}

export function subscriptionUsersCount(key: VlessKeyRow): number {
  if (!key.added_to_subscriptions) return 0;
  if (key.subscription_mode === "all") return 0;
  return key.subscription_user_ids.length;
}

export function configVaultSubscriptionLabel(key: VlessKeyRow): string {
  if (!key.added_to_subscriptions) return "—";
  if (key.subscription_mode === "all") return "Всем пользователям";
  return usersCountLabel(key.subscription_user_ids.length);
}

function rowFromUri(
  id: number,
  name: string,
  raw_uri: string,
  opts: {
    active?: boolean;
    notify_on_fail?: boolean;
    added_to_subscriptions?: boolean;
    subscription_mode?: ConfigVaultSubscriptionMode;
    subscription_user_ids?: number[];
  },
): VlessKeyRow {
  const parsed = parseProxyUri(raw_uri)!;
  const now = new Date().toISOString();
  const subscription_mode = opts.subscription_mode ?? "all";
  const subscription_user_ids =
    subscription_mode === "selected" ? normalizeUserIds(opts.subscription_user_ids) : [];
  return {
    id,
    name: name.trim().slice(0, 120) || defaultNameFromUri(raw_uri),
    raw_uri,
    masked_uri: maskProxyUri(raw_uri),
    active: opts.active !== false,
    added_to_subscriptions: opts.added_to_subscriptions === true,
    subscription_mode,
    subscription_user_ids,
    last_check_at: null,
    last_check_status: "never",
    last_check_latency_ms: null,
    last_error: null,
    unavailable_since: null,
    notify_on_fail: opts.notify_on_fail !== false,
    last_notified_status: null,
    last_notify_at: null,
    parsed_address: parsed.address,
    parsed_port: parsed.port,
    parsed_uuid: parsed.uuid,
    parsed_network: parsed.network,
    parsed_security: parsed.security,
    parsed_flow: parsed.flow,
    parsed_sni: parsed.sni,
    parsed_fingerprint: parsed.fingerprint,
    parsed_public_key: parsed.publicKey,
    parsed_short_id: parsed.shortId,
    created_at: now,
    updated_at: now,
  };
}

export function createConfigVaultKey(input: {
  name: string;
  raw_uri: string;
  active?: boolean;
  notify_on_fail?: boolean;
  subscription_mode?: ConfigVaultSubscriptionMode;
  subscription_user_ids?: number[];
}): VlessKeyRow {
  const uri = input.raw_uri.trim();
  const existing = listConfigVaultKeys().map((k) => k.raw_uri);
  if (existing.some((x) => x.trim().toLowerCase() === uri.toLowerCase())) {
    throw new Error("Такой ключ уже есть в хранилище");
  }
  const parsed = parseProxyUri(uri);
  if (!parsed) throw new Error("Некорректная ссылка");
  let created!: VlessKeyRow;
  mutateVault((v) => {
    const id = v.next_key_id++;
    created = rowFromUri(id, input.name, uri, {
      active: input.active,
      notify_on_fail: input.notify_on_fail,
      subscription_mode: input.subscription_mode,
      subscription_user_ids: input.subscription_user_ids,
    });
    v.keys.push(created);
  });
  return created!;
}

export function updateConfigVaultKey(
  id: number,
  patch: {
    name?: string;
    raw_uri?: string;
    active?: boolean;
    notify_on_fail?: boolean;
    subscription_mode?: ConfigVaultSubscriptionMode;
    subscription_user_ids?: number[];
  },
): VlessKeyRow {
  let updated!: VlessKeyRow;
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === id);
    if (idx < 0) throw new Error("Ключ не найден");
    const cur = v.keys[idx]!;
    const raw_uri = patch.raw_uri != null ? patch.raw_uri.trim() : cur.raw_uri;
    if (patch.raw_uri != null) {
      const dup = v.keys.some((k) => k.id !== id && k.raw_uri.trim().toLowerCase() === raw_uri.toLowerCase());
      if (dup) throw new Error("Такой ключ уже есть в хранилище");
      const parsed = parseProxyUri(raw_uri);
      if (!parsed) throw new Error("Некорректная ссылка");
    }
    const parsed = parseProxyUri(raw_uri)!;
    let subscription_mode = patch.subscription_mode ?? cur.subscription_mode;
    let subscription_user_ids = cur.subscription_user_ids;
    if (patch.subscription_mode !== undefined || patch.subscription_user_ids !== undefined) {
      subscription_mode = patch.subscription_mode ?? cur.subscription_mode;
      subscription_user_ids =
        subscription_mode === "selected"
          ? normalizeUserIds(patch.subscription_user_ids ?? cur.subscription_user_ids)
          : [];
    }
    updated = {
      ...cur,
      name: patch.name != null ? patch.name.trim().slice(0, 120) || cur.name : cur.name,
      raw_uri,
      masked_uri: maskProxyUri(raw_uri),
      active: patch.active !== undefined ? patch.active !== false : cur.active,
      notify_on_fail: patch.notify_on_fail !== undefined ? patch.notify_on_fail !== false : cur.notify_on_fail,
      subscription_mode,
      subscription_user_ids,
      parsed_address: parsed.address,
      parsed_port: parsed.port,
      parsed_uuid: parsed.uuid,
      parsed_network: parsed.network,
      parsed_security: parsed.security,
      parsed_flow: parsed.flow,
      parsed_sni: parsed.sni,
      parsed_fingerprint: parsed.fingerprint,
      parsed_public_key: parsed.publicKey,
      parsed_short_id: parsed.shortId,
      updated_at: new Date().toISOString(),
    };
    v.keys[idx] = updated;
  });
  return updated!;
}

export function deleteConfigVaultKey(id: number): void {
  mutateVault((v) => {
    v.keys = v.keys.filter((k) => k.id !== id);
    v.checks = v.checks.filter((c) => c.key_id !== id);
  });
}

export function setConfigVaultKeyInSubscriptions(id: number, added: boolean): VlessKeyRow {
  let row!: VlessKeyRow;
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === id);
    if (idx < 0) throw new Error("Ключ не найден");
    v.keys[idx] = {
      ...v.keys[idx]!,
      added_to_subscriptions: added,
      updated_at: new Date().toISOString(),
    };
    row = v.keys[idx]!;
  });
  return row!;
}

export function setConfigVaultSubscriptionTargets(
  id: number,
  mode: ConfigVaultSubscriptionMode,
  userIds?: number[],
): VlessKeyRow {
  return updateConfigVaultKey(id, {
    subscription_mode: mode,
    subscription_user_ids: userIds,
  });
}

export function setConfigVaultKeyChecking(id: number): void {
  mutateVault((v) => {
    const k = v.keys.find((x) => x.id === id);
    if (!k) return;
    k.last_check_status = "checking";
    k.updated_at = new Date().toISOString();
  });
}

export function applyConfigVaultCheckResult(
  keyId: number,
  result: {
    status: "available" | "unavailable" | "unstable";
    attempts_total: number;
    attempts_success: number;
    attempts_failed: number;
    avg_latency_ms: number | null;
    min_latency_ms: number | null;
    max_latency_ms: number | null;
    error_message: string | null;
    triggered_by: "manual" | "auto";
    notification_sent: boolean;
  },
): { key: VlessKeyRow; check: VlessKeyCheckRow; prev_status: VlessCheckStatus } {
  let key!: VlessKeyRow;
  let check!: VlessKeyCheckRow;
  let prev_status: VlessCheckStatus = "never";
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === keyId);
    if (idx < 0) throw new Error("Ключ не найден");
    const cur = v.keys[idx]!;
    prev_status = cur.last_check_status;
    const now = new Date().toISOString();
    const wasUnavailable = cur.last_check_status === "unavailable";
    const isUnavailable = result.status === "unavailable";
    v.keys[idx] = {
      ...cur,
      last_check_at: now,
      last_check_status: result.status,
      last_check_latency_ms: result.avg_latency_ms,
      last_error: result.error_message,
      unavailable_since: isUnavailable
        ? wasUnavailable && cur.unavailable_since
          ? cur.unavailable_since
          : now
        : null,
      updated_at: now,
    };
    key = v.keys[idx]!;
    const checkId = v.next_check_id++;
    check = {
      id: checkId,
      key_id: keyId,
      checked_at: now,
      attempts_total: result.attempts_total,
      attempts_success: result.attempts_success,
      attempts_failed: result.attempts_failed,
      avg_latency_ms: result.avg_latency_ms,
      min_latency_ms: result.min_latency_ms,
      max_latency_ms: result.max_latency_ms,
      status: result.status,
      error_message: result.error_message,
      triggered_by: result.triggered_by,
      notification_sent: result.notification_sent,
    };
    v.checks.unshift(check);
    if (v.checks.length > 5000) v.checks.length = 5000;
  });
  return { key, check, prev_status };
}

export function updateConfigVaultNotifyState(
  keyId: number,
  patch: { last_notified_status: VlessCheckStatus | null; last_notify_at: string | null },
): void {
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === keyId);
    if (idx < 0) return;
    v.keys[idx] = {
      ...v.keys[idx]!,
      last_notified_status: patch.last_notified_status,
      last_notify_at: patch.last_notify_at,
      updated_at: new Date().toISOString(),
    };
  });
}

export function listConfigVaultChecks(keyId: number, limit = 50): VlessKeyCheckRow[] {
  return readVault()
    .checks.filter((c) => c.key_id === keyId)
    .sort((a, b) => (a.checked_at < b.checked_at ? 1 : -1))
    .slice(0, Math.min(100, Math.max(1, limit)));
}

export function purgeConfigVaultChecksOlderThanDays(days: number): number {
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  mutateVault((v) => {
    const before = v.checks.length;
    v.checks = v.checks.filter((c) => {
      const t = Date.parse(c.checked_at);
      return Number.isFinite(t) && t >= cutoff;
    });
    removed = before - v.checks.length;
  });
  return removed;
}

export function importConfigVaultKeys(
  lines: string[],
  opts: { name_prefix?: string; active?: boolean; notify_on_fail?: boolean },
): { added: number; skipped_duplicates: number; errors: string[] } {
  const prefix = String(opts.name_prefix ?? "").trim();
  let added = 0;
  let skipped_duplicates = 0;
  const errors: string[] = [];
  mutateVault((v) => {
    const seen = new Set(v.keys.map((k) => k.raw_uri.trim().toLowerCase()));
    let n = 0;
    for (const line of lines) {
      const uri = line.trim();
      if (!uri) continue;
      n += 1;
      if (!isValidConfigVaultUri(uri)) {
        errors.push(`Строка ${n}: некорректная ссылка (vless://, trojan://, hysteria2://)`);
        continue;
      }
      const parsed = parseProxyUri(uri);
      if (!parsed) {
        errors.push(`Строка ${n}: не удалось разобрать ссылку`);
        continue;
      }
      const key = uri.toLowerCase();
      if (seen.has(key)) {
        skipped_duplicates += 1;
        continue;
      }
      seen.add(key);
      const id = v.next_key_id++;
      const name = prefix
        ? `${prefix} ${n}`.slice(0, 120)
        : defaultNameFromUri(uri, `Ключ ${id}`);
      v.keys.push(
        rowFromUri(id, name, uri, {
          active: opts.active,
          notify_on_fail: opts.notify_on_fail,
        }),
      );
      added += 1;
    }
  });
  return { added, skipped_duplicates, errors };
}

/** Ответ API: без raw_uri по умолчанию. */
export function vaultKeyForApi(k: VlessKeyRow, includeRaw = false): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...k,
    subscription_users_count: subscriptionUsersCount(k),
    subscription_label: configVaultSubscriptionLabel(k),
  };
  if (!includeRaw) {
    delete base.raw_uri;
    delete base.parsed_uuid;
    delete base.parsed_public_key;
    delete base.parsed_short_id;
  }
  return base;
}
