import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const surveysRoot = process.env.SURVEY_FILES_DIR ?? path.join(path.dirname(dataFile), "survey-files");

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

export function validateSurveyPhotoMime(mime: string): boolean {
  return ALLOWED.has(mime.toLowerCase());
}

export function saveSurveyPhoto(surveyId: number, bytes: Buffer, mime: string): string {
  if (bytes.length > MAX_BYTES) throw new Error("photo_too_large");
  if (!validateSurveyPhotoMime(mime)) throw new Error("unsupported_photo_format");
  const ext = mimeToExt(mime);
  const rel = `${surveyId}/photo.${ext}`;
  const full = path.join(surveysRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return rel;
}

export function deleteSurveyPhoto(relPath: string | null | undefined): void {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..")) return;
  const full = path.join(surveysRoot, safe);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

export function readSurveyPhoto(relPath: string): { bytes: Buffer; mime: string; filename: string } | null {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..")) return null;
  const full = path.join(surveysRoot, safe);
  if (!fs.existsSync(full)) return null;
  const bytes = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { bytes, mime, filename: path.basename(full) };
}
