import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const mediaRoot =
  process.env.COMMUNICATION_MEDIA_DIR ?? path.join(path.dirname(dataFile), "communication-media");

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

export function validateCommunicationPhotoMime(mime: string): boolean {
  return ALLOWED.has(mime.toLowerCase());
}

export function saveCommunicationPhoto(
  logId: string,
  bytes: Buffer | Uint8Array,
  mime: string,
  filenameHint?: string,
): { photo_path: string; photo_mime: string; photo_name: string } {
  const id = String(logId ?? "").trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error("invalid_log_id");
  }
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length > MAX_BYTES) throw new Error("photo_too_large");
  const photo_mime = String(mime || "image/jpeg").toLowerCase();
  if (!validateCommunicationPhotoMime(photo_mime)) throw new Error("unsupported_photo_format");
  const ext = mimeToExt(photo_mime);
  const hint = String(filenameHint ?? "").trim();
  const base = hint.replace(/[^\w.\-]+/g, "_").slice(0, 80) || `photo.${ext}`;
  const photo_name = base.includes(".") ? base : `${base}.${ext}`;
  const photo_path = `${id}/${photo_name}`;
  const full = path.join(mediaRoot, photo_path);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return { photo_path, photo_mime, photo_name };
}

export function deleteCommunicationPhoto(relPath: string | null | undefined): void {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..")) return;
  const full = path.join(mediaRoot, safe);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  const dir = path.dirname(full);
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    /* ignore */
  }
}

export function readCommunicationPhoto(
  relPath: string,
): { bytes: Buffer; mime: string; filename: string } | null {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..")) return null;
  const full = path.join(mediaRoot, safe);
  if (!fs.existsSync(full)) return null;
  const bytes = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { bytes, mime, filename: path.basename(full) };
}
