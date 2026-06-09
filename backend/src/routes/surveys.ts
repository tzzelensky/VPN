import { Router } from "express";
import type { RecipientMode } from "../communicationTargets.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getTelegramBotToken } from "../telegram/env.js";
import {
  buildSurveyExportCsv,
  buildSurveyReport,
  buildSurveyStats,
  createOrUpdateSurvey,
  enrichRecipientRow,
  listSurveysWithStats,
  queueSurveySend,
} from "../surveyService.js";
import { archiveSurvey, deleteSurveyDraft, getSurvey, listSurveyRecipients } from "../surveyDb.js";
import { deleteSurveyPhoto } from "../surveyFiles.js";

const router = Router();
router.use(requireAuth);

function parseDataUrl(input: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(input.trim());
  if (!m) return null;
  const mime = m[1] || "image/jpeg";
  try {
    const buf = Buffer.from(m[2] || "", "base64");
    if (!buf.length) return null;
    return { mime, bytes: buf };
  } catch {
    return null;
  }
}

function parseMode(raw: unknown): RecipientMode | null {
  const m = String(raw ?? "").trim();
  if (m === "global" || m === "single" || m === "selected" || m === "segment") return m;
  return null;
}

type Body = {
  id?: unknown;
  title?: unknown;
  message_text?: unknown;
  allow_feedback?: unknown;
  mode?: unknown;
  user_id?: unknown;
  user_ids?: unknown;
  segment_id?: unknown;
  photo_base64?: unknown;
  photo_mime?: unknown;
  photo_name?: unknown;
  clear_photo?: unknown;
  send?: unknown;
};

router.get("/", (_req, res) => {
  res.json({ surveys: listSurveysWithStats() });
});

router.get("/:id/export.csv", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  try {
    const csv = buildSurveyExportCsv(id);
    const survey = getSurvey(id);
    const name = (survey?.title ?? "survey").replace(/[^\w.-]+/g, "_").slice(0, 60);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
    res.send(csv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_found") {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

router.get("/:id", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  const survey = getSurvey(id);
  if (!survey) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const recipients = listSurveyRecipients(id).map(enrichRecipientRow);
  res.json({
    survey,
    stats: buildSurveyStats(id),
    report: buildSurveyReport(id),
    recipients,
  });
});

router.post("/:id/archive", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  const survey = getSurvey(id);
  if (!survey) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const archived = archiveSurvey(id);
  if (!archived) {
    res.status(400).json({ error: "cannot_archive" });
    return;
  }
  res.json({ ok: true, survey: archived });
});

router.post("/", async (req, res) => {
  if (!getTelegramBotToken()) {
    res.status(503).json({ error: "telegram_not_configured" });
    return;
  }
  const body = (req.body ?? {}) as Body;
  const mode = parseMode(body.mode);
  if (!mode) {
    res.status(400).json({ error: "invalid_mode" });
    return;
  }
  let photo: { mime: string; bytes: Buffer; filename: string } | null = null;
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
  const allow_feedback = body.allow_feedback === true || body.allow_feedback === 1 || body.allow_feedback === "1";
  const created_by = "panel";
  try {
    const survey = await createOrUpdateSurvey({
      id: body.id != null ? Math.floor(Number(body.id)) : undefined,
      title: String(body.title ?? ""),
      message_text: String(body.message_text ?? ""),
      allow_feedback,
      created_by,
      mode,
      user_id: Number(body.user_id),
      user_ids: Array.isArray(body.user_ids)
        ? body.user_ids.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0)
        : [],
      segment_id: String(body.segment_id ?? ""),
      photo,
      clear_photo: body.clear_photo === true || body.clear_photo === 1 || body.clear_photo === "1",
    });
    console.log("[survey] created/updated id=", survey.id, "by=", created_by);
    const shouldSend = body.send === true || body.send === 1 || body.send === "1";
    if (shouldSend) {
      queueSurveySend(survey.id);
    }
    res.json({ survey, stats: buildSurveyStats(survey.id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code =
      msg === "title_required" || msg === "message_required" || msg === "no_targets" || msg === "invalid_photo"
        ? 400
        : msg === "not_found" || msg === "not_draft"
          ? 404
          : msg === "photo_too_large" || msg === "unsupported_photo_format"
            ? 400
            : 500;
    res.status(code).json({ error: msg });
  }
});

router.post("/:id/send", (req, res) => {
  if (!getTelegramBotToken()) {
    res.status(503).json({ error: "telegram_not_configured" });
    return;
  }
  const id = Math.floor(Number(req.params.id));
  const survey = getSurvey(id);
  if (!survey) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (survey.status !== "draft" && survey.status !== "failed") {
    res.status(400).json({ error: "already_sent" });
    return;
  }
  if (survey.recipients_count === 0) {
    res.status(400).json({ error: "no_recipients" });
    return;
  }
  console.log("[survey] queue send id=", id);
  queueSurveySend(id);
  res.json({ ok: true, survey: getSurvey(id) });
});

router.delete("/:id", (req, res) => {
  const id = Math.floor(Number(req.params.id));
  const survey = getSurvey(id);
  if (!survey) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (survey.photo_path) deleteSurveyPhoto(survey.photo_path);
  if (!deleteSurveyDraft(id)) {
    res.status(400).json({ error: "not_draft" });
    return;
  }
  res.json({ ok: true });
});

export default router;
