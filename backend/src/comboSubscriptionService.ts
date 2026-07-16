import type { PaymentPlanId, PaymentSessionRow, UserRow } from "./db.js";
import {
  activateDeviceSlotPurchaseForUser,
  appendShopActivity,
  createUser,
  findUsersByTelegramChatId,
  getSubscriptionShop,
  getUser,
  snapExpiryTimeToNoonLocal,
  updateUserRow,
  userHasActiveSubscription,
  type ComboSubscriptionOffer,
} from "./db.js";
import {
  getDeviceLimitSettings,
  findDeviceSlotPurchaseByPaymentId,
  updateDeviceSlotPurchase,
  createDeviceSlotPurchaseRecord,
} from "./deviceLimitStore.js";
import { resetUserTrafficCounters } from "./trafficReset.js";
import {
  checkDeviceSlotPurchaseAllowed,
  deviceLimitCalcSettingsForUser,
} from "./deviceLimitEffective.js";
import { userDeviceTotalLimit } from "./userDeviceSlots.js";
import {
  activateWhitelistPurchaseAfterPayment,
  checkWhitelistPurchaseAllowed,
  createPendingWhitelistPurchase,
  getWhitelistPurchasePriceRub,
} from "./whitelistPurchaseService.js";
import { countSaleWhitelistKeys, getWhitelistVaultSettings, isWhitelistVaultEnabled } from "./whitelistVaultDb.js";
import { pushClientListToAllDeployedServers } from "./userSync.js";
import { subscriptionPublicName } from "./telegram/format.js";

const DAY_MS = 86400000;
/** Комбо с доп. устройством не показываем, если лимит уже ≥ этого значения. */
const COMBO_HIDE_DEVICE_SLOT_FROM = 4;

function getSubPlanMeta(planId: PaymentPlanId) {
  const row = getSubscriptionShop().plans.find((p) => p.id === planId);
  if (!row) throw new Error("Тариф не найден");
  return {
    title: row.title,
    total_gb: row.total_gb,
    days: row.days,
    priceRub: row.price_rub,
  };
}

export type ComboPricing = {
  original_rub: number;
  final_rub: number;
  discount_rub: number;
  discount_percent: number;
  parts: Array<{ label: string; price_rub: number }>;
};

export type ComboOfferPublic = ComboSubscriptionOffer & ComboPricing & {
  plan_title: string;
  addon_labels: string[];
  eligible: boolean;
  block_reason: string | null;
  /** Подписки, к которым можно применить комбо (если есть несколько). */
  eligible_subscription_ids: number[];
  eligible_subscription_names: string[];
  /** Подсказка: «Спец-предложение для подписки …» */
  for_subscription_hint: string | null;
  /** Если ровно одна подходящая — удобно автопривязать покупку. */
  preferred_subscription_id: number | null;
};

function normalizeDiscountPercent(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 15;
  return Math.min(50, Math.max(1, n));
}

export function listComboOffers(enabledOnly = false): ComboSubscriptionOffer[] {
  const offers = getSubscriptionShop().combo_offers ?? [];
  return enabledOnly ? offers.filter((o) => o.enabled) : offers;
}

export function getComboOffer(id: string): ComboSubscriptionOffer | undefined {
  const key = String(id ?? "").trim();
  if (!key) return undefined;
  return listComboOffers().find((o) => o.id === key);
}

export function resolveComboOfferPricing(offer: ComboSubscriptionOffer): ComboPricing {
  const shop = getSubscriptionShop();
  const plan = shop.plans.find((p) => p.id === offer.plan_id);
  const parts: ComboPricing["parts"] = [];
  let original_rub = 0;
  if (plan) {
    parts.push({ label: plan.title, price_rub: plan.price_rub });
    original_rub += plan.price_rub;
  }
  if (offer.include_white_lists) {
    const wl = getWhitelistPurchasePriceRub();
    parts.push({ label: "Белые списки", price_rub: wl });
    original_rub += wl;
  }
  if (offer.include_topup) {
    const top = shop.topup_plans.find((p) => p.id === offer.topup_plan_id);
    if (top) {
      parts.push({ label: top.title, price_rub: top.price_rub });
      original_rub += top.price_rub;
    }
  }
  if (offer.include_device_slot) {
    const dev = getDeviceLimitSettings().purchase_price_rub;
    parts.push({ label: "Доп. устройство", price_rub: dev });
    original_rub += dev;
  }
  const discount_percent = normalizeDiscountPercent(offer.discount_percent);
  const discount_rub = Math.floor((original_rub * discount_percent) / 100);
  const final_rub = Math.max(0, original_rub - discount_rub);
  return { original_rub, final_rub, discount_rub, discount_percent, parts };
}

function addonLabels(offer: ComboSubscriptionOffer): string[] {
  const shop = getSubscriptionShop();
  const out: string[] = [];
  if (offer.include_white_lists) out.push("Белые списки");
  if (offer.include_topup) {
    const top = shop.topup_plans.find((p) => p.id === offer.topup_plan_id);
    out.push(top ? top.title : "Докупка ГБ");
  }
  if (offer.include_device_slot) out.push("Доп. устройство");
  return out;
}

export function validateComboOfferConfig(offer: ComboSubscriptionOffer): string | null {
  if (!String(offer.title ?? "").trim()) return "Укажите название комбо";
  const shop = getSubscriptionShop();
  if (!shop.plans.some((p) => p.id === offer.plan_id)) return "Некорректный тариф подписки";
  if (!offer.include_white_lists && !offer.include_topup && !offer.include_device_slot) {
    return "Выберите хотя бы один продукт в комбо";
  }
  if (offer.include_topup && !shop.topup_plans.some((p) => p.id === offer.topup_plan_id)) {
    return "Некорректный пакет докупки ГБ";
  }
  return null;
}

function comboAddonGlobalsOk(offer: ComboSubscriptionOffer): { ok: boolean; message?: string } {
  if (offer.include_white_lists) {
    if (!isWhitelistVaultEnabled() || !getWhitelistVaultSettings().purchase.sale_enabled) {
      return { ok: false, message: "Белые списки недоступны для покупки." };
    }
    if (getWhitelistPurchasePriceRub() <= 0 || countSaleWhitelistKeys() <= 0) {
      return { ok: false, message: "Белые списки временно недоступны." };
    }
  }
  if (offer.include_device_slot) {
    const dl = getDeviceLimitSettings();
    if (!dl.enabled || !dl.purchase_enabled) {
      return { ok: false, message: "Покупка доп. устройств выключена." };
    }
  }
  if (offer.include_topup) {
    const shop = getSubscriptionShop();
    if (!shop.topup_plans.some((p) => p.id === offer.topup_plan_id)) {
      return { ok: false, message: "Пакет докупки ГБ недоступен." };
    }
  }
  return { ok: true };
}

/** Проверка аддонов комбо относительно конкретной подписки. */
export function evaluateComboOfferForSubscription(
  offer: ComboSubscriptionOffer,
  user: UserRow,
): { ok: boolean; message?: string } {
  const globals = comboAddonGlobalsOk(offer);
  if (!globals.ok) return globals;

  if (offer.include_white_lists) {
    const wlCheck = checkWhitelistPurchaseAllowed(user, { from_combo: true });
    if (!wlCheck.ok) {
      if (wlCheck.code === "already_active") {
        return { ok: false, message: "Белые списки уже подключены к этой подписке." };
      }
      if (wlCheck.code === "no_subscription") {
        return { ok: false, message: wlCheck.message };
      }
      return { ok: false, message: wlCheck.message };
    }
  }

  if (offer.include_topup && user.total_gb <= 0) {
    return { ok: false, message: "Для безлимитной подписки комбо с докупкой ГБ недоступно." };
  }

  if (offer.include_device_slot) {
    const calc = deviceLimitCalcSettingsForUser(user);
    const limit = userDeviceTotalLimit(user, calc);
    if (limit >= COMBO_HIDE_DEVICE_SLOT_FROM) {
      return {
        ok: false,
        message: `У этой подписки уже ${limit} устройств — комбо с доп. устройством недоступно.`,
      };
    }
    const check = checkDeviceSlotPurchaseAllowed(user);
    if (!check.ok) return { ok: false, message: check.message.replace(/<\/?b>/g, "") };
  }

  return { ok: true };
}

function formatForSubscriptionHint(names: string[], totalLinked: number): string | null {
  if (names.length === 0 || totalLinked <= 1 || names.length >= totalLinked) return null;
  if (names.length === 1) return `Спец-предложение для подписки «${names[0]}»`;
  return `Спец-предложение для подписок: ${names.map((n) => `«${n}»`).join(", ")}`;
}

export function validateComboOfferForPurchase(
  offer: ComboSubscriptionOffer,
  opts: {
    tg_user_id: number;
    target_user_id?: number;
    new_subscription_name?: string;
  },
): { ok: boolean; message?: string } {
  const cfgErr = validateComboOfferConfig(offer);
  if (cfgErr) return { ok: false, message: cfgErr };
  if (!offer.enabled) return { ok: false, message: "Комбо-предложение выключено." };

  const shop = getSubscriptionShop();
  const linked = findUsersByTelegramChatId(opts.tg_user_id);
  const newName = String(opts.new_subscription_name ?? "").trim();
  const target = opts.target_user_id ? linked.find((u) => u.id === opts.target_user_id) : undefined;

  if (linked.length === 0 && shop.sales_disabled) {
    return { ok: false, message: "Покупка недоступна. Продажи новым отключены." };
  }

  const globals = comboAddonGlobalsOk(offer);
  if (!globals.ok) return globals;

  // Новая подписка — аддоны применятся после создания, персональные блокировки не актуальны.
  if (newName || linked.length === 0) {
    return { ok: true };
  }

  if (target) {
    return evaluateComboOfferForSubscription(offer, target);
  }

  if (linked.length === 1) {
    return evaluateComboOfferForSubscription(offer, linked[0]!);
  }

  const eligible = linked.filter((u) => evaluateComboOfferForSubscription(offer, u).ok);
  if (eligible.length === 0) {
    const first = linked.map((u) => evaluateComboOfferForSubscription(offer, u).message).find(Boolean);
    return { ok: false, message: first ?? "Комбо недоступно ни для одной вашей подписки." };
  }
  if (eligible.length === 1) {
    return { ok: true };
  }
  return { ok: false, message: "Выберите подписку для комбо." };
}

export function buildComboOffersForClient(
  tgUserId: number,
  linked: UserRow[],
  opts?: { target_user_id?: number; for_new?: boolean },
): ComboOfferPublic[] {
  const shop = getSubscriptionShop();
  const target = opts?.target_user_id
    ? linked.find((u) => u.id === opts.target_user_id)
    : undefined;
  const forNew = opts?.for_new === true || linked.length === 0;

  return listComboOffers(true).map((offer) => {
    const pricing = resolveComboOfferPricing(offer);
    const plan = shop.plans.find((p) => p.id === offer.plan_id);
    const base = {
      ...offer,
      ...pricing,
      plan_title: plan?.title ?? `Тариф #${offer.plan_id}`,
      addon_labels: addonLabels(offer),
    };

    if (forNew) {
      const globals = comboAddonGlobalsOk(offer);
      return {
        ...base,
        eligible: globals.ok,
        block_reason: globals.ok ? null : globals.message ?? null,
        eligible_subscription_ids: [],
        eligible_subscription_names: [],
        for_subscription_hint: null,
        preferred_subscription_id: null,
      };
    }

    const candidates = target ? [target] : linked;
    const eligibleUsers = candidates.filter((u) => evaluateComboOfferForSubscription(offer, u).ok);
    const eligible_subscription_ids = eligibleUsers.map((u) => u.id);
    const eligible_subscription_names = eligibleUsers.map((u) => subscriptionPublicName(u));
    const eligible = eligibleUsers.length > 0;
    let block_reason: string | null = null;
    if (!eligible) {
      block_reason =
        candidates.map((u) => evaluateComboOfferForSubscription(offer, u).message).find(Boolean) ??
        "Комбо недоступно.";
    }

    const for_subscription_hint = formatForSubscriptionHint(
      eligible_subscription_names,
      linked.length,
    );

    return {
      ...base,
      eligible,
      block_reason,
      eligible_subscription_ids,
      eligible_subscription_names,
      for_subscription_hint,
      preferred_subscription_id:
        eligible_subscription_ids.length === 1 ? eligible_subscription_ids[0]! : null,
    };
  });
}

export async function activateComboPaymentSession(sess: PaymentSessionRow): Promise<{
  ok: boolean;
  error?: string;
  primary?: UserRow;
  autoCreated?: boolean;
  addonLines?: string[];
}> {
  const offerId = String(sess.combo_offer_id ?? "").trim();
  const offer = getComboOffer(offerId);
  if (!offer) return { ok: false, error: "Комбо-предложение не найдено" };

  const subMeta = getSubPlanMeta(sess.plan_id);
  let linked = findUsersByTelegramChatId(sess.tg_chat_id);
  let autoCreated = false;
  let autoCreatedUser: UserRow | undefined;

  const newName = String(sess.new_subscription_name ?? "").trim();
  const explicitTarget = sess.target_user_id ? linked.find((u) => u.id === sess.target_user_id) : undefined;
  /** Новая подписка только без явной цели: нет подписок или пользователь выбрал «новую». */
  const shouldCreateNew = !explicitTarget && (linked.length === 0 || Boolean(newName));

  if (shouldCreateNew) {
    try {
      autoCreatedUser = createUser({
        name: newName || clientNameFromSession(sess),
        email: `${sess.tg_chat_id}@tg.vpn`,
        tg_id: String(sess.tg_chat_id).trim(),
        total_gb: subMeta.total_gb,
        expiry_time: snapExpiryTimeToNoonLocal(Date.now() + subMeta.days * DAY_MS),
        enable: 1,
        comment: `Комбо-подписка, тариф #${sess.plan_id}: ${offer.title}`,
      });
      autoCreated = true;
      linked = autoCreatedUser ? [autoCreatedUser] : findUsersByTelegramChatId(sess.tg_chat_id);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Не удалось создать подписку" };
    }
  }

  if (sess.target_user_id && !explicitTarget && linked.length > 0) {
    return { ok: false, error: "Выбранная подписка не найдена" };
  }

  const targets: UserRow[] = explicitTarget
    ? [explicitTarget]
    : autoCreatedUser
      ? [autoCreatedUser]
      : linked.length === 1
        ? [linked[0]!]
        : linked;

  const affected: UserRow[] = [];
  if (!autoCreated) {
    for (const row of targets) {
      /** Продление: дни тарифа суммируются к оставшемуся сроку (не сбрасывают на «сейчас + N»). */
      const base = Math.max(Date.now(), row.expiry_time > 0 ? row.expiry_time : 0);
      const newExpiry = snapExpiryTimeToNoonLocal(base + subMeta.days * DAY_MS);
      const patched = updateUserRow(row.id, {
        total_gb: subMeta.total_gb,
        expiry_time: newExpiry,
        comment: `Комбо-подписка, тариф #${sess.plan_id}: ${offer.title}`,
      });
      if (!patched) continue;
      const next = await resetUserTrafficCounters(patched);
      if (next) affected.push(next);
    }
  } else if (autoCreatedUser) {
    affected.push(autoCreatedUser);
  }

  const primary = affected[0] ?? targets[0];
  if (!primary) return { ok: false, error: "Не удалось применить подписку" };

  const addonLines: string[] = [];

  if (offer.include_topup) {
    const top = getSubscriptionShop().topup_plans.find((p) => p.id === offer.topup_plan_id);
    if (top) {
      const fresh = getUser(primary.id) ?? primary;
      const nextGb = fresh.total_gb <= 0 ? top.add_gb : fresh.total_gb + top.add_gb;
      const patched = updateUserRow(fresh.id, { total_gb: nextGb });
      if (patched) {
        addonLines.push(`+${top.add_gb} ГБ`);
        appendShopActivity({
          kind: "topup",
          user_id: patched.id,
          user_name: patched.name,
          plan_id: offer.topup_plan_id,
          plan_title: top.title,
          add_gb: top.add_gb,
        });
      }
    }
  }

  let userForAddons = getUser(primary.id) ?? primary;

  if (offer.include_white_lists) {
    const wlAmount = getWhitelistPurchasePriceRub();
    const wlResult = await activateWhitelistPurchaseAfterPayment({
      user: userForAddons,
      payment_id: `${sess.id}:wl`,
      amount: wlAmount,
      tg_chat_id: sess.tg_chat_id,
      notify_user: false,
      from_combo: true,
    });
    if (!wlResult.ok) {
      return { ok: false, error: wlResult.error ?? "Не удалось подключить белые списки" };
    }
    addonLines.push("Белые списки");
    appendShopActivity({
      kind: "white_lists",
      user_id: userForAddons.id,
      user_name: userForAddons.name,
      plan_id: 1,
      plan_title: "Белые списки (комбо)",
    });
  }

  if (offer.include_device_slot) {
    userForAddons = getUser(primary.id) ?? userForAddons;
    const devCheck = checkDeviceSlotPurchaseAllowed(userForAddons);
    if (!devCheck.ok) {
      return { ok: false, error: devCheck.message };
    }
    activateDeviceSlotPurchaseForUser(userForAddons.id, 1, `${sess.id}:dev`);
    const purchase = findDeviceSlotPurchaseByPaymentId(`${sess.id}:dev`);
    if (purchase) {
      updateDeviceSlotPurchase(purchase.id, {
        status: "paid",
        activated_at: new Date().toISOString(),
      });
    }
    addonLines.push("Доп. устройство");
    appendShopActivity({
      kind: "device_slot",
      user_id: userForAddons.id,
      user_name: userForAddons.name,
      plan_id: 1,
      plan_title: "Доп. устройство (комбо)",
    });
  }

  appendShopActivity({
    kind: "combo",
    user_id: primary.id,
    user_name: primary.name,
    plan_id: sess.plan_id,
    plan_title: offer.title,
    total_gb: subMeta.total_gb,
    days: subMeta.days,
  });

  try {
    await pushClientListToAllDeployedServers();
  } catch (e) {
    console.error("[combo-subscription] push after confirm:", e);
  }

  return { ok: true, primary: getUser(primary.id) ?? primary, autoCreated, addonLines };
}

export function defaultSubscriptionClientName(opts: {
  tg_username?: string | null;
  tg_first_name?: string | null;
}): string {
  const u = String(opts.tg_username ?? "").trim().replace(/^@/, "");
  if (u) return `@${u}`.slice(0, 25);
  const fn = String(opts.tg_first_name ?? "").trim();
  if (fn) return fn.slice(0, 25);
  return "Подписка";
}

export function clientNameFromSession(sess: PaymentSessionRow): string {
  return defaultSubscriptionClientName({
    tg_username: sess.tg_username,
    tg_first_name: sess.tg_first_name,
  });
}

export function prepareComboPaymentSideEffects(
  offer: ComboSubscriptionOffer,
  sessionId: string,
  user: UserRow | undefined,
): void {
  if (offer.include_white_lists && user && userHasActiveSubscription(user)) {
    createPendingWhitelistPurchase({ user, payment_id: `${sessionId}:wl`, amount: getWhitelistPurchasePriceRub() });
  }
  if (offer.include_device_slot && user) {
    const price = getDeviceLimitSettings().purchase_price_rub;
    createDeviceSlotPurchaseRecord({
      user_id: user.id,
      subscription_id: user.id,
      payment_id: `${sessionId}:dev`,
      slots_count: 1,
      price_per_slot: price,
      amount_total: price,
      status: "pending",
      expires_at: user.expiry_time > 0 ? user.expiry_time : 0,
      admin_comment: "combo",
    });
  }
}
