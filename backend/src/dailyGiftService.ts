import { createHash } from "node:crypto";
import { getPanelSettings } from "./panelSettings.js";
import {
  appendDailyGiftEvent,
  getDailyGiftConfig,
  mutateDailyGiftStore,
  readDailyGiftStore,
} from "./dailyGiftStore.js";
import {
  newDailyGiftId,
  type DailyGiftClaimRow,
  type DailyGiftPrizeRow,
  type DailyGiftPrizeType,
} from "./dailyGiftTypes.js";
import {
  findUsersByTelegramChatId,
  getUser,
  grantRoulettePurchaseDiscount,
  addRouletteGbToPiggy,
  createPersonalPromoCodeForUser,
  resolveTelegramUsernameByTgUserId,
  snapExpiryTimeToNoonLocal,
  updateUserRow,
  userHasActiveSubscription,
  userHasUnlimitedTrafficForRoulette,
} from "./db.js";
import { pushClientListToAllDeployedServers } from "./userSync.js";

export type DailyGiftWebAppDto = {
  enabled: boolean;
  visible: boolean;
  can_open: boolean;
  opened: boolean;
  golden: boolean;
  reminder_enabled: boolean;
  day_key: string;
  empty_message: string | null;
  banner_image_url: string | null;
  prize_preview: {
    id: string;
    title: string;
    type: DailyGiftPrizeType;
    value: string;
    description: string;
    golden: boolean;
  } | null;
  opened_gift: {
    title: string;
    type: DailyGiftPrizeType;
    value: string;
    description: string;
    golden: boolean;
    status: "applied" | "failed" | "pending";
    error_message: string | null;
    credit_mode: "direct" | "piggy" | null;
  } | null;
  next_reset_at: string | null;
};

function projectTimezone(): string {
  const tz = String(getPanelSettings().ui.timezone ?? "").trim();
  return tz || "Asia/Yekaterinburg";
}

function localYmdInTz(ts: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ts),
  );
}

function localHmInTz(ts: number, tz: string): { hour: number; minute: number } {
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

function subtractCalendarDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export function getGiftDayKey(ts = Date.now(), tz?: string): string {
  const zone = tz ?? projectTimezone();
  const cfg = getDailyGiftConfig();
  const ymd = localYmdInTz(ts, zone);
  const { hour, minute } = localHmInTz(ts, zone);
  const reset = cfg.reset_hour * 60 + cfg.reset_minute;
  const now = hour * 60 + minute;
  if (now >= reset) return ymd;
  return subtractCalendarDay(ymd);
}

export function getNextGiftResetMs(ts = Date.now(), tz?: string): number {
  const zone = tz ?? projectTimezone();
  const currentDayKey = getGiftDayKey(ts, zone);
  let lo = ts + 1;
  let hi = ts + 36 * 3600_000;
  while (getGiftDayKey(hi, zone) === currentDayKey) hi += 24 * 3600_000;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (getGiftDayKey(mid, zone) === currentDayKey) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function getCurrentGiftPeriodStartMs(ts = Date.now(), tz?: string): number {
  const zone = tz ?? projectTimezone();
  const currentDayKey = getGiftDayKey(ts, zone);
  let lo = ts - 36 * 3600_000;
  let hi = ts;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (getGiftDayKey(mid, zone) === currentDayKey) hi = mid;
    else lo = mid;
  }
  return hi;
}

function tgUserHasActiveSubscription(tgUserId: number): boolean {
  return findUsersByTelegramChatId(tgUserId).some(userHasActiveSubscription);
}

function prizeAvailableOnDay(p: DailyGiftPrizeRow, dayKey: string): boolean {
  if (!p.active) return false;
  if (p.valid_from && dayKey < p.valid_from.slice(0, 10)) return false;
  if (p.valid_until && dayKey > p.valid_until.slice(0, 10)) return false;
  if (p.max_total_claims != null && p.max_total_claims > 0 && p.claims_count >= p.max_total_claims) return false;
  return true;
}

function activePrizesForDay(dayKey: string): DailyGiftPrizeRow[] {
  return readDailyGiftStore()
    .prizes.filter((p) => prizeAvailableOnDay(p, dayKey))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function resolvePrizeForUser(dayKey: string, tgUserId: number, userId?: number): DailyGiftPrizeRow | null {
  const prizes = activePrizesForDay(dayKey);
  if (!prizes.length) return null;
  return weightedPick(prizes, `${dayKey}:${tgUserId}:${userId ?? 0}`);
}

function resolveDailyGiftPrize(dayKey: string, tgUserId: number, userId?: number): DailyGiftPrizeRow | null {
  const cfg = getDailyGiftConfig();
  if (cfg.selection_mode === "random") {
    return resolvePrizeForUser(dayKey, tgUserId, userId);
  }
  return ensureDayAssignment(dayKey);
}

function weightedPick(prizes: DailyGiftPrizeRow[], seed: string): DailyGiftPrizeRow | null {
  if (!prizes.length) return null;
  const total = prizes.reduce((s, p) => s + Math.max(1, p.weight), 0);
  if (total <= 0) return prizes[0] ?? null;
  const hash = createHash("sha256").update(seed).digest();
  let roll = hash.readUInt32BE(0) % total;
  for (const p of prizes) {
    roll -= Math.max(1, p.weight);
    if (roll < 0) return p;
  }
  return prizes[prizes.length - 1] ?? null;
}

export function resolvePrizeForDay(dayKey: string): DailyGiftPrizeRow | null {
  const store = readDailyGiftStore();
  const cfg = store.config;
  const assigned = store.day_assignments.find((a) => a.day_key === dayKey);
  if (assigned) {
    const p = store.prizes.find((x) => x.id === assigned.prize_id);
    if (p && prizeAvailableOnDay(p, dayKey)) return p;
  }

  const scheduled = store.schedules.find((s) => s.day_key === dayKey);
  if (scheduled) {
    const p = store.prizes.find((x) => x.id === scheduled.prize_id);
    if (p && prizeAvailableOnDay(p, dayKey)) return p;
  }

  if (cfg.selection_mode === "scheduled") {
    return null;
  }

  if (cfg.selection_mode === "queue") {
    const ids = cfg.queue_prize_ids.filter(Boolean);
    if (!ids.length) return weightedPick(activePrizesForDay(dayKey), dayKey);
    let idx = cfg.queue_index;
    for (let i = 0; i < ids.length; i++) {
      const pid = ids[(idx + i) % ids.length]!;
      const p = store.prizes.find((x) => x.id === pid);
      if (p && prizeAvailableOnDay(p, dayKey)) return p;
    }
    return null;
  }

  return weightedPick(activePrizesForDay(dayKey), dayKey);
}

function ensureDayAssignment(dayKey: string): DailyGiftPrizeRow | null {
  const existing = readDailyGiftStore().day_assignments.find((a) => a.day_key === dayKey);
  if (existing) {
    const p = readDailyGiftStore().prizes.find((x) => x.id === existing.prize_id);
    if (p && prizeAvailableOnDay(p, dayKey)) return p;
  }
  const prize = resolvePrizeForDay(dayKey);
  if (!prize) return null;
  mutateDailyGiftStore((store) => {
    store.day_assignments = store.day_assignments.filter((a) => a.day_key !== dayKey);
    store.day_assignments.push({ day_key: dayKey, prize_id: prize.id });
    if (store.config.selection_mode === "queue") {
      const ids = store.config.queue_prize_ids;
      const idx = ids.indexOf(prize.id);
      if (idx >= 0) store.config.queue_index = (idx + 1) % Math.max(1, ids.length);
    }
  });
  return prize;
}

function claimMatchesUser(c: DailyGiftClaimRow, tgUserId: number, userId: number): boolean {
  if (c.user_id === userId) return true;
  if (c.user_id == null || c.user_id <= 0) {
    return resolveUserIdForClaim(c, tgUserId) === userId;
  }
  return false;
}

function userClaimsForDayAndSub(tgUserId: number, dayKey: string, userId: number): DailyGiftClaimRow | undefined {
  const dayClaims = readDailyGiftStore().claims.filter(
    (c) => c.tg_user_id === tgUserId && c.day_key === dayKey,
  );
  return dayClaims.find((c) => claimMatchesUser(c, tgUserId, userId));
}

function userClaimForCurrentPeriod(tgUserId: number, userId?: number, ts = Date.now()): DailyGiftClaimRow | undefined {
  const dayKey = getGiftDayKey(ts);
  if (userId != null && userId > 0) {
    const exact = userClaimsForDayAndSub(tgUserId, dayKey, userId);
    if (exact) return exact;
  } else {
    const legacy = readDailyGiftStore().claims.find((c) => c.tg_user_id === tgUserId && c.day_key === dayKey);
    if (legacy) return legacy;
  }
  const periodStart = getCurrentGiftPeriodStartMs(ts);
  return readDailyGiftStore()
    .claims.filter((c) => c.tg_user_id === tgUserId)
    .filter((c) => userId == null || userId <= 0 || claimMatchesUser(c, tgUserId, userId))
    .filter((c) => c.status === "applied" || c.status === "pending")
    .filter((c) => Date.parse(c.opened_at) >= periodStart - 60_000)
    .sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at))[0];
}

function countUserPrizeClaims(tgUserId: number, prizeId: string, userId?: number): number {
  return readDailyGiftStore().claims.filter(
    (c) =>
      c.tg_user_id === tgUserId &&
      c.prize_id === prizeId &&
      c.status === "applied" &&
      (userId == null || userId <= 0 || claimMatchesUser(c, tgUserId, userId)),
  ).length;
}

function resolveUserIdForClaim(claim: DailyGiftClaimRow, tgUserId: number): number | null {
  if (claim.user_id != null && claim.user_id > 0) return claim.user_id;
  return findUsersByTelegramChatId(tgUserId).sort((a, b) => a.id - b.id)[0]?.id ?? null;
}

function resolveClaimGolden(claim: DailyGiftClaimRow): boolean {
  if (claim.prize_golden === true) return true;
  const prize = readDailyGiftStore().prizes.find((p) => p.id === claim.prize_id);
  return prize?.golden === true;
}

function normalizeTgUsername(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().replace(/^@/, "");
  return s || null;
}

function claimTgUsername(tgUserId: number, hint?: string | null): string | null {
  return normalizeTgUsername(hint) ?? resolveTelegramUsernameByTgUserId(tgUserId);
}

function enrichClaimRow(c: DailyGiftClaimRow): DailyGiftClaimRow {
  const stored = normalizeTgUsername(c.tg_username);
  const resolved = stored ?? resolveTelegramUsernameByTgUserId(c.tg_user_id);
  const resolvedUserId = resolveUserIdForClaim(c, c.tg_user_id);
  const u = resolvedUserId ? getUser(resolvedUserId) : undefined;
  const subscriptionName = u ? String(u.name ?? u.email ?? "").trim() || null : null;
  return { ...c, tg_username: resolved, subscription_name: subscriptionName };
}

function prizeGoldenFlag(prize: DailyGiftPrizeRow | null | undefined): boolean {
  return prize?.golden === true;
}

function resolveClaimCreditMode(claim: DailyGiftClaimRow, tgUserId: number): "direct" | "piggy" {
  if (claim.credit_mode === "piggy") return "piggy";
  if (claim.prize_type !== "gb" || claim.status !== "applied") return "direct";
  const uid = resolveUserIdForClaim(claim, tgUserId);
  if (uid && userHasUnlimitedTrafficForRoulette(uid)) return "piggy";
  return "direct";
}

async function applyPrizeToUser(
  prize: DailyGiftPrizeRow,
  tgUserId: number,
  userId: number | null,
): Promise<
  | { ok: true; credit_mode?: "direct" | "piggy"; promo_code?: string }
  | { ok: false; error: string }
> {
  if (prize.type === "promo") {
    const percent = Math.min(100, Math.max(1, Math.floor(Number(prize.value) || 0)));
    if (percent < 1) return { ok: false, error: "invalid_promo_discount" };
    const row = createPersonalPromoCodeForUser({
      tg_user_id: tgUserId,
      discount_percent: percent,
      name: prize.title.trim() || `Подарок ${percent}%`,
      source: "daily_gift",
      source_ref: prize.id,
    });
    return { ok: true, credit_mode: "direct", promo_code: row.code };
  }
  if (prize.type === "discount") {
    const percent = Math.min(100, Math.max(1, Math.floor(Number(prize.value) || 0)));
    if (percent < 1) return { ok: false, error: "invalid_discount" };
    grantRoulettePurchaseDiscount(tgUserId, percent, Math.floor(Date.now() / 1000), {
      source: "daily_gift",
      source_label: prize.title.trim() || `Ежедневный подарок ${percent}%`,
    });
    return { ok: true, credit_mode: "direct" };
  }
  const uid = userId ?? findUsersByTelegramChatId(tgUserId).sort((a, b) => a.id - b.id)[0]?.id;
  if (!uid) return { ok: false, error: "no_subscription" };
  const user = getUser(uid);
  if (!user) return { ok: false, error: "user_not_found" };
  if (prize.type === "gb") {
    const gb = Math.max(0, Math.floor(Number(prize.value) || 0));
    if (gb <= 0) return { ok: false, error: "invalid_gb" };
    if (userHasUnlimitedTrafficForRoulette(uid)) {
      addRouletteGbToPiggy(uid, gb);
      return { ok: true, credit_mode: "piggy" };
    }
    updateUserRow(uid, { total_gb: user.total_gb + gb });
  } else if (prize.type === "days") {
    const days = Math.max(0, Math.floor(Number(prize.value) || 0));
    if (days <= 0) return { ok: false, error: "invalid_days" };
    const base = Math.max(Date.now(), user.expiry_time > 0 ? user.expiry_time : 0);
    updateUserRow(uid, { expiry_time: snapExpiryTimeToNoonLocal(base + days * 86_400_000) });
  }
  try {
    await pushClientListToAllDeployedServers();
  } catch {
    // UI flow continues even if sync fails
  }
  return { ok: true, credit_mode: "direct" };
}

export function getDailyGiftReminderEnabled(tgUserId: number): boolean {
  const row = readDailyGiftStore().reminders.find((r) => r.tg_user_id === tgUserId);
  return row?.enabled === true;
}

export function setDailyGiftReminder(tgUserId: number, enabled: boolean): boolean {
  mutateDailyGiftStore((store) => {
    const idx = store.reminders.findIndex((r) => r.tg_user_id === tgUserId);
    const row = {
      tg_user_id: tgUserId,
      enabled,
      updated_at: new Date().toISOString(),
      last_notify_day_key: idx >= 0 ? store.reminders[idx]!.last_notify_day_key : null,
    };
    if (idx >= 0) store.reminders[idx] = row;
    else store.reminders.push(row);
  });
  appendDailyGiftEvent({
    tg_user_id: tgUserId,
    event: enabled ? "reminder_enabled" : "reminder_disabled",
    detail: null,
  });
  return enabled;
}

function userHasActiveSubscriptionById(userId: number): boolean {
  const user = getUser(userId);
  return Boolean(user && userHasActiveSubscription(user));
}

function resolveTargetUserId(
  tgUserId: number,
  userId?: number,
): { ok: true; userId: number } | { ok: false; error: string } {
  const linked = findUsersByTelegramChatId(tgUserId).filter(userHasActiveSubscription);
  if (linked.length === 0) return { ok: false, error: "no_subscription" };
  if (userId != null && userId > 0) {
    if (!linked.some((u) => u.id === userId)) return { ok: false, error: "forbidden" };
    return { ok: true, userId };
  }
  if (linked.length === 1) return { ok: true, userId: linked[0]!.id };
  return { ok: false, error: "subscription_required" };
}

export function buildDailyGiftWebAppState(tgUserId: number, userId?: number): DailyGiftWebAppDto {
  const cfg = getDailyGiftConfig();
  const dayKey = getGiftDayKey();
  const nextResetAt = new Date(getNextGiftResetMs()).toISOString();
  const reminder = getDailyGiftReminderEnabled(tgUserId);
  const target = resolveTargetUserId(tgUserId, userId);
  const resolvedUserId = target.ok ? target.userId : undefined;
  const hasActiveSub = resolvedUserId ? userHasActiveSubscriptionById(resolvedUserId) : tgUserHasActiveSubscription(tgUserId);
  if (!cfg.enabled) {
    return {
      enabled: false,
      visible: false,
      can_open: false,
      opened: false,
      golden: false,
      reminder_enabled: reminder,
      day_key: dayKey,
      empty_message: null,
      banner_image_url: null,
      prize_preview: null,
      opened_gift: null,
      next_reset_at: null,
    };
  }
  if (!hasActiveSub) {
    return {
      enabled: true,
      visible: false,
      can_open: false,
      opened: false,
      golden: false,
      reminder_enabled: reminder,
      day_key: dayKey,
      empty_message: null,
      banner_image_url: null,
      prize_preview: null,
      opened_gift: null,
      next_reset_at: nextResetAt,
    };
  }
  const prize = resolvedUserId ? resolveDailyGiftPrize(dayKey, tgUserId, resolvedUserId) : resolveDailyGiftPrize(dayKey, tgUserId);
  const claim = resolvedUserId ? userClaimForCurrentPeriod(tgUserId, resolvedUserId) : userClaimForCurrentPeriod(tgUserId);
  const hasPrize = Boolean(prize);
  const applied = claim?.status === "applied";
  const pending = claim?.status === "pending";
  const golden = prizeGoldenFlag(prize) || (claim ? resolveClaimGolden(claim) : false);
  return {
    enabled: true,
    visible: hasPrize,
    can_open: hasPrize && !applied && !pending,
    opened: Boolean(claim),
    golden,
    reminder_enabled: reminder,
    day_key: dayKey,
    empty_message: hasPrize ? null : "Подарок скоро появится",
    banner_image_url: cfg.banner_image_url,
    prize_preview: prize
      ? {
          id: prize.id,
          title: prize.title,
          type: prize.type,
          value: prize.value,
          description: prize.description,
          golden: prizeGoldenFlag(prize),
        }
      : null,
    opened_gift: claim
      ? {
          title: claim.prize_title,
          type: claim.prize_type,
          value: claim.prize_value,
          description: claim.prize_description,
          golden: resolveClaimGolden(claim),
          status: claim.status === "applied" ? "applied" : claim.status === "failed" ? "failed" : "pending",
          error_message: claim.error_message,
          credit_mode: resolveClaimCreditMode(claim, tgUserId),
        }
      : null,
    next_reset_at: nextResetAt,
  };
}

export async function claimDailyGift(
  tgUserId: number,
  userId?: number,
  opts?: { tgUsername?: string | null },
): Promise<
  | { ok: true; gift: NonNullable<DailyGiftWebAppDto["opened_gift"]>; user_id: number }
  | { ok: false; error: string; gift?: NonNullable<DailyGiftWebAppDto["opened_gift"]>; user_id?: number }
> {
  const cfg = getDailyGiftConfig();
  if (!cfg.enabled) return { ok: false, error: "disabled" };
  const target = resolveTargetUserId(tgUserId, userId);
  if (!target.ok) return { ok: false, error: target.error };
  const targetUserId = target.userId;
  if (!userHasActiveSubscriptionById(targetUserId)) return { ok: false, error: "no_subscription" };
  const dayKey = getGiftDayKey();
  const existing = userClaimForCurrentPeriod(tgUserId, targetUserId);
  if (existing?.status === "applied") {
    return {
      ok: true,
      user_id: targetUserId,
      gift: {
        title: existing.prize_title,
        type: existing.prize_type,
        value: existing.prize_value,
        description: existing.prize_description,
        golden: resolveClaimGolden(existing),
        status: "applied",
        error_message: null,
        credit_mode: resolveClaimCreditMode(existing, tgUserId),
      },
    };
  }
  if (existing?.status === "pending") {
    return { ok: false, error: "already_claimed" };
  }
  if (existing?.status === "failed") {
    // allow retry on failed claims
  } else if (existing) {
    return { ok: false, error: "already_claimed" };
  }

  const prize = resolveDailyGiftPrize(dayKey, tgUserId, targetUserId);
  if (!prize) return { ok: false, error: "no_prize", user_id: targetUserId };
  if (
    prize.max_per_user != null &&
    prize.max_per_user > 0 &&
    countUserPrizeClaims(tgUserId, prize.id, targetUserId) >= prize.max_per_user
  ) {
    return { ok: false, error: "prize_limit_reached", user_id: targetUserId };
  }

  appendDailyGiftEvent({ tg_user_id: tgUserId, event: "banner_click", detail: dayKey });

  const claimId = newDailyGiftId();
  const openedAt = new Date().toISOString();
  const tgUsername = claimTgUsername(tgUserId, opts?.tgUsername);

  mutateDailyGiftStore((store) => {
    store.claims = store.claims.filter((c) => {
      if (c.tg_user_id !== tgUserId || c.day_key !== dayKey) return true;
      return !claimMatchesUser(c, tgUserId, targetUserId);
    });
    store.claims.push({
      id: claimId,
      tg_user_id: tgUserId,
      tg_username: tgUsername,
      user_id: targetUserId,
      day_key: dayKey,
      prize_id: prize.id,
      prize_type: prize.type,
      prize_title: prize.title,
      prize_value: prize.value,
      prize_description: prize.description,
      prize_golden: prizeGoldenFlag(prize),
      status: "pending",
      error_message: null,
      credit_mode: null,
      opened_at: openedAt,
      applied_at: null,
    });
  });

  let applyError: string | null = null;
  let applied = false;

  const applyResult = await applyPrizeToUser(prize, tgUserId, targetUserId);
  if (!applyResult.ok) {
    applyError = applyResult.error;
  } else {
    applied = true;
  }
  const creditMode = applyResult.ok ? (applyResult.credit_mode ?? "direct") : "direct";
  const prizeValueApplied =
    applyResult.ok && prize.type === "promo" && applyResult.promo_code
      ? applyResult.promo_code
      : prize.value;

  mutateDailyGiftStore((store) => {
    const idx = store.claims.findIndex((c) => c.id === claimId);
    if (idx < 0) {
      store.claims.push({
        id: claimId,
        tg_user_id: tgUserId,
        tg_username: tgUsername,
        user_id: targetUserId,
        day_key: dayKey,
        prize_id: prize.id,
        prize_type: prize.type,
        prize_title: prize.title,
        prize_value: prizeValueApplied,
        prize_description: prize.description,
        prize_golden: prizeGoldenFlag(prize),
        status: applied ? "applied" : "failed",
        error_message: applyError,
        credit_mode: applied ? creditMode : null,
        opened_at: openedAt,
        applied_at: applied ? new Date().toISOString() : null,
      });
    } else {
      store.claims[idx] = {
        ...store.claims[idx]!,
        prize_value: prizeValueApplied,
        status: applied ? "applied" : "failed",
        error_message: applyError,
        credit_mode: applied ? creditMode : null,
        applied_at: applied ? new Date().toISOString() : null,
      };
    }
    if (applied) {
      const pi = store.prizes.findIndex((p) => p.id === prize.id);
      if (pi >= 0) store.prizes[pi]!.claims_count += 1;
    }
  });

  const gift = {
    title: prize.title,
    type: prize.type,
    value: prizeValueApplied,
    description: prize.description,
    golden: prizeGoldenFlag(prize),
    status: applied ? ("applied" as const) : ("failed" as const),
    error_message: applyError,
    credit_mode: applied ? creditMode : null,
  };

  appendDailyGiftEvent({
    tg_user_id: tgUserId,
    event: applied ? "gift_applied" : "gift_apply_failed",
    detail: applyError ?? prize.id,
  });

  if (!applied) {
    return { ok: false, error: applyError ?? "apply_failed", gift, user_id: targetUserId };
  }
  return { ok: true, gift, user_id: targetUserId };
}

export function logDailyGiftBlockSeen(tgUserId: number): void {
  appendDailyGiftEvent({ tg_user_id: tgUserId, event: "block_seen", detail: getGiftDayKey() });
}

export function resetDailyGiftUserClaim(
  tgUserId: number,
  dayKey?: string,
): { ok: true; removed: number; day_key: string } | { ok: false; error: string } {
  const id = Math.floor(Number(tgUserId));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "bad_payload" };
  const key = dayKey?.trim() || getGiftDayKey();
  let removed = 0;
  const periodStart = getCurrentGiftPeriodStartMs();
  mutateDailyGiftStore((store) => {
    const before = store.claims.length;
    store.claims = store.claims.filter((c) => {
      if (c.tg_user_id !== id) return true;
      if (c.day_key === key) return false;
      if (
        (c.status === "applied" || c.status === "pending") &&
        Date.parse(c.opened_at) >= periodStart - 60_000
      ) {
        return false;
      }
      return true;
    });
    removed = before - store.claims.length;
  });
  if (removed === 0) return { ok: false, error: "no_claim" };
  appendDailyGiftEvent({ tg_user_id: id, event: "admin_reset_claim", detail: key });
  return { ok: true, removed, day_key: key };
}

export function listDailyGiftClaims(limit = 500): DailyGiftClaimRow[] {
  return readDailyGiftStore()
    .claims.slice()
    .sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at))
    .slice(0, limit)
    .map(enrichClaimRow);
}

export function listDailyGiftEvents(limit = 500) {
  return readDailyGiftStore()
    .events.slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit);
}

export function isDailyGiftNotifyWindow(ts = Date.now()): boolean {
  const cfg = getDailyGiftConfig();
  const tz = projectTimezone();
  const { hour, minute } = localHmInTz(ts, tz);
  return hour === cfg.notify_hour && minute === cfg.notify_minute;
}

export function markDailyGiftNotified(tgUserId: number, dayKey: string): void {
  mutateDailyGiftStore((store) => {
    const idx = store.reminders.findIndex((r) => r.tg_user_id === tgUserId);
    if (idx < 0) return;
    store.reminders[idx] = { ...store.reminders[idx]!, last_notify_day_key: dayKey, updated_at: new Date().toISOString() };
  });
}

export function listDailyGiftReminderTargets(dayKey: string): number[] {
  const store = readDailyGiftStore();
  if (!store.config.enabled) return [];
  return store.reminders
    .filter((r) => r.enabled && r.last_notify_day_key !== dayKey)
    .map((r) => r.tg_user_id);
}
