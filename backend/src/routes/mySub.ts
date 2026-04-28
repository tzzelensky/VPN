import { Router } from "express";
import { findUsersByTelegramChatId } from "../db.js";
import { formatStatsHtml } from "../telegram/format.js";
import { getTelegramBotToken } from "../telegram/env.js";

const router = Router();

type TgChatResult = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo?: { small_file_id?: string; big_file_id?: string };
};

type TgFileResult = { file_path?: string };

function publicSubUrl(subToken: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${base}/sub/${encodeURIComponent(subToken)}`;
}

function parseTgId(raw: string): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

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

async function resolveChatProfile(tgId: number): Promise<{ displayName: string; bigFileId: string | null }> {
  const chat = await tgCall<TgChatResult>("getChat", { chat_id: tgId });
  if (!chat) return { displayName: "Пользователь", bigFileId: null };
  const full = `${String(chat.first_name ?? "").trim()} ${String(chat.last_name ?? "").trim()}`.trim();
  const displayName = full || (chat.username ? `@${chat.username}` : "Пользователь");
  const bigFileId = String(chat.photo?.big_file_id ?? "").trim() || null;
  return { displayName, bigFileId };
}

async function fetchPhotoBytesByFileId(fileId: string): Promise<{ bytes: Buffer; mime: string } | null> {
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

router.get("/:tgId(\\d+)/profile", async (req, res) => {
  const tgId = parseTgId(req.params.tgId);
  if (!tgId) {
    res.status(400).json({ error: "invalid_tg_id" });
    return;
  }
  const linked = findUsersByTelegramChatId(tgId);
  if (linked.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const chat = await resolveChatProfile(tgId);
  const displayName = chat.displayName || linked[0]!.name || "Пользователь";
  const subscriptions = linked.map((u) => ({
    id: u.id,
    name: u.name,
    subscription_url: publicSubUrl(u.sub_token),
  }));
  res.json({
    tg_id: tgId,
    name: displayName,
    avatar_url: chat.bigFileId ? `/api/mysub/${tgId}/avatar` : null,
    stats_html: formatStatsHtml(linked),
    subscriptions,
  });
});

router.get("/:tgId(\\d+)/avatar", async (req, res) => {
  const tgId = parseTgId(req.params.tgId);
  if (!tgId) {
    res.status(400).send("bad tg id");
    return;
  }
  const linked = findUsersByTelegramChatId(tgId);
  if (linked.length === 0) {
    res.status(404).send("not found");
    return;
  }
  const chat = await resolveChatProfile(tgId);
  if (!chat.bigFileId) {
    res.status(404).send("no avatar");
    return;
  }
  const photo = await fetchPhotoBytesByFileId(chat.bigFileId);
  if (!photo) {
    res.status(502).send("avatar fetch failed");
    return;
  }
  res.setHeader("Content-Type", photo.mime);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(photo.bytes);
});

export default router;
