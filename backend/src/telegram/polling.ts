import { telegramDeleteWebhook, telegramGetUpdates } from "./api.js";
import { getTelegramBotToken } from "./env.js";
import { handleTelegramUpdate } from "./handleUpdate.js";

type Update = { update_id: number };

function asUpdate(raw: unknown): Update | null {
  if (raw && typeof raw === "object" && "update_id" in raw) {
    const id = (raw as { update_id: unknown }).update_id;
    if (typeof id === "number" && Number.isFinite(id)) return { update_id: id };
  }
  return null;
}

/**
 * Long polling для локальной отладки без публичного URL (вебхук Telegram на localhost не доставляет).
 */
export async function startTelegramLongPolling(): Promise<void> {
  if (!getTelegramBotToken()) {
    console.warn("[telegram] polling: нет TELEGRAM_BOT_TOKEN");
    return;
  }
  try {
    await telegramDeleteWebhook();
    console.log("[telegram] Вебхук сброшен (deleteWebhook), запущен long polling.");
  } catch (e) {
    console.error("[telegram] deleteWebhook:", e instanceof Error ? e.message : e);
  }

  let offset = 0;
  for (;;) {
    try {
      const batch = await telegramGetUpdates(offset);
      for (const raw of batch) {
        const u = asUpdate(raw);
        if (!u) continue;
        try {
          await handleTelegramUpdate(raw);
        } catch (err) {
          console.error("[telegram] handle update:", err instanceof Error ? err.message : err);
        }
        offset = u.update_id + 1;
      }
    } catch (e) {
      console.error("[telegram] getUpdates:", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 3500));
    }
  }
}
