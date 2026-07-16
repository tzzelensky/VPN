import { getPanelSettings } from "./panelSettings.js";

const DAY_MS = 86_400_000;

export function projectTimezone(): string {
  const tz = String(getPanelSettings().ui.timezone ?? "").trim();
  return tz || "Asia/Yekaterinburg";
}

export function localYmdInTz(ts: number, tz = projectTimezone()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

export function localHmInTz(ts: number, tz = projectTimezone()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hour, minute };
}

export function isNotifySlot(hour: number, minute: number, ts = Date.now(), tz = projectTimezone()): boolean {
  const hm = localHmInTz(ts, tz);
  return hm.hour === hour && hm.minute === minute;
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return Date.UTC(y, m - 1, d);
}

/** Календарные сутки от fromTs до toTs включительно по поясу (to − from). */
export function calendarDaysBetween(fromTs: number, toTs: number, tz = projectTimezone()): number {
  const fromYmd = localYmdInTz(fromTs, tz);
  const toYmd = localYmdInTz(toTs, tz);
  return Math.round((ymdToUtcMs(toYmd) - ymdToUtcMs(fromYmd)) / DAY_MS);
}

export function isSameLocalDay(a: number, b: number, tz = projectTimezone()): boolean {
  return localYmdInTz(a, tz) === localYmdInTz(b, tz);
}

/** Триггерные рассылки: отправка с 12:00 включительно до 22:00 (22:00 уже нельзя). */
export const TRIGGER_SEND_WINDOW_START_HOUR = 12;
export const TRIGGER_SEND_WINDOW_END_HOUR = 22;

export function isTriggerSendWindowOpen(ts = Date.now(), tz = projectTimezone()): boolean {
  const { hour } = localHmInTz(ts, tz);
  return hour >= TRIGGER_SEND_WINDOW_START_HOUR && hour < TRIGGER_SEND_WINDOW_END_HOUR;
}

function utcMsForLocalHm(ymd: string, hour: number, minute: number, tz: string): number {
  const target = hour * 60 + minute;
  const [y, mo, d] = ymd.split("-").map(Number);
  let lo = Date.UTC(y, mo - 1, d) - 12 * 3600_000;
  let hi = lo + 36 * 3600_000;
  for (let i = 0; i < 48; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const midYmd = localYmdInTz(mid, tz);
    const midHm = localHmInTz(mid, tz);
    const midTotal = midHm.hour * 60 + midHm.minute;
    if (midYmd < ymd || (midYmd === ymd && midTotal < target)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Ближайший момент отправки триггера (>= ts) в разрешённом окне. */
export function nextTriggerSendWindowOpen(ts = Date.now(), tz = projectTimezone()): number {
  if (isTriggerSendWindowOpen(ts, tz)) return ts;
  const { hour } = localHmInTz(ts, tz);
  const ymd = localYmdInTz(ts, tz);
  if (hour < TRIGGER_SEND_WINDOW_START_HOUR) {
    return utcMsForLocalHm(ymd, TRIGGER_SEND_WINDOW_START_HOUR, 0, tz);
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const nextYmd = localYmdInTz(nextDay.getTime(), tz);
  return utcMsForLocalHm(nextYmd, TRIGGER_SEND_WINDOW_START_HOUR, 0, tz);
}

/** Сколько полных календарных суток до даты окончания (0 = сегодня). */
export function calendarDaysUntilExpiry(expiryTime: number, now = Date.now(), tz = projectTimezone()): number {
  if (!expiryTime || expiryTime <= 0) return -1;
  if (expiryTime <= now) return 0;
  return Math.max(0, calendarDaysBetween(now, expiryTime, tz));
}
