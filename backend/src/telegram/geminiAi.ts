import { getPanelGeminiApiKey, getPanelSettings } from "../panelSettings.js";
import { appendAiLog } from "../aiLogStore.js";

export type GeminiChatTurn = { role: "user" | "model"; text: string };

export type GeminiGenerateMeta = {
  chatId: number;
  tgUserId: number;
  username?: string;
};

/** Отдельные free-tier RPD у 2.5*; flash-latest / 3.x часто бьют в общий лимит «latest Flash». */
const FALLBACK_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
/** Если Google не дал Retry-After — не долбим модель час. */
const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

type ExhaustedEntry = { until: number; reason: string };

/** Модели с исчерпанной квотой (до until). */
const exhaustedModels = new Map<string, ExhaustedEntry>();

/**
 * Последняя успешно ответившая модель.
 * Пока в настройках та же preferred — следующие запросы идут сюда,
 * а не снова в выбитую по лимиту.
 */
let stickyWorkingModel: string | null = null;
let stickyForSettingsModel: string | null = null;

function uniqueModels(ordered: Array<string | null | undefined>): string[] {
  return ordered.filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);
}

function settingsPreferredModel(): string {
  return String(getPanelSettings().telegram.geminiModel ?? "").trim() || DEFAULT_GEMINI_MODEL;
}

function isModelExhausted(model: string): boolean {
  const entry = exhaustedModels.get(model);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    exhaustedModels.delete(model);
    return false;
  }
  return true;
}

function nextUtcMidnightMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function markModelExhausted(model: string, error: string, retryAfterSec?: number): void {
  let until = Date.now() + DEFAULT_QUOTA_COOLDOWN_MS;
  if (typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    until = Date.now() + Math.min(retryAfterSec, 86_400) * 1000;
  } else if (/per day|\/day|rpd|daily|free_tier.*requests/i.test(error)) {
    until = nextUtcMidnightMs();
  }
  exhaustedModels.set(model, { until, reason: error.slice(0, 240) });
  console.warn(
    `[gemini] model exhausted until ${new Date(until).toISOString()}:`,
    model,
    error.slice(0, 160),
  );
}

function clearModelExhausted(model: string): void {
  exhaustedModels.delete(model);
}

function resolveModelCandidates(): string[] {
  const fromSettings = settingsPreferredModel();
  const fromEnv = process.env.GEMINI_MODEL?.trim() || "";

  if (stickyForSettingsModel !== fromSettings) {
    stickyWorkingModel = null;
    stickyForSettingsModel = fromSettings;
  }

  const ordered = uniqueModels([stickyWorkingModel, fromSettings, fromEnv, ...FALLBACK_MODELS]);
  const ready = ordered.filter((m) => !isModelExhausted(m));
  const blocked = ordered.filter((m) => isModelExhausted(m));
  // Сначала живые; выбитые — в хвост на случай, если cooldown уже неактуален.
  return ready.length > 0 ? [...ready, ...blocked] : ordered;
}

function isQuotaLikeError(status: number, error: string): boolean {
  if (status === 429) return true;
  if (status === 403 && /quota|rate|limit|exhausted/i.test(error)) return true;
  return /quota|rate.?limit|resource.?exhausted|exceeded.?your.?current.?quota|free_tier/i.test(error);
}

/** Ошибки, при которых имеет смысл пробовать другую модель. */
function shouldTryNextModel(status: number, error: string): boolean {
  if (status === 404 || status >= 500) return true;
  if (isQuotaLikeError(status, error)) return true;
  return /not found|model.+not.+supported|is not found/i.test(error);
}

const SYSTEM_INSTRUCTION =
  "Ты — помощник поддержки VPN-сервиса HSN в Telegram-боте. Отвечай кратко и по делу на русском языке. " +
  "Помогай с подключением приложения Happ/v2ray, обновлением подписки, оплатой и типичными ошибками. " +
  "Белые списки (БС) — это платная опция: дополнительные ключи для обхода блокировок, их можно купить. " +
  "Не говори, что белые списки бесплатные или входят в стандартную подписку. " +
  "Цену белых списков не выдумывай — направь пользователя в раздел «Белые списки» (БС) в меню бота, там актуальная стоимость и покупка. " +
  "Можешь назвать разделы обычным текстом в кавычках («Подписка», «Белые списки», «Оплата подписки», «Сообщить о проблеме») — кнопки под сообщением добавит бот сам. " +
  "Никогда не пиши кнопки, меню или ссылки в квадратных скобках вроде [Подписка] или [Белые списки] — это выглядит как мусор. " +
  "Не выдумывай баланс, срок подписки и статусы оплаты — если нужны данные аккаунта, предложи открыть «Подписка» в меню или написать в «Сообщить о проблеме». " +
  "Не проси и не обрабатывай пароли, токены и полные ссылки подписки. Без воды и без Markdown-таблиц.";

/** Убрать фейковые «кнопки» вида [Подписка] [Белые списки], которые модель иногда дописывает. */
export function stripFakeMenuButtons(text: string): string {
  let s = String(text ?? "");
  // Строка целиком из [Кнопка] [Кнопка2] …
  s = s.replace(/(?:^|\n)\s*(?:\[[^\]\n]{1,40}\]\s*){1,8}\s*(?=\n|$)/g, "\n");
  // Хвост сообщения: перевод строки + ряд [Кнопка]
  s = s.replace(/\n(?:\s*\[[^\]\n]{1,40}\])+\s*$/g, "");
  // Одиночные известные ярлыки меню в []
  s = s.replace(
    /\[\s*(?:Подписка|Белые списки|Оплата подписки|Сообщить о проблеме|Докупить ГБ|Купить устройство|В меню|Главное меню)\s*\]/gi,
    "",
  );
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isGeminiConfigured(): boolean {
  return Boolean(getPanelGeminiApiKey());
}

/** Ключ есть и в настройках включён AI-помощник. */
export function isAiAssistantEnabled(): boolean {
  const settings = getPanelSettings();
  if (settings.telegram.aiAssistantEnabled === false) return false;
  return isGeminiConfigured();
}

export function friendlyGeminiError(raw: string): string {
  const m = String(raw ?? "").toLowerCase();
  if (m.includes("quota") || m.includes("rate-limit") || m.includes("rate limit") || m.includes("429")) {
    return "AI временно недоступен: исчерпана квота у всех запасных моделей Gemini. Попробуйте позже или включите billing в Google AI Studio.";
  }
  if (m.includes("api key") || m.includes("permission") || m.includes("401") || m.includes("403")) {
    return "AI недоступен: проверьте Gemini API key в настройках панели.";
  }
  if (m.includes("gemini_not_configured")) {
    return "AI-помощник не настроен (нет ключа Gemini).";
  }
  return "Не удалось получить ответ AI. Попробуйте ещё раз чуть позже или напишите в «Сообщить о проблеме».";
}

async function callGeminiModel(
  model: string,
  apiKey: string,
  history: GeminiChatTurn[],
  userText: string,
): Promise<{ text: string } | { error: string; status: number; retryAfterSec?: number }> {
  const contents = [
    ...history.map((t) => ({
      role: t.role,
      parts: [{ text: t.text }],
    })),
    { role: "user" as const, parts: [{ text: userText }] },
  ];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 1024,
      },
    }),
  });
  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const errObj = raw && typeof raw === "object" ? (raw.error as { message?: string } | undefined) : undefined;
    const retryRaw = res.headers.get("retry-after");
    const retryAfterSec = retryRaw ? Number(retryRaw) : undefined;
    return {
      error: errObj?.message || `HTTP ${res.status}`,
      status: res.status,
      retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
    };
  }
  const candidates = Array.isArray(raw?.candidates) ? (raw!.candidates as unknown[]) : [];
  const first = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined;
  const parts = first?.content?.parts ?? [];
  const text = parts
    .map((p) => String(p?.text ?? ""))
    .join("")
    .trim();
  if (!text) return { error: "empty_gemini_response", status: 200 };
  return { text: text.slice(0, 3500) };
}

export async function generateGeminiReply(
  history: GeminiChatTurn[],
  userText: string,
  meta?: GeminiGenerateMeta,
): Promise<string> {
  const apiKey = getPanelGeminiApiKey();
  if (!apiKey) throw new Error("gemini_not_configured");

  const started = Date.now();
  let lastError = "unknown";
  const preferred = settingsPreferredModel();
  const models = resolveModelCandidates();
  let usedModel = models[0] ?? DEFAULT_GEMINI_MODEL;
  const tried: string[] = [];

  for (const model of models) {
    usedModel = model;
    tried.push(model);
    const result = await callGeminiModel(model, apiKey, history, userText);
    if ("text" in result) {
      clearModelExhausted(model);
      stickyWorkingModel = model;
      stickyForSettingsModel = preferred;
      if (tried.length > 1 || model !== preferred) {
        console.info(`[gemini] using model ${model} (tried: ${tried.join(" → ")})`);
      }
      const cleaned = stripFakeMenuButtons(result.text) || result.text.trim();
      if (meta) {
        appendAiLog({
          chatId: meta.chatId,
          tgUserId: meta.tgUserId,
          username: meta.username,
          prompt: userText,
          reply: cleaned,
          ok: true,
          model,
          latencyMs: Date.now() - started,
        });
      }
      return cleaned;
    }
    lastError = result.error;
    console.error("[gemini] generateContent failed:", model, result.status, result.error);
    if (isQuotaLikeError(result.status, result.error)) {
      markModelExhausted(model, result.error, result.retryAfterSec);
    }
    if (!shouldTryNextModel(result.status, result.error)) {
      break;
    }
    console.info(`[gemini] switching model after ${model} → next candidate`);
  }
  console.error("[gemini] all candidates failed:", tried.join(" → "), lastError);

  if (meta) {
    appendAiLog({
      chatId: meta.chatId,
      tgUserId: meta.tgUserId,
      username: meta.username,
      prompt: userText,
      ok: false,
      error: lastError,
      model: usedModel,
      latencyMs: Date.now() - started,
    });
  }
  throw new Error(lastError);
}
