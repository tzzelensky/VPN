import { appendAiLog } from "../aiLogStore.js";
import { createPromoCode, getPromoCodeByText } from "../db.js";
import { sendTelegramHtml } from "./api.js";
import { backHomeRow } from "./keyboards.js";
import { inlineBtn, inlineBtnPlain } from "./inlineButtonStyles.js";
import {
  friendlyGeminiError,
  generateGeminiReply,
  isAiAssistantEnabled,
  type GeminiChatTurn,
} from "./geminiAi.js";
import { getTelegramPaymentNotifyChatIds } from "./env.js";
import { isSupportAppealsEnabled } from "./supportAppealsFlow.js";

type TgUser = { id: number; username?: string; first_name?: string };

type AiSession = {
  ownerId: number;
  history: GeminiChatTurn[];
  updatedAt: number;
};

type InlineBtn = ReturnType<typeof inlineBtn> | ReturnType<typeof inlineBtnPlain> | { text: string; callback_data: string };

const SESSION_TTL_MS = 45 * 60 * 1000;
const MAX_HISTORY_TURNS = 12;
/** Макс. вопросов AI на пользователя в окне. */
const AI_USER_LIMIT = 10;
const AI_USER_WINDOW_MS = 6 * 60 * 60 * 1000;

const aiSessionByChat = new Map<number, AiSession>();
/** tgUserId → timestamps успешных/принятых запросов к AI. */
const aiUsageByUser = new Map<number, number[]>();

const EMSHANOV_PROMO_CODE = "ЕМШАНОВ";

const EMSHANOV_JOKES = [
  "Леша Емшанов заходит в бар. Бармен:\n— Обычное?\n— Нет, — говорит Леша, — сегодня я сам себе промокод.",
  "Спрашивают Лешу Емшанова:\n— Почему ты всегда спокоен?\n— Потому что скидка уже в кармане. Даже если её ещё нет.",
  "Леша Емшанов открыл VPN и увидел весь интернет.\nЗакрыл. Сказал: «Ладно, хватит на сегодня геройства».",
  "В резюме Леши Емшанова в графе «навыки» написано:\n«умею появляться в правильный момент и оставлять промокод».",
  "Леша Емшанов не опаздывает.\nОн просто тестирует, работает ли у всех терпение как у HSN-поддержки.",
  "Говорят, Леша Емшанов один раз объяснил другу, что такое подписка.\nДруг купил две. На всякий случай.",
  "Леша Емшанов — это человек, которого спрашивают у ИИ,\nа ИИ в ответ рассказывает анекдот. Совпадение? Не думаю.",
];

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pruneAiUsage(tgUserId: number): number[] {
  const now = Date.now();
  const next = (aiUsageByUser.get(tgUserId) ?? []).filter((t) => now - t < AI_USER_WINDOW_MS);
  if (next.length) aiUsageByUser.set(tgUserId, next);
  else aiUsageByUser.delete(tgUserId);
  return next;
}

function isAiAdminUser(tgUserId: number): boolean {
  return getTelegramPaymentNotifyChatIds().includes(tgUserId);
}

function aiUsageCount(tgUserId: number): number {
  return pruneAiUsage(tgUserId).length;
}

function isAiUserRateLimited(tgUserId: number): boolean {
  if (isAiAdminUser(tgUserId)) return false;
  return aiUsageCount(tgUserId) >= AI_USER_LIMIT;
}

function recordAiUsage(tgUserId: number): void {
  if (isAiAdminUser(tgUserId)) return;
  const arr = pruneAiUsage(tgUserId);
  arr.push(Date.now());
  aiUsageByUser.set(tgUserId, arr);
}

function formatRetryAfter(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  if (totalMin < 60) return `примерно через ${totalMin} мин.`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `примерно через ${h} ч.`;
  return `примерно через ${h} ч. ${m} мин.`;
}

function aiRetryAfterMs(tgUserId: number): number {
  const arr = pruneAiUsage(tgUserId);
  if (!arr.length) return 0;
  const oldest = Math.min(...arr);
  return Math.max(0, oldest + AI_USER_WINDOW_MS - Date.now());
}

function aiTiredInline() {
  const rows: InlineBtn[][] = [];
  if (isSupportAppealsEnabled()) {
    rows.push([inlineBtnPlain("Сообщить о проблеме", "appeal_start")]);
  }
  rows.push([inlineBtn("« В меню", "home", "menuHome")]);
  return { inline_keyboard: rows };
}

function buildAiTiredHtml(tgUserId: number): string {
  const retry = formatRetryAfter(aiRetryAfterMs(tgUserId));
  return (
    `😴 <b>AI устал</b> и ушёл перезагружаться.\n\n` +
    `Лимит: <b>${AI_USER_LIMIT}</b> вопросов за 6 часов.\n` +
    `Снова можно спросить ${retry}\n\n` +
    (isSupportAppealsEnabled()
      ? `Если вопрос срочный — нажмите <b>«Сообщить о проблеме»</b>, вам ответит живой человек.`
      : `Если вопрос срочный — напишите в поддержку.`)
  );
}

async function sendAiTiredAndExit(chatId: number, tgUserId: number): Promise<void> {
  clearAiChatSession(chatId);
  await sendTelegramHtml(chatId, buildAiTiredHtml(tgUserId), aiTiredInline());
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmshanovEasterEgg(text: string): boolean {
  const hay = normalizeForMatch(text);
  if (!hay.includes("емшанов")) return false;
  return /кто\s+так(ой|ая|ие)|леша|ал[её]ксей|расскажи|анекдот/.test(hay) || /^емшанов$/.test(hay);
}

function pickEmshanovJoke(): string {
  const i = Math.floor(Math.random() * EMSHANOV_JOKES.length);
  return EMSHANOV_JOKES[i] ?? EMSHANOV_JOKES[0]!;
}

function ensureEmshanovPromo(): void {
  try {
    if (getPromoCodeByText(EMSHANOV_PROMO_CODE)) return;
    createPromoCode({
      name: "Емшанов — 1%",
      code: EMSHANOV_PROMO_CODE,
      type: "percent",
      discount_percent: 1,
      one_time_per_user: false,
      admin_note: "Easter egg AI: Кто такой Леша Емшанов?",
      active: true,
      source: "campaign",
      source_ref: "ai_emshanov",
    });
  } catch (e) {
    console.warn("[gemini] ensure ЕМШАНОВ promo:", e instanceof Error ? e.message : e);
  }
}

function buildEmshanovReply(): string {
  ensureEmshanovPromo();
  const joke = pickEmshanovJoke();
  return (
    `Леша Емшанов? Легенда.\n\n` +
    `${escHtml(joke)}\n\n` +
    `Держи промокод на скидку <b>1%</b>:\n` +
    `<code>${EMSHANOV_PROMO_CODE}</code>\n\n` +
    `Примени при оплате подписки.`
  );
}

/** Контекстные кнопки по теме вопроса/ответа + управление диалогом AI. */
export function aiChatInline(userText = "", replyText = "") {
  const hay = normalizeForMatch(`${userText}\n${replyText}`);
  const rows: InlineBtn[][] = [];
  const seen = new Set<string>();

  const push = (row: InlineBtn[]) => {
    const key = row
      .map((b) => ("callback_data" in b ? String(b.callback_data) : String((b as { text?: string }).text ?? "")))
      .join("|");
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  if (/подписк|промокод|емшанов|скидк/.test(hay)) {
    push([inlineBtn("Подписка", "sub", "menuSubscription")]);
  }
  if (/покупк|оплат|купить|тариф|стоим|сколько\s+сто|промокод|емшанов/.test(hay)) {
    push([inlineBtnPlain("Оплата подписки", "pay")]);
  }
  if (/(?:^|\s)бс(?:\s|$)|бел\w*\s+списк|белые\s+списки|whitelist/.test(hay)) {
    push([inlineBtn("Белые списки", "wlmenu", "buyWhitelist")]);
  }
  if (/сообщить\s+о\s+проблеме|проблем[аыуе]|жалоб|поддержк|тех\s*поддерж/.test(hay)) {
    push([inlineBtnPlain("Сообщить о проблеме", "appeal_start")]);
  }

  rows.push([inlineBtn("« В меню", "home", "menuHome")]);
  rows.push([{ text: "Завершить диалог с AI", callback_data: "ai_exit" }]);
  return { inline_keyboard: rows };
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
  if (isAiUserRateLimited(from.id)) {
    await sendAiTiredAndExit(chatId, from.id);
    return;
  }
  const quotaHint = isAiAdminUser(from.id)
    ? ""
    : (() => {
        const left = Math.max(0, AI_USER_LIMIT - aiUsageCount(from.id));
        return `Осталось вопросов: <b>${left}</b> из ${AI_USER_LIMIT} за 6 часов.\n`;
      })();
  aiSessionByChat.set(chatId, { ownerId: from.id, history: [], updatedAt: Date.now() });
  await sendTelegramHtml(
    chatId,
    "🤖 <b>Спросить AI</b>\n\n" +
      "Напишите вопрос про подключение VPN, Happ, оплату или типичные ошибки.\n" +
      quotaHint +
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

function pushHistory(session: AiSession, userText: string, reply: string): void {
  session.history.push({ role: "user", text: userText });
  session.history.push({ role: "model", text: reply.replace(/<[^>]+>/g, "") });
  while (session.history.length > MAX_HISTORY_TURNS) {
    session.history.shift();
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

  if (isAiUserRateLimited(from.id)) {
    await sendAiTiredAndExit(chatId, from.id);
    return true;
  }

  // Списываем слот до ответа — защита от спама при долгих/падающих запросах.
  recordAiUsage(from.id);

  if (isEmshanovEasterEgg(trimmed)) {
    const started = Date.now();
    const replyHtml = buildEmshanovReply();
    pushHistory(session, trimmed, replyHtml);
    appendAiLog({
      chatId,
      tgUserId: from.id,
      username: from.username,
      prompt: trimmed,
      reply: replyHtml.replace(/<[^>]+>/g, ""),
      ok: true,
      model: "hardcoded:emshanov",
      latencyMs: Date.now() - started,
    });
    await sendTelegramHtml(chatId, replyHtml, aiChatInline(trimmed, replyHtml));
    return true;
  }

  try {
    const reply = await generateGeminiReply(session.history, trimmed, {
      chatId,
      tgUserId: from.id,
      username: from.username,
    });
    pushHistory(session, trimmed, reply);
    await sendTelegramHtml(chatId, escHtml(reply), aiChatInline(trimmed, reply));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[gemini] chat error:", msg);
    await sendTelegramHtml(chatId, escHtml(friendlyGeminiError(msg)), aiChatInline(trimmed));
  }
  return true;
}
