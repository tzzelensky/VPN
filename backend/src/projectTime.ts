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

/** Сколько полных календарных суток до даты окончания (0 = сегодня). */
export function calendarDaysUntilExpiry(expiryTime: number, now = Date.now(), tz = projectTimezone()): number {
  if (!expiryTime || expiryTime <= 0) return -1;
  if (expiryTime <= now) return 0;
  return Math.max(0, calendarDaysBetween(now, expiryTime, tz));
}
