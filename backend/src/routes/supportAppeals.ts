import { Router } from "express";
import {
  completeSupportAppeal,
  deleteSupportAppeal,
  getSupportAppeal,
  getSupportAppealsConfig,
  countNewSupportAppeals,
  listSupportAppeals,
  normalizeSupportAppealsConfig,
  setSupportAppealsConfig,
  takeSupportAppealInWork,
  type SupportAppealRow,
  type SupportAppealsConfig,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { deleteAppealFiles, saveAppealAdminReplyPhoto } from "../supportAppealFiles.js";
import {
  appealUserPhotoCount,
  loadAppealUserPhotoBytes,
  notifyUserAppealClosed,
  notifyUserAppealInProgress,
} from "../supportAppealsNotify.js";
import { readAppealStoredPhoto } from "../supportAppealFiles.js";

const router = Router();
router.use(requireAuth);

function parseDataUrl(input: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(input.trim());
  if (!m) return null;
  const mime = m[1] || "image/jpeg";
  const b64 = m[2] || "";
  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return null;
    return { mime, bytes: buf };
  } catch {
    return null;
  }
}

router.get("/", (_req, res) => {
  const appeals = listSupportAppeals().map((a) => ({
    ...a,
    photo_count: appealUserPhotoCount(a),
    text_preview: a.text.length > 120 ? `${a.text.slice(0, 120)}…` : a.text,
  }));
  res.json({
    config: getSupportAppealsConfig(),
    appeals,
  });
});

/** Для мобильного приложения и бейджа в панели: число обращений со статусом «new». */
router.get("/badge", (_req, res) => {
  res.json({ new_count: countNewSupportAppeals() });
});

router.put("/config", (req, res) => {
  try {
    const next = normalizeSupportAppealsConfig(req.body as SupportAppealsConfig);
    setSupportAppealsConfig(next);
    res.json(next);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/:id/photo/:photoIndex", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const index = Math.max(0, Math.floor(Number(req.params.photoIndex) || 0));
  const row = getSupportAppeal(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (index >= appealUserPhotoCount(row)) {
    res.status(404).json({ error: "photo_not_found" });
    return;
  }
  try {
    const hit = await loadAppealUserPhotoBytes(row, index);
    if (!hit) {
      res.status(404).json({ error: "photo_unavailable" });
      return;
    }
    res.setHeader("Content-Type", hit.mime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(hit.bytes);
  } catch (e) {
    console.error("[support] photo:", e);
    res.status(502).json({ error: "photo_fetch_failed" });
  }
});

router.get("/:id/reply-photo/:photoIndex", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const index = Math.max(0, Math.floor(Number(req.params.photoIndex) || 0));
  const row = getSupportAppeal(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const paths = row.admin_reply_photo_paths ?? [];
  if (index >= paths.length) {
    res.status(404).json({ error: "photo_not_found" });
    return;
  }
  const hit = readAppealStoredPhoto(paths[index]!);
  if (!hit) {
    res.status(404).json({ error: "photo_unavailable" });
    return;
  }
  res.setHeader("Content-Type", hit.mime);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(hit.bytes);
});

router.post("/:id/take", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  const cur = getSupportAppeal(id);
  if (!cur) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (cur.status !== "new") {
    res.status(409).json({ error: "already_handled", status: cur.status });
    return;
  }
  const next = takeSupportAppealInWork(id);
  if (!next) {
    res.status(409).json({ error: "take_failed" });
    return;
  }
  try {
    await notifyUserAppealInProgress(next);
  } catch (e) {
    console.error("[support] take notify user:", e);
  }
  res.json({ ok: true, appeal: enrichAppeal(next) });
});

router.delete("/:id", (req, res) => {
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  const cur = getSupportAppeal(id);
  if (!cur) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (cur.status === "in_progress") {
    res.status(409).json({ error: "in_progress", status: cur.status });
    return;
  }
  if (!deleteSupportAppeal(id)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    deleteAppealFiles(id);
  } catch (e) {
    console.error("[support] delete files:", e);
  }
  res.json({ ok: true });
});

router.post("/:id/complete", async (req, res) => {
  const id = String(req.params.id ?? "").trim();
  const replyText = String((req.body as { reply_text?: unknown })?.reply_text ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  if (!replyText) {
    res.status(400).json({ error: "reply_text_required" });
    return;
  }
  const cur = getSupportAppeal(id);
  if (!cur) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (cur.status !== "in_progress") {
    res.status(409).json({ error: "not_in_progress", status: cur.status });
    return;
  }
  const photosRaw = Array.isArray((req.body as { photos?: unknown }).photos)
    ? (req.body as { photos: unknown[] }).photos
    : [];
  const replyPaths: string[] = [];
  for (let i = 0; i < Math.min(photosRaw.length, 5); i++) {
    const item = photosRaw[i];
    if (!item || typeof item !== "object") continue;
    const o = item as { base64?: unknown; mime?: unknown; name?: unknown };
    const b64 = String(o.base64 ?? "").trim();
    const parsed = parseDataUrl(b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`);
    if (!parsed) continue;
    replyPaths.push(saveAppealAdminReplyPhoto(id, i, parsed.bytes, parsed.mime));
  }
  const next = completeSupportAppeal(id, {
    admin_reply_text: replyText,
    admin_reply_photo_paths: replyPaths,
  });
  if (!next) {
    res.status(409).json({ error: "complete_failed" });
    return;
  }
  try {
    await notifyUserAppealClosed(next);
  } catch (e) {
    console.error("[support] complete notify user:", e);
  }
  res.json({ ok: true, appeal: enrichAppeal(next) });
});

function enrichAppeal(a: SupportAppealRow) {
  return {
    ...a,
    photo_count: appealUserPhotoCount(a),
    text_preview: a.text.length > 120 ? `${a.text.slice(0, 120)}…` : a.text,
  };
}

export default router;
