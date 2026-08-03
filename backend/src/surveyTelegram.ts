import {
  clearExpiredPendingFeedback,
  dismissSurveyPendingFeedback,
  findActivePendingFeedback,
  findRecipientBySurveyChat,
  getSurvey,
  getSurveyResponseForRecipient,
  saveSurveyFeedback,
  saveSurveyRating,
  surveyAcceptsRating,
} from "./surveyDb.js";
import { answerCallbackQuery, editTelegramReplyMarkup, sendTelegramHtml } from "./telegram/api.js";

type CallbackQuery = {
  id: string;
  message?: { message_id?: number; chat: { id: number } };
};

export function surveyRatingKeyboard(surveyId: number) {
  const id = Math.floor(surveyId);
  const row = [1, 2, 3, 4, 5].map((n) => ({
    text: String(n),
    callback_data: `survey:${id}:rate:${n}`,
  }));
  return { inline_keyboard: [row] };
}

export function surveySkipFeedbackKeyboard(surveyId: number) {
  const id = Math.floor(surveyId);
  return {
    inline_keyboard: [[{ text: "Не оставлять комментарий", callback_data: `survey:${id}:nofb` }]],
  };
}

export function parseSurveyRateCallback(data: string): { surveyId: number; rating: number } | null {
  const m = /^survey:(\d+):rate:([1-5])$/.exec(data.trim());
  if (!m) return null;
  return { surveyId: Number(m[1]), rating: Number(m[2]) };
}

export function parseSurveySkipFeedbackCallback(data: string): { surveyId: number } | null {
  const m = /^survey:(\d+):nofb$/.exec(data.trim());
  if (!m) return null;
  return { surveyId: Number(m[1]) };
}

export async function handleSurveyRateCallback(q: CallbackQuery, surveyId: number, rating: number): Promise<boolean> {
  const chatId = q.message?.chat.id;
  if (chatId == null) {
    await answerCallbackQuery(q.id, { text: "Нет чата", show_alert: true });
    return true;
  }
  const survey = getSurvey(surveyId);
  if (!survey) {
    await answerCallbackQuery(q.id, { text: "Опрос не найден", show_alert: true });
    return true;
  }
  if (!surveyAcceptsRating(survey.status)) {
    await answerCallbackQuery(q.id, { text: "Опрос недоступен", show_alert: true });
    return true;
  }
  const recipient = findRecipientBySurveyChat(surveyId, chatId);
  if (!recipient) {
    await answerCallbackQuery(q.id, { text: "Этот опрос вам не назначен", show_alert: true });
    return true;
  }
  if (rating < 1 || rating > 5) {
    await answerCallbackQuery(q.id, { text: "Некорректная оценка", show_alert: true });
    return true;
  }

  const existing = getSurveyResponseForRecipient(recipient.id);
  if (existing?.rating != null && existing.rating >= 1) {
    await answerCallbackQuery(q.id, { text: "Вы уже ответили на этот опрос.", show_alert: true });
    return true;
  }

  try {
    const { alreadyAnswered } = saveSurveyRating({
      survey_id: surveyId,
      recipient_id: recipient.id,
      user_id: recipient.user_id,
      telegram_chat_id: chatId,
      rating,
      allow_feedback: survey.allow_feedback,
    });
    if (alreadyAnswered) {
      await answerCallbackQuery(q.id, { text: "Вы уже ответили на этот опрос.", show_alert: true });
      return true;
    }
    await answerCallbackQuery(q.id, { text: "Спасибо!" });
    console.log("[survey] rating survey=", surveyId, "user=", recipient.user_id, "rating=", rating);
    if (survey.allow_feedback) {
      await sendTelegramHtml(
        chatId,
        "Спасибо! Можете оставить комментарий к оценке одним сообщением.",
        surveySkipFeedbackKeyboard(surveyId),
      );
    } else {
      await sendTelegramHtml(chatId, "Спасибо за оценку!");
    }
    return true;
  } catch (e) {
    console.error("[survey] save rating failed:", e instanceof Error ? e.message : e);
    await answerCallbackQuery(q.id, { text: "Не удалось сохранить ответ", show_alert: true });
    return true;
  }
}

export async function handleSurveySkipFeedbackCallback(
  q: CallbackQuery,
  surveyId: number,
): Promise<boolean> {
  clearExpiredPendingFeedback();
  const chatId = q.message?.chat.id;
  if (chatId == null) {
    await answerCallbackQuery(q.id, { text: "Нет чата", show_alert: true });
    return true;
  }
  const pending = findActivePendingFeedback(chatId);
  if (!pending || pending.survey_id !== surveyId) {
    await answerCallbackQuery(q.id, { text: "Комментарий уже не принимается", show_alert: false });
    const mid = q.message?.message_id;
    if (mid != null) {
      try {
        await editTelegramReplyMarkup(chatId, mid, { inline_keyboard: [] });
      } catch {
        /* ignore */
      }
    }
    return true;
  }
  dismissSurveyPendingFeedback(pending.id);
  await answerCallbackQuery(q.id, { text: "Ок" });
  const mid = q.message?.message_id;
  if (mid != null) {
    try {
      await editTelegramReplyMarkup(chatId, mid, { inline_keyboard: [] });
    } catch {
      /* ignore */
    }
  }
  await sendTelegramHtml(chatId, "Спасибо за оценку!");
  console.log("[survey] skip feedback survey=", surveyId, "chat=", chatId);
  return true;
}

export async function handleSurveyFeedbackText(chatId: number, text: string): Promise<boolean> {
  clearExpiredPendingFeedback();
  const pending = findActivePendingFeedback(chatId);
  if (!pending) return false;
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (lower === "отмена" || lower === "/cancel" || lower === "cancel") {
    dismissSurveyPendingFeedback(pending.id);
    await sendTelegramHtml(chatId, "Спасибо за оценку!");
    console.log("[survey] cancel feedback survey=", pending.survey_id, "chat=", chatId);
    return true;
  }

  const saved = saveSurveyFeedback(pending.id, trimmed.slice(0, 4000));
  if (!saved) return false;
  console.log("[survey] feedback survey=", pending.survey_id, "chat=", chatId);
  await sendTelegramHtml(chatId, "Спасибо за обратную связь!");
  return true;
}
