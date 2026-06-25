import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultDeviceLimitSettings,
  normalizeDeviceLimitSettings,
  type DeviceLimitSettings,
} from "./deviceLimitSettings.js";
import {
  newDeviceLimitEvent,
  normalizeDeviceLimitEvents,
  type DeviceLimitEventRow,
} from "./deviceLimitEvents.js";
import {
  newDeviceSlotPurchase,
  normalizeDeviceSlotPurchases,
  type DeviceSlotPurchaseRow,
} from "./deviceSlotPurchases.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

function storePath(): string {
  return process.env.DEVICE_LIMIT_STORE_PATH ?? path.join(path.dirname(dataPath), "device_limit_store.json");
}

type DeviceLimitStoreFile = {
  settings: DeviceLimitSettings;
  purchases: DeviceSlotPurchaseRow[];
  events: DeviceLimitEventRow[];
  recent_sub_hits?: Record<string, RecentSubscriptionDeviceHit>;
};

export type RecentSubscriptionDeviceHit = {
  ip: string;
  ua: string;
  did: string;
  at: string;
};

function emptyFile(): DeviceLimitStoreFile {
  return {
    settings: defaultDeviceLimitSettings(),
    purchases: [],
    events: [],
    recent_sub_hits: {},
  };
}

function readFile(): DeviceLimitStoreFile {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DeviceLimitStoreFile>;
    return {
      settings: normalizeDeviceLimitSettings(parsed.settings),
      purchases: normalizeDeviceSlotPurchases(parsed.purchases),
      events: normalizeDeviceLimitEvents(parsed.events),
      recent_sub_hits:
        parsed.recent_sub_hits && typeof parsed.recent_sub_hits === "object" ? parsed.recent_sub_hits : {},
    };
  } catch {
    return emptyFile();
  }
}

function writeFile(data: DeviceLimitStoreFile): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

function mutate(fn: (store: DeviceLimitStoreFile) => void): void {
  const store = readFile();
  fn(store);
  writeFile(store);
}

export function getDeviceLimitSettings(): DeviceLimitSettings {
  return readFile().settings;
}

export function setDeviceLimitSettings(patch: Partial<DeviceLimitSettings>): DeviceLimitSettings {
  let out = getDeviceLimitSettings();
  mutate((store) => {
    store.settings = normalizeDeviceLimitSettings({
      ...store.settings,
      ...patch,
      updated_at: new Date().toISOString(),
    });
    out = store.settings;
  });
  return out;
}

export function appendDeviceLimitEvent(
  input: Omit<DeviceLimitEventRow, "id" | "created_at"> & { id?: string },
): DeviceLimitEventRow {
  const row = newDeviceLimitEvent(input);
  mutate((store) => {
    store.events.unshift(row);
    if (store.events.length > 5000) store.events.length = 5000;
  });
  return row;
}

export function listDeviceLimitEvents(limit = 200): DeviceLimitEventRow[] {
  return readFile().events.slice(0, Math.max(1, Math.min(2000, limit)));
}

export function createDeviceSlotPurchaseRecord(
  input: Omit<DeviceSlotPurchaseRow, "id" | "created_at" | "updated_at" | "activated_at"> & {
    id?: string;
    activated_at?: string;
  },
): DeviceSlotPurchaseRow {
  const row = newDeviceSlotPurchase(input);
  mutate((store) => {
    store.purchases.unshift(row);
  });
  return row;
}

export function updateDeviceSlotPurchase(
  id: string,
  patch: Partial<Pick<DeviceSlotPurchaseRow, "status" | "activated_at" | "updated_at">>,
): DeviceSlotPurchaseRow | undefined {
  let out: DeviceSlotPurchaseRow | undefined;
  mutate((store) => {
    const i = store.purchases.findIndex((p) => p.id === id);
    if (i < 0) return;
    const cur = store.purchases[i]!;
    const next: DeviceSlotPurchaseRow = {
      ...cur,
      ...patch,
      updated_at: patch.updated_at ?? new Date().toISOString(),
    };
    store.purchases[i] = next;
    out = next;
  });
  return out;
}

export function findDeviceSlotPurchaseByPaymentId(paymentId: string): DeviceSlotPurchaseRow | undefined {
  const id = String(paymentId ?? "").trim();
  return readFile().purchases.find((p) => p.payment_id === id);
}

export function listDeviceSlotPurchases(limit = 500): DeviceSlotPurchaseRow[] {
  return readFile().purchases.slice(0, Math.max(1, Math.min(5000, limit)));
}

/** Последний запрос подписки с UA (для имени устройства после миграции). */
export function setRecentSubscriptionDeviceHit(
  userId: number,
  hit: { ip: string; ua: string; did: string },
): void {
  const ua = String(hit.ua ?? "").trim();
  if (!ua) return;
  const key = String(userId);
  mutate((store) => {
    if (!store.recent_sub_hits) store.recent_sub_hits = {};
    store.recent_sub_hits[key] = {
      ip: String(hit.ip ?? "").trim(),
      ua,
      did: String(hit.did ?? "").trim(),
      at: new Date().toISOString(),
    };
  });
}

export function getRecentSubscriptionDeviceHit(userId: number): RecentSubscriptionDeviceHit | null {
  const hit = readFile().recent_sub_hits?.[String(userId)];
  if (!hit?.ua?.trim()) return null;
  const at = Date.parse(hit.at || "");
  if (!Number.isFinite(at) || Date.now() - at > 30 * 24 * 3600_000) return null;
  return hit;
}

export type DeviceLimitOverviewStats = {
  users_with_limit: number;
  total_devices: number;
  active_devices: number;
  blocked_attempts: number;
  purchased_extra_slots: number;
  purchase_revenue_rub: number;
};

export function countDeviceLimitBlockedAttempts(): number {
  return readFile().events.filter(
    (e) =>
      e.event_type === "device_limit_reached" ||
      e.event_type === "subscription_blocked_by_device_limit",
  ).length;
}

export { type DeviceLimitSettings, type DeviceLimitEventRow, type DeviceSlotPurchaseRow };
