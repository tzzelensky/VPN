import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recipientFromChatId, stripHtmlPreview } from "./communicationLog.js";
import { getUser, resolveTelegramUsernameByTgUserId } from "./db.js";
import { getTriggerMailingsConfig, getTriggerMailingsStore, getUserMeta } from "./triggerMailingsStore.js";
import type { TriggerCampaignId, TriggerSentLog } from "./triggerMailingsTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

export type TriggerHistoryEntry = {
  id: string;
  sent_at: string;
  campaign_id: TriggerCampaignId;
  campaign_title: string;
  step_id: string;
  step_name: string;
  variant_id?: string;
  text_preview: string;
  has_image: boolean;
  tg_chat_id: number;
  tg_user_id: number;
  user_id?: number;
  user_name: string;
  delivered: boolean;
  is_test: boolean;
};

function historyPath(): string {
  return (
    process.env.TRIGGER_MAILINGS_HISTORY_PATH ??
    path.join(path.dirname(dataPath), "trigger_mailings_history.json")
  );
}

let cache: TriggerHistoryEntry[] = [];

function readFile(): TriggerHistoryEntry[] {
  try {
    const raw = fs.readFileSync(historyPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? (parsed.items as TriggerHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeFile(items: TriggerHistoryEntry[]): void {
  const p = historyPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ items, updated_at: new Date().toISOString() }, null, 2), "utf8");
}

function stepMeta(campaignId: TriggerCampaignId, stepId: string, variantId?: string): {
  campaign_title: string;
  step_name: string;
  text_preview: string;
  has_image: boolean;
} {
  const cfg = getTriggerMailingsConfig();
  const camp = cfg.campaigns.find((c) => c.id === campaignId);
  const step = camp?.steps.find((s) => s.id === stepId);
  const variant = variantId ? step?.variants?.find((v) => v.id === variantId) : undefined;
  const textRaw = variant?.text_html ?? step?.text_html ?? "";
  const image = variant?.image_data_url ?? step?.image_data_url;
  return {
    campaign_title: camp?.title ?? campaignId,
    step_name: step?.name ?? stepId,
    text_preview: stripHtmlPreview(textRaw),
    has_image: Boolean(image),
  };
}

function normTgUsername(raw?: string | null): string | null {
  const s = String(raw ?? "").trim().replace(/^@/, "");
  return s || null;
}

function resolveRecipientLabel(tg_user_id: number, tg_chat_id: number, user_id?: number): string {
  const fromMeta = normTgUsername(getUserMeta(tg_chat_id).tg_username);
  if (fromMeta) return `@${fromMeta}`;
  const fromDb = resolveTelegramUsernameByTgUserId(tg_user_id);
  if (fromDb) return `@${fromDb}`;
  if (user_id && user_id > 0) {
    const u = getUser(user_id);
    if (u?.name) return u.name;
  }
  const rec = recipientFromChatId(tg_chat_id);
  if (rec && rec.user_id > 0) return rec.user_name;
  return `tg:${tg_chat_id}`;
}

function appendEntry(entry: TriggerHistoryEntry): void {
  cache = [entry, ...cache.filter((h) => h.id !== entry.id)];
  if (cache.length > 50_000) cache = cache.slice(0, 40_000);
  writeFile(cache);
}

function entryFromSentLog(row: TriggerSentLog): TriggerHistoryEntry {
  const meta = stepMeta(row.campaign_id, row.step_id, row.variant_id);
  return {
    id: row.id,
    sent_at: row.sent_at,
    campaign_id: row.campaign_id,
    campaign_title: meta.campaign_title,
    step_id: row.step_id,
    step_name: meta.step_name,
    variant_id: row.variant_id,
    text_preview: meta.text_preview,
    has_image: meta.has_image,
    tg_chat_id: row.tg_chat_id,
    tg_user_id: row.tg_user_id,
    user_id: row.user_id,
    user_name: resolveRecipientLabel(row.tg_user_id, row.tg_chat_id, row.user_id),
    delivered: true,
    is_test: row.chain_id.startsWith("test_"),
  };
}

export function initTriggerMailingsHistoryStore(): void {
  cache = readFile();
  const { migrated } = migrateTriggerHistoryFromSentLog();
  if (migrated > 0) {
    console.log(`[trigger-mailings] history migration: ${migrated} records`);
  }
}

export function migrateTriggerHistoryFromSentLog(): { migrated: number } {
  const sent = getTriggerMailingsStore().sent_log;
  const existing = new Set(cache.map((h) => h.id));
  let migrated = 0;
  for (const row of sent) {
    if (existing.has(row.id)) continue;
    appendEntry(entryFromSentLog(row));
    migrated++;
  }
  return { migrated };
}

export function recordTriggerHistory(input: {
  id: string;
  sent_at: string;
  campaign_id: TriggerCampaignId;
  step_id: string;
  variant_id?: string;
  tg_chat_id: number;
  tg_user_id: number;
  user_id?: number;
  chain_id: string;
  text_html: string;
  has_image: boolean;
  delivered: boolean;
}): void {
  const meta = stepMeta(input.campaign_id, input.step_id, input.variant_id);
  appendEntry({
    id: input.id,
    sent_at: input.sent_at,
    campaign_id: input.campaign_id,
    campaign_title: meta.campaign_title,
    step_id: input.step_id,
    step_name: meta.step_name,
    variant_id: input.variant_id,
    text_preview: stripHtmlPreview(input.text_html),
    has_image: input.has_image,
    tg_chat_id: input.tg_chat_id,
    tg_user_id: input.tg_user_id,
    user_id: input.user_id,
    user_name: resolveRecipientLabel(input.tg_user_id, input.tg_chat_id, input.user_id),
    delivered: input.delivered,
    is_test: input.chain_id.startsWith("test_"),
  });
}

export function listTriggerHistory(opts?: {
  limit?: number;
  from?: string;
  to?: string;
  campaign_id?: TriggerCampaignId;
}): TriggerHistoryEntry[] {
  const limit = Math.min(500, Math.max(1, Math.floor(Number(opts?.limit) || 200)));
  let items = [...cache];
  if (opts?.campaign_id) {
    items = items.filter((h) => h.campaign_id === opts.campaign_id);
  }
  if (opts?.from) {
    const fromTs = Date.parse(`${opts.from}T00:00:00.000Z`);
    if (Number.isFinite(fromTs)) {
      items = items.filter((h) => Date.parse(h.sent_at) >= fromTs);
    }
  }
  if (opts?.to) {
    const toTs = Date.parse(`${opts.to}T23:59:59.999Z`);
    if (Number.isFinite(toTs)) {
      items = items.filter((h) => Date.parse(h.sent_at) <= toTs);
    }
  }
  items.sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
  return items.slice(0, limit).map((h) => ({
    ...h,
    user_name: resolveRecipientLabel(h.tg_user_id, h.tg_chat_id, h.user_id),
  }));
}
