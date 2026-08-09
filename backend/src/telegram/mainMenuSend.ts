import { isAiAssistantEnabled } from "./geminiAi.js";
import { renderMenuBannerForUser, type MenuBannerKind, type MenuBannerUser } from "./menuBannerImage.js";
import {
  deleteTelegramMessage,
  forgetBotScreenMessage,
  sendTelegramHtml,
  sendTelegramPhotoBinary,
} from "./api.js";
import { mainMenuInline, newUserKeyboard } from "./keyboards.js";

type MenuFlags = {
  admin: boolean;
  referral: boolean;
  support: boolean;
  buyGb: boolean;
  whitelist: boolean;
  buyDevice: boolean;
  adminClientsButton: boolean;
  askAi: boolean;
};

/** Снять старую reply-клавиатуру (нельзя смешивать с inline в одном сообщении). */
export async function ensureReplyKeyboardRemoved(chatId: number): Promise<void> {
  try {
    // Непустой текст: ZWSP Telegram часто отвергает. HTML не нужен.
    const mid = await sendTelegramHtml(chatId, "…", { remove_keyboard: true });
    if (typeof mid === "number") {
      forgetBotScreenMessage(chatId, mid);
      // Даём клиенту применить remove_keyboard до удаления служебного сообщения.
      await new Promise((r) => setTimeout(r, 400));
      await deleteTelegramMessage(chatId, mid);
    }
  } catch (e) {
    console.warn(
      "[telegram] remove_keyboard failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

function truncateCaption(html: string, max = 1000): string {
  const s = String(html ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export async function sendBotMenuMessage(
  chatId: number,
  captionHtml: string,
  replyMarkup: unknown,
  from?: MenuBannerUser | null,
  bannerKind: MenuBannerKind = "profile",
): Promise<void> {
  await ensureReplyKeyboardRemoved(chatId);
  const caption = truncateCaption(captionHtml);
  try {
    const png = await renderMenuBannerForUser(from, bannerKind);
    await sendTelegramPhotoBinary(chatId, png, {
      caption,
      mimeType: "image/png",
      filename: "menu-banner.png",
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    return;
  } catch (e) {
    console.error(
      "[telegram] menu banner failed, fallback to text:",
      e instanceof Error ? e.message : e,
    );
  }
  await sendTelegramHtml(chatId, caption, replyMarkup);
}

export function linkedMenuMarkup(flags: MenuFlags) {
  return mainMenuInline(
    flags.admin,
    flags.referral,
    flags.support,
    flags.buyGb,
    flags.whitelist,
    flags.buyDevice,
    flags.adminClientsButton,
    flags.askAi,
  );
}

export function guestMenuMarkup(salesDisabled: boolean, testAvailable: boolean) {
  return newUserKeyboard(salesDisabled, testAvailable, isAiAssistantEnabled());
}
