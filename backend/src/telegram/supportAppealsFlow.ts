import {
  createSupportAppeal,
  findUsersByTelegramChatId,
  getSupportAppealsConfig,
  type SupportAppealRow,
} from "../db.js";
import { notifyAdminsNewSupportAppeal } from "../supportAppealsNotify.js";
import { sendTelegramHtml } from "./api.js";
import { backHomeRow } from "./keyboards.js";

type TgUser = { id: number; username?: string; first_name?: string };

type AppealDraft = {
  ownerId: number;
  text: string;
  photoFileIds: string[];
  tg_username?: string;
  tg_first_name?: string;
};

const appealDraftByChat = new Map<number, AppealDraft>();

export const appealComposeInline = {
  inline_keyboard: [
    [{ text: "✅ Отправить обращение", callback_data: "appeal_send" }],
    [{ text: "Отмена", callback_data: "appeal_cancel" }],
    [{ text: "« В меню", callback_data: "home" }],
  ],
};

const APPEAL_INTRO =
  "Если у вас возник вопрос или проблема, <b>опишите её</b> в одном или нескольких сообщениях. " +
  "При необходимости <b>приложите фото</b>.\n\n" +
  "Когда всё готово — нажмите <b>«Отправить обращение»</b>.";

export function isSupportAppealsEnabled(): boolean {
  return getSupportAppealsConfig().enabled;
}

export function hasAppealDraft(chatId: number): boolean {
  return appealDraftByChat.has(chatId);
}

/** Сброс черновика обращения (например, при «В меню»). */
export function clearSupportAppealDraft(chatId: number): void {
  appealDraftByChat.delete(chatId);
}

export async function startSupportAppealCompose(chatId: number, from: TgUser): Promise<void> {
  if (!isSupportAppealsEnabled()) {
    await sendTelegramHtml(chatId, "Обращения в поддержку сейчас отключены.", backHomeRow);
    return;
  }
  appealDraftByChat.set(chatId, {
    ownerId: from.id,
    text: "",
    photoFileIds: [],
    tg_username: from.username,
    tg_first_name: from.first_name,
  });
  await sendTelegramHtml(chatId, APPEAL_INTRO, appealComposeInline);
}

export async function cancelSupportAppealCompose(chatId: number): Promise<void> {
  appealDraftByChat.delete(chatId);
  await sendTelegramHtml(chatId, "Обращение отменено.", backHomeRow);
}

export async function submitSupportAppealFromDraft(chatId: number, fromId: number): Promise<boolean> {
  const draft = appealDraftByChat.get(chatId);
  if (!draft || draft.ownerId !== fromId) {
    await sendTelegramHtml(chatId, "Черновик обращения не найден. Нажмите «Сообщить о проблеме» ещё раз.", backHomeRow);
    return true;
  }
  const text = draft.text.trim();
  if (!text && draft.photoFileIds.length === 0) {
    await sendTelegramHtml(
      chatId,
      "Добавьте описание проблемы или хотя бы одно фото, затем нажмите «Отправить обращение».",
      appealComposeInline,
    );
    return true;
  }
  const linked = findUsersByTelegramChatId(fromId);
  const row = createSupportAppeal({
    tg_chat_id: chatId,
    tg_user_id: fromId,
    tg_username: draft.tg_username,
    tg_first_name: draft.tg_first_name,
    user_id: linked[0]?.id,
    text: text || "(без текста)",
    photo_file_ids: draft.photoFileIds,
    source: "bot",
  });
  appealDraftByChat.delete(chatId);
  try {
    await notifyAdminsNewSupportAppeal(row);
  } catch (e) {
    console.error("[support] notify admins:", e);
  }
  await sendTelegramHtml(
    chatId,
    "<b>Сообщение отправлено.</b>\n\nМы получили ваше обращение. Результат ответа придёт в этот чат.",
    backHomeRow,
  );
  return true;
}

export async function onSupportAppealDraftMessage(msg: {
  chat: { id: number };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: { file_id: string }[];
}): Promise<boolean> {
  const chatId = msg.chat.id;
  const fromId = msg.from?.id ?? chatId;
  const draft = appealDraftByChat.get(chatId);
  if (!draft || draft.ownerId !== fromId) return false;

  const piece = String(msg.text ?? msg.caption ?? "").trim();
  if (piece) {
    draft.text = draft.text ? `${draft.text}\n${piece}` : piece;
    if (draft.text.length > 8000) draft.text = draft.text.slice(0, 8000);
  }
  const photos = msg.photo;
  if (photos?.length) {
    const fileId = photos[photos.length - 1]!.file_id;
    if (draft.photoFileIds.length < 10) draft.photoFileIds.push(fileId);
  }
  if (!piece && !photos?.length) {
    await sendTelegramHtml(chatId, "Отправьте текст и/или фото для обращения.", appealComposeInline);
    return true;
  }
  await sendTelegramHtml(
    chatId,
    `Черновик сохранён (${draft.photoFileIds.length} фото). Нажмите «Отправить обращение», когда будете готовы.`,
    appealComposeInline,
  );
  return true;
}

export async function submitSupportAppealFromWebApp(input: {
  tg_chat_id: number;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  text: string;
  photo_file_ids?: string[];
  photo_paths?: string[];
}): Promise<SupportAppealRow> {
  const linked = findUsersByTelegramChatId(input.tg_user_id);
  const row = createSupportAppeal({
    tg_chat_id: input.tg_chat_id,
    tg_user_id: input.tg_user_id,
    tg_username: input.tg_username,
    tg_first_name: input.tg_first_name,
    user_id: linked[0]?.id,
    text: input.text.trim() || "(без текста)",
    photo_file_ids: input.photo_file_ids ?? [],
    photo_paths: input.photo_paths ?? [],
    source: "webapp",
  });
  await notifyAdminsNewSupportAppeal(row);
  return row;
}
