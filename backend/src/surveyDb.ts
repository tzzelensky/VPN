import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RecipientMode } from "./communicationTargets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const storePath = process.env.SURVEYS_STORE_PATH ?? path.join(path.dirname(dataFile), "surveys_store.json");

export type SurveyStatus = "draft" | "sending" | "sent" | "failed" | "partially_failed" | "completed" | "archived";

/** Опрос уже разослан — можно принимать оценки по кнопкам в Telegram. */
export function surveyAcceptsRating(status: SurveyStatus): boolean {
  return (
    status === "sent" ||
    status === "partially_failed" ||
    status === "completed" ||
    status === "sending" ||
    status === "archived"
  );
}
export type SurveyRecipientStatus = "pending" | "sent" | "delivered" | "failed" | "answered";

export type SurveyRow = {
  id: number;
  title: string;
  message_text: string;
  photo_path: string | null;
  allow_feedback: boolean;
  created_at: number;
  created_by: string;
  sent_at: number | null;
  status: SurveyStatus;
  recipient_mode: RecipientMode;
  recipient_user_id: number | null;
  recipient_user_ids: number[];
  recipient_segment_id: string | null;
  recipients_count: number;
  delivered_count: number;
  answered_count: number;
};

export type SurveyRecipientRow = {
  id: number;
  survey_id: number;
  user_id: number;
  telegram_chat_id: number;
  status: SurveyRecipientStatus;
  sent_at: number | null;
  error_message: string | null;
};

export type SurveyResponseRow = {
  id: number;
  survey_id: number;
  recipient_id: number;
  user_id: number;
  telegram_chat_id: number;
  rating: number | null;
  feedback_text: string | null;
  rating_answered_at: number | null;
  feedback_answered_at: number | null;
  created_at: number;
  updated_at: number;
};

export type SurveyPendingFeedbackRow = {
  id: number;
  survey_id: number;
  recipient_id: number;
  response_id: number;
  telegram_chat_id: number;
  expires_at: number;
  created_at: number;
};

type Store = {
  next_survey_id: number;
  next_recipient_id: number;
  next_response_id: number;
  next_pending_id: number;
  surveys: SurveyRow[];
  recipients: SurveyRecipientRow[];
  responses: SurveyResponseRow[];
  pending_feedback: SurveyPendingFeedbackRow[];
};

function defaultStore(): Store {
  return {
    next_survey_id: 1,
    next_recipient_id: 1,
    next_response_id: 1,
    next_pending_id: 1,
    surveys: [],
    recipients: [],
    responses: [],
    pending_feedback: [],
  };
}

function readStore(): Store {
  try {
    if (!fs.existsSync(storePath)) return defaultStore();
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      ...defaultStore(),
      ...parsed,
      surveys: Array.isArray(parsed.surveys) ? parsed.surveys : [],
      recipients: Array.isArray(parsed.recipients) ? parsed.recipients : [],
      responses: Array.isArray(parsed.responses) ? parsed.responses : [],
      pending_feedback: Array.isArray(parsed.pending_feedback) ? parsed.pending_feedback : [],
    };
  } catch (e) {
    console.error("[survey-db] read failed:", e instanceof Error ? e.message : e);
    return defaultStore();
  }
}

function writeStore(store: Store): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(tmp, storePath);
}

export function initSurveyDb(): void {
  readStore();
  console.log("[survey-db] store:", storePath);
}

function mutate<T>(fn: (store: Store) => T): T {
  const store = readStore();
  const out = fn(store);
  writeStore(store);
  return out;
}

export function listSurveys(): SurveyRow[] {
  return [...readStore().surveys].sort((a, b) => b.created_at - a.created_at);
}

export function getSurvey(id: number): SurveyRow | null {
  const n = Math.floor(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return readStore().surveys.find((s) => s.id === n) ?? null;
}

export function listSurveyRecipients(surveyId: number): SurveyRecipientRow[] {
  const id = Math.floor(surveyId);
  return readStore().recipients.filter((r) => r.survey_id === id);
}

export function getSurveyRecipient(id: number): SurveyRecipientRow | null {
  const n = Math.floor(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return readStore().recipients.find((r) => r.id === n) ?? null;
}

export function findRecipientBySurveyChat(surveyId: number, chatId: number): SurveyRecipientRow | null {
  const sid = Math.floor(surveyId);
  const cid = Math.floor(chatId);
  return readStore().recipients.find((r) => r.survey_id === sid && r.telegram_chat_id === cid) ?? null;
}

export function listSurveyResponses(surveyId: number): SurveyResponseRow[] {
  const id = Math.floor(surveyId);
  return readStore().responses.filter((r) => r.survey_id === id);
}

export function getSurveyResponseForRecipient(recipientId: number): SurveyResponseRow | null {
  const rid = Math.floor(recipientId);
  return readStore().responses.find((r) => r.recipient_id === rid) ?? null;
}

export function findActivePendingFeedback(chatId: number, now = Date.now()): SurveyPendingFeedbackRow | null {
  const cid = Math.floor(chatId);
  const rows = readStore().pending_feedback.filter((p) => p.telegram_chat_id === cid && p.expires_at > now);
  if (rows.length === 0) return null;
  return rows.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
}

export function createSurveyDraft(input: {
  title: string;
  message_text: string;
  photo_path: string | null;
  allow_feedback: boolean;
  created_by: string;
  recipient_mode: RecipientMode;
  recipient_user_id?: number | null;
  recipient_user_ids?: number[];
  recipient_segment_id?: string | null;
}): SurveyRow {
  return mutate((store) => {
    const id = store.next_survey_id++;
    const row: SurveyRow = {
      id,
      title: input.title,
      message_text: input.message_text,
      photo_path: input.photo_path,
      allow_feedback: input.allow_feedback,
      created_at: Date.now(),
      created_by: input.created_by,
      sent_at: null,
      status: "draft",
      recipient_mode: input.recipient_mode,
      recipient_user_id: input.recipient_user_id ?? null,
      recipient_user_ids: input.recipient_user_ids ?? [],
      recipient_segment_id: input.recipient_segment_id ?? null,
      recipients_count: 0,
      delivered_count: 0,
      answered_count: 0,
    };
    store.surveys.push(row);
    return row;
  });
}

export function updateSurveyDraft(
  id: number,
  patch: Partial<
    Pick<
      SurveyRow,
      | "title"
      | "message_text"
      | "photo_path"
      | "allow_feedback"
      | "recipient_mode"
      | "recipient_user_id"
      | "recipient_user_ids"
      | "recipient_segment_id"
    >
  >,
): SurveyRow | null {
  return mutate((store) => {
    const row = store.surveys.find((s) => s.id === id);
    if (!row || row.status !== "draft") return null;
    Object.assign(row, patch);
    return row;
  });
}

export function replaceSurveyRecipients(
  surveyId: number,
  rows: Array<{ user_id: number; telegram_chat_id: number }>,
): SurveyRecipientRow[] {
  return mutate((store) => {
    store.recipients = store.recipients.filter((r) => r.survey_id !== surveyId);
    const out: SurveyRecipientRow[] = [];
    for (const r of rows) {
      const rec: SurveyRecipientRow = {
        id: store.next_recipient_id++,
        survey_id: surveyId,
        user_id: r.user_id,
        telegram_chat_id: r.telegram_chat_id,
        status: "pending",
        sent_at: null,
        error_message: null,
      };
      store.recipients.push(rec);
      out.push(rec);
    }
    const survey = store.surveys.find((s) => s.id === surveyId);
    if (survey) {
      survey.recipients_count = out.length;
      survey.delivered_count = 0;
      survey.answered_count = 0;
    }
    return out;
  });
}

export function markSurveySending(surveyId: number): SurveyRow | null {
  return mutate((store) => {
    const s = store.surveys.find((x) => x.id === surveyId);
    if (!s) return null;
    s.status = "sending";
    s.sent_at = Date.now();
    return s;
  });
}

export function updateRecipientStatus(
  recipientId: number,
  patch: Partial<Pick<SurveyRecipientRow, "status" | "sent_at" | "error_message">>,
): void {
  mutate((store) => {
    const r = store.recipients.find((x) => x.id === recipientId);
    if (!r) return;
    Object.assign(r, patch);
  });
}

export function recomputeSurveyCounters(surveyId: number): void {
  mutate((store) => {
    const s = store.surveys.find((x) => x.id === surveyId);
    if (!s) return;
    const recs = store.recipients.filter((r) => r.survey_id === surveyId);
    s.delivered_count = recs.filter((r) => r.status === "sent" || r.status === "delivered" || r.status === "answered").length;
    s.answered_count = recs.filter((r) => r.status === "answered").length;
    const pending = recs.some((r) => r.status === "pending");
    const failedAll = recs.length > 0 && recs.every((r) => r.status === "failed");
    if (!pending) {
      if (failedAll) s.status = "failed";
      else s.status = "completed";
    }
  });
}

export function finishSurveySend(surveyId: number): void {
  mutate((store) => {
    const s = store.surveys.find((x) => x.id === surveyId);
    if (!s) return;
    if (s.status === "archived") return;
    const recs = store.recipients.filter((r) => r.survey_id === surveyId);
    s.delivered_count = recs.filter((r) => r.status === "sent" || r.status === "delivered" || r.status === "answered").length;
    s.answered_count = recs.filter((r) => r.status === "answered").length;
    const failedCount = recs.filter((r) => r.status === "failed").length;
    const anySent = s.delivered_count > 0;
    const allFailed = recs.length > 0 && failedCount === recs.length;
    if (allFailed) s.status = "failed";
    else if (failedCount > 0 && anySent) s.status = "partially_failed";
    else if (anySent) s.status = "sent";
    else s.status = "failed";
    if (s.answered_count > 0 && s.status !== "failed") s.status = "completed";
  });
}

export function archiveSurvey(id: number): SurveyRow | null {
  return mutate((store) => {
    const s = store.surveys.find((x) => x.id === id);
    if (!s || s.status === "draft" || s.status === "sending") return null;
    s.status = "archived";
    return s;
  });
}

export function saveSurveyRating(input: {
  survey_id: number;
  recipient_id: number;
  user_id: number;
  telegram_chat_id: number;
  rating: number;
  allow_feedback: boolean;
}): { response: SurveyResponseRow; alreadyAnswered: boolean } {
  return mutate((store) => {
    const existing = store.responses.find((r) => r.recipient_id === input.recipient_id);
    if (existing?.rating != null && existing.rating >= 1) {
      return { response: existing, alreadyAnswered: true };
    }
    const now = Date.now();
    let response = existing;
    if (!response) {
      response = {
        id: store.next_response_id++,
        survey_id: input.survey_id,
        recipient_id: input.recipient_id,
        user_id: input.user_id,
        telegram_chat_id: input.telegram_chat_id,
        rating: null,
        feedback_text: null,
        rating_answered_at: null,
        feedback_answered_at: null,
        created_at: now,
        updated_at: now,
      };
      store.responses.push(response);
    }
    response.rating = input.rating;
    response.rating_answered_at = now;
    response.updated_at = now;

    const recipient = store.recipients.find((r) => r.id === input.recipient_id);
    if (recipient && !input.allow_feedback) {
      recipient.status = "answered";
      const survey = store.surveys.find((s) => s.id === input.survey_id);
      if (survey) {
        survey.answered_count = store.recipients.filter((r) => r.survey_id === input.survey_id && r.status === "answered").length;
        if (survey.answered_count > 0 && survey.status !== "archived" && survey.status !== "draft") {
          survey.status = "completed";
        }
      }
    }

    if (input.allow_feedback) {
      store.pending_feedback = store.pending_feedback.filter(
        (p) => !(p.telegram_chat_id === input.telegram_chat_id && p.survey_id === input.survey_id),
      );
      store.pending_feedback.push({
        id: store.next_pending_id++,
        survey_id: input.survey_id,
        recipient_id: input.recipient_id,
        response_id: response.id,
        telegram_chat_id: input.telegram_chat_id,
        expires_at: now + 24 * 60 * 60 * 1000,
        created_at: now,
      });
    }

    return { response, alreadyAnswered: false };
  });
}

export function saveSurveyFeedback(pendingId: number, text: string): SurveyResponseRow | null {
  return mutate((store) => {
    const pending = store.pending_feedback.find((p) => p.id === pendingId);
    if (!pending) return null;
    const response = store.responses.find((r) => r.id === pending.response_id);
    if (!response) return null;
    const now = Date.now();
    response.feedback_text = text;
    response.feedback_answered_at = now;
    response.updated_at = now;
    store.pending_feedback = store.pending_feedback.filter((p) => p.id !== pendingId);
    const recipient = store.recipients.find((r) => r.id === pending.recipient_id);
    if (recipient) recipient.status = "answered";
    const survey = store.surveys.find((s) => s.id === pending.survey_id);
    if (survey) {
      survey.answered_count = store.recipients.filter((r) => r.survey_id === pending.survey_id && r.status === "answered").length;
      if (survey.answered_count > 0 && survey.status !== "archived" && survey.status !== "draft") {
        survey.status = "completed";
      }
    }
    return response;
  });
}

export function clearExpiredPendingFeedback(now = Date.now()): void {
  mutate((store) => {
    store.pending_feedback = store.pending_feedback.filter((p) => p.expires_at > now);
  });
}

export function deleteSurveyDraft(id: number): boolean {
  return mutate((store) => {
    const row = store.surveys.find((s) => s.id === id);
    if (!row || row.status !== "draft") return false;
    store.surveys = store.surveys.filter((s) => s.id !== id);
    store.recipients = store.recipients.filter((r) => r.survey_id !== id);
    store.responses = store.responses.filter((r) => r.survey_id !== id);
    store.pending_feedback = store.pending_feedback.filter((p) => p.survey_id !== id);
    return true;
  });
}
