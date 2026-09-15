import { randomBytes } from "node:crypto";
import { buildSegmentRows, uniqTargets, type TargetUserLite } from "./communicationTargets.js";
import { logCommunicationMessage, stripHtmlPreview } from "./communicationLog.js";
import { saveCommunicationPhoto } from "./communicationMediaFiles.js";
import {
  getUser,
  listCommunicationSegments,
  listUsers,
} from "./db.js";
import { sendTelegramHtml, sendTelegramPhotoBinary } from "./telegram/api.js";
import { getTelegramWebAppUrl } from "./telegram/env.js";

export type CommunicationSendPayload = {
  mode?: unknown;
  text?: unknown;
  title?: unknown;
  user_id?: unknown;
  user_ids?: unknown;
  segment_id?: unknown;
  mark_enabled?: unknown;
  mark_text?: unknown;
  photo_base64?: unknown;
  photo_mime?: unknown;
  photo_name?: unknown;
  buttons?: unknown;
};

export type CommunicationSendResult = {
  ok: boolean;
  sent: number;
  attempted: number;
  failed: number;
  failures: Array<{ user_id: number; user_name: string; error: string }>;
};

export class CommunicationSendError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const MODE_SOURCE_LABELS: Record<string, string> = {
  global: "Рассылка: всем клиентам",
  single: "Рассылка: одному клиенту",
  selected: "Рассылка: выбранным клиентам",
  segment: "Рассылка: по сегменту",
};

type CommInlineBtn =
  | { text: string; callback_data: string; style?: "primary" | "success" | "danger" }
  | { text: string; web_app: { url: string }; style?: "primary" | "success" | "danger" };

function parseDataUrl(input: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(input.trim());
  if (!m) return null;
  const mime = m[1] || "image/jpeg";
  const b64 = m[2] || "";
  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return null;
    return { mime, bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
}

function parseButtons(raw: unknown): CommInlineBtn[] {
  const arr = Array.isArray(raw) ? raw : [];
  const ids = [...new Set(arr.map((x) => String(x ?? "").trim()))];
  const out: CommInlineBtn[] = [];
  for (const id of ids) {
    if (id === "pay") out.push({ text: "Оплата подписки", callback_data: "pay" });
    else if (id === "ref") out.push({ text: "Пригласи друга", callback_data: "ref_menu" });
    else if (id === "sub") out.push({ text: "Подписка", callback_data: "sub" });
    else if (id === "buygb") out.push({ text: "Докупить ГБ", callback_data: "buygb" });
    else if (id === "whitelist") {
      out.push({ text: "Белые списки", callback_data: "wlmenu", style: "success" });
    } else if (id === "webapp") {
      const url = getTelegramWebAppUrl();
      if (url) out.push({ text: "Открыть приложение", web_app: { url } });
    }
  }
  return out;
}

function daysLeft(u: { expiry_time: number }): number | null {
  if (!u.expiry_time || u.expiry_time <= 0) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(u.expiry_time);
  end.setHours(0, 0, 0, 0);
  const diff = Math.round((end.getTime() - now.getTime()) / 86400000);
  return Math.max(0, diff);
}

function remainingGb(u: { total_gb: number; traffic_up: number; traffic_down: number }): number | null {
  if (u.total_gb <= 0) return null;
  const used = (u.traffic_up + u.traffic_down) / (1024 * 1024 * 1024);
  return Math.max(0, Number((u.total_gb - used).toFixed(2)));
}

function formatDaysBeforeEnd(value: number | null): string {
  if (value == null) return "без срока";
  if (value <= 0) return "сегодня";
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} дня`;
  return `${value} дней`;
}

function formatGbBeforeEnd(value: number | null): string {
  if (value == null) return "без лимита";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ГБ`;
}

function renderCommunicationText(template: string, userId: number): string {
  const u = getUser(userId);
  if (!u) return template;
  return template
    .replaceAll("{days_before_end}", formatDaysBeforeEnd(daysLeft(u)))
    .replaceAll("{gb_before_end}", formatGbBeforeEnd(remainingGb(u)));
}

export function normalizeScheduledPayload(body: CommunicationSendPayload): {
  mode: "global" | "single" | "selected" | "segment";
  text: string;
  title?: string;
  user_id?: number;
  user_ids?: number[];
  segment_id?: string;
  mark_enabled: boolean;
  mark_text: string;
  photo_base64?: string;
  photo_mime?: string;
  photo_name?: string;
  buttons?: string[];
} {
  const mode = String(body.mode ?? "").trim();
  if (mode !== "global" && mode !== "single" && mode !== "selected" && mode !== "segment") {
    throw new CommunicationSendError(400, "invalid_mode");
  }
  const text = String(body.text ?? "").trim();
  if (!text) throw new CommunicationSendError(400, "message_required");
  const buttonsStored = Array.isArray(body.buttons)
    ? [
        ...new Set(
          body.buttons
            .map((x) => String(x ?? "").trim())
            .filter(
              (x) =>
                x === "pay" ||
                x === "ref" ||
                x === "sub" ||
                x === "buygb" ||
                x === "webapp" ||
                x === "whitelist",
            ),
        ),
      ]
    : [];
  return {
    mode,
    text,
    ...(String(body.title ?? "").trim() ? { title: String(body.title).trim() } : {}),
    ...(mode === "single" && Number(body.user_id) > 0 ? { user_id: Number(body.user_id) } : {}),
    ...(mode === "selected" && Array.isArray(body.user_ids)
      ? {
          user_ids: [
            ...new Set(body.user_ids.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0)),
          ],
        }
      : {}),
    ...(mode === "segment" && String(body.segment_id ?? "").trim()
      ? { segment_id: String(body.segment_id).trim() }
      : {}),
    mark_enabled: body.mark_enabled === true || body.mark_enabled === 1 || body.mark_enabled === "1",
    mark_text: String(body.mark_text ?? "").trim(),
    ...(body.photo_base64 != null && String(body.photo_base64).trim()
      ? {
          photo_base64: String(body.photo_base64),
          photo_mime: String(body.photo_mime ?? ""),
          photo_name: String(body.photo_name ?? ""),
        }
      : {}),
    ...(buttonsStored.length ? { buttons: buttonsStored } : {}),
  };
}

export async function executeCommunicationSend(body: CommunicationSendPayload): Promise<CommunicationSendResult> {
  const mode = String(body.mode ?? "").trim();
  const text = String(body.text ?? "").trim();
  if (!text) throw new CommunicationSendError(400, "message_required");

  let photo: { mime: string; bytes: Uint8Array; filename: string } | null = null;
  if (body.photo_base64 != null && String(body.photo_base64).trim()) {
    const parsed = parseDataUrl(String(body.photo_base64));
    if (!parsed) throw new CommunicationSendError(400, "invalid_photo");
    photo = {
      mime: String((body.photo_mime ?? parsed.mime) || "image/jpeg"),
      bytes: parsed.bytes,
      filename: String(body.photo_name ?? "photo.jpg").trim() || "photo.jpg",
    };
  }

  let targets: Array<{ chatId: number; userId: number; userName: string }> = [];
  if (mode === "global") {
    const all = listUsers().map((u) => ({ id: u.id, name: u.name, tg_id: u.tg_id, enable: u.enable === 1 }));
    targets = uniqTargets(all);
  } else if (mode === "single") {
    const id = Number(body.user_id);
    if (!Number.isFinite(id) || id <= 0) throw new CommunicationSendError(400, "user_required");
    const user = getUser(id);
    if (!user) throw new CommunicationSendError(404, "not_found");
    const row = { id: user.id, name: user.name, tg_id: user.tg_id, enable: user.enable === 1 };
    targets = uniqTargets([row]);
  } else if (mode === "selected") {
    const idsRaw = Array.isArray(body.user_ids) ? body.user_ids : [];
    const ids = [...new Set(idsRaw.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))];
    if (ids.length === 0) throw new CommunicationSendError(400, "users_required");
    const rows: TargetUserLite[] = [];
    for (const id of ids) {
      const u = getUser(id);
      if (!u) continue;
      rows.push({ id: u.id, name: u.name, tg_id: u.tg_id, enable: u.enable === 1 });
    }
    targets = uniqTargets(rows);
  } else if (mode === "segment") {
    const segmentId = String(body.segment_id ?? "").trim();
    if (!segmentId) throw new CommunicationSendError(400, "segment_required");
    try {
      const rows = await buildSegmentRows(segmentId);
      targets = uniqTargets(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "segment_not_found") throw new CommunicationSendError(404, msg);
      throw new CommunicationSendError(500, msg);
    }
  } else {
    throw new CommunicationSendError(400, "invalid_mode");
  }

  if (targets.length === 0) throw new CommunicationSendError(400, "no_targets");

  const failures: Array<{ user_id: number; user_name: string; error: string }> = [];
  let sent = 0;
  const markEnabled = body.mark_enabled === true || body.mark_enabled === 1 || body.mark_enabled === "1";
  const markText = String(body.mark_text ?? "").trim();
  const header = markEnabled && markText ? `<b>${markText}</b>\n\n` : "";
  const buttons = parseButtons(body.buttons);
  const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons.map((b) => [b]) } : undefined;
  for (const t of targets) {
    const caption = `${header}${renderCommunicationText(text, t.userId)}`;
    try {
      if (photo) {
        await sendTelegramPhotoBinary(t.chatId, photo.bytes, {
          caption,
          filename: photo.filename,
          mimeType: photo.mime,
          parse_mode: "HTML",
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
      } else {
        await sendTelegramHtml(t.chatId, caption, replyMarkup);
      }
      sent++;
    } catch (e) {
      failures.push({
        user_id: t.userId,
        user_name: t.userName,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const segment =
    mode === "segment" ? listCommunicationSegments().find((s) => s.id === String(body.segment_id ?? "").trim()) : undefined;

  const logId = randomBytes(8).toString("hex");
  let photoMeta: { photo_path: string; photo_mime: string; photo_name: string } | null = null;
  if (photo) {
    try {
      photoMeta = saveCommunicationPhoto(logId, photo.bytes, photo.mime, photo.filename);
    } catch (e) {
      console.error("[communications] save photo:", e instanceof Error ? e.message : e);
    }
  }

  const buttonsStored = Array.isArray(body.buttons)
    ? [
        ...new Set(
          body.buttons
            .map((x) => String(x ?? "").trim())
            .filter(
              (x) =>
                x === "pay" ||
                x === "ref" ||
                x === "sub" ||
                x === "buygb" ||
                x === "webapp" ||
                x === "whitelist",
            ),
        ),
      ]
    : [];

  const selectedUserIds = mode === "selected" || mode === "single" ? targets.map((t) => t.userId) : [];

  try {
    logCommunicationMessage({
      id: logId,
      automatic: false,
      source_label: MODE_SOURCE_LABELS[mode] ?? "Рассылка из панели",
      mode: mode as "global" | "single" | "selected" | "segment",
      ...(segment ? { segment_id: segment.id, segment_name: segment.name } : {}),
      text: stripHtmlPreview(`${header}${text}`),
      body_text: text,
      ...(String(body.title ?? "").trim() ? { title: String(body.title).trim() } : {}),
      mark_enabled: markEnabled,
      ...(markText ? { mark_text: markText } : {}),
      ...(buttonsStored.length ? { buttons: buttonsStored } : {}),
      ...(selectedUserIds.length ? { user_ids: selectedUserIds } : {}),
      has_photo: Boolean(photo),
      ...(photoMeta
        ? {
            photo_path: photoMeta.photo_path,
            photo_mime: photoMeta.photo_mime,
            photo_name: photoMeta.photo_name,
          }
        : {}),
      recipients: targets.map((t) => ({ user_id: t.userId, user_name: t.userName })),
      sent,
      attempted: targets.length,
      failed: failures.length,
    });
  } catch (e) {
    console.error("[communications] log:", e);
  }

  return {
    ok: failures.length === 0,
    sent,
    attempted: targets.length,
    failed: failures.length,
    failures,
  };
}
