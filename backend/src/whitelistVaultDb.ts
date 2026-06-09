import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VlessCheckStatus } from "./configVaultTypes.js";
import type { UserRow } from "./db.js";
import { listUsers, updateUserRow, userHasActiveSubscription } from "./db.js";
import { defaultNameFromUri, maskProxyUri, parseProxyUri, setProxyUriRemark } from "./configVaultUri.js";
import { isValidWhitelistVaultUri } from "./extraVless.js";
import {
  DEFAULT_WHITELIST_VAULT_SETTINGS,
  type WhitelistAssignmentMode,
  type WhitelistKeyCheckRow,
  type WhitelistKeyRow,
  type WhitelistSourceType,
  type WhitelistVaultSettings,
  type WhiteListPurchaseRow,
  type WhiteListPurchaseStatus,
} from "./whitelistVaultTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const vaultPath =
  process.env.WHITELIST_VAULT_PATH ?? path.join(path.dirname(dataFile), "whitelist_vault.json");

type VaultFile = {
  next_key_id: number;
  next_check_id: number;
  next_purchase_id: number;
  keys: WhitelistKeyRow[];
  checks: WhitelistKeyCheckRow[];
  purchases: WhiteListPurchaseRow[];
  settings: WhitelistVaultSettings;
};

function emptyVault(): VaultFile {
  return {
    next_key_id: 1,
    next_check_id: 1,
    next_purchase_id: 1,
    keys: [],
    checks: [],
    purchases: [],
    settings: { ...DEFAULT_WHITELIST_VAULT_SETTINGS },
  };
}

function normalizeAssignmentMode(raw: unknown): WhitelistAssignmentMode {
  const v = String(raw ?? "none").trim().toLowerCase();
  if (v === "all" || v === "selected") return v;
  return "none";
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

function normalizePurchaseSettings(raw: unknown): WhitelistVaultSettings["purchase"] {
  const base = { ...DEFAULT_WHITELIST_VAULT_SETTINGS.purchase };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const durationRaw = String(o.duration ?? base.duration).trim().toLowerCase();
  const duration =
    durationRaw === "30_days" || durationRaw === "forever" ? durationRaw : ("subscription_end" as const);
  return {
    sale_enabled: o.sale_enabled === true || o.sale_enabled === 1 || o.sale_enabled === "1",
    price_rub: Math.max(0, Math.floor(Number(o.price_rub) || 0)),
    duration,
    miniapp_description: String(o.miniapp_description ?? base.miniapp_description).slice(0, 2000),
    bot_description: String(o.bot_description ?? base.bot_description).slice(0, 2000),
    issue_unavailable_keys: o.issue_unavailable_keys === true || o.issue_unavailable_keys === 1,
  };
}

function normalizeInstructionSettings(raw: unknown): WhitelistVaultSettings["instruction"] {
  const base = { ...DEFAULT_WHITELIST_VAULT_SETTINGS.instruction };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const photo = o.photo_path != null ? String(o.photo_path).trim() : "";
  return {
    title: String(o.title ?? base.title).slice(0, 200),
    text: String(o.text ?? base.text).slice(0, 8000),
    photo_path: photo || null,
  };
}

function normalizeSettings(raw: unknown): WhitelistVaultSettings {
  const base = { ...DEFAULT_WHITELIST_VAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const interval = Math.floor(Number(o.interval_minutes) || base.interval_minutes);
  const attempts = Math.floor(Number(o.attempts_per_check) || base.attempts_per_check);
  const timeout = Math.floor(Number(o.attempt_timeout_sec) || base.attempt_timeout_sec);
  const cooldown = Math.floor(Number(o.notify_cooldown_minutes) || base.notify_cooldown_minutes);
  const testUrl = String(o.test_url ?? base.test_url).trim() || base.test_url;
  return {
    enabled: o.enabled === true || o.enabled === 1 || o.enabled === "1",
    auto_check_enabled: o.auto_check_enabled === true || o.auto_check_enabled === 1 || o.auto_check_enabled === "1",
    interval_minutes: Math.min(1440, Math.max(1, interval)),
    attempts_per_check: Math.min(10, Math.max(1, attempts)),
    attempt_timeout_sec: Math.min(60, Math.max(3, timeout)),
    test_url: testUrl.slice(0, 500),
    notify_on_unavailable: !(o.notify_on_unavailable === false || o.notify_on_unavailable === 0),
    notify_cooldown_minutes: Math.min(240, Math.max(5, cooldown)),
    last_auto_run_at: o.last_auto_run_at != null ? String(o.last_auto_run_at) : null,
    purchase: normalizePurchaseSettings(o.purchase),
    instruction: normalizeInstructionSettings(o.instruction),
  };
}

function normalizePurchase(raw: unknown): WhiteListPurchaseRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const userId = Math.floor(Number(o.user_id));
  const paymentId = String(o.payment_id ?? "").trim();
  if (!id || !Number.isFinite(userId) || userId <= 0 || !paymentId) return null;
  const stRaw = String(o.status ?? "pending").trim().toLowerCase();
  const status: WhiteListPurchaseStatus =
    stRaw === "paid" || stRaw === "failed" || stRaw === "refunded" ? stRaw : "pending";
  return {
    id,
    user_id: userId,
    user_name: String(o.user_name ?? "").trim() || `#${userId}`,
    tg_id: String(o.tg_id ?? "").trim(),
    payment_id: paymentId,
    amount: Math.max(0, Math.floor(Number(o.amount) || 0)),
    status,
    activated_at: o.activated_at != null ? String(o.activated_at) : null,
    expires_at: o.expires_at != null ? String(o.expires_at) : null,
    instruction_sent: o.instruction_sent === true || o.instruction_sent === 1,
    instruction_error: o.instruction_error != null ? String(o.instruction_error).slice(0, 500) : null,
    activation_error: o.activation_error != null ? String(o.activation_error).slice(0, 500) : null,
    created_at: String(o.created_at ?? new Date().toISOString()),
    updated_at: String(o.updated_at ?? o.created_at ?? new Date().toISOString()),
  };
}

function normalizeKey(raw: unknown): WhitelistKeyRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Math.floor(Number(o.id));
  const raw_uri = String(o.raw_uri ?? "").trim();
  if (!Number.isFinite(id) || id <= 0 || !isValidWhitelistVaultUri(raw_uri)) return null;
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
  const src = String(o.source_type ?? "manual_vless").trim().toLowerCase();
  const source_type: WhitelistSourceType = src === "json_import" ? "json_import" : "manual_vless";
  const assignment_mode = normalizeAssignmentMode(o.assignment_mode);
  const assigned_user_ids = normalizeUserIds(o.assigned_user_ids);
  return {
    id,
    name: String(o.name ?? "").trim().slice(0, 120) || defaultNameFromUri(raw_uri),
    raw_uri,
    masked_uri: String(o.masked_uri ?? "").trim() || maskProxyUri(raw_uri),
    source_type,
    active: !(o.active === false || o.active === 0 || o.active === "0"),
    include_in_sale: o.include_in_sale === true || o.include_in_sale === 1 || o.include_in_sale === "1",
    assignment_mode,
    assigned_user_ids: assignment_mode === "selected" ? assigned_user_ids : [],
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

function normalizeCheck(raw: unknown): WhitelistKeyCheckRow | null {
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
      .filter((x): x is WhitelistKeyRow => x != null);
    const checks = (Array.isArray(parsed.checks) ? parsed.checks : [])
      .map((x) => normalizeCheck(x))
      .filter((x): x is WhitelistKeyCheckRow => x != null);
    const purchases = (Array.isArray(parsed.purchases) ? parsed.purchases : [])
      .map((x) => normalizePurchase(x))
      .filter((x): x is WhiteListPurchaseRow => x != null);
    return {
      next_key_id: Number(parsed.next_key_id) > 0 ? Number(parsed.next_key_id) : 1,
      next_check_id: Number(parsed.next_check_id) > 0 ? Number(parsed.next_check_id) : 1,
      next_purchase_id: Number(parsed.next_purchase_id) > 0 ? Number(parsed.next_purchase_id) : 1,
      keys,
      checks,
      purchases,
      settings: normalizeSettings(parsed.settings),
    };
  } catch (e) {
    console.error("[whitelist-vault] read failed:", e instanceof Error ? e.message : e);
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

export function isWhitelistVaultEnabled(): boolean {
  return readVault().settings.enabled;
}

export function listWhitelistVaultKeys(): WhitelistKeyRow[] {
  return [...readVault().keys].sort((a, b) => b.id - a.id);
}

export function getWhitelistVaultKey(id: number): WhitelistKeyRow | undefined {
  return readVault().keys.find((k) => k.id === id);
}

export function getWhitelistVaultSettings(): WhitelistVaultSettings {
  return readVault().settings;
}

export function saveWhitelistVaultSettings(
  patch: Partial<Omit<WhitelistVaultSettings, "purchase" | "instruction">> & {
    purchase?: Partial<WhitelistVaultSettings["purchase"]>;
    instruction?: Partial<WhitelistVaultSettings["instruction"]>;
  },
): WhitelistVaultSettings {
  let out = getWhitelistVaultSettings();
  mutateVault((v) => {
    const merged = { ...v.settings, ...patch };
    if (patch.purchase) merged.purchase = { ...v.settings.purchase, ...patch.purchase };
    if (patch.instruction) merged.instruction = { ...v.settings.instruction, ...patch.instruction };
    v.settings = normalizeSettings(merged);
    if (!v.settings.enabled) {
      v.settings.auto_check_enabled = false;
      v.settings.purchase.sale_enabled = false;
    }
    out = v.settings;
  });
  return out;
}

export function saveWhitelistPurchaseSettings(
  patch: Partial<WhitelistVaultSettings["purchase"]>,
): WhitelistVaultSettings["purchase"] {
  let out = getWhitelistVaultSettings().purchase;
  mutateVault((v) => {
    v.settings.purchase = normalizePurchaseSettings({ ...v.settings.purchase, ...patch });
    if (!v.settings.enabled) v.settings.purchase.sale_enabled = false;
    out = v.settings.purchase;
  });
  return out;
}

export function saveWhitelistInstructionSettings(
  patch: Partial<WhitelistVaultSettings["instruction"]>,
): WhitelistVaultSettings["instruction"] {
  let out = getWhitelistVaultSettings().instruction;
  mutateVault((v) => {
    v.settings.instruction = normalizeInstructionSettings({ ...v.settings.instruction, ...patch });
    out = v.settings.instruction;
  });
  return out;
}

export function isWhitelistPurchaseVisible(): boolean {
  const s = getWhitelistVaultSettings();
  if (!s.enabled || !s.purchase.sale_enabled) return false;
  if (s.purchase.price_rub <= 0) return false;
  return countSaleWhitelistKeys() > 0;
}

export function countSaleWhitelistKeys(): number {
  return listWhitelistVaultKeys().filter((k) => k.active && k.include_in_sale).length;
}

export function userHasPaidWhitelistProduct(user: UserRow): boolean {
  if (!isWhitelistVaultEnabled()) return false;
  const until = user.whitelist_active_until;
  const purchase = getLatestPaidWhitelistPurchase(user.id);
  if (!purchase || purchase.status !== "paid") return false;
  if (until > Date.now()) return true;
  const settings = getWhitelistVaultSettings();
  if (settings.purchase.duration === "forever") return true;
  if (purchase.expires_at && Date.parse(purchase.expires_at) > Date.now()) return true;
  if (settings.purchase.duration === "subscription_end") {
    return userHasActiveSubscription(user);
  }
  return false;
}

/** Доступ к ключам из продажи (оплаченный продукт «белые списки»). */
export function userHasActiveWhitelistAccess(user: UserRow): boolean {
  return userHasPaidWhitelistProduct(user);
}

export type WhitelistAccessStatus = "none" | "active" | "suspended" | "expired";

export function userHasWhitelistEntitlement(user: UserRow): boolean {
  if (!isWhitelistVaultEnabled()) return false;
  const hasManual =
    user.whitelist_happ_enabled === 1 ||
    listWhitelistVaultKeys().some((k) => k.active && userReceivesWhitelistKey(user.id, k));
  const purchase = getLatestPaidWhitelistPurchase(user.id);
  const hasPaid = !!(purchase && purchase.status === "paid");
  return hasManual || hasPaid;
}

/** Unix ms окончания белых списков; null = без фиксированной даты (бессрочно). */
export function resolveWhitelistExpiryMs(user: UserRow): number | null {
  const until = user.whitelist_active_until;
  if (until > 0) return until;
  const purchase = getLatestPaidWhitelistPurchase(user.id);
  if (!purchase || purchase.status !== "paid") return null;
  const settings = getWhitelistVaultSettings();
  if (settings.purchase.duration === "forever") return null;
  if (purchase.expires_at) {
    const ms = Date.parse(purchase.expires_at);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function whitelistPeriodRemaining(user: UserRow): boolean {
  if (!userHasWhitelistEntitlement(user)) return false;
  const expiresMs = resolveWhitelistExpiryMs(user);
  if (expiresMs === null) return true;
  return expiresMs > Date.now();
}

export function getWhitelistAccessState(user: UserRow): {
  status: WhitelistAccessStatus;
  expires_at_ms: number | null;
  remaining_days: number | null;
} {
  if (!userHasWhitelistEntitlement(user)) {
    return { status: "none", expires_at_ms: null, remaining_days: null };
  }
  const expiresMs = resolveWhitelistExpiryMs(user);
  const remaining = whitelistPeriodRemaining(user);
  const remaining_days =
    expiresMs != null && expiresMs > Date.now()
      ? Math.max(0, Math.ceil((expiresMs - Date.now()) / 86400000))
      : expiresMs === null
        ? null
        : 0;

  if (!remaining) {
    return { status: "expired", expires_at_ms: expiresMs, remaining_days: 0 };
  }
  if (!userHasActiveSubscription(user)) {
    return { status: "suspended", expires_at_ms: expiresMs, remaining_days };
  }
  return { status: "active", expires_at_ms: expiresMs, remaining_days };
}

function resolveAssignmentMode(
  mode: WhitelistAssignmentMode,
  userIds: number[] | undefined,
): { mode: WhitelistAssignmentMode; userIds: number[] } {
  const ids = normalizeUserIds(userIds);
  if (mode === "selected" && ids.length === 0) {
    return { mode: "none", userIds: [] };
  }
  if (mode === "selected") return { mode, userIds: ids };
  return { mode, userIds: [] };
}

function enableWhitelistHappForUsers(userIds: number[]): void {
  const unique = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
  for (const userId of unique) {
    updateUserRow(userId, { whitelist_happ_enabled: 1 });
  }
}

function userHasManualWhitelistAssignment(userId: number): boolean {
  return listWhitelistVaultKeys().some(
    (k) => k.active && k.assignment_mode === "selected" && k.assigned_user_ids.includes(userId),
  );
}

function disableWhitelistHappIfUnassigned(userIds: number[]): void {
  const unique = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
  for (const userId of unique) {
    if (!userHasManualWhitelistAssignment(userId)) {
      updateUserRow(userId, { whitelist_happ_enabled: 0 });
    }
  }
}

function syncWhitelistHappForAssignment(
  mode: WhitelistAssignmentMode,
  userIds: number[],
  prevUserIds: number[] = [],
): void {
  const nextIds = mode === "selected" ? userIds : [];
  if (nextIds.length > 0) {
    enableWhitelistHappForUsers(nextIds);
  }
  const nextSet = new Set(nextIds);
  const removed = prevUserIds.filter((id) => !nextSet.has(id));
  if (removed.length > 0) {
    disableWhitelistHappIfUnassigned(removed);
  }
}

function keyEligibleForSubscription(key: WhitelistKeyRow, user: UserRow): boolean {
  if (!key.active) return false;
  if (userReceivesWhitelistKey(user.id, key)) return true;
  const settings = getWhitelistVaultSettings();
  if (!settings.purchase.issue_unavailable_keys && key.last_check_status === "unavailable") return false;
  if (userHasActiveWhitelistAccess(user) && key.include_in_sale) return true;
  return false;
}

export function assignedUsersCount(k: WhitelistKeyRow): number {
  if (k.assignment_mode === "none") return 0;
  if (k.assignment_mode === "all") return listUsers().length;
  return k.assigned_user_ids.length;
}

function usersCountLabel(n: number): string {
  if (n === 0) return "0 пользователей";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} пользователь`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} пользователя`;
  return `${n} пользователей`;
}

export function assignmentLabel(k: WhitelistKeyRow): string {
  return usersCountLabel(assignedUsersCount(k));
}

export function userReceivesWhitelistKey(userId: number, key: WhitelistKeyRow): boolean {
  if (!key.active) return false;
  if (key.assignment_mode === "none") return false;
  if (key.assignment_mode === "all") return true;
  return key.assigned_user_ids.includes(userId);
}

export function subscriptionWhitelistUrisForUser(user: UserRow): string[] {
  if (!isWhitelistVaultEnabled()) return [];
  if (!userHasActiveSubscription(user)) return [];
  const hasManualAssignment = listWhitelistVaultKeys().some(
    (k) => k.active && userReceivesWhitelistKey(user.id, k),
  );
  if (user.whitelist_happ_enabled !== 1 && !hasManualAssignment) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of listWhitelistVaultKeys()) {
    if (!keyEligibleForSubscription(k, user)) continue;
    const uri = k.raw_uri.trim();
    const key = uri.toLowerCase();
    if (!uri || seen.has(key)) continue;
    seen.add(key);
    out.push(uri);
  }
  return out;
}

export function whitelistVaultStats(): {
  total: number;
  available: number;
  unavailable: number;
  unstable: number;
  never: number;
  assigned_users: number;
  last_auto_run_at: string | null;
  enabled: boolean;
} {
  const keys = listWhitelistVaultKeys();
  const settings = getWhitelistVaultSettings();
  let assignedSum = 0;
  for (const k of keys) {
    if (k.assignment_mode === "all") assignedSum += 1;
    else if (k.assignment_mode === "selected") assignedSum += k.assigned_user_ids.length;
  }
  return {
    total: keys.length,
    available: keys.filter((k) => k.last_check_status === "available").length,
    unavailable: keys.filter((k) => k.last_check_status === "unavailable").length,
    unstable: keys.filter((k) => k.last_check_status === "unstable").length,
    never: keys.filter((k) => k.last_check_status === "never").length,
    assigned_users: assignedSum,
    last_auto_run_at: settings.last_auto_run_at,
    enabled: settings.enabled,
  };
}

function rowFromUri(
  id: number,
  name: string,
  raw_uri: string,
  opts: {
    active?: boolean;
    include_in_sale?: boolean;
    notify_on_fail?: boolean;
    source_type?: WhitelistSourceType;
    assignment_mode?: WhitelistAssignmentMode;
    assigned_user_ids?: number[];
  },
): WhitelistKeyRow {
  const parsed = parseProxyUri(raw_uri)!;
  const now = new Date().toISOString();
  const mode = opts.assignment_mode ?? "none";
  return {
    id,
    name: name.trim().slice(0, 120) || defaultNameFromUri(raw_uri),
    raw_uri,
    masked_uri: maskProxyUri(raw_uri),
    source_type: opts.source_type ?? "manual_vless",
    active: opts.active !== false,
    include_in_sale: opts.include_in_sale === true,
    assignment_mode: mode,
    assigned_user_ids: mode === "selected" ? normalizeUserIds(opts.assigned_user_ids) : [],
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

export function createWhitelistVaultKey(input: {
  name: string;
  raw_uri: string;
  active?: boolean;
  include_in_sale?: boolean;
  notify_on_fail?: boolean;
  source_type?: WhitelistSourceType;
  assignment_mode?: WhitelistAssignmentMode;
  assigned_user_ids?: number[];
}): WhitelistKeyRow {
  const uri = input.raw_uri.trim();
  const existing = listWhitelistVaultKeys().map((k) => k.raw_uri);
  if (existing.some((x) => x.trim().toLowerCase() === uri.toLowerCase())) {
    throw new Error("Такой ключ уже есть в белых списках");
  }
  if (!parseProxyUri(uri)) throw new Error("Некорректная ссылка (vless:// или hysteria2://)");
  let created!: WhitelistKeyRow;
  mutateVault((v) => {
    const id = v.next_key_id++;
    created = rowFromUri(id, input.name, uri, input);
    v.keys.push(created);
  });
  syncWhitelistHappForAssignment(created!.assignment_mode, created!.assigned_user_ids, []);
  return created!;
}

export function updateWhitelistVaultKey(
  id: number,
  patch: {
    name?: string;
    raw_uri?: string;
    active?: boolean;
    include_in_sale?: boolean;
    notify_on_fail?: boolean;
    assignment_mode?: WhitelistAssignmentMode;
    assigned_user_ids?: number[];
  },
): WhitelistKeyRow {
  let updated!: WhitelistKeyRow;
  let prevAssignedIds: number[] = [];
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === id);
    if (idx < 0) throw new Error("Ключ не найден");
    const cur = v.keys[idx]!;
    const raw_uri = patch.raw_uri != null ? patch.raw_uri.trim() : cur.raw_uri;
    if (patch.raw_uri != null) {
      const dup = v.keys.some((k) => k.id !== id && k.raw_uri.trim().toLowerCase() === raw_uri.toLowerCase());
      if (dup) throw new Error("Такой ключ уже есть в белых списках");
      if (!parseProxyUri(raw_uri)) throw new Error("Некорректная ссылка (vless:// или hysteria2://)");
    }
    const parsed = parseProxyUri(raw_uri)!;
    let mode = patch.assignment_mode ?? cur.assignment_mode;
    let assignedIds =
      mode === "selected" ? normalizeUserIds(patch.assigned_user_ids ?? cur.assigned_user_ids) : [];
    if (patch.assignment_mode !== undefined || patch.assigned_user_ids !== undefined) {
      prevAssignedIds = cur.assignment_mode === "selected" ? [...cur.assigned_user_ids] : [];
      const resolved = resolveAssignmentMode(mode, assignedIds);
      mode = resolved.mode;
      assignedIds = resolved.userIds;
    }
    updated = {
      ...cur,
      name: patch.name != null ? patch.name.trim().slice(0, 120) || cur.name : cur.name,
      raw_uri,
      masked_uri: maskProxyUri(raw_uri),
      active: patch.active !== undefined ? patch.active !== false : cur.active,
      include_in_sale: patch.include_in_sale !== undefined ? patch.include_in_sale === true : cur.include_in_sale,
      notify_on_fail: patch.notify_on_fail !== undefined ? patch.notify_on_fail !== false : cur.notify_on_fail,
      assignment_mode: mode,
      assigned_user_ids: assignedIds,
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
  const prevAssigned =
    patch.assignment_mode !== undefined || patch.assigned_user_ids !== undefined ? prevAssignedIds : [];
  syncWhitelistHappForAssignment(updated!.assignment_mode, updated!.assigned_user_ids, prevAssigned);
  return updated!;
}

export function deleteWhitelistVaultKey(id: number): void {
  mutateVault((v) => {
    v.keys = v.keys.filter((k) => k.id !== id);
    v.checks = v.checks.filter((c) => c.key_id !== id);
  });
}

export function bulkDeleteWhitelistVaultKeys(ids: number[]): { deleted: number } {
  const unique = [...new Set(ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0))];
  if (unique.length === 0) throw new Error("Выберите ключи");
  const idSet = new Set(unique);
  let deleted = 0;
  mutateVault((v) => {
    const before = v.keys.length;
    v.keys = v.keys.filter((k) => !idSet.has(k.id));
    deleted = before - v.keys.length;
    v.checks = v.checks.filter((c) => !idSet.has(c.key_id));
  });
  return { deleted };
}

export function deleteAllWhitelistVaultKeys(): { deleted: number } {
  let deleted = 0;
  mutateVault((v) => {
    deleted = v.keys.length;
    v.keys = [];
    v.checks = [];
  });
  return { deleted };
}

export function setWhitelistVaultKeyAssignment(
  id: number,
  mode: WhitelistAssignmentMode,
  userIds?: number[],
): WhitelistKeyRow {
  return updateWhitelistVaultKey(id, {
    assignment_mode: mode,
    assigned_user_ids: userIds,
  });
}

export function bulkRenameWhitelistVaultKeys(
  ids: number[],
  remark: string,
): { updated: number; errors: string[] } {
  const name = remark.trim().slice(0, 120);
  if (!name) throw new Error("Укажите название");
  const unique = [...new Set(ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0))];
  if (unique.length === 0) throw new Error("Выберите ключи");
  let updated = 0;
  const errors: string[] = [];
  for (const id of unique) {
    try {
      const key = getWhitelistVaultKey(id);
      if (!key) {
        errors.push(`Ключ #${id}: не найден`);
        continue;
      }
      const nextUri = setProxyUriRemark(key.raw_uri, name);
      if (!nextUri) {
        errors.push(`Ключ #${id}: не удалось обновить ссылку`);
        continue;
      }
      updateWhitelistVaultKey(id, { name, raw_uri: nextUri });
      updated += 1;
    } catch (e) {
      errors.push(`Ключ #${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { updated, errors };
}

export function bulkAssignWhitelistVaultKeys(
  ids: number[],
  mode: WhitelistAssignmentMode,
  userIds?: number[],
): { updated: number; errors: string[] } {
  if (mode !== "none" && mode !== "all" && mode !== "selected") {
    throw new Error("Некорректный режим назначения");
  }
  if (mode === "selected" && (!userIds || userIds.length === 0)) {
    throw new Error("Выберите пользователей");
  }
  const unique = [...new Set(ids.map((x) => Math.floor(Number(x))).filter((n) => n > 0))];
  if (unique.length === 0) throw new Error("Выберите ключи");
  let updated = 0;
  const errors: string[] = [];
  for (const id of unique) {
    try {
      if (!getWhitelistVaultKey(id)) {
        errors.push(`Ключ #${id}: не найден`);
        continue;
      }
      setWhitelistVaultKeyAssignment(id, mode, userIds);
      updated += 1;
    } catch (e) {
      errors.push(`Ключ #${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { updated, errors };
}

export function setWhitelistVaultKeyChecking(id: number): void {
  mutateVault((v) => {
    const k = v.keys.find((x) => x.id === id);
    if (!k) return;
    k.last_check_status = "checking";
    k.updated_at = new Date().toISOString();
  });
}

export function applyWhitelistVaultCheckResult(
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
): { key: WhitelistKeyRow; check: WhitelistKeyCheckRow; prev_status: VlessCheckStatus } {
  let key!: WhitelistKeyRow;
  let check!: WhitelistKeyCheckRow;
  let prev_status: VlessCheckStatus = "never";
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === keyId);
    if (idx < 0) throw new Error("Ключ не найден");
    const cur = v.keys[idx]!;
    prev_status = cur.last_check_status;
    const now = new Date().toISOString();
    const isUnavailable = result.status === "unavailable";
    const wasUnavailable = cur.last_check_status === "unavailable";
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

export function updateWhitelistVaultNotifyState(
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

export function listWhitelistVaultChecks(keyId: number, limit = 50): WhitelistKeyCheckRow[] {
  return readVault()
    .checks.filter((c) => c.key_id === keyId)
    .sort((a, b) => (a.checked_at < b.checked_at ? 1 : -1))
    .slice(0, Math.min(100, Math.max(1, limit)));
}

export function purgeWhitelistVaultChecksOlderThanDays(days: number): number {
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

export function importWhitelistVaultUris(
  lines: string[],
  opts: {
    name_prefix?: string;
    active?: boolean;
    include_in_sale?: boolean;
    notify_on_fail?: boolean;
    source_type?: WhitelistSourceType;
    assignment_mode?: WhitelistAssignmentMode;
    assigned_user_ids?: number[];
  },
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
      if (!isValidWhitelistVaultUri(uri)) {
        errors.push(`Строка ${n}: некорректная ссылка (ожидается vless:// или hysteria2://)`);
        continue;
      }
      if (!parseProxyUri(uri)) {
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
      const name = prefix ? `${prefix} ${n}`.slice(0, 120) : defaultNameFromUri(uri, `Белый список ${id}`);
      v.keys.push(
        rowFromUri(id, name, uri, {
          active: opts.active,
          notify_on_fail: opts.notify_on_fail,
          source_type: opts.source_type ?? "manual_vless",
          assignment_mode: opts.assignment_mode,
          assigned_user_ids: opts.assigned_user_ids,
        }),
      );
      added += 1;
    }
  });
  return { added, skipped_duplicates, errors };
}

export function whitelistKeyForApi(k: WhitelistKeyRow, includeRaw = false): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...k,
    assigned_users_count: assignedUsersCount(k),
    assignment_label: assignmentLabel(k),
  };
  if (!includeRaw) {
    delete base.raw_uri;
    delete base.parsed_uuid;
    delete base.parsed_public_key;
    delete base.parsed_short_id;
  }
  return base;
}

export function listWhitelistPurchases(limit = 200): WhiteListPurchaseRow[] {
  return [...readVault().purchases]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, Math.min(500, Math.max(1, limit)));
}

export function getLatestPaidWhitelistPurchase(userId: number): WhiteListPurchaseRow | undefined {
  return listWhitelistPurchases(500).find((p) => p.user_id === userId && p.status === "paid");
}

export function createWhitelistPurchase(input: {
  user_id: number;
  user_name: string;
  tg_id: string;
  payment_id: string;
  amount: number;
  status?: WhiteListPurchaseStatus;
  activated_at?: string | null;
  expires_at?: string | null;
}): WhiteListPurchaseRow {
  let created!: WhiteListPurchaseRow;
  const now = new Date().toISOString();
  mutateVault((v) => {
    const id = `wl${v.next_purchase_id++}`;
    created = {
      id,
      user_id: input.user_id,
      user_name: input.user_name,
      tg_id: input.tg_id,
      payment_id: input.payment_id,
      amount: Math.max(0, Math.floor(input.amount || 0)),
      status: input.status ?? "pending",
      activated_at: input.activated_at ?? null,
      expires_at: input.expires_at ?? null,
      instruction_sent: false,
      instruction_error: null,
      activation_error: null,
      created_at: now,
      updated_at: now,
    };
    v.purchases.unshift(created);
    if (v.purchases.length > 2000) v.purchases.length = 2000;
  });
  return created!;
}

export function patchWhitelistPurchase(
  id: string,
  patch: Partial<
    Pick<
      WhiteListPurchaseRow,
      | "status"
      | "activated_at"
      | "expires_at"
      | "amount"
      | "instruction_sent"
      | "instruction_error"
      | "activation_error"
    >
  >,
): WhiteListPurchaseRow | undefined {
  let updated: WhiteListPurchaseRow | undefined;
  mutateVault((v) => {
    const idx = v.purchases.findIndex((p) => p.id === id);
    if (idx < 0) return;
    updated = {
      ...v.purchases[idx]!,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    v.purchases[idx] = updated;
  });
  return updated;
}

export function markWhitelistPurchaseActivated(id: string): void {
  patchWhitelistPurchase(id, { activated_at: new Date().toISOString(), status: "paid", activation_error: null });
}

export function markWhitelistPurchaseInstruction(id: string, sent: boolean, error: string | null): void {
  patchWhitelistPurchase(id, { instruction_sent: sent, instruction_error: error });
}
