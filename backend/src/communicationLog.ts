import {
  appendCommunicationMessageLog,
  listUsers,
  type CommunicationMessageLogRow,
} from "./db.js";

export type LogRecipient = { user_id: number; user_name: string };

export function stripHtmlPreview(html: string, max = 240): string {
  const plain = String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max)}…`;
}

export function recipientFromUserId(userId: number): LogRecipient | null {
  const u = listUsers().find((x) => x.id === userId);
  if (!u) return null;
  return { user_id: u.id, user_name: u.name };
}

export function recipientFromChatId(chatId: number): LogRecipient | null {
  const id = Math.floor(Number(chatId));
  if (!Number.isFinite(id) || id <= 0) return null;
  for (const u of listUsers()) {
    if (Number(String(u.tg_id ?? "").trim()) === id) {
      return { user_id: u.id, user_name: u.name };
    }
  }
  return { user_id: 0, user_name: `tg:${id}` };
}

export function logCommunicationMessage(
  input: Omit<CommunicationMessageLogRow, "id" | "sent_at">,
): CommunicationMessageLogRow | null {
  try {
    return appendCommunicationMessageLog(input);
  } catch (e) {
    console.error("[communication-log]", e instanceof Error ? e.message : e);
    return null;
  }
}
