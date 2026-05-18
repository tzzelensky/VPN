import { Router } from "express";
import { logCommunicationMessage, stripHtmlPreview } from "../communicationLog.js";
import {
  createCommunicationSegment,
  deleteCommunicationSegment,
  getUser,
  listCommunicationMessageLog,
  listCommunicationSegments,
  listUsers,
  updateCommunicationSegment,
  type CommunicationSegmentRow,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendTelegramHtml, sendTelegramPhotoBinary, telegramHasDialog } from "../telegram/api.js";
import { getTelegramBotToken, getTelegramWebAppUrl } from "../telegram/env.js";

const router = Router();
router.use(requireAuth);

type TargetUserLite = { id: number; name: string; tg_id: string; enable: boolean };

type SendBody = {
  mode?: unknown;
  text?: unknown;
  user_id?: unknown;
  user_ids?: unknown;
  segment_id?: unknown;
  mark_enabled?: unknown;
  mark_text?: unknown;
  photo_base64?: unknown;
  photo_mime?: unknown;
  photo_name?: unknown;
  buttons?: unknown;
};

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

function toChatId(raw: string): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseDataUrl(input: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(input.trim());
  if (!m) return null;
  const mime = m[1] || "image/jpeg";
  const b64 = m[2] || "";
  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return null;
    return { mime, bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
}

function uniqTargets(rows: TargetUserLite[]): Array<{ chatId: number; userId: number; userName: string }> {
  const out: Array<{ chatId: number; userId: number; userName: string }> = [];
  const seen = new Set<number>();
  for (const r of rows) {
    const chatId = toChatId(r.tg_id);
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    out.push({ chatId, userId: r.id, userName: r.name });
  }
  return out;
}

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

type CommInlineBtn =
  | { text: string; callback_data: string }
  | { text: string; web_app: { url: string } };

function parseButtons(raw: unknown): CommInlineBtn[] {
  const arr = Array.isArray(raw) ? raw : [];
  const ids = [...new Set(arr.map((x) => String(x ?? "").trim()))];
  const out: CommInlineBtn[] = [];
  for (const id of ids) {
    if (id === "pay") out.push({ text: "Оплата подписки", callback_data: "pay" });
    else if (id === "ref") out.push({ text: "Пригласи друга", callback_data: "ref_menu" });
    else if (id === "sub") out.push({ text: "Подписка", callback_data: "sub" });
    else if (id === "buygb") out.push({ text: "Докупить ГБ", callback_data: "buygb" });
    else if (id === "webapp") {
      const url = getTelegramWebAppUrl();
      if (url) out.push({ text: "Открыть приложение", web_app: { url } });
    }
  }
  return out;
}

router.get("/segments", (_req, res) => {
  res.json({ segments: listCommunicationSegments() });
});

router.get("/history", (req, res) => {
  const limit = Number(req.query.limit);
  const rows = listCommunicationMessageLog(Number.isFinite(limit) ? limit : 200);
  res.json({ items: rows });
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
  const updated = updateCommunicationSegment(id, parseSegmentBody((req.body ?? {}) as SegmentBody));
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
  const ok = deleteCommunicationSegment(id);
  if (!ok) {
    res.status(404).json({ error: "segment_not_found" });
    return;
  }
  res.json({ ok: true });
});

function daysLeft(u: { expiry_time: number }): number | null {
  if (!u.expiry_time || u.expiry_time <= 0) return null;
  const ms = u.expiry_time - Date.now();
  if (ms <= 0) return 0;
  return Math.max(0, Math.ceil(ms / 86400000));
}

function remainingGb(u: { total_gb: number; traffic_up: number; traffic_down: number }): number | null {
  if (u.total_gb <= 0) return null;
  const used = (u.traffic_up + u.traffic_down) / (1024 * 1024 * 1024);
  return Math.max(0, Number((u.total_gb - used).toFixed(2)));
}

function matchesMetric(value: number | null, mode: "any" | "exact" | "range", exact?: number, from?: number, to?: number): boolean {
  if (mode === "any") return true;
  if (value == null) return false;
  if (mode === "exact") return Math.floor(value) === Math.max(0, Math.floor(Number(exact) || 0));
  const a = Math.max(0, Math.floor(Number(from) || 0));
  const b = Math.max(0, Math.floor(Number(to) || 0));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return value >= lo && value <= hi;
}

async function buildSegmentRows(segmentId: string): Promise<TargetUserLite[]> {
  const segment = listCommunicationSegments().find((s) => s.id === segmentId);
  if (!segment) throw new Error("segment_not_found");
  const all = listUsers();
  const pre = segment.user_ids.length > 0 ? all.filter((u) => segment.user_ids.includes(u.id)) : all;
  const filtered = pre.filter((u) => {
    const d = daysLeft(u);
    const g = remainingGb(u);
    return (
      matchesMetric(d, segment.days_mode, segment.days_exact, segment.days_from, segment.days_to) &&
      matchesMetric(g, segment.gb_mode, segment.gb_exact, segment.gb_from, segment.gb_to)
    );
  });
  const rows: TargetUserLite[] = [];
  for (const u of filtered) {
    const chatId = toChatId(u.tg_id);
    if (!chatId) continue;
    const hasChat = await telegramHasDialog(chatId);
    if (!hasChat) continue;
    rows.push({ id: u.id, name: u.name, tg_id: u.tg_id, enable: u.enable === 1 });
  }
  return rows;
}

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

router.post("/send", async (req, res) => {
  if (!getTelegramBotToken()) {
    res.status(503).json({ error: "telegram_not_configured" });
    return;
  }

  const body = (req.body ?? {}) as SendBody;
  const mode = String(body.mode ?? "").trim();
  const text = String(body.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "message_required" });
    return;
  }

  let photo: { mime: string; bytes: Uint8Array; filename: string } | null = null;
  if (body.photo_base64 != null && String(body.photo_base64).trim()) {
    const parsed = parseDataUrl(String(body.photo_base64));
    if (!parsed) {
      res.status(400).json({ error: "invalid_photo" });
      return;
    }
    photo = {
      mime: String((body.photo_mime ?? parsed.mime) || "image/jpeg"),
      bytes: parsed.bytes,
      filename: String(body.photo_name ?? "photo.jpg").trim() || "photo.jpg",
    };
  }

  let targets: Array<{ chatId: number; userId: number; userName: string }> = [];
  if (mode === "global") {
    const all = listUsers().map((u) => ({ id: u.id, name: u.name, tg_id: u.tg_id, enable: u.enable === 1 }));
    targets = uniqTargets(all);
  } else if (mode === "single") {
    const id = Number(body.user_id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "user_required" });
      return;
    }
    const user = getUser(id);
    if (!user) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const row = { id: user.id, name: user.name, tg_id: user.tg_id, enable: user.enable === 1 };
    targets = uniqTargets([row]);
  } else if (mode === "selected") {
    const idsRaw = Array.isArray(body.user_ids) ? body.user_ids : [];
    const ids = [...new Set(idsRaw.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))];
    if (ids.length === 0) {
      res.status(400).json({ error: "users_required" });
      return;
    }
    const rows: TargetUserLite[] = [];
    for (const id of ids) {
      const u = getUser(id);
      if (!u) continue;
      rows.push({ id: u.id, name: u.name, tg_id: u.tg_id, enable: u.enable === 1 });
    }
    targets = uniqTargets(rows);
  } else if (mode === "segment") {
    const segmentId = String(body.segment_id ?? "").trim();
    if (!segmentId) {
      res.status(400).json({ error: "segment_required" });
      return;
    }
    try {
      const rows = await buildSegmentRows(segmentId);
      targets = uniqTargets(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "segment_not_found") {
        res.status(404).json({ error: msg });
        return;
      }
      res.status(500).json({ error: msg });
      return;
    }
  } else {
    res.status(400).json({ error: "invalid_mode" });
    return;
  }

  if (targets.length === 0) {
    res.status(400).json({ error: "no_targets" });
    return;
  }

  const failures: Array<{ user_id: number; user_name: string; error: string }> = [];
  let sent = 0;
  const markEnabled = body.mark_enabled === true || body.mark_enabled === 1 || body.mark_enabled === "1";
  const markText = String(body.mark_text ?? "").trim();
  const header = markEnabled ? `<b>${markText || "Сообщение от администратора"}</b>\n\n` : "";
  const caption = `${header}${text}`;
  const buttons = parseButtons(body.buttons);
  const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons.map((b) => [b]) } : undefined;
  for (const t of targets) {
    try {
      if (photo) {
        await sendTelegramPhotoBinary(t.chatId, photo.bytes, {
          caption,
          filename: photo.filename,
          mimeType: photo.mime,
          parse_mode: "HTML",
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
      } else {
        await sendTelegramHtml(t.chatId, caption, replyMarkup);
      }
      sent++;
    } catch (e) {
      failures.push({
        user_id: t.userId,
        user_name: t.userName,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const segment =
    mode === "segment" ? listCommunicationSegments().find((s) => s.id === String(body.segment_id ?? "").trim()) : undefined;

  try {
    logCommunicationMessage({
      automatic: false,
      source_label: MODE_SOURCE_LABELS[mode] ?? "Рассылка из панели",
      mode: mode as "global" | "single" | "selected" | "segment",
      ...(segment ? { segment_id: segment.id, segment_name: segment.name } : {}),
      text: stripHtmlPreview(caption),
      has_photo: Boolean(photo),
      recipients: targets.map((t) => ({ user_id: t.userId, user_name: t.userName })),
      sent,
      attempted: targets.length,
      failed: failures.length,
    });
  } catch (e) {
    console.error("[communications] log:", e);
  }

  res.json({
    ok: failures.length === 0,
    sent,
    attempted: targets.length,
    failed: failures.length,
    failures,
  });
});

export default router;
