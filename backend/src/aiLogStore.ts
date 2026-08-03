import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AiLogEntry = {
  id: string;
  ts: number;
  chatId: number;
  tgUserId: number;
  username?: string;
  prompt: string;
  reply?: string;
  ok: boolean;
  error?: string;
  model: string;
  latencyMs: number;
};

const MAX_ENTRIES = 400;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");
const storePath = process.env.AI_LOGS_PATH ?? path.join(path.dirname(dataFile), "ai_chat_logs.json");

let entries: AiLogEntry[] = [];
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(storePath)) return;
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8")) as { entries?: AiLogEntry[] };
    if (Array.isArray(raw.entries)) entries = raw.entries.slice(-MAX_ENTRIES);
  } catch {
    entries = [];
  }
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const tmp = `${storePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 2), "utf8");
    fs.renameSync(tmp, storePath);
  } catch (e) {
    console.error("[ai-logs] persist failed:", e instanceof Error ? e.message : e);
  }
}

function clip(s: string, max: number): string {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function appendAiLog(
  partial: Omit<AiLogEntry, "id" | "ts"> & { ts?: number },
): AiLogEntry {
  load();
  const entry: AiLogEntry = {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ts: partial.ts ?? Date.now(),
    chatId: partial.chatId,
    tgUserId: partial.tgUserId,
    username: partial.username ? String(partial.username).slice(0, 64) : undefined,
    prompt: clip(partial.prompt, 500),
    reply: partial.reply != null ? clip(partial.reply, 800) : undefined,
    ok: partial.ok,
    error: partial.error ? clip(partial.error, 400) : undefined,
    model: String(partial.model ?? "").slice(0, 80),
    latencyMs: Math.max(0, Math.floor(Number(partial.latencyMs) || 0)),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  persist();
  return entry;
}

export function listAiLogs(limit = 200): AiLogEntry[] {
  load();
  const n = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit) || 200));
  return entries.slice(-n).reverse();
}

export function clearAiLogs(): number {
  load();
  const n = entries.length;
  entries = [];
  persist();
  return n;
}
