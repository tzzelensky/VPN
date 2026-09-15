import { Router } from "express";
import surveysRouter from "./surveys.js";
import { buildSegmentRows, toChatId } from "../communicationTargets.js";
import { readCommunicationPhoto, deleteCommunicationPhoto } from "../communicationMediaFiles.js";
import {
  createCommunicationSegment,
  deleteCommunicationSegment,
  ensureTestSubscriptionSegment,
  ensureWhitelistConnectedSegment,
  getCommunicationMessageLogById,
  deleteCommunicationMessageLog,
  isSystemCommunicationSegment,
  isTestSubscriptionSystemSegment,
  isWhitelistConnectedSystemSegment,
  listCommunicationMessageLog,
  listCommunicationSegments,
  listTestSubscriptionSegmentUserIds,
  listUsers,
  listWhitelistConnectedSegmentUserIds,
  refreshTestSubscriptionSegment,
  refreshWhitelistConnectedSegment,
  updateCommunicationSegment,
  WHITELIST_CONNECTED_SEGMENT_NAME,
  type CommunicationSegmentRow,
} from "../db.js";
import { sweepExpiredManualWhitelistGrants } from "../whitelistVaultDb.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getAutoCommunicationsConfig, setAutoCommunicationsConfig } from "../autoCommunicationsStore.js";
import { normalizeAutoCommunicationsConfig } from "../autoCommunicationsTypes.js";
import { getTelegramBotToken } from "../telegram/env.js";
import { telegramHasDialog } from "../telegram/api.js";
import { runAutoExpiryNotificationsOnce } from "../telegram/expiryNotify.js";
import triggerMailingsRouter from "./triggerMailings.js";
import {
  CommunicationSendError,
  executeCommunicationSend,
  normalizeScheduledPayload,
  type CommunicationSendPayload,
} from "../communicationSend.js";
import {
  addScheduledMailing,
  cancelScheduledMailing,
  listScheduledMailings,
} from "../scheduledMailingsStore.js";
import { friendlyGeminiError, generateGeminiText, isGeminiConfigured } from "../telegram/geminiAi.js";

const MAIL_IMPROVE_INSTRUCTION =
  "Ты редактор рекламных сообщений VPN-сервиса для Telegram. " +
  "Улучши черновик пользователя: сделай текст более привлекательным и продающим, сохрани смысл и все факты. " +
  "Пиши по-русски обычным текстом. Не используй HTML и Markdown: никаких <b> </b> <i> ** __ ` и прочих тегов. " +
  "Не выдумывай цены, тарифы, сроки, промокоды и кнопки. Не пиши фейковые кнопки в квадратных скобках вроде [Подписка]. " +
  "Не раздувай текст в простыню — держи примерно тот же объём или чуть короче, если черновик длинный. " +
  "Верни только готовый текст сообщения, без пояснений и кавычек вокруг.";

function stripMailImproveMarkup(text: string): string {
  return String(text ?? "")
    .replace(/<\/?(?:b|strong|i|em|u|s|code|pre)(?:\s[^>]*)?>/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const router = Router();
router.use(requireAuth);

type SendBody = CommunicationSendPayload & { send_at?: unknown };

type SegmentBody = {
  name?: unknown;
  user_ids?: unknown;
  days_mode?: unknown;
  days_exact?: unknown;
  days_from?: unknown;
  days_to?: unknown;
  gb_mode?: unknown;
  gb_exact?: unknown;
  gb_from?: unknown;
  gb_to?: unknown;
  preset_enabled?: unknown;
  preset_text?: unknown;
};

router.get("/targets", async (_req, res) => {
  const base = listUsers().map((u) => ({
    id: u.id,
    name: u.name,
    tg_id: u.tg_id,
    enable: u.enable === 1,
  }));
  const users = await Promise.all(
    base.map(async (u) => {
      const chatId = toChatId(u.tg_id);
      const has_chat = chatId ? await telegramHasDialog(chatId) : false;
      return { ...u, has_chat };
    }),
  );
  res.json({ users });
});

router.get("/auto-broadcasts", (_req, res) => {
  res.json(getAutoCommunicationsConfig());
});

router.put("/auto-broadcasts", (req, res) => {
  try {
    const next = setAutoCommunicationsConfig(normalizeAutoCommunicationsConfig(req.body));
    res.json(next);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/auto-broadcasts/run-expiry", async (_req, res) => {
  try {
    if (!getTelegramBotToken()) {
      res.status(503).json({ error: "telegram_not_configured" });
      return;
    }
    await runAutoExpiryNotificationsOnce({ force: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

function parseSegmentBody(body: SegmentBody): Omit<CommunicationSegmentRow, "id" | "created_at" | "updated_at"> {
  return {
    name: String(body.name ?? "").trim().slice(0, 120),
    user_ids: Array.isArray(body.user_ids)
      ? [...new Set(body.user_ids.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))]
      : [],
    days_mode:
      String(body.days_mode ?? "any").trim() === "exact" || String(body.days_mode ?? "any").trim() === "range"
        ? (String(body.days_mode ?? "any").trim() as "exact" | "range")
        : "any",
    days_exact: Math.max(0, Math.floor(Number(body.days_exact) || 0)),
    days_from: Math.max(0, Math.floor(Number(body.days_from) || 0)),
    days_to: Math.max(0, Math.floor(Number(body.days_to) || 0)),
    gb_mode:
      String(body.gb_mode ?? "any").trim() === "exact" || String(body.gb_mode ?? "any").trim() === "range"
        ? (String(body.gb_mode ?? "any").trim() as "exact" | "range")
        : "any",
    gb_exact: Math.max(0, Math.floor(Number(body.gb_exact) || 0)),
    gb_from: Math.max(0, Math.floor(Number(body.gb_from) || 0)),
    gb_to: Math.max(0, Math.floor(Number(body.gb_to) || 0)),
    preset_enabled:
      body.preset_enabled === true || body.preset_enabled === 1 || body.preset_enabled === "1",
    preset_text: String(body.preset_text ?? "").trim().slice(0, 4000),
  };
}

router.get("/segments", (_req, res) => {
  sweepExpiredManualWhitelistGrants();
  ensureTestSubscriptionSegment();
  refreshTestSubscriptionSegment();
  ensureWhitelistConnectedSegment();
  refreshWhitelistConnectedSegment();
  res.json({ segments: listCommunicationSegments() });
});

router.get("/history", (req, res) => {
  const limit = Number(req.query.limit);
  const from = String(req.query.from ?? "").trim();
  const to = String(req.query.to ?? "").trim();
  const manual =
    req.query.manual === "1" ||
    req.query.manual === "true" ||
    req.query.manual_only === "1" ||
    req.query.manual_only === "true";
  const rows = listCommunicationMessageLog(Number.isFinite(limit) ? limit : 200, {
    fromYmd: from || undefined,
    toYmd: to || undefined,
    manualOnly: manual,
  });
  res.json({ items: rows });
});

router.get("/history/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const row = getCommunicationMessageLogById(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(row);
});

router.get("/history/:id/photo", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const row = getCommunicationMessageLogById(id);
  if (!row?.photo_path) {
    res.status(404).json({ error: "photo_not_found" });
    return;
  }
  const photo = readCommunicationPhoto(row.photo_path);
  if (!photo) {
    res.status(404).json({ error: "photo_not_found" });
    return;
  }
  res.setHeader("Content-Type", photo.mime);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(row.photo_name || photo.filename)}"`,
  );
  res.send(photo.bytes);
});

router.delete("/history/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id_required" });
    return;
  }
  const removed = deleteCommunicationMessageLog(id);
  if (!removed) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (removed.photo_path) deleteCommunicationPhoto(removed.photo_path);
  res.json({ ok: true, id });
});

const MODE_SOURCE_LABELS: Record<string, string> = {
  global: "Рассылка: всем клиентам",
  single: "Рассылка: одному клиенту",
  selected: "Рассылка: выбранным клиентам",
  segment: "Рассылка: по сегменту",
};

router.post("/segments", (req, res) => {
  try {
    const segment = createCommunicationSegment(parseSegmentBody((req.body ?? {}) as SegmentBody));
    res.status(201).json(segment);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch("/segments/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "segment_id_required" });
    return;
  }
  const existing = listCommunicationSegments().find((s) => s.id === id);
  if (!existing) {
    res.status(404).json({ error: "segment_not_found" });
    return;
  }
  const body = parseSegmentBody((req.body ?? {}) as SegmentBody);
  if (isTestSubscriptionSystemSegment(existing)) {
    const updated = updateCommunicationSegment(id, {
      preset_enabled: body.preset_enabled,
      preset_text: body.preset_text,
      days_mode: "any",
      gb_mode: "any",
      user_ids: listTestSubscriptionSegmentUserIds(),
    });
    res.json(updated ?? refreshTestSubscriptionSegment());
    return;
  }
  if (isWhitelistConnectedSystemSegment(existing)) {
    sweepExpiredManualWhitelistGrants();
    const updated = updateCommunicationSegment(id, {
      name: WHITELIST_CONNECTED_SEGMENT_NAME,
      days_mode: "any",
      gb_mode: "any",
      user_ids: listWhitelistConnectedSegmentUserIds(),
      preset_enabled: false,
      preset_text: "",
    });
    res.json(updated ?? refreshWhitelistConnectedSegment());
    return;
  }
  const updated = updateCommunicationSegment(id, body);
  if (!updated) {
    res.status(404).json({ error: "segment_not_found" });
    return;
  }
  res.json(updated);
});

router.delete("/segments/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "segment_id_required" });
    return;
  }
  const existing = listCommunicationSegments().find((s) => s.id === id);
  if (existing && isSystemCommunicationSegment(existing)) {
    res.status(403).json({ error: "system_segment_protected" });
    return;
  }
  const ok = deleteCommunicationSegment(id);
  if (!ok) {
    res.status(404).json({ error: "segment_not_found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/segments/:id/refresh-test-subscriptions", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const existing = listCommunicationSegments().find((s) => s.id === id);
  if (!existing || !isSystemCommunicationSegment(existing)) {
    res.status(404).json({ error: "segment_not_found" });
    return;
  }
  if (isWhitelistConnectedSystemSegment(existing)) {
    sweepExpiredManualWhitelistGrants();
    const segment = refreshWhitelistConnectedSegment();
    res.json(segment);
    return;
  }
  const segment = refreshTestSubscriptionSegment();
  res.json(segment);
});

router.get("/segments/:id/users", async (req, res) => {
  const segmentId = String(req.params.id ?? "").trim();
  if (!segmentId) {
    res.status(400).json({ error: "segment_required" });
    return;
  }
  try {
    const rows = await buildSegmentRows(segmentId);
    res.json({
      users: rows.map((u) => ({ id: u.id, name: u.name, tg_id: u.tg_id })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "segment_not_found") {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
});


router.get("/scheduled", (_req, res) => {
  res.json({ items: listScheduledMailings("pending") });
});

router.delete("/scheduled/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id_required" });
    return;
  }
  const job = cancelScheduledMailing(id);
  if (!job) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true, id: job.id });
});

router.post("/improve-text", async (req, res) => {
  if (!isGeminiConfigured()) {
    res.status(503).json({ error: friendlyGeminiError("gemini_not_configured", "panel") });
    return;
  }
  const text = String((req.body as { text?: unknown } | undefined)?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "message_required" });
    return;
  }
  try {
    const improved = stripMailImproveMarkup(await generateGeminiText(MAIL_IMPROVE_INSTRUCTION, text));
    res.json({ improved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(502).json({ error: friendlyGeminiError(msg, "panel") });
  }
});

router.post("/send", async (req, res) => {
  if (!getTelegramBotToken()) {
    res.status(503).json({ error: "telegram_not_configured" });
    return;
  }

  const body = (req.body ?? {}) as SendBody;
  const sendAtRaw = String(body.send_at ?? "").trim();
  if (sendAtRaw) {
    const sendAtMs = Date.parse(sendAtRaw);
    if (!Number.isFinite(sendAtMs)) {
      res.status(400).json({ error: "invalid_send_at" });
      return;
    }
    if (sendAtMs > Date.now() + 15_000) {
      try {
        const payload = normalizeScheduledPayload(body);
        const job = addScheduledMailing(new Date(sendAtMs).toISOString(), payload);
        res.json({
          ok: true,
          scheduled: true,
          id: job.id,
          send_at: job.send_at,
          sent: 0,
          attempted: 0,
          failed: 0,
          failures: [],
        });
      } catch (e) {
        if (e instanceof CommunicationSendError) {
          res.status(e.status).json({ error: e.code });
          return;
        }
        res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
  }

  try {
    const result = await executeCommunicationSend(body);
    res.json(result);
  } catch (e) {
    if (e instanceof CommunicationSendError) {
      res.status(e.status).json({ error: e.code });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.use("/surveys", surveysRouter);
router.use("/trigger-mailings", triggerMailingsRouter);

export default router;
