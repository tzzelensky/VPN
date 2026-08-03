import { sendTelegramHtml } from "./api.js";
import { backHomeRow } from "./keyboards.js";
import { inlineBtn } from "./inlineButtonStyles.js";
import {
  friendlyGeminiError,
  generateGeminiReply,
  isAiAssistantEnabled,
  type GeminiChatTurn,
} from "./geminiAi.js";

type TgUser = { id: number; username?: string; first_name?: string };

type AiSession = {
  ownerId: number;
  history: GeminiChatTurn[];
  updatedAt: number;
};

const SESSION_TTL_MS = 45 * 60 * 1000;
const MAX_HISTORY_TURNS = 12;
const aiSessionByChat = new Map<number, AiSession>();

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function aiChatInline() {
  return {
    inline_keyboard: [
      [inlineBtn("« В меню", "home", "menuHome")],
      [{ text: "Завершить диалог с AI", callback_data: "ai_exit" }],
    ],
  };
}

export function hasAiChatSession(chatId: number): boolean {
  pruneExpired();
  return aiSessionByChat.has(chatId);
}

export function clearAiChatSession(chatId: number): void {
  aiSessionByChat.delete(chatId);
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [chatId, s] of aiSessionByChat) {
    if (now - s.updatedAt > SESSION_TTL_MS) aiSessionByChat.delete(chatId);
  }
}

export async function startAiChat(chatId: number, from: TgUser): Promise<void> {
  if (!isAiAssistantEnabled()) {
    await sendTelegramHtml(
      chatId,
      "AI-помощник сейчас выключен или не настроен.",
      backHomeRow(),
    );
    return;
  }
  aiSessionByChat.set(chatId, { ownerId: from.id, history: [], updatedAt: Date.now() });
  await sendTelegramHtml(
    chatId,
    "🤖 <b>Спросить AI</b>\n\n" +
      "Напишите вопрос про подключение VPN, Happ, оплату или типичные ошибки.\n" +
      "Чтобы выйти — «Завершить диалог с AI» или «В меню».",
    aiChatInline(),
  );
}

export async function exitAiChat(chatId: number, withMessage = true): Promise<void> {
  clearAiChatSession(chatId);
  if (withMessage) {
    await sendTelegramHtml(chatId, "Диалог с AI завершён.", backHomeRow());
  }
}

/** Обработка текста в режиме AI. true = сообщение поглощено. */
export async function onAiChatMessage(chatId: number, from: TgUser, text: string): Promise<boolean> {
  pruneExpired();
  const session = aiSessionByChat.get(chatId);
  if (!session || session.ownerId !== from.id) {
    clearAiChatSession(chatId);
    return false;
  }

  const trimmed = text.trim();
  if (!trimmed) return true;

  const lower = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    lower === "завершить диалог с ai" ||
    lower === "завершить диалог" ||
    lower === "выйти из ai" ||
    lower === "стоп ai"
  ) {
    await exitAiChat(chatId);
    return true;
  }
  if (
    lower === "в меню" ||
    lower === "меню" ||
    lower === "главное меню" ||
    lower === "главная" ||
    lower.startsWith("в меню ")
  ) {
    clearAiChatSession(chatId);
    return false;
  }

  session.updatedAt = Date.now();
  try {
    const reply = await generateGeminiReply(session.history, trimmed, {
      chatId,
      tgUserId: from.id,
      username: from.username,
    });
    session.history.push({ role: "user", text: trimmed });
    session.history.push({ role: "model", text: reply });
    while (session.history.length > MAX_HISTORY_TURNS) {
      session.history.shift();
    }
    await sendTelegramHtml(chatId, escHtml(reply), aiChatInline());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[gemini] chat error:", msg);
    await sendTelegramHtml(chatId, escHtml(friendlyGeminiError(msg)), aiChatInline());
  }
  return true;
}
