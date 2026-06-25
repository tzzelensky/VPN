import { Router } from "express";
import {
  clearPurchaseDiscountsForUser,
  deletePurchaseDiscount,
  listPurchaseDiscountsGrouped,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  res.json(listPurchaseDiscountsGrouped());
});

router.delete("/user/:tgUserId", (req, res) => {
  const tgUserId = Math.floor(Number(req.params.tgUserId));
  if (!Number.isFinite(tgUserId) || tgUserId <= 0) {
    res.status(400).json({ error: "invalid_tg_user_id" });
    return;
  }
  const removed = clearPurchaseDiscountsForUser(tgUserId);
  res.json({ ok: true, removed });
});

router.delete("/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const ok = deletePurchaseDiscount(id);
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
