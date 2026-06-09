import {
  atomicRouletteTicketPurchase,
  findUsersByTelegramChatId,
  getRouletteTicketShop,
  getWebAppActiveGame,
  snapExpiryTimeToNoonLocal,
  subscriptionResourceBalances,
  userHasActiveSubscription,
  type UserRow,
} from "./db.js";
import { sendTelegramHtml } from "./telegram/api.js";

export type BuyRouletteTicketsPaymentType = "subscription_days" | "traffic_gb";

export type BuyRouletteTicketsResult =
  | {
      ok: true;
      tickets_count: number;
      tickets_added: number;
      cost: number;
      remaining_days: number | null;
      remaining_gb: number | null;
      payment_type: BuyRouletteTicketsPaymentType;
    }
  | { ok: false; error: string };

const buyLocks = new Map<number, Promise<BuyRouletteTicketsResult>>();

function findPrimaryActiveSubscriptionUser(tgUserId: number): UserRow | undefined {
  return findUsersByTelegramChatId(tgUserId)
    .filter(userHasActiveSubscription)
    .sort((a, b) => a.id - b.id)[0];
}

function canBuyWithDays(u: UserRow, costDays: number): string | null {
  const bal = subscriptionResourceBalances(u);
  if (bal.unlimited_time) return "Покупка за дни недоступна при подписке без срока.";
  if (u.expiry_time <= 0 || bal.remaining_days == null || bal.remaining_days <= 0) {
    return "Недостаточно дней подписки для покупки билетов.";
  }
  const now = Date.now();
  const subAfter = snapExpiryTimeToNoonLocal(u.expiry_time - costDays * 86_400_000);
  if (subAfter < now || subAfter - now < 86_400_000) {
    return "Недостаточно дней подписки для покупки билетов.";
  }
  return null;
}

function canBuyWithGb(u: UserRow, costGb: number): string | null {
  const bal = subscriptionResourceBalances(u);
  if (bal.unlimited_traffic) return "На безлимитном тарифе покупка за ГБ недоступна.";
  if (bal.remaining_gb == null || bal.remaining_gb < costGb) return "Недостаточно ГБ трафика для покупки билетов.";
  return null;
}

export function getRouletteTicketShopPublicForUser(tgUserId: number) {
  const shop = getRouletteTicketShop();
  const primary = findPrimaryActiveSubscriptionUser(tgUserId);
  const balances = primary ? subscriptionResourceBalances(primary) : null;
  const hasSubscription = !!primary;
  const paymentVisible = shop.enabled && (shop.allow_days || shop.allow_gb);
  const visible = getWebAppActiveGame() === "roulette" && paymentVisible && hasSubscription;
  return {
    enabled: shop.enabled,
    visible,
    price_days_per_ticket: shop.price_days_per_ticket,
    price_gb_per_ticket: shop.price_gb_per_ticket,
    min_tickets: shop.min_tickets,
    max_tickets: shop.max_tickets,
    allow_days: shop.allow_days,
    allow_gb: shop.allow_gb,
    balances: balances
      ? {
          remaining_days: balances.remaining_days,
          remaining_gb: balances.remaining_gb,
          unlimited_traffic: balances.unlimited_traffic,
          unlimited_time: balances.unlimited_time,
          has_active_subscription: true,
        }
      : {
          remaining_days: null,
          remaining_gb: null,
          unlimited_traffic: false,
          unlimited_time: false,
          has_active_subscription: false,
        },
  };
}

async function notifyPurchase(
  tgUserId: number,
  tickets: number,
  cost: number,
  paymentType: BuyRouletteTicketsPaymentType,
): Promise<void> {
  const unit = paymentType === "subscription_days" ? "дней подписки" : "ГБ трафика";
  const text =
    `🎟️ <b>Билеты для рулетки куплены</b>\n\n` +
    `Количество: <b>${tickets}</b>\n` +
    `Списано: <b>${cost}</b> ${unit}\n\n` +
    `Можно открыть Mini App и крутить рулетку.`;
  await sendTelegramHtml(tgUserId, text);
}

export async function buyRouletteTicketsForUser(
  tgUserId: number,
  paymentType: BuyRouletteTicketsPaymentType,
  tickets: number,
  userId?: number,
): Promise<BuyRouletteTicketsResult> {
  const prev = buyLocks.get(tgUserId);
  if (prev) return prev;

  const work = (async (): Promise<BuyRouletteTicketsResult> => {
    const shop = getRouletteTicketShop();
    if (getWebAppActiveGame() !== "roulette") {
      return { ok: false, error: "Рулетка сейчас выключена." };
    }
    if (!shop.enabled) {
      return { ok: false, error: "Покупка билетов за ресурсы подписки отключена." };
    }
    if (paymentType === "subscription_days" && !shop.allow_days) {
      return { ok: false, error: "Покупка за дни подписки отключена." };
    }
    if (paymentType === "traffic_gb" && !shop.allow_gb) {
      return { ok: false, error: "Покупка за ГБ трафика отключена." };
    }

    const count = Math.floor(Number(tickets) || 0);
    if (count < shop.min_tickets) {
      return { ok: false, error: `Минимальное количество билетов: ${shop.min_tickets}.` };
    }
    if (count > shop.max_tickets) {
      return { ok: false, error: `Максимальное количество билетов за одну покупку: ${shop.max_tickets}.` };
    }

    const linked = findUsersByTelegramChatId(tgUserId).filter(userHasActiveSubscription).sort((a, b) => a.id - b.id);
    const uid = Math.floor(Number(userId));
    const primary =
      Number.isFinite(uid) && uid > 0 ? linked.find((u) => u.id === uid) : linked[0];
    if (!primary) {
      return { ok: false, error: "Для покупки билетов нужна активная подписка." };
    }

    const pricePer =
      paymentType === "subscription_days" ? shop.price_days_per_ticket : shop.price_gb_per_ticket;
    if (pricePer <= 0) {
      return { ok: false, error: "Некорректная цена билета в настройках." };
    }
    const cost = count * pricePer;
    if (cost <= 0) {
      return { ok: false, error: "Некорректная стоимость покупки." };
    }

    if (paymentType === "subscription_days") {
      const err = canBuyWithDays(primary, cost);
      if (err) return { ok: false, error: err };
    } else {
      const err = canBuyWithGb(primary, cost);
      if (err) return { ok: false, error: err };
    }

    const atomic = atomicRouletteTicketPurchase({
      tg_user_id: tgUserId,
      user_id: primary.id,
      tickets: count,
      payment_type: paymentType,
      cost,
    });
    if (!atomic.ok) {
      return { ok: false, error: atomic.error };
    }

    if (shop.notify_telegram_on_purchase) {
      try {
        await notifyPurchase(tgUserId, count, cost, paymentType);
      } catch {
        // ignore notify errors
      }
    }

    return {
      ok: true,
      tickets_count: atomic.tickets_remaining,
      tickets_added: count,
      cost,
      remaining_days: atomic.remaining_days,
      remaining_gb: atomic.remaining_gb,
      payment_type: paymentType,
    };
  })();

  buyLocks.set(tgUserId, work);
  try {
    return await work;
  } finally {
    buyLocks.delete(tgUserId);
  }
}
