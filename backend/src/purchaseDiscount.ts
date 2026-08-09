import {
  applyPromoCodeForUser,
  findUsersByTelegramChatId,
  getReferralInviteByTgUser,
  getReferralProgram,
  getRoulettePurchaseDiscount,
} from "./db.js";
import { escHtml } from "./telegram/format.js";

export type PurchasePriceResolution = {
  original_price_rub: number;
  final_price_rub: number;
  discount_percent: number;
  promo_calc?: ReturnType<typeof applyPromoCodeForUser>;
  referral_discount_percent: number;
  referral_inviter_user_id?: number;
  roulette_discount?: { percent: number; spin_id: number };
};

function percentOff(priceRub: number, percent: number): number {
  return Math.max(0, Math.floor(priceRub - (priceRub * percent) / 100));
}

export function resolvePurchasePrice(input: {
  tg_user_id: number;
  original_price_rub: number;
  promo_code?: string;
  target_user_id?: number;
  new_subscription_name?: string;
  allow_referral?: boolean;
  allow_roulette?: boolean;
  plan_id?: number;
  purchase_kind?: "subscription" | "topup";
}): PurchasePriceResolution {
  const original = Math.max(0, Math.floor(input.original_price_rub));
  const cleanPromo = String(input.promo_code ?? "").trim().replace(/\s+/g, "");

  if (cleanPromo) {
    const promoCalc = applyPromoCodeForUser({
      code: cleanPromo,
      tg_user_id: input.tg_user_id,
      original_price_rub: original,
      plan_id: input.plan_id,
      purchase_kind: input.purchase_kind,
    });
    return {
      original_price_rub: original,
      final_price_rub: promoCalc.final_price_rub,
      discount_percent: promoCalc.discount_percent,
      promo_calc: promoCalc,
      referral_discount_percent: 0,
    };
  }

  if (input.allow_roulette !== false) {
    const roulette = getRoulettePurchaseDiscount(input.tg_user_id);
    if (roulette) {
      const percent = roulette.discount_percent;
      return {
        original_price_rub: original,
        final_price_rub: percentOff(original, percent),
        discount_percent: percent,
        referral_discount_percent: 0,
        roulette_discount: { percent, spin_id: roulette.spin_id },
      };
    }
  }

  const linked = findUsersByTelegramChatId(input.tg_user_id);
  const target = input.target_user_id;
  const newName = String(input.new_subscription_name ?? "").trim();
  const invite =
    input.allow_referral !== false && linked.length === 0
      ? getReferralInviteByTgUser(input.tg_user_id)
      : undefined;
  const refCfg = getReferralProgram();
  const refPercent =
    !target && !newName && linked.length === 0 && invite && refCfg.enabled
      ? refCfg.invited_discount_percent
      : 0;

  if (refPercent > 0) {
    return {
      original_price_rub: original,
      final_price_rub: percentOff(original, refPercent),
      discount_percent: refPercent,
      referral_discount_percent: refPercent,
      referral_inviter_user_id: invite?.inviter_user_id,
    };
  }

  return {
    original_price_rub: original,
    final_price_rub: original,
    discount_percent: 0,
    referral_discount_percent: 0,
  };
}

export function formatPromoRewardSummaryHtml(calc: {
  discount_rub: number;
  bonus_gb: number;
  bonus_days: number;
  promo: { type: string; code: string };
}): string {
  const parts: string[] = [];
  if (calc.discount_rub > 0) {
    if (calc.promo.type === "rub") parts.push(`скидка <b>${calc.discount_rub} ₽</b>`);
    else parts.push(`скидка <b>${calc.discount_rub} ₽</b>`);
  }
  if (calc.bonus_gb > 0) parts.push(`подарок <b>+${calc.bonus_gb} ГБ</b>`);
  if (calc.bonus_days > 0) parts.push(`подарок <b>+${calc.bonus_days} дн.</b>`);
  if (parts.length === 0) return `Промокод <b>${escHtml(calc.promo.code)}</b> применён.`;
  return `Промокод <b>${escHtml(calc.promo.code)}</b>: ${parts.join(", ")}.`;
}

export function formatPurchasePriceUserLines(
  res: PurchasePriceResolution,
  opts?: { promoCode?: string },
): string {
  if (res.promo_calc) {
    const code = opts?.promoCode?.trim() || res.promo_calc.promo.code;
    const giftBits: string[] = [];
    if (res.promo_calc.bonus_gb > 0) giftBits.push(`+${res.promo_calc.bonus_gb} ГБ`);
    if (res.promo_calc.bonus_days > 0) giftBits.push(`+${res.promo_calc.bonus_days} дн.`);
    const giftLine =
      giftBits.length > 0 ? `<b>Бонус после оплаты:</b> ${giftBits.map((g) => `<b>${escHtml(g)}</b>`).join(" · ")}\n` : "";
    if (res.discount_percent > 0 || res.final_price_rub < res.original_price_rub) {
      return (
        `<b>Скидка применилась!</b> ${formatPromoRewardSummaryHtml(res.promo_calc)}\n` +
        `<b>Сумма к оплате:</b> <s>${res.original_price_rub} ₽</s> <b>${res.final_price_rub} ₽</b>\n` +
        giftLine +
        `\n`
      );
    }
    return (
      `<b>Промокод ${escHtml(code)} применён!</b>\n` +
      giftLine +
      `<b>Сумма к оплате:</b> <b>${res.original_price_rub} ₽</b>\n\n`
    );
  }
  if (res.roulette_discount) {
    return (
      `<b>Применена автоскидка ${res.roulette_discount.percent}%</b>\n` +
      `<b>Сумма к оплате:</b> <s>${res.original_price_rub} ₽</s> <b>${res.final_price_rub} ₽</b>\n\n`
    );
  }
  if (res.referral_discount_percent > 0) {
    return (
      `<b>Сумма к оплате:</b> <s>${res.original_price_rub} ₽</s> <b>${res.final_price_rub} ₽</b> (скидка ${res.referral_discount_percent}%)\n\n`
    );
  }
  return `<b>Сумма к оплате:</b> ${res.original_price_rub} ₽\n\n`;
}

export function formatAdminPaymentAmountLine(
  originalPriceRub: number,
  sess: {
    referral_discount_percent?: number;
    roulette_discount_percent?: number;
  },
): string {
  const roulettePercent = sess.roulette_discount_percent ?? 0;
  const referralPercent = sess.referral_discount_percent ?? 0;
  const percent = roulettePercent > 0 ? roulettePercent : referralPercent;
  if (percent > 0) {
    const final = percentOff(originalPriceRub, percent);
    const label = roulettePercent > 0 ? `автоскидка ${roulettePercent}%` : `скидка ${referralPercent}%`;
    return `Сумма: <s>${originalPriceRub} ₽</s> <b>${final} ₽</b> (${label})\n`;
  }
  return `Сумма: <b>${originalPriceRub} ₽</b>\n`;
}
