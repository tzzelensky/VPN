import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  deleteDailyGiftPrize,
  deleteDailyGiftSchedule,
  getDailyGiftConfig,
  listDailyGiftPrizes,
  listDailyGiftSchedules,
  mutateDailyGiftStore,
  readDailyGiftStore,
  setDailyGiftConfig,
  setDailyGiftSchedule,
  upsertDailyGiftPrize,
} from "../dailyGiftStore.js";
import { listDailyGiftClaims, listDailyGiftEvents, resetDailyGiftUserClaim } from "../dailyGiftService.js";
import { normalizeDailyGiftConfig, normalizeDailyGiftPrize } from "../dailyGiftTypes.js";
import { sendDailyGiftReminder } from "../telegram/dailyGiftNotify.js";
import { appendDailyGiftEvent } from "../dailyGiftStore.js";

function parseTgUserIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
  }
  if (typeof raw === "string") {
    return [
      ...new Set(
        raw
          .split(/[\s,;]+/)
          .map((x) => Math.floor(Number(x.trim())))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
  }
  return [];
}

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  const store = readDailyGiftStore();
  res.json({
    config: store.config,
    prizes: store.prizes,
    schedules: store.schedules,
    day_assignments: store.day_assignments,
    claims: listDailyGiftClaims(1000),
    events: listDailyGiftEvents(200),
    reminders_count: store.reminders.filter((r) => r.enabled).length,
  });
});

router.put("/config", (req, res) => {
  try {
    const next = setDailyGiftConfig(normalizeDailyGiftConfig(req.body));
    res.json(next);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/prizes", (req, res) => {
  try {
    const row = upsertDailyGiftPrize(req.body ?? {});
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.put("/prizes/:id", (req, res) => {
  try {
    const id = String(req.params.id ?? "").trim();
    const row = upsertDailyGiftPrize({ ...(req.body ?? {}), id });
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/prizes/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!deleteDailyGiftPrize(id)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/schedules", (req, res) => {
  const body = (req.body ?? {}) as { day_key?: unknown; prize_id?: unknown };
  const day_key = String(body.day_key ?? "").trim();
  const prize_id = String(body.prize_id ?? "").trim();
  if (!day_key || !prize_id) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  setDailyGiftSchedule(day_key, prize_id);
  res.json({ ok: true, schedules: listDailyGiftSchedules() });
});

router.delete("/schedules/:dayKey", (req, res) => {
  deleteDailyGiftSchedule(String(req.params.dayKey ?? "").trim());
  res.json({ ok: true, schedules: listDailyGiftSchedules() });
});

router.put("/queue", (req, res) => {
  const body = (req.body ?? {}) as { prize_ids?: unknown; queue_index?: unknown };
  const prize_ids = Array.isArray(body.prize_ids)
    ? body.prize_ids.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const queue_index = Math.max(0, Math.floor(Number(body.queue_index) || 0));
  const cfg = setDailyGiftConfig({ queue_prize_ids: prize_ids, queue_index });
  res.json(cfg);
});

router.get("/prizes", (_req, res) => {
  res.json({ prizes: listDailyGiftPrizes() });
});

router.get("/report", (_req, res) => {
  res.json({
    claims: listDailyGiftClaims(1000),
    events: listDailyGiftEvents(500),
  });
});

router.post("/prizes/validate", (req, res) => {
  const row = normalizeDailyGiftPrize(req.body);
  if (!row) {
    res.status(400).json({ error: "invalid_prize" });
    return;
  }
  res.json({ ok: true });
});

router.post("/reset-user-claim", (req, res) => {
  const body = (req.body ?? {}) as { tg_user_id?: unknown; day_key?: unknown };
  const tgUserId = Math.floor(Number(body.tg_user_id));
  if (!Number.isFinite(tgUserId) || tgUserId <= 0) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const dayKey = body.day_key != null ? String(body.day_key).trim() : undefined;
  const result = resetDailyGiftUserClaim(tgUserId, dayKey || undefined);
  if (!result.ok) {
    const status = result.error === "no_claim" ? 404 : 400;
    res.status(status).json({ error: result.error });
    return;
  }
  res.json({
    ok: true,
    removed: result.removed,
    day_key: result.day_key,
    claims: listDailyGiftClaims(1000),
  });
});

router.post("/send-reminder", async (req, res) => {
  const body = (req.body ?? {}) as { tg_user_ids?: unknown; tg_user_id?: unknown };
  const ids = [
    ...new Set([
      ...parseTgUserIds(body.tg_user_ids),
      ...parseTgUserIds(body.tg_user_id != null ? [body.tg_user_id] : []),
    ]),
  ];
  if (ids.length === 0) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const results: Array<{ tg_user_id: number; ok: boolean; error?: string }> = [];
  let sent = 0;
  let failed = 0;
  for (const tgUserId of ids) {
    try {
      await sendDailyGiftReminder(tgUserId, { manual: true });
      appendDailyGiftEvent({
        tg_user_id: tgUserId,
        event: "notify_manual",
        detail: null,
      });
      results.push({ tg_user_id: tgUserId, ok: true });
      sent += 1;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      appendDailyGiftEvent({
        tg_user_id: tgUserId,
        event: "notify_manual_failed",
        detail: err,
      });
      results.push({ tg_user_id: tgUserId, ok: false, error: err });
      failed += 1;
    }
  }
  res.json({ ok: failed === 0, sent, failed, total: ids.length, results });
});

router.post("/reset-day-assignments", (_req, res) => {
  mutateDailyGiftStore((store) => {
    store.day_assignments = [];
  });
  res.json({ ok: true });
});

export default router;
