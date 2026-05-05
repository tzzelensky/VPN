import { Router } from "express";
import {
  getSubscriptionShop,
  listUsers,
  listShopActivity,
  normalizeSubscriptionShop,
  setSubscriptionShop,
  type SubscriptionShopConfig,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  res.json(getSubscriptionShop());
});

router.get("/activity", (_req, res) => {
  const rows = listShopActivity();
  const shop = getSubscriptionShop();
  const currentSubscriptions = listUsers()
    .filter((u) => u.enable === 1)
    .map((u) => {
      const byGb = shop.plans.find((p) => p.total_gb === u.total_gb);
      const planLabel = byGb
        ? `${byGb.title} (${byGb.total_gb > 0 ? `${byGb.total_gb} ГБ` : "безлимит"} / ${byGb.days} дн.)`
        : `Индивидуальный (${u.total_gb > 0 ? `${u.total_gb} ГБ` : "безлимит"}, срок: ${u.expiry_time > 0 ? "есть" : "без срока"})`;
      return {
        line: `#${u.id} ${u.name} — ${planLabel}`,
        created_at: u.updated_at,
      };
    });
  const subscriptions = rows
    .filter((r) => r.kind === "subscription")
    .map((r) => ({
      line: `#${r.user_id} ${r.user_name} — ${r.plan_title} (${r.total_gb && r.total_gb > 0 ? `${r.total_gb} ГБ` : "безлимит"} / ${r.days ?? 0} дн.)`,
      created_at: r.created_at,
    }));
  const topups = rows
    .filter((r) => r.kind === "topup")
    .map((r) => ({
      line: `#${r.user_id} ${r.user_name} — докупка +${r.add_gb ?? 0} ГБ (${r.plan_title})`,
      created_at: r.created_at,
    }));
  res.json({ subscriptions: currentSubscriptions.length > 0 ? currentSubscriptions : subscriptions, topups });
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
