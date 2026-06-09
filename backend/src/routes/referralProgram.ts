import { Router } from "express";
import * as XLSX from "xlsx";
import {
  getReferralProgram,
  getUser,
  normalizeReferralProgram,
  setReferralProgram,
  type ReferralProgramConfig,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { runAdminGiftJobs, tryBeginAdminGiftJob, type AdminGiftJobInput } from "../referralAdminGiftJob.js";
import {
  buildReferralEvents,
  buildReferralReport,
  computeReferralStats,
  eventsToCsv,
  getReferralMeta,
  referralEventsToLegacyLines,
  referralSettingsHistoryForClient,
  reportToCsv,
  type ReferralEventKind,
} from "../referralProgramService.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  res.json(getReferralProgram());
});

router.get("/meta", (_req, res) => {
  res.json(getReferralMeta());
});

router.get("/stats", (_req, res) => {
  res.json(computeReferralStats());
});

router.get("/events", (req, res) => {
  let events = buildReferralEvents();
  const kind = String(req.query.kind ?? "all").trim().toLowerCase();
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const from = String(req.query.from ?? "").trim();
  const to = String(req.query.to ?? "").trim();

  if (kind === "errors") {
    events = events.filter((e) => e.kind === "error");
  } else if (kind !== "all" && kind !== "") {
    const map: Record<string, ReferralEventKind> = {
      invitations: "invitation",
      invitation: "invitation",
      rewards: "reward",
      reward: "reward",
      gifts: "admin_gift",
      admin_gift: "admin_gift",
    };
    const want = map[kind];
    if (want) events = events.filter((e) => e.kind === want);
  }

  if (q) {
    events = events.filter((e) => {
      const hay = [e.inviter_name, e.invitee_name, e.user_name, e.reward_text, e.admin_comment, e.line]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  if (from) {
    const t0 = Date.parse(from);
    if (Number.isFinite(t0)) events = events.filter((e) => Date.parse(e.created_at) >= t0);
  }
  if (to) {
    const t1 = Date.parse(to);
    if (Number.isFinite(t1)) events = events.filter((e) => Date.parse(e.created_at) <= t1 + 86_400_000);
  }

  res.json({ entries: events });
});

/** Обратная совместимость: текстовые строки для старых клиентов. */
router.get("/rewards-log", (_req, res) => {
  const events = buildReferralEvents();
  const entries = referralEventsToLegacyLines(events);
  res.json({ entries });
});

router.get("/report", (_req, res) => {
  res.json({ rows: buildReferralReport() });
});

router.get("/settings-history", (_req, res) => {
  res.json({ entries: referralSettingsHistoryForClient() });
});

router.get("/export/events.csv", (req, res) => {
  let events = buildReferralEvents();
  const kind = String(req.query.kind ?? "all").trim().toLowerCase();
  if (kind === "errors") events = events.filter((e) => e.kind === "error");
  else if (kind !== "all" && kind) {
    const k = kind.replace(/s$/, "") as ReferralEventKind;
    events = events.filter((e) => e.kind === k || (kind === "gifts" && e.kind === "admin_gift"));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="referral-events.csv"');
  res.send(eventsToCsv(events));
});

router.get("/export/events.xlsx", (req, res) => {
  let events = buildReferralEvents();
  const kind = String(req.query.kind ?? "all").trim().toLowerCase();
  if (kind === "errors") events = events.filter((e) => e.kind === "error");
  else if (kind !== "all" && kind) {
    const k = kind.replace(/s$/, "") as ReferralEventKind;
    events = events.filter((e) => e.kind === k || (kind === "gifts" && e.kind === "admin_gift"));
  }

  const header = ["Тип", "Кто", "Кому", "Награда", "Статус", "Дата", "Комментарий"];
  const kindRu: Record<ReferralEventKind, string> = {
    invitation: "Приглашение",
    reward: "Награда",
    admin_gift: "Ручной подарок",
    error: "Ошибка",
  };

  const aoa: unknown[][] = [
    header,
    ...events.map((e) => [
      kindRu[e.kind] ?? e.kind,
      e.inviter_name ?? e.granted_by ?? "",
      e.invitee_name ?? e.user_name ?? "",
      e.reward_text ?? "",
      e.status ?? "",
      e.created_at,
      e.admin_comment ?? e.line ?? "",
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Events");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="referral-events.xlsx"');
  res.send(buf);
});

router.get("/export/report.csv", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="referral-report.csv"');
  res.send(reportToCsv(buildReferralReport()));
});

router.get("/export/report.xlsx", (_req, res) => {
  const rows = buildReferralReport();
  const header = [
    "Пригласивший",
    "Приглашенный",
    "Дата приглашения",
    "Купил",
    "Скидка %",
    "Награда пригласившему",
    "Награда приглашенному",
    "Статус",
    "Дата начисления",
  ];

  const aoa: unknown[][] = [
    header,
    ...rows.map((r) => [
      r.inviter_name,
      r.invitee_name,
      r.invited_at,
      r.purchased ? "да" : "нет",
      r.discount_percent,
      r.inviter_reward,
      r.invitee_reward,
      r.status,
      r.rewarded_at ?? "",
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="referral-report.xlsx"');
  res.send(buf);
});

router.put("/", (req, res) => {
  try {
    const next = normalizeReferralProgram(req.body as ReferralProgramConfig);
    setReferralProgram(next, { changed_by: "Администратор" });
    res.json(getReferralProgram());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "invite_copy_text_required") {
      res.status(400).json({ error: "invite_copy_text_required", message: "Текст приглашения не может быть пустым." });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

router.post("/admin-gift", (req, res) => {
  const body = (req.body ?? {}) as {
    user_id?: unknown;
    user_ids?: unknown;
    kind?: unknown;
    amount?: unknown;
    comment?: unknown;
    admin_comment?: unknown;
  };
  const kindRaw = String(body.kind ?? "").trim().toLowerCase();
  const kind = kindRaw === "gb" || kindRaw === "days" ? kindRaw : null;
  const amount = Math.floor(Number(body.amount));
  const adminComment = String(body.admin_comment ?? body.comment ?? "").trim();
  const rawIds = Array.isArray(body.user_ids)
    ? body.user_ids
    : body.user_id != null
      ? [body.user_id]
      : [];
  const userIds = [...new Set(rawIds.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))];

  if (userIds.length === 0 || !kind || amount <= 0) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }

  const queued: (AdminGiftJobInput & { admin_comment?: string })[] = [];
  const errors: { user_id: number; error: string }[] = [];

  for (const userId of userIds) {
    const user = getUser(userId);
    if (!user) {
      errors.push({ user_id: userId, error: "user_not_found" });
      continue;
    }
    const tgKey = String(user.tg_id ?? "").trim();
    const tgChatId = Number(tgKey);
    if (!tgKey || !Number.isFinite(tgChatId) || tgChatId <= 0) {
      errors.push({ user_id: userId, error: "user_no_tg_id" });
      continue;
    }
    if (kind === "gb" && user.total_gb <= 0) {
      errors.push({ user_id: userId, error: "user_unlimited_gb" });
      continue;
    }
    if (!tryBeginAdminGiftJob(userId)) {
      errors.push({ user_id: userId, error: "gift_already_processing" });
      continue;
    }
    queued.push({ user_id: userId, kind, amount, ...(adminComment ? { admin_comment: adminComment } : {}) });
  }

  if (queued.length === 0) {
    res.status(400).json({ error: "no_valid_users", errors });
    return;
  }

  runAdminGiftJobs(queued);

  res.json({ ok: true, queued: queued.length, errors });
});

export default router;
