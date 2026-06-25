import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultDailyGiftConfig,
  newDailyGiftId,
  normalizeDailyGiftConfig,
  normalizeDailyGiftPrize,
  type DailyGiftClaimRow,
  type DailyGiftConfig,
  type DailyGiftDayAssignment,
  type DailyGiftEventRow,
  type DailyGiftPrizeRow,
  type DailyGiftReminderRow,
  type DailyGiftScheduleRow,
  type DailyGiftStoreFile,
} from "./dailyGiftTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

function storePath(): string {
  return process.env.DAILY_GIFT_STORE_PATH ?? path.join(path.dirname(dataPath), "daily_gift_store.json");
}

function emptyFile(): DailyGiftStoreFile {
  return {
    config: defaultDailyGiftConfig(),
    prizes: [],
    schedules: [],
    day_assignments: [],
    claims: [],
    reminders: [],
    events: [],
  };
}

function normalizeClaim(raw: unknown): DailyGiftClaimRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tg = Number(o.tg_user_id);
  if (!Number.isFinite(tg) || tg <= 0) return null;
  const type = String(o.prize_type ?? "").trim().toLowerCase();
  if (type !== "gb" && type !== "days" && type !== "promo" && type !== "discount") return null;
  const status = String(o.status ?? "applied");
  if (status !== "pending" && status !== "applied" && status !== "failed") return null;
  return {
    id: String(o.id ?? newDailyGiftId()),
    tg_user_id: Math.floor(tg),
    tg_username: o.tg_username != null ? String(o.tg_username).trim().replace(/^@/, "") || null : null,
    user_id: o.user_id == null ? null : Math.floor(Number(o.user_id)) || null,
    day_key: String(o.day_key ?? ""),
    prize_id: String(o.prize_id ?? ""),
    prize_type: type as DailyGiftClaimRow["prize_type"],
    prize_title: String(o.prize_title ?? ""),
    prize_value: String(o.prize_value ?? ""),
    prize_description: String(o.prize_description ?? ""),
    prize_golden: o.prize_golden === true,
    status,
    error_message: o.error_message ? String(o.error_message) : null,
    credit_mode:
      o.credit_mode === "piggy" ? "piggy" : o.credit_mode === "direct" ? "direct" : null,
    opened_at: String(o.opened_at ?? new Date().toISOString()),
    applied_at: o.applied_at ? String(o.applied_at) : null,
  };
}

function readFile(): DailyGiftStoreFile {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DailyGiftStoreFile>;
    return {
      config: normalizeDailyGiftConfig(parsed.config),
      prizes: Array.isArray(parsed.prizes)
        ? parsed.prizes.map((p) => normalizeDailyGiftPrize(p)).filter((p): p is DailyGiftPrizeRow => p != null)
        : [],
      schedules: Array.isArray(parsed.schedules)
        ? parsed.schedules
            .map((s) => {
              if (!s || typeof s !== "object") return null;
              const o = s as Record<string, unknown>;
              const day_key = String(o.day_key ?? "").trim();
              const prize_id = String(o.prize_id ?? "").trim();
              if (!day_key || !prize_id) return null;
              return { day_key, prize_id };
            })
            .filter((x): x is DailyGiftScheduleRow => x != null)
        : [],
      day_assignments: Array.isArray(parsed.day_assignments)
        ? parsed.day_assignments
            .map((s) => {
              if (!s || typeof s !== "object") return null;
              const o = s as Record<string, unknown>;
              const day_key = String(o.day_key ?? "").trim();
              const prize_id = String(o.prize_id ?? "").trim();
              if (!day_key || !prize_id) return null;
              return { day_key, prize_id };
            })
            .filter((x): x is DailyGiftDayAssignment => x != null)
        : [],
      claims: Array.isArray(parsed.claims)
        ? parsed.claims.map((c) => normalizeClaim(c)).filter((c): c is DailyGiftClaimRow => c != null)
        : [],
      reminders: Array.isArray(parsed.reminders)
        ? parsed.reminders
            .map((r) => {
              if (!r || typeof r !== "object") return null;
              const o = r as Record<string, unknown>;
              const tg = Number(o.tg_user_id);
              if (!Number.isFinite(tg) || tg <= 0) return null;
              return {
                tg_user_id: Math.floor(tg),
                enabled: o.enabled === true,
                updated_at: String(o.updated_at ?? new Date().toISOString()),
                last_notify_day_key: o.last_notify_day_key ? String(o.last_notify_day_key) : null,
              };
            })
            .filter((x): x is DailyGiftReminderRow => x != null)
        : [],
      events: Array.isArray(parsed.events)
        ? parsed.events
            .map((e) => {
              if (!e || typeof e !== "object") return null;
              const o = e as Record<string, unknown>;
              return {
                id: String(o.id ?? newDailyGiftId()),
                tg_user_id: o.tg_user_id == null ? null : Math.floor(Number(o.tg_user_id)) || null,
                event: String(o.event ?? ""),
                detail: o.detail ? String(o.detail) : null,
                created_at: String(o.created_at ?? new Date().toISOString()),
              };
            })
            .filter((x): x is DailyGiftEventRow => x != null)
        : [],
    };
  } catch {
    return emptyFile();
  }
}

function writeFile(data: DailyGiftStoreFile): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

export function mutateDailyGiftStore(fn: (store: DailyGiftStoreFile) => void): void {
  const store = readFile();
  fn(store);
  if (store.claims.length > 50_000) store.claims = store.claims.slice(-50_000);
  if (store.events.length > 20_000) store.events = store.events.slice(-20_000);
  writeFile(store);
}

export function readDailyGiftStore(): DailyGiftStoreFile {
  return readFile();
}

export function getDailyGiftConfig(): DailyGiftConfig {
  return readFile().config;
}

export function setDailyGiftConfig(patch: Partial<DailyGiftConfig>): DailyGiftConfig {
  let out = getDailyGiftConfig();
  mutateDailyGiftStore((store) => {
    store.config = normalizeDailyGiftConfig({ ...store.config, ...patch });
    out = store.config;
  });
  return out;
}

export function listDailyGiftPrizes(): DailyGiftPrizeRow[] {
  return readFile().prizes;
}

export function upsertDailyGiftPrize(input: Partial<DailyGiftPrizeRow> & { id?: string }): DailyGiftPrizeRow {
  let out: DailyGiftPrizeRow | null = null;
  mutateDailyGiftStore((store) => {
    const id = String(input.id ?? "").trim() || newDailyGiftId();
    const idx = store.prizes.findIndex((p) => p.id === id);
    const prev = idx >= 0 ? store.prizes[idx] : undefined;
    const row = normalizeDailyGiftPrize({ ...prev, ...input, id });
    if (!row) throw new Error("invalid_prize");
    if (idx >= 0) store.prizes[idx] = row;
    else store.prizes.push(row);
    out = row;
  });
  return out!;
}

export function deleteDailyGiftPrize(id: string): boolean {
  let removed = false;
  mutateDailyGiftStore((store) => {
    const before = store.prizes.length;
    store.prizes = store.prizes.filter((p) => p.id !== id);
    store.schedules = store.schedules.filter((s) => s.prize_id !== id);
    store.config.queue_prize_ids = store.config.queue_prize_ids.filter((pid) => pid !== id);
    removed = store.prizes.length < before;
  });
  return removed;
}

export function listDailyGiftSchedules(): DailyGiftScheduleRow[] {
  return readFile().schedules;
}

export function setDailyGiftSchedule(day_key: string, prize_id: string): void {
  mutateDailyGiftStore((store) => {
    store.schedules = store.schedules.filter((s) => s.day_key !== day_key);
    store.schedules.push({ day_key, prize_id });
  });
}

export function deleteDailyGiftSchedule(day_key: string): void {
  mutateDailyGiftStore((store) => {
    store.schedules = store.schedules.filter((s) => s.day_key !== day_key);
  });
}

export function appendDailyGiftEvent(input: Omit<DailyGiftEventRow, "id" | "created_at"> & { id?: string }): void {
  mutateDailyGiftStore((store) => {
    store.events.push({
      id: input.id ?? newDailyGiftId(),
      tg_user_id: input.tg_user_id ?? null,
      event: input.event,
      detail: input.detail ?? null,
      created_at: new Date().toISOString(),
    });
  });
}

export function initDailyGiftStore(): void {
  const p = storePath();
  if (!fs.existsSync(p)) writeFile(emptyFile());
}
