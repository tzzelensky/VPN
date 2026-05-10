import { Router } from "express";
import {
  getDropperAdminReport,
  getDropperGameConfig,
  grantDropperTicketsToUserIds,
  normalizeDropperGame,
  resetAllDropperTickets,
  setDropperGameConfig,
  setDropperTicketsPoolForClientRow,
  type DropperGameConfig,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  res.json(getDropperGameConfig());
});

router.put("/", (req, res) => {
  try {
    const next = normalizeDropperGame(req.body as DropperGameConfig);
    setDropperGameConfig(next);
    res.json(next);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/grant-tickets", (req, res) => {
  const body = (req.body ?? {}) as { user_ids?: unknown; tickets?: unknown };
  const idsRaw = Array.isArray(body.user_ids) ? body.user_ids : [];
  const ids = [...new Set(idsRaw.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))];
  const tickets = Math.max(0, Math.floor(Number(body.tickets) || 0));
  if (ids.length === 0) {
    res.status(400).json({ error: "users_required" });
    return;
  }
  if (tickets <= 0) {
    res.status(400).json({ error: "tickets_required" });
    return;
  }
  const { uniquePools } = grantDropperTicketsToUserIds(ids, tickets);
  res.json({
    ok: true,
    selected_rows: ids.length,
    unique_pools: uniquePools,
    tickets_each: tickets,
  });
});

router.post("/reset-all-tickets", (_req, res) => {
  resetAllDropperTickets();
  res.json({ ok: true });
});

/** Установить пул билетов для строки клиента (общий для всех подписок с тем же tg_id). */
router.post("/set-user-tickets", (req, res) => {
  const body = (req.body ?? {}) as { user_id?: unknown; tickets?: unknown };
  const userId = Math.floor(Number(body.user_id));
  const tickets = Math.max(0, Math.floor(Number(body.tickets) || 0));
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: "user_id_required" });
    return;
  }
  const result = setDropperTicketsPoolForClientRow(userId, tickets);
  if (!result.ok) {
    res.status(result.error === "user_not_found" ? 404 : 400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

router.get("/report", (_req, res) => {
  res.json(getDropperAdminReport());
});

export default router;
