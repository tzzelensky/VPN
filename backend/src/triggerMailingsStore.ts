import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultTriggerMailingsConfig,
  normalizeTriggerMailingsConfig,
  normalizeTriggerMailingsStore,
  TRIGGER_COPY_CAMPAIGN_IDS,
  TRIGGER_COPY_REFRESH_VERSION,
  type TriggerCampaign,
  type TriggerCampaignId,
  type TriggerMailingsConfig,
  type TriggerMailingsStore,
  type TriggerQueueItem,
  type TriggerSentLog,
  type TriggerStepStats,
  type TriggerUserMeta,
} from "./triggerMailingsTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

function storePath(): string {
  return (
    process.env.TRIGGER_MAILINGS_STORE_PATH ??
    path.join(path.dirname(dataPath), "trigger_mailings_store.json")
  );
}

let cache: TriggerMailingsStore = normalizeTriggerMailingsStore(null);

function readFile(): TriggerMailingsStore {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    return normalizeTriggerMailingsStore(JSON.parse(raw));
  } catch {
    return normalizeTriggerMailingsStore(null);
  }
}

function writeFile(store: TriggerMailingsStore): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
}

function persist(mutator: (store: TriggerMailingsStore) => void): TriggerMailingsStore {
  const next = structuredClone(cache);
  mutator(next);
  cache = next;
  writeFile(next);
  return next;
}

function emptyStepStats(): TriggerStepStats {
  return {
    triggered: 0,
    sent: 0,
    delivered: 0,
    clicks: 0,
    payments: 0,
    revenue_rub: 0,
    payment_delay_ms_sum: 0,
    payment_delay_count: 0,
  };
}

export function migrateTriggerCopyTexts(): { updated: number } {
  const ver = cache.copy_refresh_version ?? 0;
  if (ver >= TRIGGER_COPY_REFRESH_VERSION) return { updated: 0 };

  const defaults = defaultTriggerMailingsConfig();
  const byCampaign = new Map(defaults.campaigns.map((c) => [c.id, c]));
  let updated = 0;

  persist((s) => {
    for (const campaignId of TRIGGER_COPY_CAMPAIGN_IDS) {
      const def = byCampaign.get(campaignId);
      const camp = s.config.campaigns.find((c) => c.id === campaignId);
      if (!def || !camp) continue;
      const defSteps = new Map(def.steps.map((st) => [st.id, st]));
      for (const step of camp.steps) {
        const fb = defSteps.get(step.id);
        if (!fb) continue;
        step.text_html = fb.text_html;
        step.buttons = structuredClone(fb.buttons);
        updated++;
      }
    }
    s.copy_refresh_version = TRIGGER_COPY_REFRESH_VERSION;
    s.config.updated_at = new Date().toISOString();
  });

  return { updated };
}

export function initTriggerMailingsStore(): void {
  cache = readFile();
  const { updated } = migrateTriggerCopyTexts();
  if (updated > 0) {
    console.log(`[trigger-mailings] copy refresh v${TRIGGER_COPY_REFRESH_VERSION}: ${updated} steps`);
  }
}

export function getTriggerMailingsStore(): TriggerMailingsStore {
  return cache;
}

export function getTriggerMailingsConfig(): TriggerMailingsConfig {
  return cache.config;
}

export function setTriggerMailingsConfig(config: TriggerMailingsConfig): TriggerMailingsConfig {
  const next = normalizeTriggerMailingsConfig(config);
  persist((s) => {
    s.config = next;
    for (const c of next.campaigns) {
      if (!s.stats[c.id]) s.stats[c.id] = {};
      for (const st of c.steps) {
        if (!s.stats[c.id]![st.id]) s.stats[c.id]![st.id] = emptyStepStats();
      }
    }
  });
  return next;
}

export function patchTriggerCampaign(campaignId: TriggerCampaignId, patch: Partial<TriggerCampaign>): TriggerCampaign | null {
  let updated: TriggerCampaign | null = null;
  persist((s) => {
    const i = s.config.campaigns.findIndex((c) => c.id === campaignId);
    if (i === -1) return;
    const cur = s.config.campaigns[i]!;
    updated = { ...cur, ...patch, id: campaignId, steps: patch.steps ?? cur.steps };
    s.config.campaigns[i] = updated;
    s.config.updated_at = new Date().toISOString();
  });
  return updated;
}

export function enqueueTriggerItem(item: Omit<TriggerQueueItem, "id"> & { id?: string }): TriggerQueueItem {
  const row: TriggerQueueItem = {
    ...item,
    id: item.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  };
  persist((s) => {
    s.queue.push(row);
  });
  return row;
}

export function updateQueueItem(id: string, patch: Partial<TriggerQueueItem>): void {
  persist((s) => {
    const i = s.queue.findIndex((q) => q.id === id);
    if (i === -1) return;
    s.queue[i] = { ...s.queue[i]!, ...patch };
  });
}

export function cancelQueueForChat(
  tg_chat_id: number,
  opts?: { campaign_ids?: TriggerCampaignId[]; chain_id?: string; reason?: string },
): number {
  let n = 0;
  persist((s) => {
    const now = new Date().toISOString();
    for (const q of s.queue) {
      if (q.tg_chat_id !== tg_chat_id || q.sent_at || q.cancelled_at) continue;
      if (opts?.chain_id && q.chain_id !== opts.chain_id) continue;
      if (opts?.campaign_ids && !opts.campaign_ids.includes(q.campaign_id)) continue;
      q.cancelled_at = now;
      q.cancel_reason = opts?.reason ?? "cancelled";
      n++;
    }
    const meta = userMetaForChat(s, tg_chat_id);
    if (opts?.chain_id) {
      delete meta.active_chains?.[opts.chain_id];
    } else if (opts?.campaign_ids) {
      for (const [cid, camp] of Object.entries(meta.active_chains ?? {})) {
        if (opts.campaign_ids.includes(camp)) delete meta.active_chains![cid];
      }
    } else {
      meta.active_chains = {};
    }
    s.user_meta[String(tg_chat_id)] = meta;
  });
  return n;
}

function userMetaForChat(s: TriggerMailingsStore, tg_chat_id: number): TriggerUserMeta {
  return s.user_meta[String(tg_chat_id)] ?? {};
}

export function touchUserActivity(tg_chat_id: number, tg_username?: string): void {
  persist((s) => {
    const key = String(tg_chat_id);
    const prev = s.user_meta[key] ?? {};
    const un = String(tg_username ?? "").trim().replace(/^@/, "");
    s.user_meta[key] = {
      ...prev,
      last_activity_at: new Date().toISOString(),
      ...(un ? { tg_username: un } : {}),
    };
  });
}

export function markUserBlocked(tg_chat_id: number): void {
  persist((s) => {
    const key = String(tg_chat_id);
    const prev = s.user_meta[key] ?? {};
    s.user_meta[key] = { ...prev, bot_blocked: true };
    const now = new Date().toISOString();
    for (const q of s.queue) {
      if (q.tg_chat_id === tg_chat_id && !q.sent_at && !q.cancelled_at) {
        q.cancelled_at = now;
        q.cancel_reason = "bot_blocked";
      }
    }
  });
}

export function markUserPaid(tg_chat_id: number): void {
  persist((s) => {
    const key = String(tg_chat_id);
    const prev = s.user_meta[key] ?? {};
    s.user_meta[key] = { ...prev, has_ever_paid: true };
  });
}

export function getUserMeta(tg_chat_id: number): TriggerUserMeta {
  return cache.user_meta[String(tg_chat_id)] ?? {};
}

export function bumpStats(
  campaign_id: TriggerCampaignId,
  step_id: string,
  variant_id: string | undefined,
  field: keyof TriggerStepStats,
  delta = 1,
): void {
  const key = variant_id ? `${step_id}__${variant_id}` : step_id;
  persist((s) => {
    if (!s.stats[campaign_id]) s.stats[campaign_id] = {};
    if (!s.stats[campaign_id]![key]) s.stats[campaign_id]![key] = emptyStepStats();
    const st = s.stats[campaign_id]![key]!;
    if (field === "revenue_rub" || field === "payment_delay_ms_sum") {
      st[field] += delta;
    } else {
      st[field] += Math.floor(delta);
    }
  });
}

export function appendSentLog(entry: TriggerSentLog): void {
  persist((s) => {
    s.sent_log.push(entry);
    if (s.sent_log.length > 50_000) s.sent_log = s.sent_log.slice(-40_000);
    const key = String(entry.tg_chat_id);
    const prev = s.user_meta[key] ?? {};
    s.user_meta[key] = {
      ...prev,
      last_trigger_sent_at: entry.sent_at,
      active_chains: { ...(prev.active_chains ?? {}), [entry.chain_id]: entry.campaign_id },
    };
  });
}

export function markFiredKey(tg_chat_id: number, firedKey: string): void {
  persist((s) => {
    const key = String(tg_chat_id);
    const prev = s.user_meta[key] ?? {};
    s.user_meta[key] = {
      ...prev,
      fired_keys: { ...(prev.fired_keys ?? {}), [firedKey]: new Date().toISOString() },
    };
  });
}

export function hasFiredKey(tg_chat_id: number, firedKey: string): boolean {
  return Boolean(cache.user_meta[String(tg_chat_id)]?.fired_keys?.[firedKey]);
}

export function registerChain(tg_chat_id: number, chain_id: string, campaign_id: TriggerCampaignId): void {
  persist((s) => {
    const key = String(tg_chat_id);
    const prev = s.user_meta[key] ?? {};
    s.user_meta[key] = {
      ...prev,
      active_chains: { ...(prev.active_chains ?? {}), [chain_id]: campaign_id },
    };
  });
}

export function pruneSentQueue(): void {
  persist((s) => {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    s.queue = s.queue.filter((q) => {
      const t = Date.parse(q.scheduled_at);
      if (Number.isFinite(t) && t < cutoff && (q.sent_at || q.cancelled_at)) return false;
      return true;
    });
  });
}

export function listPendingQueue(now = Date.now()): TriggerQueueItem[] {
  return cache.queue.filter((q) => {
    if (q.sent_at || q.cancelled_at) return false;
    return Date.parse(q.scheduled_at) <= now;
  });
}

export function getCampaignById(id: TriggerCampaignId): TriggerCampaign | undefined {
  return cache.config.campaigns.find((c) => c.id === id);
}
