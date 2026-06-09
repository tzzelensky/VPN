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
}): PurchasePriceResolution {
  const original = Math.max(0, Math.floor(input.original_price_rub));
  const cleanPromo = String(input.promo_code ?? "").trim().replace(/\s+/g, "");

  if (cleanPromo) {
    const promoCalc = applyPromoCodeForUser({
      code: cleanPromo,
      tg_user_id: input.tg_user_id,
      original_price_rub: original,
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

export function formatPurchasePriceUserLines(
  res: PurchasePriceResolution,
  opts?: { promoCode?: string },
): string {
  if (res.promo_calc) {
    const code = opts?.promoCode?.trim() || res.promo_calc.promo.code;
    return (
      `<b>Скидка применилась! Стоимость ${res.final_price_rub} руб</b>\n` +
      `<b>Сумма к оплате:</b> <s>${res.original_price_rub} ₽</s> <b>${res.final_price_rub} ₽</b> (промокод ${escHtml(code)})\n\n`
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
