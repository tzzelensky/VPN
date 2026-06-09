import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const rootDir =
  process.env.WHITELIST_INSTRUCTION_FILES_DIR ?? path.join(path.dirname(dataFile), "whitelist-instruction-files");

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "jpg";
}

export function saveWhitelistInstructionPhoto(bytes: Buffer, mime: string): string {
  const ext = mimeToExt(mime);
  const rel = `instruction.${ext}`;
  const full = path.join(rootDir, rel);
  fs.mkdirSync(rootDir, { recursive: true });
  for (const f of fs.readdirSync(rootDir)) {
    if (f.startsWith("instruction.")) {
      try {
        fs.unlinkSync(path.join(rootDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  fs.writeFileSync(full, bytes);
  return rel;
}

export function deleteWhitelistInstructionPhoto(relPath: string | null | undefined): void {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..")) return;
  const full = path.join(rootDir, safe);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

export function readWhitelistInstructionPhoto(relPath: string | null | undefined): { bytes: Buffer; mime: string } | null {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..")) return null;
  const full = path.join(rootDir, safe);
  if (!fs.existsSync(full)) return null;
  const bytes = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
  return { bytes, mime };
}

export function whitelistInstructionPhotoPublicUrl(baseUrl: string, relPath: string | null | undefined): string | null {
  const safe = String(relPath ?? "").replace(/\\/g, "/").trim();
  if (!safe || safe.includes("..")) return null;
  return `${baseUrl.replace(/\/$/, "")}/api/whitelist-vault/instruction/photo/${encodeURIComponent(safe)}`;
}
