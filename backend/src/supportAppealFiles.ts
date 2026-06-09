import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const appealsRoot =
  process.env.SUPPORT_APPEALS_FILES_DIR ?? path.join(path.dirname(dataFile), "support-appeals-files");

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "jpg";
}

export function saveAppealUserPhoto(appealId: string, index: number, bytes: Buffer, mime: string): string {
  const ext = mimeToExt(mime);
  const rel = `${appealId}/user-${index}.${ext}`;
  const full = path.join(appealsRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return rel;
}

export function saveAppealAdminReplyPhoto(appealId: string, index: number, bytes: Buffer, mime: string): string {
  const ext = mimeToExt(mime);
  const rel = `${appealId}/reply-${index}.${ext}`;
  const full = path.join(appealsRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return rel;
}

export function deleteAppealFiles(appealId: string): void {
  const id = String(appealId ?? "").trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) return;
  const dir = path.join(appealsRoot, id);
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

export function readAppealStoredPhoto(relPath: string): { bytes: Buffer; mime: string } | null {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..")) return null;
  const full = path.join(appealsRoot, safe);
  if (!fs.existsSync(full)) return null;
  const bytes = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
  return { bytes, mime };
}
