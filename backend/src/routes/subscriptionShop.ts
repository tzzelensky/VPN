import { Router } from "express";
import {
  deleteUser,
  getSubscriptionShop,
  getUser,
  listShopActivity,
  listUsers,
  normalizeSubscriptionShop,
  setSubscriptionShop,
  type SubscriptionShopConfig,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { listPaymentSessionReport, payerDisplayName, clearPaymentSessionsReport } from "../paymentSessionLogService.js";
import type { PaymentSessionLogRow } from "../paymentSessionLogStore.js";
import { subscriptionPublicName } from "../telegram/format.js";
import { getTestPlanRuntimeMeta } from "../testSubscription.js";
import { refreshTestSubscriptionSegment } from "../db.js";
import { removeUserUuidFromAllServers, pushClientListToAllDeployedServers } from "../userSync.js";
import { resolveClientPaymentUrl } from "../paymentUrl.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  const shop = getSubscriptionShop();
  // Показываем только валидированную ссылку из магазина (без автоподстановок из env).
  res.json({ ...shop, payment_url: resolveClientPaymentUrl(shop.payment_url) });
});

router.get("/test-subscriptions", (_req, res) => {
  const meta = getTestPlanRuntimeMeta();
  const gb = meta.total_gb > 0 ? `${meta.total_gb} ГБ` : "безлимит";
  const entries = listUsers()
    .filter((u) => u.is_test_subscription === 1)
    .map((u) => ({
      id: u.id,
      name: subscriptionPublicName(u),
      tg_id: String(u.tg_id ?? "").trim(),
      line: `${subscriptionPublicName(u)} — ${meta.title} (${gb} / ${meta.days} дн.)`,
      created_at: u.created_at,
      expiry_time: u.expiry_time,
    }))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  res.json({ entries });
});

router.delete("/test-subscriptions/:id(\\d+)", async (req, res) => {
  const id = Number(req.params.id);
  const row = getUser(id);
  if (!row || row.is_test_subscription !== 1) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    await removeUserUuidFromAllServers(row.vless_uuid);
    deleteUser(id);
    refreshTestSubscriptionSegment();
    await pushClientListToAllDeployedServers();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/activity", (_req, res) => {
  const rows = listShopActivity();
  const shop = getSubscriptionShop();
  const currentSubscriptions = listUsers()
    .filter((u) => u.enable === 1 && u.is_test_subscription !== 1)
    .map((u) => {
      const byGb = shop.plans.find((p) => p.total_gb === u.total_gb);
      const planLabel = byGb
        ? `${byGb.title} (${byGb.total_gb > 0 ? `${byGb.total_gb} ГБ` : "безлимит"} / ${byGb.days} дн.)`
        : `Индивидуальный (${u.total_gb > 0 ? `${u.total_gb} ГБ` : "безлимит"}, срок: ${u.expiry_time > 0 ? "есть" : "без срока"})`;
      return {
        line: `${subscriptionPublicName(u)} — ${planLabel}`,
        created_at: u.updated_at,
      };
    });
  const subscriptions = rows
    .filter((r) => r.kind === "subscription")
    .map((r) => ({
      line: `${r.user_name} — ${r.plan_title} (${r.total_gb && r.total_gb > 0 ? `${r.total_gb} ГБ` : "безлимит"} / ${r.days ?? 0} дн.)`,
      created_at: r.created_at,
    }));
  const topups = rows
    .filter((r) => r.kind === "topup")
    .map((r) => ({
      line: `${r.user_name} — докупка +${r.add_gb ?? 0} ГБ (${r.plan_title})`,
      created_at: r.created_at,
    }));
  res.json({ subscriptions: currentSubscriptions.length > 0 ? currentSubscriptions : subscriptions, topups });
});

function paymentSessionKindLabel(kind: PaymentSessionLogRow["kind"]): string {
  if (kind === "subscription") return "Подписка";
  if (kind === "topup") return "Докупка ГБ";
  if (kind === "test") return "Тестовая";
  if (kind === "white_lists") return "Белые списки";
  if (kind === "combo") return "Комбо";
  return "Доп. устройство";
}

function paymentSessionToDto(row: PaymentSessionLogRow) {
  return {
    id: row.id,
    status: row.status,
    kind: row.kind,
    kind_label: paymentSessionKindLabel(row.kind),
    channel: row.channel,
    payer_name: payerDisplayName(row),
    tg_chat_id: row.tg_chat_id,
    tg_user_id: row.tg_user_id,
    tg_username: row.tg_username ?? "",
    target_user_id: row.target_user_id ?? null,
    target_user_name: row.target_user_name ?? "",
    new_subscription_name: row.new_subscription_name ?? "",
    plan_id: row.plan_id,
    plan_title: row.plan_title,
    tariff_line: row.tariff_line,
    amount_rub: row.amount_rub,
    amount_original_rub: row.amount_original_rub ?? null,
    discount_label: row.discount_label ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at ?? null,
    recent_messages: row.messages.slice(-5),
  };
}

router.get("/payment-sessions", (req, res) => {
  const from = String(req.query.from ?? "").trim();
  const to = String(req.query.to ?? "").trim();
  const status = String(req.query.status ?? "all").trim();
  const rows = listPaymentSessionReport({ from, to, status, limit: 500 });
  res.json({ sessions: rows.map(paymentSessionToDto) });
});

router.post("/payment-sessions/clear", (req, res) => {
  const body = (req.body ?? {}) as { from?: unknown; to?: unknown; status?: unknown };
  const from = String(body.from ?? req.query.from ?? "").trim();
  const to = String(body.to ?? req.query.to ?? "").trim();
  const status = String(body.status ?? req.query.status ?? "all").trim();
  const result = clearPaymentSessionsReport({ from, to, status });
  res.json(result);
});

router.put("/", (req, res) => {
  try {
    const next = normalizeSubscriptionShop(req.body as SubscriptionShopConfig);
    setSubscriptionShop(next);
    res.json(next);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
