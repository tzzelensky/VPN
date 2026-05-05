import { Router } from "express";
import {
  getSubscriptionShop,
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
  res.json({ subscriptions, topups });
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
