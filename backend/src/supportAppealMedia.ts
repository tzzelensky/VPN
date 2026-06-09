import { getTelegramBotToken } from "./telegram/env.js";

type TgFileResult = { file_path?: string };

async function tgCall<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result?: T };
    return data.ok ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}

export async function fetchTelegramPhotoBytes(fileId: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  const fileInfo = await tgCall<TgFileResult>("getFile", { file_id: fileId });
  const filePath = String(fileInfo?.file_path ?? "").trim();
  if (!filePath) return null;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) return null;
  const ab = await fileRes.arrayBuffer();
  const ct = String(fileRes.headers.get("content-type") ?? "").toLowerCase();
  const mime = ct.includes("png") ? "image/png" : ct.includes("webp") ? "image/webp" : "image/jpeg";
  return { bytes: Buffer.from(ab), mime };
}
