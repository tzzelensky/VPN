import { randomInt } from "node:crypto";
import {
  consumeGameTicketForUser,
  findUsersByTelegramChatId,
  getDropperGameConfig,
  getGameTicketsPerPurchase,
  getRoulettePrizes,
  getRouletteSpinById,
  addRouletteGbToPiggy,
  grantRoulettePurchaseDiscount,
  getUser,
  ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD,
  userHasUnlimitedTrafficForRoulette,
  getWebAppActiveGame,
  insertRouletteSpin,
  listRouletteSpins,
  normalizeRoulettePrizeChances,
  readRouletteConfig,
  saveRoulettePrizes,
  setWebAppActiveGame,
  snapExpiryTimeToNoonLocal,
  updateRouletteSpin,
  updateUserRow,
  userHasActiveSubscription,
  type RoulettePrizeRow,
  type RouletteSpinRow,
} from "./db.js";
import { sendTelegramHtml } from "./telegram/api.js";
import { getTelegramPaymentNotifyChatIds } from "./telegram/env.js";

export type RoulettePrizeType =
  | "subscription_days"
  | "traffic_gb"
  | "tariff_upgrade"
  | "promo_discount"
  | "extra_ticket"
  | "no_prize"
  | "custom";

export const ROULETTE_PRIZE_TYPE_LABELS: Record<RoulettePrizeType, string> = {
  subscription_days: "Дни подписки",
  traffic_gb: "ГБ трафика",
  tariff_upgrade: "Улучшение тарифа",
  promo_discount: "Скидка",
  extra_ticket: "Пустой сектор",
  no_prize: "Пустой сектор",
  custom: "Кастомный",
};

export function isRouletteLosePrizeType(type: string): boolean {
  return type === "no_prize" || type === "extra_ticket";
}

/** Активные призы на колесе — тот же порядок, что в Mini App. */
export function getActiveRoulettePrizesForWheel(): RoulettePrizeRow[] {
  return getRoulettePrizes(false).filter((p) => p.active && !p.archived);
}

export function prizeIndexOnWheel(prizeId: string): number {
  const list = getActiveRoulettePrizesForWheel();
  const idx = list.findIndex((p) => p.id === prizeId);
  return idx >= 0 ? idx : 0;
}

export const DEFAULT_ROULETTE_PRIZES: Omit<RoulettePrizeRow, "id" | "created_at" | "updated_at">[] = [
  { title: "+1 день подписки", type: "subscription_days", value: 1, chance_percent: 25, active: true, color: "#4ade80", icon: "📅", win_text: "Поздравляем! Вы выиграли +1 день подписки 🎉", sort_order: 0, archived: false },
  { title: "+5 ГБ трафика", type: "traffic_gb", value: 5, chance_percent: 25, active: true, color: "#60a5fa", icon: "📶", win_text: "Поздравляем! Вы выиграли +5 ГБ трафика 🎉", sort_order: 1, archived: false },
  { title: "+2 дня подписки", type: "subscription_days", value: 2, chance_percent: 15, active: true, color: "#34d399", icon: "📅", win_text: "Поздравляем! Вы выиграли +2 дня подписки 🎉", sort_order: 2, archived: false },
  { title: "+10 ГБ трафика", type: "traffic_gb", value: 10, chance_percent: 15, active: true, color: "#818cf8", icon: "📶", win_text: "Поздравляем! Вы выиграли +10 ГБ трафика 🎉", sort_order: 3, archived: false },
  { title: "Улучшение тарифа", type: "tariff_upgrade", value: 1, chance_percent: 7, active: true, color: "#fbbf24", icon: "⬆️", win_text: "Поздравляем! Ваш тариф улучшен на 1 уровень 🎉", sort_order: 4, archived: false },
  { title: "+30 ГБ трафика", type: "traffic_gb", value: 30, chance_percent: 8, active: true, color: "#a78bfa", icon: "📶", win_text: "Поздравляем! Вы выиграли +30 ГБ трафика 🎉", sort_order: 5, archived: false },
  { title: "+5 дней подписки", type: "subscription_days", value: 5, chance_percent: 5, active: true, color: "#22c55e", icon: "📅", win_text: "Поздравляем! Вы выиграли +5 дней подписки 🎉", sort_order: 6, archived: false },
  { title: "+50 ГБ трафика", type: "traffic_gb", value: 50, chance_percent: 0, active: false, color: "#c084fc", icon: "💎", win_text: "Поздравляем! Вы выиграли +50 ГБ трафика 🎉", sort_order: 7, archived: false },
  { title: "+10 дней подписки", type: "subscription_days", value: 10, chance_percent: 0, active: false, color: "#16a34a", icon: "💎", win_text: "Поздравляем! Вы выиграли +10 дней подписки 🎉", sort_order: 8, archived: false },
  { title: "Скидка 20%", type: "promo_discount", value: 20, chance_percent: 0, active: false, color: "#fb923c", icon: "🏷️", win_text: "Поздравляем! Скидка 20% на следующую покупку 🎉", sort_order: 9, archived: false },
  {
    title: "Мимо",
    type: "no_prize",
    value: 0,
    chance_percent: 0,
    active: false,
    color: "#94a3b8",
    icon: "😔",
    win_text: "Увы, в этот раз не повезло. В другой раз точно повезёт!",
    sort_order: 10,
    archived: false,
  },
];

export function ensureDefaultRoulettePrizes(): RoulettePrizeRow[] {
  const existing = getRoulettePrizes(false);
  if (existing.length > 0) return existing;
  return saveRoulettePrizes(
    DEFAULT_ROULETTE_PRIZES.map((p, i) => ({
      ...p,
      id: `rp_default_${i}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })) as RoulettePrizeRow[],
  );
}

export function activePrizesChanceSum(prizes: RoulettePrizeRow[]): number {
  return prizes.filter((p) => p.active && !p.archived).reduce((s, p) => s + (Number(p.chance_percent) || 0), 0);
}

export function pickWeightedPrize(prizes: RoulettePrizeRow[]): RoulettePrizeRow | null {
  const active = prizes.filter((p) => p.active && !p.archived && (Number(p.chance_percent) || 0) > 0);
  if (active.length === 0) return null;
  const total = active.reduce((s, p) => s + (Number(p.chance_percent) || 0), 0);
  if (total <= 0) return null;
  let roll = randomInt(0, Math.floor(total * 100)) / 100;
  for (const p of active) {
    roll -= Number(p.chance_percent) || 0;
    if (roll <= 0) return p;
  }
  return active[active.length - 1] ?? null;
}

function inferPlanFromUser(u: { total_gb: number }): 1 | 2 | 3 {
  if (u.total_gb <= 0) return 3;
  if (u.total_gb >= 250) return 2;
  return 1;
}

function addDaysToUser(userId: number, days: number): void {
  const u = getUser(userId);
  if (!u) return;
  const base = Math.max(Date.now(), u.expiry_time > 0 ? u.expiry_time : 0);
  const newExp = snapExpiryTimeToNoonLocal(base + days * 86_400_000);
  updateUserRow(userId, { expiry_time: newExp });
}

export type PrizeApplyResult = {
  status: "success" | "pending" | "failed";
  error_message?: string;
  applied_title?: string;
  applied_message?: string;
};

export function applyRoulettePrize(
  tgUserId: number,
  prize: RoulettePrizeRow,
  spinId: number,
  targetUserId: number,
): PrizeApplyResult {
  const users = findUsersByTelegramChatId(tgUserId);
  const primary = users.find((u) => u.id === targetUserId) ?? users[0];

  try {
    switch (prize.type as RoulettePrizeType) {
      case "subscription_days": {
        const days = Math.max(1, Math.floor(Number(prize.value) || 1));
        if (!primary) {
          return { status: "pending", applied_title: `+${days} дн. (ожидает подписку)` };
        }
        if (!userHasActiveSubscription(primary)) {
          return { status: "pending", applied_title: `+${days} дн. (ожидает подписку)` };
        }
        addDaysToUser(primary.id, days);
        return { status: "success", applied_title: prize.title };
      }
      case "traffic_gb": {
        const gb = Math.max(1, Math.floor(Number(prize.value) || 1));
        if (!primary) return { status: "pending", applied_title: `+${gb} ГБ (ожидает подписку)` };
        if (userHasUnlimitedTrafficForRoulette(primary.id)) {
          const total = addRouletteGbToPiggy(primary.id, gb);
          const canExchange = total >= ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD;
          return {
            status: "success",
            applied_title: `+${gb} ГБ в копилку`,
            applied_message: canExchange
              ? `В копилке ${total} ГБ — можно обменять ${ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD} ГБ на билет!`
              : `На безлимитном тарифе ГБ копятся в копилке: ${total} / ${ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD} ГБ.`,
          };
        }
        if (!userHasActiveSubscription(primary)) {
          return { status: "pending", applied_title: `+${gb} ГБ (ожидает подписку)` };
        }
        updateUserRow(primary.id, { total_gb: primary.total_gb + gb });
        return { status: "success", applied_title: prize.title };
      }
      case "tariff_upgrade": {
        if (!primary) return { status: "pending", applied_title: "Улучшение тарифа (ожидает подписку)" };
        const plan = inferPlanFromUser(primary);
        if (plan >= 3) {
          addDaysToUser(primary.id, 7);
          return {
            status: "success",
            applied_title: "+7 дней в подарок",
            applied_message:
              "У вас уже максимальный тариф — улучшать некуда. Вот +7 дней подписки в подарок!",
          };
        }
        if (plan === 2) {
          updateUserRow(primary.id, { total_gb: 0 });
          return { status: "success", applied_title: "Тариф улучшен до безлимита" };
        }
        updateUserRow(primary.id, { total_gb: 250 });
        return { status: "success", applied_title: "Тариф улучшен до 250 ГБ" };
      }
      case "extra_ticket":
      case "no_prize":
        return { status: "success", applied_title: "Без приза" };
      case "promo_discount": {
        const percent = Math.min(100, Math.max(1, Math.floor(Number(prize.value) || 20)));
        grantRoulettePurchaseDiscount(tgUserId, percent, spinId);
        return {
          status: "success",
          applied_title: `Скидка ${percent}% на покупку`,
          applied_message: `Скидка ${percent}% автоматически применится при следующей оплате в боте или Mini App.`,
        };
      }
      default:
        return { status: "success", applied_title: prize.title };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "failed", error_message: msg, applied_title: prize.title };
  }
}

const spinLocks = new Map<number, Promise<unknown>>();

export type RouletteSpinResponse = {
  ok: boolean;
  error?: string;
  spin?: RouletteSpinRow;
  prize?: RoulettePrizeRow;
  tickets_remaining?: number;
  prize_index?: number;
};

export async function spinRouletteForUser(
  tgUserId: number,
  opts?: { test?: boolean; user_id?: number },
): Promise<RouletteSpinResponse> {
  ensureDefaultRoulettePrizes();
  const prizes = getActiveRoulettePrizesForWheel();
  const sum = activePrizesChanceSum(prizes);
  if (prizes.length === 0) return { ok: false, error: "Нет активных призов" };
  if (Math.abs(sum - 100) > 0.01) return { ok: false, error: `Сумма шансов ${sum.toFixed(1)}%, нужно 100%` };

  const picked = pickWeightedPrize(prizes);
  if (!picked) return { ok: false, error: "Не удалось выбрать приз" };

  if (opts?.test) {
    return { ok: true, prize: picked, prize_index: prizeIndexOnWheel(picked.id) };
  }

  if (getWebAppActiveGame() !== "roulette") {
    return { ok: false, error: "Рулетка выключена" };
  }

  const existing = spinLocks.get(tgUserId);
  if (existing) {
    await existing.catch(() => undefined);
    return { ok: false, error: "Подождите, прокрут уже выполняется" };
  }

  const job = (async (): Promise<RouletteSpinResponse> => {
    const linked = findUsersByTelegramChatId(tgUserId);
    let targetUserId = Math.floor(Number(opts?.user_id));
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      targetUserId = [...linked].sort((a, b) => a.id - b.id)[0]?.id ?? 0;
    }
    if (!targetUserId || !linked.some((u) => u.id === targetUserId)) {
      return { ok: false, error: "Подписка не найдена" };
    }

    const ticketResult = consumeGameTicketForUser(targetUserId, tgUserId);
    if (!ticketResult.ok) {
      return { ok: false, error: ticketResult.error ?? "Нет билетов" };
    }

    const spin = insertRouletteSpin({
      user_id: targetUserId,
      tg_user_id: tgUserId,
      prize_id: picked.id,
      ticket_spent: true,
      result_type: picked.type,
      result_value: picked.value,
      status: "pending",
      prize_title: picked.title,
      error_message: null,
    });

    const applied = applyRoulettePrize(tgUserId, picked, spin.id, targetUserId);
    const updated = updateRouletteSpin(spin.id, {
      status: applied.status,
      error_message: applied.error_message ?? null,
      prize_title: applied.applied_title ?? picked.title,
      prize_display_message: applied.applied_message ?? null,
    });

    const idx = prizeIndexOnWheel(picked.id);

    if (applied.status === "failed") {
      void notifyAdminRouletteError(tgUserId, picked, applied.error_message ?? "unknown").catch((e) =>
        console.error("[roulette] admin notify:", e),
      );
    }

    return {
      ok: true,
      spin: updated,
      prize: picked,
      tickets_remaining: ticketResult.tickets_remaining,
      prize_index: idx >= 0 ? idx : 0,
    };
  })();

  spinLocks.set(tgUserId, job);
  try {
    return await job;
  } finally {
    spinLocks.delete(tgUserId);
  }
}

async function notifyRouletteWin(tgUserId: number, prize: RoulettePrizeRow, applied: PrizeApplyResult): Promise<void> {
  const title = applied.applied_title ?? prize.title;
  let body: string;
  if (isRouletteLosePrizeType(prize.type)) {
    body = `😔 <b>Увы, в этот раз не повезло.</b>\n\nБилет списан. В другой раз точно повезёт!`;
  } else if (applied.status === "pending") {
    body = `🎉 Вы выиграли: <b>${title}</b>\n\nПриз будет применён после активации подписки.`;
  } else if (applied.status === "failed") {
    body = `Вы выиграли: <b>${title}</b>, но при начислении произошла ошибка.\n\nМы уже передали информацию администратору.`;
  } else if (applied.applied_message) {
    body = `🎉 Поздравляем!\n\n<b>${title}</b>\n\n${applied.applied_message}\n\nПриз уже начислен в вашу подписку.`;
  } else {
    body = `🎉 Поздравляем!\n\nВы выиграли: <b>${title}</b>\n\nПриз уже начислен в вашу подписку.`;
  }
  await sendTelegramHtml(tgUserId, body);
}

/** Уведомление в Telegram после анимации рулетки в Mini App. */
export async function notifyRouletteSpinToUser(
  tgUserId: number,
  spinId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const spin = getRouletteSpinById(spinId);
  if (!spin || spin.tg_user_id !== tgUserId) return { ok: false, error: "spin_not_found" };
  if (spin.user_notified) return { ok: true };

  const prize = getRoulettePrizes(true).find((p) => p.id === spin.prize_id);
  if (!prize) return { ok: false, error: "prize_not_found" };

  const applied: PrizeApplyResult = {
    status: spin.status,
    error_message: spin.error_message ?? undefined,
    applied_title: spin.prize_title,
    applied_message: spin.prize_display_message ?? undefined,
  };

  try {
    await notifyRouletteWin(tgUserId, prize, applied);
    updateRouletteSpin(spinId, { user_notified: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function notifyAdminRouletteError(tgUserId: number, prize: RoulettePrizeRow, error: string): Promise<void> {
  const users = findUsersByTelegramChatId(tgUserId);
  const name = users[0]?.name ?? "—";
  const text =
    `⚠️ Ошибка начисления приза в рулетке\n\n` +
    `Пользователь: ${name}\n` +
    `Telegram ID: ${tgUserId}\n` +
    `Приз: ${prize.title}\n` +
    `Ошибка: ${error}\n` +
    `Время: ${new Date().toISOString()}`;
  for (const chatId of getTelegramPaymentNotifyChatIds()) {
    await sendTelegramHtml(chatId, text);
  }
}

export function getRoulettePublicConfig() {
  const cfg = readRouletteConfig();
  const prizes = getActiveRoulettePrizesForWheel();
  return {
    enabled: getWebAppActiveGame() === "roulette",
    tickets_per_purchase: getGameTicketsPerPurchase(),
    prizes: prizes.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      value: p.value,
      color: p.color,
      icon: p.icon,
      win_text: p.win_text,
    })),
    chance_sum: activePrizesChanceSum(prizes),
  };
}

export function getRouletteStats() {
  const { rows: spins } = listRouletteSpins({ limit: 100000 });
  const today = new Date().toISOString().slice(0, 10);
  const prizeCounts = new Map<string, number>();
  let subDays = 0;
  let trafficGb = 0;
  let upgrades = 0;
  for (const s of spins) {
    if (s.status !== "success" && s.status !== "pending") continue;
    prizeCounts.set(s.prize_title, (prizeCounts.get(s.prize_title) ?? 0) + 1);
    if (s.result_type === "subscription_days") subDays += Number(s.result_value) || 0;
    if (s.result_type === "traffic_gb") trafficGb += Number(s.result_value) || 0;
    if (s.result_type === "tariff_upgrade") upgrades += 1;
  }
  let topPrize = "—";
  let topCount = 0;
  for (const [t, c] of prizeCounts) {
    if (c > topCount) {
      topCount = c;
      topPrize = t;
    }
  }
  return {
    total_spins: spins.length,
    spins_today: spins.filter((s) => s.created_at.startsWith(today)).length,
    subscription_days_given: subDays,
    traffic_gb_given: trafficGb,
    tariff_upgrades: upgrades,
    top_prize: topPrize,
  };
}

export {
  getWebAppActiveGame,
  setWebAppActiveGame,
  getGameTicketsPerPurchase,
  normalizeRoulettePrizeChances,
  readRouletteConfig,
  getRoulettePrizes,
  saveRoulettePrizes,
  listRouletteSpins,
};
