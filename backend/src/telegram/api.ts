import { getTelegramBotToken } from "./env.js";

type TelegramOk<T> = { ok: true; result: T } | { ok: false; description?: string };

async function tgCall<T>(method: string, body: Record<string, unknown>): Promise<TelegramOk<T>> {
  const token = getTelegramBotToken();
  if (!token) return { ok: false, description: "no_token" };
  const url = `https://api.telegram.org/bot${token}/${method}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[telegram] fetch ${method}:`, msg);
    return { ok: false, description: `network: ${msg}` };
  }
  let data: TelegramOk<T>;
  try {
    data = (await res.json()) as TelegramOk<T>;
  } catch (e) {
    console.error(`[telegram] ${method}: non-JSON response`, res.status);
    return { ok: false, description: "invalid_response" };
  }
  if (!data.ok) {
    console.error(`[telegram] ${method} failed:`, data.description ?? res.status);
  }
  return data;
}

async function tgMultipartCall<T>(method: string, form: FormData): Promise<TelegramOk<T>> {
  const token = getTelegramBotToken();
  if (!token) return { ok: false, description: "no_token" };
  const url = `https://api.telegram.org/bot${token}/${method}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      body: form,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[telegram] fetch ${method}:`, msg);
    return { ok: false, description: `network: ${msg}` };
  }
  let data: TelegramOk<T>;
  try {
    data = (await res.json()) as TelegramOk<T>;
  } catch {
    console.error(`[telegram] ${method}: non-JSON response`, res.status);
    return { ok: false, description: "invalid_response" };
  }
  if (!data.ok) {
    console.error(`[telegram] ${method} failed:`, data.description ?? res.status);
  }
  return data;
}

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const r = await tgCall<unknown>("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
  if (!r.ok) throw new Error(r.description ?? "sendMessage failed");
}

export async function sendTelegramHtml(
  chatId: number,
  text: string,
  reply_markup?: unknown,
): Promise<number | undefined> {
  const r = await tgCall<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(reply_markup ? { reply_markup } : {}),
  });
  if (!r.ok) throw new Error(r.description ?? "sendMessage failed");
  const mid = r.result?.message_id;
  if (typeof mid === "number") pushBotScreenMessage(chatId, mid);
  return mid;
}

const lastBotMessageIdByChat = new Map<number, number>();
const botScreenStackByChat = new Map<number, number[]>();

export function rememberLastBotMessageId(chatId: number, messageId: number): void {
  lastBotMessageIdByChat.set(chatId, messageId);
}

export function pushBotScreenMessage(chatId: number, messageId: number): void {
  rememberLastBotMessageId(chatId, messageId);
  const stack = botScreenStackByChat.get(chatId) ?? [];
  stack.push(messageId);
  botScreenStackByChat.set(chatId, stack);
}

export function getLastBotMessageId(chatId: number): number | undefined {
  const stack = botScreenStackByChat.get(chatId);
  if (stack && stack.length > 0) return stack[stack.length - 1];
  return lastBotMessageIdByChat.get(chatId);
}

export function forgetBotScreenMessage(chatId: number, messageId: number): void {
  const stack = botScreenStackByChat.get(chatId) ?? [];
  const idx = stack.lastIndexOf(messageId);
  if (idx >= 0) stack.splice(idx, 1);
  if (stack.length > 0) lastBotMessageIdByChat.set(chatId, stack[stack.length - 1]!);
  else lastBotMessageIdByChat.delete(chatId);
}

export type TelegramScreenRef = { messageId: number; threadId?: number };

/** Заменяет текст экрана (fallback, если deleteMessage не сработал). */
export async function editTelegramMessageText(
  chatId: number,
  messageId: number,
  text: string,
  opts?: { reply_markup?: unknown; parseMode?: "HTML" | null; threadId?: number },
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
  };
  if (opts?.threadId != null) body.message_thread_id = opts.threadId;
  if (opts?.parseMode !== null) body.parse_mode = "HTML";
  if (opts?.reply_markup !== undefined) body.reply_markup = opts.reply_markup;

  const r = await tgCall<boolean>("editMessageText", body);
  if (!r.ok) {
    console.warn(
      "[telegram] editMessageText failed:",
      r.description ?? "unknown",
      "chat=",
      chatId,
      "msg=",
      messageId,
    );
    return false;
  }
  return true;
}

export async function editTelegramReplyMarkup(
  chatId: number,
  messageId: number,
  reply_markup: unknown,
  threadId?: number,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    reply_markup,
  };
  if (threadId != null) body.message_thread_id = threadId;
  const r = await tgCall<boolean>("editMessageReplyMarkup", body);
  if (!r.ok) {
    console.warn(
      "[telegram] editMessageReplyMarkup failed:",
      r.description ?? "unknown",
      "chat=",
      chatId,
      "msg=",
      messageId,
    );
    return false;
  }
  return true;
}

/**
 * Проверка, есть ли у бота доступ к чату (диалог начат и бот не заблокирован).
 * Возвращает false при любой ошибке/недоступности.
 */
export async function telegramHasDialog(chatId: number): Promise<boolean> {
  const r = await tgCall<unknown>("getChat", { chat_id: chatId });
  return r.ok;
}

/** Удаляет сообщение бота в чате (например, экран с inline-кнопкой «В меню»). */
export async function deleteTelegramMessage(
  chatId: number,
  messageId: number,
  threadId?: number,
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: Number(chatId),
    message_id: Number(messageId),
  };
  if (threadId != null) body.message_thread_id = Number(threadId);
  const r = await tgCall<boolean>("deleteMessage", body);
  if (!r.ok) {
    console.error(
      "[telegram] deleteMessage failed:",
      r.description ?? "unknown",
      "chat=",
      chatId,
      "msg=",
      messageId,
      "thread=",
      threadId ?? "—",
    );
    return false;
  }
  return true;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  opts?: { text?: string; show_alert?: boolean },
): Promise<void> {
  const r = await tgCall("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: opts?.text,
    show_alert: opts?.show_alert ?? false,
  });
  if (!r.ok) {
    console.error("[telegram] answerCallbackQuery failed:", r.description);
  }
}

export async function telegramDeleteWebhook(): Promise<void> {
  const r = await tgCall<boolean>("deleteWebhook", { drop_pending_updates: false });
  if (!r.ok) throw new Error(r.description ?? "deleteWebhook failed");
}

export async function sendTelegramPhoto(
  chatId: number,
  photoFileId: string,
  caption: string,
  opts?: { reply_markup?: unknown; parse_mode?: "HTML" },
): Promise<void> {
  const r = await tgCall<unknown>("sendPhoto", {
    chat_id: chatId,
    photo: photoFileId,
    caption,
    parse_mode: opts?.parse_mode ?? "HTML",
    ...(opts?.reply_markup ? { reply_markup: opts.reply_markup } : {}),
  });
  if (!r.ok) throw new Error(r.description ?? "sendPhoto failed");
}

export async function editMessageCaption(
  chatId: number,
  messageId: number,
  caption: string,
  opts?: { parse_mode?: "HTML"; reply_markup?: unknown },
): Promise<void> {
  const r = await tgCall<unknown>("editMessageCaption", {
    chat_id: chatId,
    message_id: messageId,
    caption,
    parse_mode: opts?.parse_mode ?? "HTML",
    ...(opts?.reply_markup !== undefined ? { reply_markup: opts.reply_markup } : {}),
  });
  if (!r.ok) {
    console.error("[telegram] editMessageCaption failed:", r.description);
  }
}

export async function sendTelegramPhotoBinary(
  chatId: number,
  bytes: Uint8Array,
  opts?: { caption?: string; mimeType?: string; filename?: string; parse_mode?: "HTML"; reply_markup?: unknown },
): Promise<void> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  if (opts?.caption) form.set("caption", opts.caption);
  form.set("parse_mode", opts?.parse_mode ?? "HTML");
  if (opts?.reply_markup) form.set("reply_markup", JSON.stringify(opts.reply_markup));
  const mime = (opts?.mimeType ?? "image/jpeg").trim() || "image/jpeg";
  const filename = (opts?.filename ?? "photo.jpg").trim() || "photo.jpg";
  form.set("photo", new Blob([Buffer.from(bytes)], { type: mime }), filename);
  const r = await tgMultipartCall<unknown>("sendPhoto", form);
  if (!r.ok) throw new Error(r.description ?? "sendPhoto failed");
}

export async function telegramGetUpdates(offset: number): Promise<unknown[]> {
  const r = await tgCall<unknown[]>("getUpdates", {
    ...(offset > 0 ? { offset } : {}),
    timeout: 45,
    limit: 100,
  });
  if (!r.ok) throw new Error(r.description ?? "getUpdates failed");
  return Array.isArray(r.result) ? r.result : [];
}
