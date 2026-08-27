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
import {
  listPaymentSessionReport,
  payerDisplayName,
  clearPaymentSessionsReport,
  patchRevenueAmount,
  backfillAdminRenewalsFromCommunicationLog,
  createManualRevenueEntry,
  deleteRevenueEntry,
} from "../paymentSessionLogService.js";
import type { PaymentSessionLogRow } from "../paymentSessionLogStore.js";
import { getPaymentSessionLog } from "../paymentSessionLogStore.js";
import { subscriptionPublicName } from "../telegram/format.js";
import { getTestPlanRuntimeMeta } from "../testSubscription.js";
import { refreshTestSubscriptionSegment } from "../db.js";
import { removeUserUuidFromAllServers, pushClientListToAllDeployedServers } from "../userSync.js";
import { resolveClientPaymentUrl } from "../paymentUrl.js";
import { localYmdInTz, projectTimezone } from "../projectTime.js";

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

function revenueExcludedLookup(): { byId: Set<number>; byTg: Set<number> } {
  const byId = new Set<number>();
  const byTg = new Set<number>();
  for (const u of listUsers()) {
    if (u.exclude_from_revenue !== 1) continue;
    byId.add(u.id);
    const tg = Math.floor(Number(String(u.tg_id ?? "").trim()));
    if (Number.isFinite(tg) && tg > 0) byTg.add(tg);
  }
  return { byId, byTg };
}

function revenueRowExcluded(
  row: PaymentSessionLogRow,
  lookup: { byId: Set<number>; byTg: Set<number> },
): boolean {
  if (row.target_user_id != null && row.target_user_id > 0) {
    return lookup.byId.has(row.target_user_id);
  }
  return lookup.byTg.has(row.tg_user_id) || lookup.byTg.has(row.tg_chat_id);
}

function revenueMonthKey(row: PaymentSessionLogRow, tz: string): string {
  const iso = String(row.completed_at || row.created_at || "").trim();
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return localYmdInTz(ms, tz).slice(0, 7);
}

function parseMonthQuery(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return null;
}

router.get("/revenue", (req, res) => {
  backfillAdminRenewalsFromCommunicationLog();
  const tz = projectTimezone();
  const nowMonth = localYmdInTz(Date.now(), tz).slice(0, 7);
  const month = parseMonthQuery(req.query.month) ?? nowMonth;
  const lookup = revenueExcludedLookup();
  const sessions = listPaymentSessionReport({ status: "confirmed", limit: 5000 });
  const filtered = sessions
    .filter((row) => row.status === "confirmed")
    .filter((row) => revenueMonthKey(row, tz) === month)
    .filter((row) => !revenueRowExcluded(row, lookup))
    .sort((a, b) => {
      const ta = Date.parse(String(a.completed_at || a.created_at));
      const tb = Date.parse(String(b.completed_at || b.created_at));
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

  let totalRub = 0;
  const byChannel = { chat: 0, webapp: 0, admin: 0 };
  const rows = filtered.map((row) => {
    const amount = Math.max(0, Math.round(Number(row.amount_rub) || 0));
    totalRub += amount;
    if (row.channel === "webapp") byChannel.webapp += amount;
    else if (row.channel === "admin") byChannel.admin += amount;
    else byChannel.chat += amount;
    return {
      id: row.id,
      kind: row.kind,
      channel: row.channel,
      payer_name: payerDisplayName(row),
      target_user_id: row.target_user_id ?? null,
      target_user_name: row.target_user_name ?? "",
      plan_title: row.plan_title,
      tariff_line: row.tariff_line,
      amount_rub: amount,
      amount_original_rub: row.amount_original_rub ?? null,
      created_at: row.created_at,
      completed_at: row.completed_at ?? null,
    };
  });

  res.json({
    month,
    total_rub: totalRub,
    count: rows.length,
    by_channel: byChannel,
    rows,
  });
});

router.post("/revenue", (req, res) => {
  const body = (req.body ?? {}) as {
    user_id?: unknown;
    user_ids?: unknown;
    amount_rub?: unknown;
    completed_at?: unknown;
    plan_title?: unknown;
  };
  const idsRaw = Array.isArray(body.user_ids) ? body.user_ids : body.user_id != null ? [body.user_id] : [];
  const userIds = idsRaw
    .map((x) => Math.floor(Number(x)))
    .filter((n, i, arr) => Number.isFinite(n) && n > 0 && arr.indexOf(n) === i);
  if (userIds.length === 0) {
    res.status(400).json({ error: "user_id_required" });
    return;
  }
  const amount = Math.round(Number(body.amount_rub));
  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).json({ error: "invalid_amount_rub" });
    return;
  }
  const completedAt = String(body.completed_at ?? "").trim();
  const planTitle = String(body.plan_title ?? "").trim();
  const rows = [];
  const errors: { user_id: number; error: string }[] = [];
  for (const userId of userIds) {
    const user = getUser(userId);
    if (!user) {
      errors.push({ user_id: userId, error: "not_found" });
      continue;
    }
    if (user.exclude_from_revenue === 1) {
      errors.push({ user_id: userId, error: "user_excluded_from_revenue" });
      continue;
    }
    const created = createManualRevenueEntry({
      user,
      amount_rub: amount,
      ...(completedAt ? { completed_at: completedAt } : {}),
      ...(planTitle ? { plan_title: planTitle } : {}),
    });
    if (!created) {
      errors.push({ user_id: userId, error: "create_failed" });
      continue;
    }
    rows.push({
      id: created.id,
      kind: created.kind,
      channel: created.channel,
      payer_name: payerDisplayName(created),
      target_user_id: created.target_user_id ?? null,
      target_user_name: created.target_user_name ?? "",
      plan_title: created.plan_title,
      tariff_line: created.tariff_line,
      amount_rub: created.amount_rub,
      amount_original_rub: created.amount_original_rub ?? null,
      created_at: created.created_at,
      completed_at: created.completed_at ?? null,
    });
  }
  if (rows.length === 0) {
    res.status(400).json({ error: errors[0]?.error ?? "create_failed", errors });
    return;
  }
  res.json({
    ok: true,
    added: rows.length,
    rows,
    ...(rows[0] ? { row: rows[0] } : {}),
    ...(errors.length ? { errors } : {}),
  });
});

router.patch("/revenue/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id_required" });
    return;
  }
  const body = (req.body ?? {}) as { amount_rub?: unknown };
  const amount = Math.round(Number(body.amount_rub));
  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).json({ error: "invalid_amount_rub" });
    return;
  }
  const updated = patchRevenueAmount(id, amount);
  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({
    ok: true,
    row: {
      id: updated.id,
      kind: updated.kind,
      channel: updated.channel,
      payer_name: payerDisplayName(updated),
      target_user_id: updated.target_user_id ?? null,
      target_user_name: updated.target_user_name ?? "",
      plan_title: updated.plan_title,
      tariff_line: updated.tariff_line,
      amount_rub: updated.amount_rub,
      amount_original_rub: updated.amount_original_rub ?? null,
      created_at: updated.created_at,
      completed_at: updated.completed_at ?? null,
    },
  });
});

router.delete("/revenue/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id_required" });
    return;
  }
  const existing = getPaymentSessionLog(id);
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (existing.channel !== "admin") {
    res.status(400).json({ error: "only_admin_rows_deletable" });
    return;
  }
  const removed = deleteRevenueEntry(id);
  if (!removed) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true, id: removed.id });
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
