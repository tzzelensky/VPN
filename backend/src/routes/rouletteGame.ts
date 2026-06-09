import { Router } from "express";
import { randomBytes } from "node:crypto";
import {
  getGameTicketsPerPurchase,
  getRoulettePrizes,
  getRouletteTicketShop,
  getUser,
  getWebAppActiveGame,
  listRouletteSpins,
  listRouletteTicketPurchaseTransactions,
  normalizeRoulettePrizeChances,
  normalizeRouletteTicketShop,
  readRouletteConfig,
  saveRoulettePrizes,
  setGameTicketsPerPurchase,
  setRouletteTicketShop,
  setWebAppActiveGame,
  validateRouletteTicketShop,
  type RoulettePrizeRow,
  type RouletteTicketShopConfig,
  type WebAppActiveGame,
} from "../db.js";
import {
  activePrizesChanceSum,
  ensureDefaultRoulettePrizes,
  getRoulettePublicConfig,
  getRouletteStats,
  ROULETTE_PRIZE_TYPE_LABELS,
  spinRouletteForUser,
  type RoulettePrizeType,
} from "../rouletteGame.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.get("/settings", (_req, res) => {
  ensureDefaultRoulettePrizes();
  const prizes = getRoulettePrizes(false);
  res.json({
    ...readRouletteConfig(),
    tickets_per_purchase: getGameTicketsPerPurchase(),
    chance_sum: activePrizesChanceSum(prizes),
    prizes,
  });
});

router.put("/settings", (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      active_game?: WebAppActiveGame;
      tickets_per_purchase?: unknown;
      ticket_shop?: Partial<RouletteTicketShopConfig>;
    };
    if (body.active_game === "none" || body.active_game === "dropper" || body.active_game === "roulette") {
      setWebAppActiveGame(body.active_game);
    }
    if (body.tickets_per_purchase != null) {
      setGameTicketsPerPurchase(Math.floor(Number(body.tickets_per_purchase) || 0));
    }
    if (body.ticket_shop != null && typeof body.ticket_shop === "object") {
      const merged = normalizeRouletteTicketShop({ ...getRouletteTicketShop(), ...body.ticket_shop });
      const fieldErrors = validateRouletteTicketShop(merged);
      if (Object.keys(fieldErrors).length > 0) {
        res.status(400).json({ error: "validation_failed", field_errors: fieldErrors });
        return;
      }
      setRouletteTicketShop(merged);
    }
    ensureDefaultRoulettePrizes();
    const prizes = getRoulettePrizes(false);
    res.json({
      ...readRouletteConfig(),
      tickets_per_purchase: getGameTicketsPerPurchase(),
      chance_sum: activePrizesChanceSum(prizes),
      prizes,
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/ticket-shop/validate", (req, res) => {
  const body = (req.body ?? {}) as { ticket_shop?: Partial<RouletteTicketShopConfig> };
  const merged = normalizeRouletteTicketShop({ ...getRouletteTicketShop(), ...(body.ticket_shop ?? {}) });
  const field_errors = validateRouletteTicketShop(merged);
  res.json({ ok: Object.keys(field_errors).length === 0, field_errors });
});

router.get("/prizes", (_req, res) => {
  ensureDefaultRoulettePrizes();
  const prizes = getRoulettePrizes(true);
  res.json({ prizes, chance_sum: activePrizesChanceSum(prizes.filter((p) => p.active)), type_labels: ROULETTE_PRIZE_TYPE_LABELS });
});

router.put("/prizes", (req, res) => {
  try {
    const raw = (req.body as { prizes?: unknown })?.prizes;
    if (!Array.isArray(raw)) {
      res.status(400).json({ error: "prizes_required" });
      return;
    }
    const now = new Date().toISOString();
    const prizes: RoulettePrizeRow[] = raw.map((p, i) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const id = String(o.id ?? randomBytes(6).toString("hex")).trim();
      const title = String(o.title ?? "").trim();
      if (!title) throw new Error("Название приза обязательно");
      const type = String(o.type ?? "custom").trim() as RoulettePrizeType;
      const value = Math.floor(Number(o.value) || 0);
      if (type !== "custom" && type !== "tariff_upgrade" && value <= 0) {
        throw new Error(`Значение приза «${title}» должно быть больше 0`);
      }
      return {
        id,
        title,
        type,
        value,
        chance_percent: Math.max(0, Math.min(100, Number(o.chance_percent) || 0)),
        active: o.active !== false,
        color: String(o.color ?? "#6366f1").trim() || "#6366f1",
        icon: String(o.icon ?? "🎁").trim() || "🎁",
        win_text: String(o.win_text ?? title).trim() || title,
        sort_order: Math.floor(Number(o.sort_order ?? i)),
        archived: o.archived === true,
        created_at: String(o.created_at ?? now),
        updated_at: now,
      };
    });
    saveRoulettePrizes(prizes);
    const saved = getRoulettePrizes(true);
    res.json({ prizes: saved, chance_sum: activePrizesChanceSum(saved.filter((p) => p.active && !p.archived)) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/prizes/normalize-chances", (_req, res) => {
  const prizes = normalizeRoulettePrizeChances();
  res.json({ prizes, chance_sum: activePrizesChanceSum(prizes) });
});

router.post("/test-spin", async (_req, res) => {
  try {
    const result = await spinRouletteForUser(0, { test: true });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/stats", (_req, res) => {
  res.json(getRouletteStats());
});

router.get("/report", (req, res) => {
  const q = req.query;
  const pageSize = Math.min(300, Math.max(20, Math.floor(Number(q.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
  const { rows: spins, total } = listRouletteSpins({
    limit: pageSize,
    offset,
    tgUserId: q.user_id ? Math.floor(Number(q.user_id)) : undefined,
    userQuery: q.user_query ? String(q.user_query) : undefined,
    prizeType: q.prize_type ? String(q.prize_type) : undefined,
    status: q.status ? String(q.status) : undefined,
    errorsOnly: q.errors_only === "1" || q.errors_only === "true",
    dateFrom: q.date_from ? String(q.date_from) : undefined,
    dateTo: q.date_to ? String(q.date_to) : undefined,
  });
  const rows = spins.map((s) => {
    const u = getUser(s.user_id);
    return {
      ...s,
      user_name: u?.name ?? "—",
      tg_username: u?.tg_id ?? String(s.tg_user_id),
    };
  });
  res.json({ rows, total, limit: pageSize, offset });
});

router.get("/preview", (_req, res) => {
  ensureDefaultRoulettePrizes();
  res.json(getRoulettePublicConfig());
});

router.get("/ticket-purchases", (req, res) => {
  const q = req.query;
  const paymentRaw = q.payment_type ? String(q.payment_type) : "";
  const paymentType =
    paymentRaw === "subscription_days" || paymentRaw === "traffic_gb" ? paymentRaw : undefined;
  const statusRaw = q.status ? String(q.status) : "";
  const status = statusRaw === "success" || statusRaw === "failed" ? statusRaw : undefined;
  const rows = listRouletteTicketPurchaseTransactions({
    limit: Math.min(5000, Math.floor(Number(q.limit) || 500)),
    tgUserId: q.user_id ? Math.floor(Number(q.user_id)) : undefined,
    paymentType,
    status,
    dateFrom: q.date_from ? String(q.date_from) : undefined,
    dateTo: q.date_to ? String(q.date_to) : undefined,
  });
  const mapped = rows.map((t) => {
    const u = getUser(t.user_id);
    return {
      id: t.id,
      user_id: t.user_id,
      tg_user_id: t.tg_user_id,
      user_name: u?.name ?? "—",
      tg_username: u?.tg_id ?? String(t.tg_user_id),
      tickets_amount: t.amount,
      payment_type: t.source === "purchase_for_days" ? "subscription_days" : "traffic_gb",
      spent_amount: t.spent_resource_amount ?? 0,
      status: t.status ?? "success",
      error_message: t.error_message,
      created_at: t.created_at,
    };
  });
  res.json({ rows: mapped, total: mapped.length });
});

router.get("/ticket-purchases/export.csv", (req, res) => {
  const q = req.query;
  const paymentRaw = q.payment_type ? String(q.payment_type) : "";
  const paymentType =
    paymentRaw === "subscription_days" || paymentRaw === "traffic_gb" ? paymentRaw : undefined;
  const statusRaw = q.status ? String(q.status) : "";
  const status = statusRaw === "success" || statusRaw === "failed" ? statusRaw : undefined;
  const rows = listRouletteTicketPurchaseTransactions({
    limit: 5000,
    tgUserId: q.user_id ? Math.floor(Number(q.user_id)) : undefined,
    paymentType,
    status,
    dateFrom: q.date_from ? String(q.date_from) : undefined,
    dateTo: q.date_to ? String(q.date_to) : undefined,
  });
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ["id", "user_name", "tg_username", "date", "tickets", "payment_type", "spent", "status", "error"];
  const lines = [header.join(",")];
  for (const t of rows) {
    const u = getUser(t.user_id);
    lines.push(
      [
        t.id,
        esc(u?.name ?? "—"),
        esc(u?.tg_id ?? String(t.tg_user_id)),
        t.created_at,
        String(t.amount),
        t.source === "purchase_for_days" ? "days" : "gb",
        String(t.spent_resource_amount ?? 0),
        t.status ?? "success",
        esc(t.error_message ?? ""),
      ].join(","),
    );
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="roulette-ticket-purchases.csv"');
  res.send("\uFEFF" + lines.join("\n"));
});

export default router;
