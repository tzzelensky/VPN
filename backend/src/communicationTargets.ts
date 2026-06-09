import {
  getUser,
  isTestSubscriptionSystemSegment,
  listCommunicationSegments,
  listTestSubscriptionSegmentUserIds,
  listUsers,
  type CommunicationSegmentRow,
} from "./db.js";
import { telegramHasDialog } from "./telegram/api.js";

export type TargetUserLite = { id: number; name: string; tg_id: string; enable: boolean };

export function toChatId(raw: string): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function uniqTargets(rows: TargetUserLite[]): Array<{ chatId: number; userId: number; userName: string }> {
  const out: Array<{ chatId: number; userId: number; userName: string }> = [];
  const seen = new Set<number>();
  for (const r of rows) {
    const chatId = toChatId(r.tg_id);
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    out.push({ chatId, userId: r.id, userName: r.name });
  }
  return out;
}

function daysLeft(u: { expiry_time: number }): number | null {
  if (!u.expiry_time || u.expiry_time <= 0) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(u.expiry_time);
  end.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((end.getTime() - now.getTime()) / 86400000));
}

function remainingGb(u: { total_gb: number; traffic_up: number; traffic_down: number }): number | null {
  if (u.total_gb <= 0) return null;
  const used = (u.traffic_up + u.traffic_down) / (1024 * 1024 * 1024);
  return Math.max(0, Number((u.total_gb - used).toFixed(2)));
}

function matchesMetric(value: number | null, mode: "any" | "exact" | "range", exact?: number, from?: number, to?: number): boolean {
  if (mode === "any") return true;
  if (value == null) return false;
  if (mode === "exact") return Math.floor(value) === Math.max(0, Math.floor(Number(exact) || 0));
  const a = Math.max(0, Math.floor(Number(from) || 0));
  const b = Math.max(0, Math.floor(Number(to) || 0));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return value >= lo && value <= hi;
}

export async function buildSegmentRows(segmentId: string): Promise<TargetUserLite[]> {
  const segment = listCommunicationSegments().find((s) => s.id === segmentId);
  if (!segment) throw new Error("segment_not_found");
  const all = listUsers();
  let pre: typeof all;
  if (isTestSubscriptionSystemSegment(segment)) {
    const allowed = new Set(listTestSubscriptionSegmentUserIds());
    pre = all.filter((u) => allowed.has(u.id));
  } else if (segment.user_ids.length > 0) {
    pre = all.filter((u) => segment.user_ids.includes(u.id));
  } else {
    pre = all;
  }
  const filtered = pre.filter((u) => {
    const d = daysLeft(u);
    const g = remainingGb(u);
    return (
      matchesMetric(d, segment.days_mode, segment.days_exact, segment.days_from, segment.days_to) &&
      matchesMetric(g, segment.gb_mode, segment.gb_exact, segment.gb_from, segment.gb_to)
    );
  });
  const rows: TargetUserLite[] = [];
  for (const u of filtered) {
    const chatId = toChatId(u.tg_id);
    if (!chatId) continue;
    const hasChat = await telegramHasDialog(chatId);
    if (!hasChat) continue;
    rows.push({ id: u.id, name: u.name, tg_id: u.tg_id, enable: u.enable === 1 });
  }
  return rows;
}

export type RecipientMode = "global" | "single" | "selected" | "segment";

export async function resolveCommunicationRecipients(opts: {
  mode: RecipientMode;
  user_id?: number;
  user_ids?: number[];
  segment_id?: string;
}): Promise<Array<{ chatId: number; userId: number; userName: string }>> {
  if (opts.mode === "global") {
    const all = listUsers().map((u) => ({ id: u.id, name: u.name, tg_id: u.tg_id, enable: u.enable === 1 }));
    return uniqTargets(all);
  }
  if (opts.mode === "single") {
    const id = Number(opts.user_id);
    if (!Number.isFinite(id) || id <= 0) throw new Error("user_required");
    const user = getUser(id);
    if (!user) throw new Error("not_found");
    return uniqTargets([{ id: user.id, name: user.name, tg_id: user.tg_id, enable: user.enable === 1 }]);
  }
  if (opts.mode === "selected") {
    const ids = [...new Set((opts.user_ids ?? []).map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))];
    if (ids.length === 0) throw new Error("users_required");
    const rows: TargetUserLite[] = [];
    for (const id of ids) {
      const u = getUser(id);
      if (!u) continue;
      rows.push({ id: u.id, name: u.name, tg_id: u.tg_id, enable: u.enable === 1 });
    }
    return uniqTargets(rows);
  }
  if (opts.mode === "segment") {
    const segmentId = String(opts.segment_id ?? "").trim();
    if (!segmentId) throw new Error("segment_required");
    const rows = await buildSegmentRows(segmentId);
    return uniqTargets(rows);
  }
  throw new Error("invalid_mode");
}
