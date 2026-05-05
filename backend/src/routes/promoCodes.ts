import { Router } from "express";
import {
  applyPromoCodeForUser,
  createPromoCode,
  listPromoCodes,
  listPromoCodeUsages,
  validatePromoCodeForUser,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  const promos = listPromoCodes();
  res.json({
    promos: promos.map((p) => ({
      ...p,
      usages_count: listPromoCodeUsages(p.id).length,
    })),
  });
});

router.post("/", (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      name?: unknown;
      code?: unknown;
      discount_percent?: unknown;
      one_time_per_user?: unknown;
    };
    const created = createPromoCode({
      name: String(body.name ?? "").trim(),
      code: String(body.code ?? "").trim(),
      discount_percent: Math.floor(Number(body.discount_percent) || 0),
      one_time_per_user: body.one_time_per_user === true || body.one_time_per_user === 1 || body.one_time_per_user === "1",
    });
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id/usages", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "promo_id_required" });
    return;
  }
  const usages = listPromoCodeUsages(id);
  res.json({ usages });
});

router.post("/preview", (req, res) => {
  const body = (req.body ?? {}) as { code?: unknown; tg_user_id?: unknown; original_price_rub?: unknown };
  try {
    const calc = applyPromoCodeForUser({
      code: String(body.code ?? "").trim(),
      tg_user_id: Math.floor(Number(body.tg_user_id) || 0),
      original_price_rub: Math.floor(Number(body.original_price_rub) || 0),
    });
    res.json(calc);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "promo_not_found") {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg === "promo_already_used") {
      res.status(409).json({ error: msg });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

router.post("/validate", (req, res) => {
  const body = (req.body ?? {}) as { code?: unknown; tg_user_id?: unknown };
  try {
    const promo = validatePromoCodeForUser(String(body.code ?? "").trim(), Math.floor(Number(body.tg_user_id) || 0));
    res.json({
      promo,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "promo_not_found") {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg === "promo_already_used") {
      res.status(409).json({ error: msg });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

export default router;
