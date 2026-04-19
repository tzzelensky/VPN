import { Router } from "express";
import { getTelegramWebhookSecret, isTelegramWebhookEnabled } from "../telegram/env.js";
import { handleTelegramUpdate } from "../telegram/handleUpdate.js";

const router = Router();

/**
 * Вебхук Telegram. URL задайте в @BotFather:
 * https://<ваш-домен>/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
 */
router.post("/webhook/:secret", async (req, res) => {
  if (!isTelegramWebhookEnabled()) {
    return res.status(404).end();
  }
  const want = getTelegramWebhookSecret();
  if (!want || req.params.secret !== want) {
    return res.status(404).end();
  }
  try {
    await handleTelegramUpdate(req.body);
  } catch (e) {
    console.error("[telegram] webhook error:", e instanceof Error ? e.message : e);
    return res.sendStatus(500);
  }
  return res.sendStatus(200);
});

export default router;
