import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const avatarsRoot = process.env.PANEL_AVATARS_DIR ?? path.join(path.dirname(dataFile), "panel-avatars");

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

export function validatePanelAvatar(bytes: Buffer, mime: string): void {
  if (bytes.length > MAX_AVATAR_BYTES) throw new Error("avatar_too_large");
  if (!ALLOWED.has(mime.toLowerCase())) throw new Error("unsupported_avatar_format");
}

export function savePanelAvatar(bytes: Buffer, mime: string): string {
  validatePanelAvatar(bytes, mime);
  const ext = mimeToExt(mime);
  const rel = `avatar.${ext}`;
  const full = path.join(avatarsRoot, rel);
  fs.mkdirSync(avatarsRoot, { recursive: true });
  for (const f of fs.readdirSync(avatarsRoot)) {
    if (f.startsWith("avatar.")) {
      try {
        fs.unlinkSync(path.join(avatarsRoot, f));
      } catch {
        /* ignore */
      }
    }
  }
  fs.writeFileSync(full, bytes);
  return rel;
}

export function deletePanelAvatarFiles(): void {
  if (!fs.existsSync(avatarsRoot)) return;
  for (const f of fs.readdirSync(avatarsRoot)) {
    if (f.startsWith("avatar.")) {
      try {
        fs.unlinkSync(path.join(avatarsRoot, f));
      } catch {
        /* ignore */
      }
    }
  }
}

export function readPanelAvatar(relPath: string): { bytes: Buffer; mime: string } | null {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..") || !safe.startsWith("avatar.")) return null;
  const full = path.join(avatarsRoot, safe);
  if (!fs.existsSync(full)) return null;
  const bytes = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { bytes, mime };
}

export function panelAvatarPublicPath(rel: string | null): string | null {
  if (!rel) return null;
  return `/api/settings/avatar`;
}
