import type { RecipientMode } from "./communicationTargets.js";
import { resolveCommunicationRecipients } from "./communicationTargets.js";
import { getUser, listUsers } from "./db.js";
import {
  createSurveyDraft,
  finishSurveySend,
  getSurvey,
  listSurveyRecipients,
  listSurveyResponses,
  listSurveys,
  markSurveySending,
  replaceSurveyRecipients,
  updateRecipientStatus,
  updateSurveyDraft,
  type SurveyRecipientRow,
  type SurveyRow,
} from "./surveyDb.js";
import { deleteSurveyPhoto, readSurveyPhoto, saveSurveyPhoto } from "./surveyFiles.js";
import { sendTelegramHtml, sendTelegramPhotoBinary } from "./telegram/api.js";
import { surveyRatingKeyboard } from "./surveyTelegram.js";

const sendingSurveys = new Set<number>();

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildSurveyReport(surveyId: number) {
  const survey = getSurvey(surveyId);
  if (!survey) throw new Error("not_found");
  const recipients = listSurveyRecipients(surveyId);
  const stats = buildSurveyStats(surveyId);
  const send_ok = recipients.filter((r) => r.status === "sent" || r.status === "delivered" || r.status === "answered").length;
  const send_failed = recipients.filter((r) => r.status === "failed").length;
  const total = recipients.length;
  const answered = stats.answered_count;
  const response_rate = total > 0 ? Math.round((answered / total) * 1000) / 10 : 0;
  const maxDist = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => stats.distribution[n] ?? 0));
  return {
    stats,
    total_recipients: total,
    send_ok,
    send_failed,
    answered,
    response_rate,
    max_dist: maxDist,
  };
}

export function buildSurveyStats(surveyId: number) {
  const responses = listSurveyResponses(surveyId).filter((r) => r.rating != null && r.rating >= 1);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>;
  let sum = 0;
  for (const r of responses) {
    const n = Math.floor(Number(r.rating));
    if (n >= 1 && n <= 5) {
      dist[n] = (dist[n] ?? 0) + 1;
      sum += n;
    }
  }
  const count = responses.length;
  return {
    answered_count: count,
    average_rating: count > 0 ? Number((sum / count).toFixed(2)) : null,
    distribution: dist,
  };
}

export async function resolveSurveyRecipientTargets(opts: {
  mode: RecipientMode;
  user_id?: number;
  user_ids?: number[];
  segment_id?: string;
}): Promise<Array<{ chatId: number; userId: number; userName: string }>> {
  return resolveCommunicationRecipients(opts);
}

export async function createOrUpdateSurvey(input: {
  id?: number;
  title: string;
  message_text: string;
  allow_feedback: boolean;
  created_by: string;
  mode: RecipientMode;
  user_id?: number;
  user_ids?: number[];
  segment_id?: string;
  photo?: { mime: string; bytes: Buffer; filename: string } | null;
  clear_photo?: boolean;
}): Promise<SurveyRow> {
  const title = String(input.title ?? "").trim().slice(0, 200);
  const message_text = String(input.message_text ?? "").trim().slice(0, 4000);
  if (!title) throw new Error("title_required");
  if (!message_text) throw new Error("message_required");

  let row: SurveyRow;
  if (input.id) {
    const existing = getSurvey(input.id);
    if (!existing) throw new Error("not_found");
    if (existing.status !== "draft") throw new Error("not_draft");
    const updated = updateSurveyDraft(existing.id, {
      title,
      message_text,
      allow_feedback: input.allow_feedback,
      recipient_mode: input.mode,
      recipient_user_id: input.mode === "single" ? Number(input.user_id) || null : null,
      recipient_user_ids: input.mode === "selected" ? input.user_ids ?? [] : [],
      recipient_segment_id: input.mode === "segment" ? String(input.segment_id ?? "") || null : null,
    });
    if (!updated) throw new Error("update_failed");
    row = updated;
    if (input.clear_photo && row.photo_path) {
      deleteSurveyPhoto(row.photo_path);
      row = updateSurveyDraft(row.id, { photo_path: null }) ?? row;
    }
    if (input.photo) {
      if (row.photo_path) deleteSurveyPhoto(row.photo_path);
      const rel = saveSurveyPhoto(row.id, input.photo.bytes, input.photo.mime);
      row = updateSurveyDraft(row.id, { photo_path: rel }) ?? row;
    }
  } else {
    row = createSurveyDraft({
      title,
      message_text,
      photo_path: null,
      allow_feedback: input.allow_feedback,
      created_by: input.created_by,
      recipient_mode: input.mode,
      recipient_user_id: input.mode === "single" ? Number(input.user_id) || null : null,
      recipient_user_ids: input.mode === "selected" ? input.user_ids ?? [] : [],
      recipient_segment_id: input.mode === "segment" ? String(input.segment_id ?? "") || null : null,
    });
    if (input.photo) {
      const rel = saveSurveyPhoto(row.id, input.photo.bytes, input.photo.mime);
      row = updateSurveyDraft(row.id, { photo_path: rel }) ?? row;
    }
  }

  const targets = await resolveSurveyRecipientTargets({
    mode: input.mode,
    user_id: input.user_id,
    user_ids: input.user_ids,
    segment_id: input.segment_id,
  });
  if (targets.length === 0) throw new Error("no_targets");
  replaceSurveyRecipients(
    row.id,
    targets.map((t) => ({ user_id: t.userId, telegram_chat_id: t.chatId })),
  );
  return getSurvey(row.id) ?? row;
}

export function queueSurveySend(surveyId: number): void {
  const id = Math.floor(surveyId);
  if (sendingSurveys.has(id)) return;
  sendingSurveys.add(id);
  setImmediate(() => {
    void runSurveySend(id).finally(() => sendingSurveys.delete(id));
  });
}

async function runSurveySend(surveyId: number): Promise<void> {
  const survey = getSurvey(surveyId);
  if (!survey) return;
  if (survey.status !== "draft" && survey.status !== "failed") {
    console.log("[survey] skip send, status=", survey.status, "id=", surveyId);
    return;
  }
  console.log("[survey] send start id=", surveyId);
  markSurveySending(surveyId);
  const recipients = listSurveyRecipients(surveyId);
  const photo = survey.photo_path ? readSurveyPhoto(survey.photo_path) : null;
  const markup = surveyRatingKeyboard(surveyId);
  const text = escHtml(survey.message_text);

  for (const rec of recipients) {
    try {
      if (photo) {
        await sendTelegramPhotoBinary(rec.telegram_chat_id, photo.bytes, {
          caption: text,
          filename: photo.filename,
          mimeType: photo.mime,
          parse_mode: "HTML",
          reply_markup: markup,
        });
      } else {
        await sendTelegramHtml(rec.telegram_chat_id, text, markup);
      }
      updateRecipientStatus(rec.id, { status: "sent", sent_at: Date.now(), error_message: null });
      console.log("[survey] sent ok survey=", surveyId, "user=", rec.user_id);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      updateRecipientStatus(rec.id, { status: "failed", error_message: err });
      console.error("[survey] send fail survey=", surveyId, "user=", rec.user_id, err);
    }
  }
  finishSurveySend(surveyId);
  console.log("[survey] send done id=", surveyId);
}

export function enrichRecipientRow(rec: SurveyRecipientRow) {
  const u = getUser(rec.user_id);
  const resp = listSurveyResponses(rec.survey_id).find((r) => r.recipient_id === rec.id);
  return {
    ...rec,
    user_name: u?.name ?? `id:${rec.user_id}`,
    telegram_username: u?.tg_id ? `tg:${u.tg_id}` : null,
    phone: u?.comment?.trim() || null,
    rating: resp?.rating ?? null,
    feedback_text: resp?.feedback_text ?? null,
    rating_answered_at: resp?.rating_answered_at ?? null,
    feedback_answered_at: resp?.feedback_answered_at ?? null,
  };
}

export function listSurveysWithStats() {
  return listSurveys().map((s) => {
    const recipients = listSurveyRecipients(s.id);
    const send_failed = recipients.filter((r) => r.status === "failed").length;
    const send_ok = recipients.filter((r) => r.status === "sent" || r.status === "delivered" || r.status === "answered").length;
    return {
      ...s,
      stats: buildSurveyStats(s.id),
      send_ok,
      send_failed,
    };
  });
}

export function buildSurveyExportCsv(surveyId: number): string {
  const survey = getSurvey(surveyId);
  if (!survey) throw new Error("not_found");
  const recipients = listSurveyRecipients(surveyId);
  const stats = buildSurveyStats(surveyId);
  const header = [
    "Название опроса",
    "Статус опроса",
    "Дата отправки",
    "Клиент",
    "Telegram",
    "Телефон",
    "Статус отправки",
    "Оценка",
    "Обратная связь",
    "Дата ответа",
    "Ошибка отправки",
    "Всего получателей",
    "Ответили",
    "Средняя оценка",
  ];
  const lines = [header.join(";")];
  const sentAt = survey.sent_at ? new Date(survey.sent_at).toISOString() : "";
  for (const rec of recipients) {
    const row = enrichRecipientRow(rec);
    const cells = [
      survey.title,
      survey.status,
      sentAt,
      row.user_name,
      row.telegram_username ?? "",
      row.phone ?? "",
      rec.status,
      row.rating != null ? String(row.rating) : "",
      (row.feedback_text ?? "").replace(/[\r\n;]/g, " "),
      row.rating_answered_at ? new Date(row.rating_answered_at).toISOString() : "",
      (rec.error_message ?? "").replace(/[\r\n;]/g, " "),
      String(survey.recipients_count),
      String(stats.answered_count),
      stats.average_rating != null ? String(stats.average_rating) : "",
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    lines.push(cells.join(";"));
  }
  return "\uFEFF" + lines.join("\n");
}

export function findUserTelegramMeta(userId: number) {
  const u = getUser(userId);
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    tg_id: u.tg_id,
    telegram_username: (u as { telegram_username?: string }).telegram_username ?? null,
    phone: (u as { phone?: string }).phone ?? null,
  };
}

export function listAllUsersLite() {
  return listUsers().map((u) => ({
    id: u.id,
    name: u.name,
    tg_id: u.tg_id,
    enable: u.enable === 1,
  }));
}
