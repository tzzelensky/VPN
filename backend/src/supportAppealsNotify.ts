import type { SupportAppealRow } from "./db.js";
import { readAppealStoredPhoto } from "./supportAppealFiles.js";
import { fetchTelegramPhotoBytes } from "./supportAppealMedia.js";
import { getTelegramPaymentNotifyChatIds } from "./telegram/env.js";
import { sendPanelPushToAll } from "./fcm.js";
import { sendTelegramHtml, sendTelegramPhoto, sendTelegramPhotoBinary } from "./telegram/api.js";
import { escHtml } from "./telegram/format.js";

function appealUserTag(row: SupportAppealRow): string {
  if (row.tg_username && String(row.tg_username).trim()) {
    return `@${escHtml(String(row.tg_username).replace(/^@/, ""))}`;
  }
  if (row.tg_first_name && String(row.tg_first_name).trim()) {
    return escHtml(String(row.tg_first_name).trim());
  }
  return `<code>${row.tg_user_id}</code>`;
}

function panelAppealsUrl(): string {
  const base = (process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${base}/support-appeals`;
}

export async function notifyAdminsNewSupportAppeal(row: SupportAppealRow): Promise<void> {
  const tagPlain =
    row.tg_username && String(row.tg_username).trim()
      ? `@${String(row.tg_username).replace(/^@/, "")}`
      : row.tg_first_name && String(row.tg_first_name).trim()
        ? String(row.tg_first_name).trim()
        : `TG ${row.tg_user_id}`;
  const previewPlain = row.text ? row.text.slice(0, 160) : "без текста";

  void sendPanelPushToAll({
    title: "Новое обращение",
    body: `${tagPlain}: ${previewPlain}`,
    data: { appeal_id: row.id },
  }).catch((e) => console.error("[support] fcm push:", e));

  const admins = getTelegramPaymentNotifyChatIds();
  if (!admins.length) return;
  const tag = appealUserTag(row);
  const panelUrl = escHtml(panelAppealsUrl());
  const preview = row.text ? escHtml(row.text.slice(0, 400)) : "<i>без текста</i>";
  const caption =
    `📩 <b>Новое обращение</b>\n` +
    `От пользователя ${tag} поступило обращение.\n\n` +
    `${preview}\n\n` +
    `Перейдите в панель «Обращения», чтобы посмотреть:\n` +
    `<a href="${panelUrl}">${panelUrl}</a>`;
  for (const chatId of admins) {
    try {
      const firstPhoto = row.photo_file_ids[0];
      if (firstPhoto) {
        await sendTelegramPhoto(chatId, firstPhoto, caption, { parse_mode: "HTML" });
      } else {
        await sendTelegramHtml(chatId, caption);
      }
    } catch (e) {
      console.error("[support] admin notify:", chatId, e);
    }
  }
}

export async function notifyUserAppealInProgress(row: SupportAppealRow): Promise<void> {
  const body =
    `<b>Ваше обращение принято в работу.</b>\n\n` +
    `Мы уже разбираемся с вашим вопросом. Ответ придёт в этот чат, как только будет готов.`;
  try {
    await sendTelegramHtml(row.tg_chat_id, body);
  } catch (e) {
    console.error("[support] user in-progress notify:", row.tg_chat_id, e);
  }
}

export async function notifyUserAppealClosed(row: SupportAppealRow): Promise<void> {
  const reply = String(row.admin_reply_text ?? "").trim();
  const body =
    `<b>Ваше обращение обработано.</b>\n\n` +
    (reply ? `${escHtml(reply)}\n\n` : "") +
    `Если вопрос останется актуальным — напишите нам снова через «Сообщить о проблеме».`;
  try {
    const paths = row.admin_reply_photo_paths ?? [];
    if (paths.length === 0) {
      await sendTelegramHtml(row.tg_chat_id, body);
      return;
    }
    for (let i = 0; i < paths.length; i++) {
      const hit = readAppealStoredPhoto(paths[i]!);
      if (!hit) continue;
      await sendTelegramPhotoBinary(row.tg_chat_id, hit.bytes, {
        caption: i === 0 ? body : undefined,
        filename: `reply-${i + 1}.jpg`,
        mimeType: hit.mime,
        parse_mode: "HTML",
      });
    }
    if (paths.every((p) => !readAppealStoredPhoto(p))) {
      await sendTelegramHtml(row.tg_chat_id, body);
    }
  } catch (e) {
    console.error("[support] user closed notify:", row.tg_chat_id, e);
  }
}

export function appealUserPhotoCount(row: SupportAppealRow): number {
  return (row.photo_file_ids?.length ?? 0) + (row.photo_paths?.length ?? 0);
}

export async function loadAppealUserPhotoBytes(
  row: SupportAppealRow,
  index: number,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const tgCount = row.photo_file_ids.length;
  if (index < tgCount) {
    return fetchTelegramPhotoBytes(row.photo_file_ids[index]!);
  }
  const pathIdx = index - tgCount;
  if (pathIdx >= 0 && pathIdx < row.photo_paths.length) {
    const hit = readAppealStoredPhoto(row.photo_paths[pathIdx]!);
    if (hit) return hit;
  }
  return null;
}
