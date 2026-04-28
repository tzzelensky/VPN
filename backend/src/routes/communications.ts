import { Router } from "express";
import { getUser, listUsers } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { sendTelegramHtml, sendTelegramPhotoBinary } from "../telegram/api.js";
import { getTelegramBotToken } from "../telegram/env.js";

const router = Router();
router.use(requireAuth);

type TargetUserLite = { id: number; name: string; tg_id: string; enable: boolean };

type SendBody = {
  mode?: unknown;
  text?: unknown;
  user_id?: unknown;
  user_ids?: unknown;
  mark_enabled?: unknown;
  mark_text?: unknown;
  photo_base64?: unknown;
  photo_mime?: unknown;
  photo_name?: unknown;
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

router.get("/targets", (_req, res) => {
  const users = listUsers().map((u) => ({
    id: u.id,
    name: u.name,
    tg_id: u.tg_id,
    enable: u.enable === 1,
  }));
  res.json({ users });
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
  for (const t of targets) {
    try {
      if (photo) {
        await sendTelegramPhotoBinary(t.chatId, photo.bytes, {
          caption,
          filename: photo.filename,
          mimeType: photo.mime,
          parse_mode: "HTML",
        });
      } else {
        await sendTelegramHtml(t.chatId, caption);
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

  res.json({
    ok: failures.length === 0,
    sent,
    attempted: targets.length,
    failed: failures.length,
    failures,
  });
});

export default router;
