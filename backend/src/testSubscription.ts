import {
  findUsersByTelegramChatId,
  getSubscriptionShop,
  hasUsedTestSubscription,
} from "./db.js";

export type TestPlanRuntimeMeta = {
  title: string;
  total_gb: number;
  days: number;
  priceRub: number;
};

export function getTestPlanRuntimeMeta(): TestPlanRuntimeMeta {
  const tp = getSubscriptionShop().test_plan;
  return {
    title: tp.title.trim() || "Тестовая подписка",
    total_gb: tp.total_gb,
    days: tp.days,
    priceRub: tp.price_rub,
  };
}

export { hasUsedTestSubscription, markTestSubscriptionUsed } from "./db.js";

/** Новый клиент без подписки, тест включён в панели и ещё не использован. */
export function isTestSubscriptionEligible(tgUserId: number): boolean {
  const shop = getSubscriptionShop();
  if (shop.sales_disabled) return false;
  if (!shop.test_plan.enabled) return false;
  if (findUsersByTelegramChatId(tgUserId).length > 0) return false;
  if (hasUsedTestSubscription(tgUserId)) return false;
  return true;
}

/** Оплата новой подписки / теста (без привязки в панели). */
export function isNewUserPaymentAllowed(tgUserId: number): boolean {
  if (findUsersByTelegramChatId(tgUserId).length > 0) return true;
  return !getSubscriptionShop().sales_disabled;
}

/** Докупка ГБ доступна, если есть хотя бы одна не тестовая подписка. */
export function tgUserCanBuyGb(tgUserId: number): boolean {
  const linked = findUsersByTelegramChatId(tgUserId);
  if (linked.length === 0) return false;
  return linked.some((u) => u.is_test_subscription !== 1);
}
