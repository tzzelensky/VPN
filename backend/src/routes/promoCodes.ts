import { Router } from "express";
import * as XLSX from "xlsx";
import {
  applyPromoCodeForUser,
  createPromoCode,
  deletePromoCode,
  listPromoCodes,
  listPromoCodeUsages,
  updatePromoCode,
  validatePromoCodeForUser,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  const promos = listPromoCodes();
  const now = Date.now();
  res.json({
    promos: promos.map((p) => ({
      ...p,
      usages_count: listPromoCodeUsages(p.id).filter((u) => u.status !== "error").length,
      total_usages_count: listPromoCodeUsages(p.id).length,
      status:
        p.active === false
          ? "inactive"
          : p.valid_until && Number.isFinite(Date.parse(p.valid_until)) && Date.parse(p.valid_until) < now
            ? "expired"
            : p.max_uses_total && listPromoCodeUsages(p.id).filter((u) => u.status !== "error").length >= p.max_uses_total
              ? "limit_reached"
              : "active",
    })),
  });
});

router.post("/", (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      name?: unknown;
      code?: unknown;
      type?: unknown;
      discount_percent?: unknown;
      discount_rub?: unknown;
      gift_gb?: unknown;
      gift_days?: unknown;
      one_time_per_user?: unknown;
      max_uses_total?: unknown;
      max_uses_per_user?: unknown;
      min_purchase_rub?: unknown;
      first_purchase_only?: unknown;
      new_users_only?: unknown;
      apply_plan_ids?: unknown;
      admin_note?: unknown;
      active?: unknown;
      valid_until?: unknown;
    };
    const created = createPromoCode({
      name: String(body.name ?? "").trim(),
      code: String(body.code ?? "").trim(),
      type: String(body.type ?? "").trim().toLowerCase() as "percent" | "rub" | "gb" | "days" | "combo",
      discount_percent: Math.floor(Number(body.discount_percent) || 0),
      discount_rub: Math.floor(Number(body.discount_rub) || 0),
      gift_gb: Math.floor(Number(body.gift_gb) || 0),
      gift_days: Math.floor(Number(body.gift_days) || 0),
      one_time_per_user: body.one_time_per_user === true || body.one_time_per_user === 1 || body.one_time_per_user === "1",
      max_uses_total: Number.isFinite(Number(body.max_uses_total)) ? Math.floor(Number(body.max_uses_total)) : undefined,
      max_uses_per_user: Number.isFinite(Number(body.max_uses_per_user)) ? Math.floor(Number(body.max_uses_per_user)) : undefined,
      min_purchase_rub: Number.isFinite(Number(body.min_purchase_rub)) ? Math.floor(Number(body.min_purchase_rub)) : undefined,
      first_purchase_only: body.first_purchase_only === true || body.first_purchase_only === 1 || body.first_purchase_only === "1",
      new_users_only: body.new_users_only === true || body.new_users_only === 1 || body.new_users_only === "1",
      apply_plan_ids: Array.isArray(body.apply_plan_ids) ? body.apply_plan_ids.map((x) => Math.floor(Number(x) || 0)) : undefined,
      admin_note: String(body.admin_note ?? "").trim(),
      active: !(body.active === false || body.active === 0 || body.active === "0"),
      valid_until: String(body.valid_until ?? "").trim(),
    });
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch("/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "promo_id_required" });
    return;
  }
  try {
    const body = (req.body ?? {}) as {
      name?: unknown;
      code?: unknown;
      type?: unknown;
      discount_percent?: unknown;
      discount_rub?: unknown;
      gift_gb?: unknown;
      gift_days?: unknown;
      one_time_per_user?: unknown;
      max_uses_total?: unknown;
      max_uses_per_user?: unknown;
      min_purchase_rub?: unknown;
      first_purchase_only?: unknown;
      new_users_only?: unknown;
      apply_plan_ids?: unknown;
      admin_note?: unknown;
      active?: unknown;
      valid_until?: unknown;
    };
    const updated = updatePromoCode(id, {
      ...(body.name !== undefined ? { name: String(body.name ?? "").trim() } : {}),
      ...(body.code !== undefined ? { code: String(body.code ?? "").trim() } : {}),
      ...(body.type !== undefined ? { type: String(body.type ?? "").trim().toLowerCase() as "percent" | "rub" | "gb" | "days" | "combo" } : {}),
      ...(body.discount_percent !== undefined ? { discount_percent: Math.floor(Number(body.discount_percent) || 0) } : {}),
      ...(body.discount_rub !== undefined ? { discount_rub: Math.floor(Number(body.discount_rub) || 0) } : {}),
      ...(body.gift_gb !== undefined ? { gift_gb: Math.floor(Number(body.gift_gb) || 0) } : {}),
      ...(body.gift_days !== undefined ? { gift_days: Math.floor(Number(body.gift_days) || 0) } : {}),
      ...(body.one_time_per_user !== undefined
        ? { one_time_per_user: body.one_time_per_user === true || body.one_time_per_user === 1 || body.one_time_per_user === "1" }
        : {}),
      ...(body.max_uses_total !== undefined ? { max_uses_total: Math.floor(Number(body.max_uses_total) || 0) } : {}),
      ...(body.max_uses_per_user !== undefined ? { max_uses_per_user: Math.floor(Number(body.max_uses_per_user) || 0) } : {}),
      ...(body.min_purchase_rub !== undefined ? { min_purchase_rub: Math.floor(Number(body.min_purchase_rub) || 0) } : {}),
      ...(body.first_purchase_only !== undefined
        ? { first_purchase_only: body.first_purchase_only === true || body.first_purchase_only === 1 || body.first_purchase_only === "1" }
        : {}),
      ...(body.new_users_only !== undefined
        ? { new_users_only: body.new_users_only === true || body.new_users_only === 1 || body.new_users_only === "1" }
        : {}),
      ...(body.apply_plan_ids !== undefined
        ? { apply_plan_ids: Array.isArray(body.apply_plan_ids) ? body.apply_plan_ids.map((x) => Math.floor(Number(x) || 0)) : [] }
        : {}),
      ...(body.admin_note !== undefined ? { admin_note: String(body.admin_note ?? "").trim() } : {}),
      ...(body.active !== undefined ? { active: body.active === true || body.active === 1 || body.active === "1" } : {}),
      ...(body.valid_until !== undefined ? { valid_until: String(body.valid_until ?? "").trim() } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: "promo_not_found" });
      return;
    }
    res.json(updated);
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
  const body = (req.body ?? {}) as { code?: unknown; tg_user_id?: unknown; original_price_rub?: unknown; plan_id?: unknown };
  try {
    const calc = applyPromoCodeForUser({
      code: String(body.code ?? "").trim(),
      tg_user_id: Math.floor(Number(body.tg_user_id) || 0),
      original_price_rub: Math.floor(Number(body.original_price_rub) || 0),
      plan_id: Math.floor(Number(body.plan_id) || 0) || undefined,
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
    if (msg === "promo_inactive" || msg === "promo_expired" || msg === "promo_min_purchase_not_met" || msg === "promo_plan_not_allowed") {
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
    if (msg === "promo_inactive" || msg === "promo_expired") {
      res.status(409).json({ error: msg });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

router.delete("/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "promo_id_required" });
    return;
  }
  const ok = deletePromoCode(id);
  if (!ok) {
    res.status(404).json({ error: "promo_not_found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/:id/duplicate", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "promo_id_required" });
    return;
  }
  const source = listPromoCodes().find((x) => x.id === id);
  if (!source) {
    res.status(404).json({ error: "promo_not_found" });
    return;
  }
  try {
    const body = (req.body ?? {}) as { code?: unknown };
    const explicitCode = String(body.code ?? "").trim();
    const code = explicitCode || `${source.code}_COPY`;
    const created = createPromoCode({
      name: `${source.name} (копия)`,
      code,
      type: source.type,
      discount_percent: source.discount_percent,
      discount_rub: source.discount_rub,
      gift_gb: source.gift_gb,
      gift_days: source.gift_days,
      one_time_per_user: source.one_time_per_user,
      max_uses_total: source.max_uses_total,
      max_uses_per_user: source.max_uses_per_user,
      min_purchase_rub: source.min_purchase_rub,
      first_purchase_only: source.first_purchase_only,
      new_users_only: source.new_users_only,
      apply_plan_ids: source.apply_plan_ids,
      admin_note: source.admin_note,
      active: source.active,
      valid_until: source.valid_until,
    });
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id/report", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const promo = listPromoCodes().find((x) => x.id === id);
  if (!promo) {
    res.status(404).json({ error: "promo_not_found" });
    return;
  }
  const usages = listPromoCodeUsages(id);
  const applied = usages.filter((u) => u.status !== "error");
  const uniqueUsers = new Set(applied.map((u) => u.tg_user_id)).size;
  const sumDiscountRub = applied.reduce((s, u) => s + (u.discount_rub ?? 0), 0);
  const sumGb = applied.reduce((s, u) => s + (u.bonus_gb ?? 0), 0);
  const sumDays = applied.reduce((s, u) => s + (u.bonus_days ?? 0), 0);
  const now = Date.now();
  const status =
    promo.active === false
      ? "inactive"
      : promo.valid_until && Number.isFinite(Date.parse(promo.valid_until)) && Date.parse(promo.valid_until) < now
        ? "expired"
        : promo.max_uses_total && applied.length >= promo.max_uses_total
          ? "limit_reached"
          : "active";
  res.json({
    promo: {
      ...promo,
      status,
      usages_count: applied.length,
      unique_users_count: uniqueUsers,
      sum_discount_rub: sumDiscountRub,
      sum_bonus_gb: sumGb,
      sum_bonus_days: sumDays,
    },
    usages,
  });
});

function csvEscape(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

router.get("/:id/export.csv", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const promo = listPromoCodes().find((x) => x.id === id);
  if (!promo) {
    res.status(404).json({ error: "promo_not_found" });
    return;
  }
  const usages = listPromoCodeUsages(id);
  const header = ["Промокод", "Пользователь", "Telegram username", "Телефон", "Дата", "Тариф", "Исходная цена", "Итоговая цена", "Скидка", "Бонус ГБ", "Бонус дней", "Статус", "Ошибка"];
  const lines = [
    header.join(","),
    ...usages.map((u) =>
      [
        csvEscape(promo.code),
        csvEscape(u.user_name ?? u.tg_first_name ?? `tg:${u.tg_user_id}`),
        csvEscape(u.tg_username ? `@${u.tg_username}` : ""),
        csvEscape(u.phone ?? ""),
        csvEscape(u.applied_at),
        csvEscape(u.plan_title ?? ""),
        csvEscape(u.original_price_rub ?? ""),
        csvEscape(u.final_price_rub ?? ""),
        csvEscape(u.discount_rub ?? ""),
        csvEscape(u.bonus_gb ?? ""),
        csvEscape(u.bonus_days ?? ""),
        csvEscape(u.status ?? "applied"),
        csvEscape(u.error ?? ""),
      ].join(","),
    ),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"promo-${promo.code}-report.csv\"`);
  res.send("\uFEFF" + lines.join("\r\n"));
});

router.get("/:id/export.xlsx", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const promo = listPromoCodes().find((x) => x.id === id);
  if (!promo) {
    res.status(404).json({ error: "promo_not_found" });
    return;
  }
  const usages = listPromoCodeUsages(id);
  const aoa: unknown[][] = [
    ["Промокод", "Пользователь", "Telegram username", "Телефон", "Дата", "Тариф", "Исходная цена", "Итоговая цена", "Скидка", "Бонус ГБ", "Бонус дней", "Статус", "Ошибка"],
    ...usages.map((u) => [
      promo.code,
      u.user_name ?? u.tg_first_name ?? `tg:${u.tg_user_id}`,
      u.tg_username ? `@${u.tg_username}` : "",
      u.phone ?? "",
      u.applied_at,
      u.plan_title ?? "",
      u.original_price_rub ?? "",
      u.final_price_rub ?? "",
      u.discount_rub ?? "",
      u.bonus_gb ?? "",
      u.bonus_days ?? "",
      u.status ?? "applied",
      u.error ?? "",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Promo report");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=\"promo-${promo.code}-report.xlsx\"`);
  res.send(buf);
});

export default router;
