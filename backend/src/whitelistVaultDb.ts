import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VlessCheckStatus } from "./configVaultTypes.js";
import type { UserRow } from "./db.js";
import { listUsers, updateUserRow, userHasActiveSubscription } from "./db.js";
import { defaultNameFromUri, maskProxyUri, parseProxyUri, setProxyUriRemark, applyUserRemarkToProxyUri, isClientJsonProfileUri } from "./configVaultUri.js";
import { isValidWhitelistVaultUri } from "./extraVless.js";
import { formatSubscriptionNodeName } from "./subscriptionNodeName.js";
import {
  DEFAULT_WHITELIST_VAULT_SETTINGS,
  type WhitelistAssignmentMode,
  type WhitelistKeyCheckRow,
  type WhitelistKeyRow,
  type WhitelistGroupRow,
  type WhitelistSubscriptionSnapshot,
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
  next_group_id: number;
  next_check_id: number;
  next_purchase_id: number;
  keys: WhitelistKeyRow[];
  groups: WhitelistGroupRow[];
  checks: WhitelistKeyCheckRow[];
  purchases: WhiteListPurchaseRow[];
  settings: WhitelistVaultSettings;
};

let vaultCache: { mtimeMs: number; vault: VaultFile } | null = null;

function invalidateVaultCache(): void {
  vaultCache = null;
}

function emptyVault(): VaultFile {
  return {
    next_key_id: 1,
    next_group_id: 1,
    next_check_id: 1,
    next_purchase_id: 1,
    keys: [],
    groups: [],
    checks: [],
    purchases: [],
    settings: { ...DEFAULT_WHITELIST_VAULT_SETTINGS },
  };
}

function normalizeAssignmentMode(raw: unknown): WhitelistAssignmentMode {
  const v = String(raw ?? "none").trim().toLowerCase();
  if (v === "all" || v === "selected" || v === "purchasers") return v;
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

function normalizeSubscriptionSnapshot(raw: unknown): WhitelistSubscriptionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode = normalizeAssignmentMode(o.assignment_mode);
  return {
    include_in_sale: o.include_in_sale === true || o.include_in_sale === 1 || o.include_in_sale === "1",
    assignment_mode: mode,
    assigned_user_ids: mode === "selected" ? normalizeUserIds(o.assigned_user_ids) : [],
  };
}

function normalizeGroup(raw: unknown): WhitelistGroupRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Math.floor(Number(o.id));
  const name = String(o.name ?? "").trim().slice(0, 120);
  if (!Number.isFinite(id) || id <= 0 || !name) return null;
  const checks = Math.floor(Number(o.checks_before_remove) || 3);
  return {
    id,
    name,
    remove_on_unavailable: o.remove_on_unavailable === true || o.remove_on_unavailable === 1 || o.remove_on_unavailable === "1",
    checks_before_remove: Math.min(50, Math.max(1, checks)),
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
  const groupIdRaw = o.group_id != null ? Math.floor(Number(o.group_id)) : null;
  const group_id = groupIdRaw != null && Number.isFinite(groupIdRaw) && groupIdRaw > 0 ? groupIdRaw : null;
  const checksBeforeRemove = Math.floor(Number(o.checks_before_remove) || 3);
  return {
    id,
    name: String(o.name ?? "").trim().slice(0, 120) || defaultNameFromUri(raw_uri),
    raw_uri,
    masked_uri: String(o.masked_uri ?? "").trim() || maskProxyUri(raw_uri),
    source_type,
    client_json:
      typeof o.client_json === "string" && o.client_json.trim()
        ? o.client_json.trim()
        : null,
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
    group_id,
    remove_on_unavailable: o.remove_on_unavailable === true || o.remove_on_unavailable === 1 || o.remove_on_unavailable === "1",
    checks_before_remove: Math.min(50, Math.max(1, checksBeforeRemove)),
    consecutive_unavailable_checks: Math.max(0, Math.floor(Number(o.consecutive_unavailable_checks) || 0)),
    removed_from_subscriptions:
      o.removed_from_subscriptions === true || o.removed_from_subscriptions === 1 || o.removed_from_subscriptions === "1",
    removed_manually: o.removed_manually === true || o.removed_manually === 1 || o.removed_manually === "1",
    removed_at: o.removed_at != null ? String(o.removed_at) : null,
    subscription_restore_snapshot: normalizeSubscriptionSnapshot(o.subscription_restore_snapshot),
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
    if (!fs.existsSync(vaultPath)) {
      invalidateVaultCache();
      return emptyVault();
    }
    const mtimeMs = fs.statSync(vaultPath).mtimeMs;
    if (vaultCache && vaultCache.mtimeMs === mtimeMs) return vaultCache.vault;
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
    const groups = (Array.isArray(parsed.groups) ? parsed.groups : [])
      .map((x) => normalizeGroup(x))
      .filter((x): x is WhitelistGroupRow => x != null);
    const vault: VaultFile = {
      next_key_id: Number(parsed.next_key_id) > 0 ? Number(parsed.next_key_id) : 1,
      next_group_id: Number(parsed.next_group_id) > 0 ? Number(parsed.next_group_id) : 1,
      next_check_id: Number(parsed.next_check_id) > 0 ? Number(parsed.next_check_id) : 1,
      next_purchase_id: Number(parsed.next_purchase_id) > 0 ? Number(parsed.next_purchase_id) : 1,
      keys,
      groups,
      checks,
      purchases,
      settings: normalizeSettings(parsed.settings),
    };
    // Ключи без существующей группы — сбрасываем group_id.
    const groupIds = new Set(vault.groups.map((g) => g.id));
    for (const k of vault.keys) {
      if (k.group_id != null && !groupIds.has(k.group_id)) k.group_id = null;
    }
    vaultCache = { mtimeMs, vault };
    return vault;
  } catch (e) {
    console.error("[whitelist-vault] read failed:", e instanceof Error ? e.message : e);
    invalidateVaultCache();
    return emptyVault();
  }
}

function writeVault(vault: VaultFile): void {
  fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
  const tmp = `${vaultPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), "utf8");
  fs.renameSync(tmp, vaultPath);
  try {
    vaultCache = { mtimeMs: fs.statSync(vaultPath).mtimeMs, vault };
  } catch {
    invalidateVaultCache();
  }
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

export function listWhitelistVaultGroups(): WhitelistGroupRow[] {
  return [...readVault().groups].sort((a, b) => a.id - b.id);
}

export function getWhitelistVaultGroup(id: number): WhitelistGroupRow | undefined {
  return readVault().groups.find((g) => g.id === id);
}

function purgeEmptyGroups(v: VaultFile): void {
  const used = new Set(
    v.keys.map((k) => k.group_id).filter((id): id is number => id != null && id > 0),
  );
  v.groups = v.groups.filter((g) => used.has(g.id));
}

export function getWhitelistAutoRemoveSettings(
  key: WhitelistKeyRow,
  group?: WhitelistGroupRow | null,
): { remove_on_unavailable: boolean; checks_before_remove: number } {
  const g = group ?? (key.group_id != null ? getWhitelistVaultGroup(key.group_id) : null);
  if (g) {
    return {
      remove_on_unavailable: g.remove_on_unavailable,
      checks_before_remove: g.checks_before_remove,
    };
  }
  return {
    remove_on_unavailable: key.remove_on_unavailable,
    checks_before_remove: key.checks_before_remove,
  };
}

function keyHasSubscriptionPresence(key: WhitelistKeyRow): boolean {
  return key.include_in_sale || key.assignment_mode !== "none";
}

export function processWhitelistAutoSubscriptionAfterCheck(
  keyId: number,
  checkStatus: "available" | "unavailable" | "unstable",
): { action: "none" | "removed" | "restored"; checks_count: number; key: WhitelistKeyRow } {
  let key!: WhitelistKeyRow;
  let action: "none" | "removed" | "restored" = "none";
  let checks_count = 0;
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === keyId);
    if (idx < 0) throw new Error("Ключ не найден");
    const cur = v.keys[idx]!;
    const group = cur.group_id != null ? v.groups.find((g) => g.id === cur.group_id) : undefined;
    const autoRemove = getWhitelistAutoRemoveSettings(cur, group);
    const now = new Date().toISOString();

    if (checkStatus === "unavailable") {
      const nextChecks = cur.consecutive_unavailable_checks + 1;
      let removed_from_subscriptions = cur.removed_from_subscriptions;
      let removed_at = cur.removed_at;
      let snapshot = cur.subscription_restore_snapshot;

      if (
        autoRemove.remove_on_unavailable &&
        !cur.removed_from_subscriptions &&
        nextChecks >= autoRemove.checks_before_remove &&
        keyHasSubscriptionPresence(cur)
      ) {
        removed_from_subscriptions = true;
        removed_at = now;
        snapshot = {
          include_in_sale: cur.include_in_sale,
          assignment_mode: cur.assignment_mode,
          assigned_user_ids: [...cur.assigned_user_ids],
        };
        action = "removed";
        checks_count = nextChecks;
      }

      v.keys[idx] = {
        ...cur,
        consecutive_unavailable_checks: nextChecks,
        removed_from_subscriptions,
        removed_manually: removed_from_subscriptions && action === "removed" ? false : cur.removed_manually,
        removed_at,
        subscription_restore_snapshot: snapshot,
        updated_at: now,
      };
    } else {
      let removed_from_subscriptions = cur.removed_from_subscriptions;
      let removed_at = cur.removed_at;
      let snapshot = cur.subscription_restore_snapshot;
      let removed_manually = cur.removed_manually;

      if (
        cur.removed_from_subscriptions &&
        !cur.removed_manually &&
        cur.subscription_restore_snapshot &&
        checkStatus === "available"
      ) {
        removed_from_subscriptions = false;
        removed_at = null;
        snapshot = null;
        removed_manually = false;
        action = "restored";
      }

      v.keys[idx] = {
        ...cur,
        consecutive_unavailable_checks: 0,
        removed_from_subscriptions,
        removed_manually,
        removed_at,
        subscription_restore_snapshot: snapshot,
        updated_at: now,
      };
    }
    key = v.keys[idx]!;
  });
  return { action, checks_count, key };
}

export function manuallyRemoveWhitelistKeyFromSubscriptions(id: number): WhitelistKeyRow {
  let updated!: WhitelistKeyRow;
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === id);
    if (idx < 0) throw new Error("Ключ не найден");
    const cur = v.keys[idx]!;
    if (!keyHasSubscriptionPresence(cur)) {
      throw new Error("Ключ не выдаётся в подписках (не в продаже и не назначен)");
    }
    if (cur.removed_from_subscriptions) throw new Error("Ключ уже убран из подписок");
    const now = new Date().toISOString();
    updated = {
      ...cur,
      removed_from_subscriptions: true,
      removed_manually: true,
      removed_at: now,
      subscription_restore_snapshot: {
        include_in_sale: cur.include_in_sale,
        assignment_mode: cur.assignment_mode,
        assigned_user_ids: [...cur.assigned_user_ids],
      },
      updated_at: now,
    };
    v.keys[idx] = updated;
  });
  return updated!;
}

export function manuallyRestoreWhitelistKeyToSubscriptions(id: number): WhitelistKeyRow {
  let updated!: WhitelistKeyRow;
  mutateVault((v) => {
    const idx = v.keys.findIndex((k) => k.id === id);
    if (idx < 0) throw new Error("Ключ не найден");
    const cur = v.keys[idx]!;
    if (!cur.removed_from_subscriptions) throw new Error("Ключ не был убран из подписок");
    const now = new Date().toISOString();
    updated = {
      ...cur,
      removed_from_subscriptions: false,
      removed_manually: false,
      removed_at: null,
      subscription_restore_snapshot: null,
      consecutive_unavailable_checks: 0,
      updated_at: now,
    };
    v.keys[idx] = updated;
  });
  return updated!;
}

export function createWhitelistVaultGroup(name: string, keyIds: number[]): WhitelistGroupRow {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) throw new Error("Укажите название группы");
  const unique = [...new Set(keyIds.map((x) => Math.floor(Number(x))).filter((n) => n > 0))];
  if (unique.length < 2) throw new Error("Выберите минимум 2 ключа для группы");
  let created!: WhitelistGroupRow;
  mutateVault((v) => {
    for (const id of unique) {
      if (!v.keys.some((k) => k.id === id)) throw new Error(`Ключ #${id} не найден`);
    }
    const id = v.next_group_id++;
    const now = new Date().toISOString();
    created = {
      id,
      name: trimmed,
      remove_on_unavailable: false,
      checks_before_remove: 3,
      created_at: now,
      updated_at: now,
    };
    v.groups.push(created);
    for (const keyId of unique) {
      const idx = v.keys.findIndex((k) => k.id === keyId);
      const cur = v.keys[idx]!;
      v.keys[idx] = { ...cur, group_id: id, updated_at: now };
    }
    purgeEmptyGroups(v);
  });
  return created!;
}

export function updateWhitelistVaultGroup(
  id: number,
  patch: {
    name?: string;
    remove_on_unavailable?: boolean;
    checks_before_remove?: number;
  },
): WhitelistGroupRow {
  let updated!: WhitelistGroupRow;
  mutateVault((v) => {
    const idx = v.groups.findIndex((g) => g.id === id);
    if (idx < 0) throw new Error("Группа не найдена");
    const cur = v.groups[idx]!;
    const checks =
      patch.checks_before_remove !== undefined
        ? Math.min(50, Math.max(1, Math.floor(Number(patch.checks_before_remove) || 3)))
        : cur.checks_before_remove;
    updated = {
      ...cur,
      name: patch.name != null ? patch.name.trim().slice(0, 120) || cur.name : cur.name,
      remove_on_unavailable:
        patch.remove_on_unavailable !== undefined ? patch.remove_on_unavailable === true : cur.remove_on_unavailable,
      checks_before_remove: checks,
      updated_at: new Date().toISOString(),
    };
    v.groups[idx] = updated;
  });
  return updated!;
}

export function deleteWhitelistVaultGroup(id: number): void {
  mutateVault((v) => {
    if (!v.groups.some((g) => g.id === id)) throw new Error("Группа не найдена");
    const now = new Date().toISOString();
    for (const k of v.keys) {
      if (k.group_id === id) {
        k.group_id = null;
        k.updated_at = now;
      }
    }
    v.groups = v.groups.filter((g) => g.id !== id);
  });
}

export function whitelistGroupForApi(g: WhitelistGroupRow, keys: WhitelistKeyRow[]): Record<string, unknown> {
  const groupKeys = keys.filter((k) => k.group_id === g.id);
  return {
    ...g,
    keys_count: groupKeys.length,
    removed_count: groupKeys.filter((k) => k.removed_from_subscriptions).length,
    unavailable_count: groupKeys.filter((k) => k.last_check_status === "unavailable").length,
  };
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
  return listWhitelistVaultKeys().filter((k) => k.active && k.include_in_sale && !k.removed_from_subscriptions).length;
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
  if (key.removed_from_subscriptions) return false;
  // Ручное назначение: только при живой основной подписке (после истечения флаг снимается).
  if (user.whitelist_happ_enabled === 1) {
    if (userHasManualWhitelistGrant(user) && !userHasActiveSubscription(user)) return false;
    return true;
  }
  if (userReceivesWhitelistKey(user.id, key)) return true;
  const settings = getWhitelistVaultSettings();
  if (!settings.purchase.issue_unavailable_keys && key.last_check_status === "unavailable") return false;
  if (userHasActiveWhitelistAccess(user) && key.include_in_sale) return true;
  return false;
}

/** Ручное назначение БС (кнопка в админке), не оплаченный продукт. */
export function userHasManualWhitelistGrant(user: UserRow): boolean {
  return user.whitelist_happ_enabled === 1 && !userHasPaidWhitelistProduct(user);
}

/**
 * Ручные БС действуют только до конца основной подписки.
 * После истечения флаг снимается — при продлении БС сами не возвращаются.
 */
export function clearManualWhitelistGrantIfSubscriptionInactive(user: UserRow): boolean {
  if (!userHasManualWhitelistGrant(user)) return false;
  if (userHasActiveSubscription(user)) return false;
  updateUserRow(user.id, { whitelist_happ_enabled: 0 });
  return true;
}

export function sweepExpiredManualWhitelistGrants(): number {
  let n = 0;
  for (const u of listUsers()) {
    if (clearManualWhitelistGrantIfSubscriptionInactive(u)) n += 1;
  }
  return n;
}

/** Включить БС пользователю: в подписку попадут все активные ключи. */
export function grantWhitelistAccessToUser(userId: number): void {
  const id = Math.floor(Number(userId));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Некорректный пользователь");
  const user = listUsers().find((u) => u.id === id);
  if (!user) throw new Error("Пользователь не найден");
  if (!userHasActiveSubscription(user)) {
    throw new Error("У пользователя нет активной подписки — ручные БС действуют только до её окончания");
  }
  updateUserRow(id, { whitelist_happ_enabled: 1 });
}

/** Снять БС у пользователя (ручное и покупка). */
export function revokeWhitelistAccessFromUser(userId: number): void {
  const id = Math.floor(Number(userId));
  if (!Number.isFinite(id) || id <= 0) throw new Error("Некорректный пользователь");
  const user = listUsers().find((u) => u.id === id);
  if (!user) throw new Error("Пользователь не найден");
  const now = new Date().toISOString();
  mutateVault((v) => {
    for (const p of v.purchases) {
      if (p.user_id !== id) continue;
      if (p.status === "paid" || p.status === "pending") {
        p.status = "refunded";
        p.updated_at = now;
        p.activation_error = p.activation_error ?? "admin_revoke";
      }
    }
    for (const k of v.keys) {
      if (k.assignment_mode !== "selected") continue;
      if (!k.assigned_user_ids.includes(id)) continue;
      k.assigned_user_ids = k.assigned_user_ids.filter((x) => x !== id);
      if (k.assigned_user_ids.length === 0) k.assignment_mode = "none";
      k.updated_at = now;
    }
  });
  updateUserRow(id, {
    whitelist_happ_enabled: 0,
    whitelist_active_until: 0,
    whitelist_purchase_id: "",
  });
}

function countActiveWhitelistPurchasers(): number {
  return listUsers().filter((u) => userHasActiveWhitelistAccess(u)).length;
}

export function assignedUsersCount(k: WhitelistKeyRow): number {
  if (k.assignment_mode === "all") return listUsers().length;
  if (k.assignment_mode === "selected") return k.assigned_user_ids.length;
  if (k.assignment_mode === "purchasers") return countActiveWhitelistPurchasers();
  // Ключи «в продажу» с режимом «никому» всё равно попадают к покупателям БС.
  if (k.include_in_sale) return countActiveWhitelistPurchasers();
  return 0;
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
  const n = assignedUsersCount(k);
  if (k.assignment_mode === "purchasers" || (k.assignment_mode === "none" && k.include_in_sale)) {
    if (n === 0) return "0 с купленными БС";
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} с купленными БС`;
    return `${n} с купленными БС`;
  }
  return usersCountLabel(n);
}

export function userReceivesWhitelistKey(userId: number, key: WhitelistKeyRow): boolean {
  if (!key.active) return false;
  if (key.assignment_mode === "none") return false;
  if (key.assignment_mode === "all") return true;
  if (key.assignment_mode === "purchasers") {
    const user = listUsers().find((u) => u.id === userId);
    return user != null && userHasActiveWhitelistAccess(user);
  }
  return key.assigned_user_ids.includes(userId);
}

export function subscriptionWhitelistUrisForUser(user: UserRow): string[] {
  return subscriptionWhitelistEntriesForUser(user)
    .filter((e) => !isClientJsonProfileUri(e.uri))
    .map((e) => e.uri);
}

export type WhitelistSubscriptionEntry = {
  key_id: number;
  uri: string;
  name: string;
  /** Полный Happ/Xray JSON, если импортировали из JSON. */
  client_json: Record<string, unknown> | null;
};

function parseClientJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function subscriptionWhitelistEntriesForUser(user: UserRow): WhitelistSubscriptionEntry[] {
  if (!isWhitelistVaultEnabled()) return [];
  clearManualWhitelistGrantIfSubscriptionInactive(user);
  const fresh = listUsers().find((u) => u.id === user.id) ?? user;
  if (!userHasActiveSubscription(fresh)) return [];
  const hasManualAssignment = listWhitelistVaultKeys().some(
    (k) => k.active && userReceivesWhitelistKey(fresh.id, k),
  );
  if (fresh.whitelist_happ_enabled !== 1 && !hasManualAssignment) return [];
  const seen = new Set<string>();
  const out: WhitelistSubscriptionEntry[] = [];
  // В Happ сверху раньше добавленные ключи (не по убыванию id как в админке).
  const keysForSub = [...listWhitelistVaultKeys()].sort((a, b) => {
    const ta = Date.parse(a.created_at) || 0;
    const tb = Date.parse(b.created_at) || 0;
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });
  for (const k of keysForSub) {
    if (!keyEligibleForSubscription(k, fresh)) continue;
    const raw = k.raw_uri.trim();
    if (!raw) continue;
    const baseName = k.name || defaultNameFromUri(raw);
    const displayName = formatSubscriptionNodeName(baseName, fresh.name);
    const uri = applyUserRemarkToProxyUri(raw, baseName, fresh.name);
    const key = uri.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let client_json = parseClientJsonObject(k.client_json);
    if (client_json) {
      client_json = { ...client_json, remarks: displayName };
    }
    out.push({
      key_id: k.id,
      uri,
      name: displayName,
      client_json,
    });
  }
  return out;
}

export function userHasWhitelistClientJsonProfiles(user: UserRow): boolean {
  return subscriptionWhitelistEntriesForUser(user).some((e) => e.client_json != null);
}

/** Уникальные пользователи, у которых реально подключены БС (не сумма назначений по ключам). */
export function countUsersWithWhitelistConnected(): number {
  const keys = listWhitelistVaultKeys();
  return listUsers().filter((u) => {
    if (u.is_test_subscription === 1) return false;
    if (u.whitelist_happ_enabled === 1) return true;
    if (userHasActiveWhitelistAccess(u) && getWhitelistAccessState(u).status === "active") return true;
    return keys.some((k) => k.active && userReceivesWhitelistKey(u.id, k));
  }).length;
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
  return {
    total: keys.length,
    available: keys.filter((k) => k.last_check_status === "available").length,
    unavailable: keys.filter((k) => k.last_check_status === "unavailable").length,
    unstable: keys.filter((k) => k.last_check_status === "unstable").length,
    never: keys.filter((k) => k.last_check_status === "never").length,
    assigned_users: countUsersWithWhitelistConnected(),
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
    client_json?: string | null;
  },
): WhitelistKeyRow {
  const parsed = parseProxyUri(raw_uri)!;
  const now = new Date().toISOString();
  const mode = opts.assignment_mode ?? "none";
  const client_json =
    typeof opts.client_json === "string" && opts.client_json.trim() ? opts.client_json.trim() : null;
  return {
    id,
    name: name.trim().slice(0, 120) || defaultNameFromUri(raw_uri),
    raw_uri,
    masked_uri: maskProxyUri(raw_uri),
    source_type: opts.source_type ?? "manual_vless",
    client_json,
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
    group_id: null,
    remove_on_unavailable: false,
    checks_before_remove: 3,
    consecutive_unavailable_checks: 0,
    removed_from_subscriptions: false,
    removed_manually: false,
    removed_at: null,
    subscription_restore_snapshot: null,
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
  client_json?: string | null;
}): WhitelistKeyRow {
  const uri = input.raw_uri.trim();
  const existingKeys = listWhitelistVaultKeys();
  const existing = existingKeys.find((k) => k.raw_uri.trim().toLowerCase() === uri.toLowerCase());
  if (existing) {
    // Повторный JSON-импорт: обновляем полный профиль, чтобы Happ получил routing/xhttp.extra.
    if (input.client_json != null || input.source_type === "json_import") {
      return updateWhitelistVaultKey(existing.id, {
        name: input.name,
        client_json: input.client_json ?? existing.client_json,
        active: input.active,
        include_in_sale: input.include_in_sale,
        notify_on_fail: input.notify_on_fail,
        assignment_mode: input.assignment_mode,
        assigned_user_ids: input.assigned_user_ids,
      });
    }
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
    client_json?: string | null;
    remove_on_unavailable?: boolean;
    checks_before_remove?: number;
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
    const client_json =
      patch.client_json !== undefined
        ? typeof patch.client_json === "string" && patch.client_json.trim()
          ? patch.client_json.trim()
          : null
        : cur.client_json;
    updated = {
      ...cur,
      name: patch.name != null ? patch.name.trim().slice(0, 120) || cur.name : cur.name,
      raw_uri,
      masked_uri: maskProxyUri(raw_uri),
      client_json,
      active: patch.active !== undefined ? patch.active !== false : cur.active,
      include_in_sale: patch.include_in_sale !== undefined ? patch.include_in_sale === true : cur.include_in_sale,
      notify_on_fail: patch.notify_on_fail !== undefined ? patch.notify_on_fail !== false : cur.notify_on_fail,
      remove_on_unavailable:
        patch.remove_on_unavailable !== undefined ? patch.remove_on_unavailable === true : cur.remove_on_unavailable,
      checks_before_remove:
        patch.checks_before_remove !== undefined
          ? Math.min(50, Math.max(1, Math.floor(Number(patch.checks_before_remove) || 3)))
          : cur.checks_before_remove,
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
  if (patch.assignment_mode !== undefined || patch.assigned_user_ids !== undefined) {
    syncWhitelistHappForAssignment(updated!.assignment_mode, updated!.assigned_user_ids, prevAssignedIds);
  }
  return updated!;
}

export function deleteWhitelistVaultKey(id: number): void {
  mutateVault((v) => {
    v.keys = v.keys.filter((k) => k.id !== id);
    v.checks = v.checks.filter((c) => c.key_id !== id);
    purgeEmptyGroups(v);
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
    purgeEmptyGroups(v);
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
  if (mode !== "none" && mode !== "all" && mode !== "selected" && mode !== "purchasers") {
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

export function whitelistKeyForApi(
  k: WhitelistKeyRow,
  includeRaw = false,
  groupsById?: Map<number, WhitelistGroupRow>,
): Record<string, unknown> {
  const group =
    k.group_id != null
      ? groupsById?.get(k.group_id) ?? getWhitelistVaultGroup(k.group_id)
      : null;
  const autoRemove = getWhitelistAutoRemoveSettings(k, group);
  const base: Record<string, unknown> = {
    ...k,
    assigned_users_count: assignedUsersCount(k),
    assignment_label: assignmentLabel(k),
    group_name: group?.name ?? null,
    effective_remove_on_unavailable: autoRemove.remove_on_unavailable,
    effective_checks_before_remove: autoRemove.checks_before_remove,
  };
  if (!includeRaw) {
    delete base.raw_uri;
    // parsed_uuid оставляем — нужен для поиска ключей БС по UUID из JSON
    delete base.parsed_public_key;
    delete base.parsed_short_id;
    // client_json тяжёлый — в списке не отдаём
    delete base.client_json;
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

/**
 * Сбрасывает все оплаченные/ожидающие покупки БС и снимает доступы у пользователей,
 * чтобы можно было купить белые списки заново (и узел пропал из подписки сразу).
 */
export function resetAllWhitelistPurchases(): {
  reset_purchases: number;
  reset_users: number;
  cleared_assignments: number;
  users: Array<{ id: number; name: string; purchase_ids: string[] }>;
} {
  const now = new Date().toISOString();
  const purchaseIdsByUser = new Map<number, string[]>();
  let reset_purchases = 0;
  let cleared_assignments = 0;

  mutateVault((v) => {
    for (const p of v.purchases) {
      if (p.status === "paid" || p.status === "pending") {
        p.status = "refunded";
        p.updated_at = now;
        p.activation_error = p.activation_error ?? "admin_reset";
        reset_purchases++;
      }
      const list = purchaseIdsByUser.get(p.user_id) ?? [];
      if (!list.includes(p.id)) list.push(p.id);
      purchaseIdsByUser.set(p.user_id, list);
    }

    // Ключи «в продажу» больше не выдаём через ручное назначение после сброса —
    // иначе БС остаётся в подписке без оплаты.
    for (const k of v.keys) {
      if (!k.include_in_sale) continue;
      if (k.assignment_mode === "all") {
        k.assignment_mode = "none";
        k.assigned_user_ids = [];
        k.updated_at = now;
        cleared_assignments++;
        continue;
      }
      if (k.assignment_mode === "selected" && k.assigned_user_ids.length > 0) {
        cleared_assignments += k.assigned_user_ids.length;
        k.assigned_user_ids = [];
        k.assignment_mode = "none";
        k.updated_at = now;
      }
    }
  });

  const usersOut: Array<{ id: number; name: string; purchase_ids: string[] }> = [];
  let reset_users = 0;
  const seenUser = new Set<number>();

  for (const u of listUsers()) {
    const fromPurchases = purchaseIdsByUser.get(u.id) ?? [];
    const hasFlags =
      u.whitelist_happ_enabled === 1 ||
      u.whitelist_active_until > 0 ||
      Boolean(String(u.whitelist_purchase_id ?? "").trim());
    if (fromPurchases.length === 0 && !hasFlags) continue;
    if (seenUser.has(u.id)) continue;
    seenUser.add(u.id);

    updateUserRow(u.id, {
      whitelist_happ_enabled: 0,
      whitelist_active_until: 0,
      whitelist_purchase_id: "",
    });
    reset_users++;
    usersOut.push({
      id: u.id,
      name: u.name,
      purchase_ids: fromPurchases,
    });
  }

  return {
    reset_purchases,
    reset_users,
    cleared_assignments,
    users: usersOut,
  };
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
