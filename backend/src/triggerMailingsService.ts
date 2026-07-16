import { randomBytes } from "node:crypto";
import { recordTriggerHistory } from "./triggerMailingsHistoryStore.js";
import { getPanelSettings } from "./panelSettings.js";
import { isTriggerSendWindowOpen, nextTriggerSendWindowOpen, projectTimezone } from "./projectTime.js";
import { findAwaitingProofSessionByChat, getPaymentSession, listUsers, type UserRow } from "./db.js";
import {
  appendSentLog,
  bumpStats,
  cancelQueueForChat,
  enqueueTriggerItem,
  getCampaignById,
  getTriggerMailingsConfig,
  getTriggerMailingsStore,
  getUserMeta,
  hasFiredKey,
  listPendingQueue,
  markFiredKey,
  markUserBlocked,
  markUserPaid,
  pruneSentQueue,
  registerChain,
  setTriggerMailingsConfig,
  touchUserActivity,
  updateQueueItem,
} from "./triggerMailingsStore.js";
import {
  TRIGGER_CAMPAIGN_PRIORITY,
  TRIGGER_MIN_GAP_MS,
  TRIGGER_PAYMENT_ATTRIBUTION_MS,
  statsKey,
  type TriggerAudience,
  type TriggerButton,
  type TriggerCampaignId,
  type TriggerMessageStep,
  type TriggerMessageVariant,
  type TriggerQueueItem,
} from "./triggerMailingsTypes.js";
import { sendTelegramHtml, sendTelegramPhotoBinary } from "./telegram/api.js";
import { getTelegramBotToken } from "./telegram/env.js";

function isTriggerMailingsGloballyEnabled(): boolean {
  return getTriggerMailingsConfig().globally_enabled !== false;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function panelTimezone(): string {
  return getPanelSettings().ui.timezone?.trim() || projectTimezone();
}

function ymdInTimezone(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ts),
  );
}

function formatExpiryDate(expiryMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(expiryMs),
  );
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2] || "", "base64");
    if (!buf.length) return null;
    return { mime: m[1] || "image/jpeg", bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
}

function pickVariant(
  step: TriggerMessageStep,
): { variant?: TriggerMessageVariant; useDefault: true } | { variant: TriggerMessageVariant; useDefault: false } {
  const vars = step.variants?.filter((v) => v.weight > 0) ?? [];
  if (!vars.length) return { useDefault: true };
  const total = vars.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const v of vars) {
    r -= v.weight;
    if (r <= 0) return { variant: v, useDefault: false };
  }
  return { variant: vars[vars.length - 1]!, useDefault: false };
}

function buildCallbackData(campaignId: TriggerCampaignId, stepId: string, action: string): string {
  const raw = `tm|${campaignId.slice(0, 8)}|${stepId}|${action}`;
  return raw.length <= 64 ? raw : raw.slice(0, 64);
}

export function parseTriggerClickCallback(
  data: string,
): { campaignId: TriggerCampaignId; stepId: string; action: string } | null {
  const m = /^tm\|([^|]+)\|([^|]+)\|(.+)$/.exec(data);
  if (!m) return null;
  const partial = m[1]!;
  const cfg = getTriggerMailingsConfig();
  const camp = cfg.campaigns.find((c) => c.id.startsWith(partial) || c.id.includes(partial));
  if (!camp) return null;
  return { campaignId: camp.id, stepId: m[2]!, action: m[3]! };
}

function buildInlineKeyboard(buttons: TriggerButton[], campaignId: TriggerCampaignId, stepId: string): unknown {
  if (!buttons.length) return undefined;
  const rows = buttons.map((b) => {
    if (b.kind === "url" && b.url) return [{ text: b.text, url: b.url }];
    const action = b.callback || "home";
    return [{ text: b.text, callback_data: buildCallbackData(campaignId, stepId, action) }];
  });
  return { inline_keyboard: rows };
}

function applyTemplate(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, escHtml(v));
  return out;
}

function lastTriggerSendPriority(tg_chat_id: number, now: number): number | null {
  const store = getTriggerMailingsStore();
  const hit = store.sent_log
    .filter((l) => l.tg_chat_id === tg_chat_id && now - Date.parse(l.sent_at) < TRIGGER_MIN_GAP_MS)
    .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0];
  if (!hit) return null;
  return getCampaignById(hit.campaign_id)?.priority ?? null;
}

function canSendNow(tg_chat_id: number, priority: number, now: number): boolean {
  const meta = getUserMeta(tg_chat_id);
  if (meta.bot_blocked) return false;
  const lastAt = meta.last_trigger_sent_at ? Date.parse(meta.last_trigger_sent_at) : 0;
  if (!Number.isFinite(lastAt) || now - lastAt >= TRIGGER_MIN_GAP_MS) return true;
  const lastPri = lastTriggerSendPriority(tg_chat_id, now);
  if (lastPri == null) return true;
  // Внутри 6-часового окна пропускаем только более приоритетную цепочку (меньше число).
  return priority < lastPri;
}

function abandonedPurchaseSessionStillOpen(item: TriggerQueueItem): boolean {
  const sessionId = typeof item.meta?.session_id === "string" ? item.meta.session_id : "";
  if (sessionId) {
    const sess = getPaymentSession(sessionId);
    return Boolean(sess && sess.status === "awaiting_proof");
  }
  return Boolean(findAwaitingProofSessionByChat(item.tg_chat_id));
}

async function deliverMessage(
  tg_chat_id: number,
  text: string,
  image_data_url: string | undefined,
  reply_markup: unknown,
): Promise<number | undefined> {
  if (image_data_url) {
    const parsed = parseDataUrl(image_data_url);
    if (parsed) {
      await sendTelegramPhotoBinary(tg_chat_id, parsed.bytes, {
        caption: text,
        mimeType: parsed.mime,
        reply_markup,
        parse_mode: "HTML",
      });
      return undefined;
    }
  }
  return await sendTelegramHtml(tg_chat_id, text, reply_markup);
}

async function sendStepNow(
  campaignId: TriggerCampaignId,
  step: TriggerMessageStep,
  ctx: {
    tg_chat_id: number;
    tg_user_id: number;
    user_id?: number;
    chain_id: string;
    templateVars?: Record<string, string>;
    variant_id?: string;
    variant?: TriggerMessageVariant;
  },
  opts?: { force?: boolean },
): Promise<boolean> {
  if (!isTriggerMailingsGloballyEnabled()) return false;
  if (!opts?.force && !isTriggerSendWindowOpen(Date.now(), panelTimezone())) return false;
  const campaign = getCampaignById(campaignId);
  if (!campaign?.enabled || !step.enabled) return false;
  const variant = ctx.variant;
  const text = applyTemplate(variant?.text_html ?? step.text_html, ctx.templateVars ?? {});
  const reply_markup = buildInlineKeyboard(variant?.buttons ?? step.buttons, campaignId, step.id);
  const variantId = ctx.variant_id ?? variant?.id;
  bumpStats(campaignId, step.id, variantId, "sent");
  try {
    const mid = await deliverMessage(ctx.tg_chat_id, text, variant?.image_data_url ?? step.image_data_url, reply_markup);
    bumpStats(campaignId, step.id, variantId, "delivered");
    const sentAt = new Date().toISOString();
    const logId = randomBytes(8).toString("hex");
    appendSentLog({
      id: logId,
      campaign_id: campaignId,
      step_id: step.id,
      variant_id: variantId,
      chain_id: ctx.chain_id,
      tg_chat_id: ctx.tg_chat_id,
      tg_user_id: ctx.tg_user_id,
      user_id: ctx.user_id,
      sent_at: sentAt,
      message_id: mid,
    });
    recordTriggerHistory({
      id: logId,
      sent_at: sentAt,
      campaign_id: campaignId,
      step_id: step.id,
      variant_id: variantId,
      tg_chat_id: ctx.tg_chat_id,
      tg_user_id: ctx.tg_user_id,
      user_id: ctx.user_id,
      chain_id: ctx.chain_id,
      text_html: text,
      has_image: Boolean(variant?.image_data_url ?? step.image_data_url),
      delivered: true,
    });
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/blocked|forbidden|deactivated|chat not found/i.test(msg)) markUserBlocked(ctx.tg_chat_id);
    console.error(`[trigger-mailings] send ${campaignId}/${step.id}:`, msg);
    return false;
  }
}

function scheduleChainSteps(
  campaignId: TriggerCampaignId,
  tg_chat_id: number,
  tg_user_id: number,
  opts?: {
    user_id?: number;
    chain_id?: string;
    fromStepIndex?: number;
    templateVars?: Record<string, string>;
    meta?: Record<string, unknown>;
  },
): string {
  if (!isTriggerMailingsGloballyEnabled()) return "";
  const campaign = getCampaignById(campaignId);
  if (!campaign?.enabled) return "";
  const chain_id = opts?.chain_id ?? randomBytes(6).toString("hex");
  registerChain(tg_chat_id, chain_id, campaignId);
  const startIdx = opts?.fromStepIndex ?? 0;
  const now = Date.now();
  let offsetMs = 0;
  for (let i = startIdx; i < campaign.steps.length; i++) {
    const step = campaign.steps[i]!;
    if (!step.enabled) continue;
    if (step.schedule_kind === "delay_minutes" && i > startIdx) offsetMs += step.schedule_value * 60_000;
    else if (step.schedule_kind === "delay_minutes" && i === startIdx) offsetMs = step.schedule_value * 60_000;
    const picked = pickVariant(step);
    const variant = picked.useDefault ? undefined : picked.variant;
    bumpStats(campaignId, step.id, variant?.id, "triggered");
    const isImmediate =
      step.schedule_kind === "immediate" ||
      (step.schedule_kind === "delay_minutes" && step.schedule_value === 0 && i === startIdx);
    if (isImmediate) {
      const when = nextTriggerSendWindowOpen(now, panelTimezone());
      if (when <= now) {
        void sendStepNow(campaignId, step, {
          tg_chat_id,
          tg_user_id,
          user_id: opts?.user_id,
          chain_id,
          templateVars: opts?.templateVars,
          variant,
          variant_id: variant?.id,
        });
      } else {
        enqueueTriggerItem({
          campaign_id: campaignId,
          step_id: step.id,
          chain_id,
          tg_chat_id,
          tg_user_id,
          user_id: opts?.user_id,
          scheduled_at: new Date(when).toISOString(),
          priority: campaign.priority,
          variant_id: variant?.id,
          meta: opts?.meta,
        });
      }
      continue;
    }
    if (step.schedule_kind !== "delay_minutes") continue;
    enqueueTriggerItem({
      campaign_id: campaignId,
      step_id: step.id,
      chain_id,
      tg_chat_id,
      tg_user_id,
      user_id: opts?.user_id,
      scheduled_at: new Date(nextTriggerSendWindowOpen(now + offsetMs, panelTimezone())).toISOString(),
      priority: campaign.priority,
      variant_id: variant?.id,
      meta: opts?.meta,
    });
  }
  return chain_id;
}

export function isWelcomeSeriesTriggerActive(): boolean {
  if (!isTriggerMailingsGloballyEnabled()) return false;
  const camp = getCampaignById("welcome_series");
  return Boolean(camp?.enabled);
}

export function triggerOnGuestStart(tg_chat_id: number, tg_user_id: number, tg_username?: string): void {
  if (!isTriggerMailingsGloballyEnabled()) return;
  touchUserActivity(tg_chat_id, tg_username);
  if (getUserMeta(tg_chat_id).has_ever_paid) return;
  cancelQueueForChat(tg_chat_id, { campaign_ids: ["welcome_series"], reason: "restart_welcome" });
  scheduleChainSteps("welcome_series", tg_chat_id, tg_user_id);
}

export function triggerOnPaymentSessionStart(args: {
  tg_chat_id: number;
  tg_user_id: number;
  session_id: string;
  kind: string;
}): void {
  if (!isTriggerMailingsGloballyEnabled()) return;
  cancelQueueForChat(args.tg_chat_id, { campaign_ids: ["abandoned_purchase"], reason: "new_payment_session" });
  scheduleChainSteps("abandoned_purchase", args.tg_chat_id, args.tg_user_id, {
    meta: { session_id: args.session_id, kind: args.kind },
  });
}

export function triggerOnPaymentSuccess(args: {
  tg_chat_id: number;
  tg_user_id: number;
  user_id?: number;
  is_renewal: boolean;
  expiry_ms?: number;
  amount_rub?: number;
}): void {
  if (!isTriggerMailingsGloballyEnabled()) return;
  markUserPaid(args.tg_chat_id);
  cancelQueueForChat(args.tg_chat_id, {
    campaign_ids: ["welcome_series", "abandoned_purchase", "subscription_expiry", "user_return", "trial_expiry"],
    reason: "payment_success",
  });
  const tz = getPanelSettings().ui.timezone?.trim() || "Asia/Yekaterinburg";
  const templateVars: Record<string, string> = {};
  if (args.expiry_ms) templateVars.expiry_date = formatExpiryDate(args.expiry_ms, tz);
  if (args.is_renewal) {
    scheduleChainSteps("subscription_renewal", args.tg_chat_id, args.tg_user_id, { user_id: args.user_id, templateVars });
  } else {
    scheduleChainSteps("payment_success", args.tg_chat_id, args.tg_user_id, { user_id: args.user_id });
  }
  attributePayment(args.tg_chat_id, args.amount_rub ?? 0);
}

export function triggerOnPaymentReject(tg_chat_id: number, tg_user_id: number): void {
  if (!isTriggerMailingsGloballyEnabled()) return;
  cancelQueueForChat(tg_chat_id, { campaign_ids: ["abandoned_purchase"], reason: "payment_rejected" });
  scheduleChainSteps("payment_error", tg_chat_id, tg_user_id);
}

export function triggerOnSuspiciousPayment(tg_chat_id: number, tg_user_id: number): void {
  if (!isTriggerMailingsGloballyEnabled()) return;
  scheduleChainSteps("suspicious_payment", tg_chat_id, tg_user_id);
}

export function triggerOnTariffChange(tg_chat_id: number, tg_user_id: number, user_id?: number): void {
  if (!isTriggerMailingsGloballyEnabled()) return;
  scheduleChainSteps("tariff_change", tg_chat_id, tg_user_id, { user_id });
}

export function triggerOnDeviceLimit(tg_chat_id: number, tg_user_id: number, user_id?: number): void {
  if (!isTriggerMailingsGloballyEnabled()) return;
  if (hasFiredKey(tg_chat_id, "device_limit")) return;
  markFiredKey(tg_chat_id, "device_limit");
  scheduleChainSteps("device_limit", tg_chat_id, tg_user_id, { user_id });
}

export function recordTriggerButtonClick(campaignId: TriggerCampaignId, stepId: string, variantId?: string): void {
  bumpStats(campaignId, stepId, variantId, "clicks");
}

export function recordUserActivity(tg_chat_id: number, tg_username?: string): void {
  touchUserActivity(tg_chat_id, tg_username);
}

function attributePayment(tg_chat_id: number, amount_rub: number): void {
  const store = getTriggerMailingsStore();
  const now = Date.now();
  const hit = store.sent_log
    .filter((l) => l.tg_chat_id === tg_chat_id && now - Date.parse(l.sent_at) <= TRIGGER_PAYMENT_ATTRIBUTION_MS)
    .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0];
  if (!hit) return;
  const delay = now - Date.parse(hit.sent_at);
  bumpStats(hit.campaign_id, hit.step_id, hit.variant_id, "payments");
  if (amount_rub > 0) bumpStats(hit.campaign_id, hit.step_id, hit.variant_id, "revenue_rub", amount_rub);
  bumpStats(hit.campaign_id, hit.step_id, hit.variant_id, "payment_delay_ms_sum", delay);
  bumpStats(hit.campaign_id, hit.step_id, hit.variant_id, "payment_delay_count");
}

function userExpiryMs(u: UserRow): number {
  return u.expiry_time ?? 0;
}

function isUserActive(u: UserRow, now: number): boolean {
  return u.enable === 1 && (u.expiry_time ?? 0) > now;
}

function isUserExpired(u: UserRow, now: number): boolean {
  const exp = u.expiry_time ?? 0;
  return exp > 0 && exp <= now;
}

function isUserNew(u: UserRow, _now: number): boolean {
  return !isUserPaid(u) && (u.expiry_time ?? 0) <= 0;
}

function isUserPaid(u: UserRow): boolean {
  const chatId = Number(u.tg_id);
  if (chatId && getUserMeta(chatId).has_ever_paid) return true;
  return (u.expiry_time ?? 0) > 0;
}

function matchAudience(u: UserRow, aud: TriggerAudience, now: number): boolean {
  if (!u.tg_id) return false;
  switch (aud) {
    case "all":
      return true;
    case "active":
      return isUserActive(u, now);
    case "expired":
      return isUserExpired(u, now);
    case "new":
      return isUserNew(u, now);
    case "paid":
      return isUserPaid(u);
    case "unpaid":
      return !isUserPaid(u);
    default:
      return false;
  }
}

export async function sendManualTriggerCampaign(
  campaignId: TriggerCampaignId,
  audience?: TriggerAudience,
): Promise<{ sent: number; errors: string[] }> {
  if (!isTriggerMailingsGloballyEnabled()) return { sent: 0, errors: ["globally_disabled"] };
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { sent: 0, errors: ["campaign_not_found"] };
  const step = campaign.steps[0];
  if (!step) return { sent: 0, errors: ["no_steps"] };
  const aud = audience ?? campaign.manual_audience ?? "all";
  const now = Date.now();
  let sent = 0;
  const errors: string[] = [];
  for (const u of listUsers().filter((x) => x.tg_id && matchAudience(x, aud, now))) {
    const chatId = Number(u.tg_id);
    const ok = await sendStepNow(campaignId, step, {
      tg_chat_id: chatId,
      tg_user_id: chatId,
      user_id: u.id,
      chain_id: randomBytes(6).toString("hex"),
    }, { force: true });
    if (ok) sent++;
    else errors.push(`${u.id}`);
  }
  return { sent, errors };
}

export async function sendTriggerTest(args: {
  campaign_id: TriggerCampaignId;
  step_id: string;
  tg_chat_id: number;
  variant_id?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const campaign = getCampaignById(args.campaign_id);
  const step = campaign?.steps.find((s) => s.id === args.step_id);
  if (!campaign || !step) return { ok: false, error: "not_found" };
  const variant = args.variant_id ? step.variants?.find((v) => v.id === args.variant_id) : undefined;
  const tz = getPanelSettings().ui.timezone?.trim() || "Asia/Yekaterinburg";
  const ok = await sendStepNow(args.campaign_id, step, {
    tg_chat_id: args.tg_chat_id,
    tg_user_id: args.tg_chat_id,
    chain_id: "test_" + randomBytes(4).toString("hex"),
    templateVars: { expiry_date: formatExpiryDate(Date.now() + 30 * 86400000, tz) },
    variant,
    variant_id: variant?.id,
  }, { force: true });
  return { ok, error: ok ? undefined : "send_failed" };
}

async function processQueueOnce(): Promise<void> {
  if (!getTelegramBotToken() || !isTriggerMailingsGloballyEnabled()) return;
  const now = Date.now();
  if (!isTriggerSendWindowOpen(now, panelTimezone())) return;
  const pending = listPendingQueue(now).sort(
    (a, b) => a.priority - b.priority || Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at),
  );
  const byChat = new Map<number, typeof pending>();
  for (const q of pending) {
    const arr = byChat.get(q.tg_chat_id) ?? [];
    arr.push(q);
    byChat.set(q.tg_chat_id, arr);
  }
  for (const [chatId, items] of byChat) {
    if (getUserMeta(chatId).bot_blocked) {
      for (const q of items) updateQueueItem(q.id, { cancelled_at: new Date().toISOString(), cancel_reason: "bot_blocked" });
      continue;
    }
    items.sort((a, b) => a.priority - b.priority || Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
    const top = items[0]!;
    if (!canSendNow(chatId, top.priority, now)) continue;
    for (const q of items) {
      if (q.id !== top.id && q.priority > top.priority) {
        updateQueueItem(q.id, { cancelled_at: new Date().toISOString(), cancel_reason: "lower_priority" });
      }
    }
    const campaign = getCampaignById(top.campaign_id);
    const step = campaign?.steps.find((s) => s.id === top.step_id);
    if (!campaign?.enabled || !step?.enabled) {
      updateQueueItem(top.id, { cancelled_at: new Date().toISOString(), cancel_reason: "disabled" });
      continue;
    }
    if (top.campaign_id === "abandoned_purchase" && !abandonedPurchaseSessionStillOpen(top)) {
      updateQueueItem(top.id, { cancelled_at: new Date().toISOString(), cancel_reason: "session_closed" });
      continue;
    }
    const variant = top.variant_id ? step.variants?.find((v) => v.id === top.variant_id) : undefined;
    const ok = await sendStepNow(top.campaign_id, step, {
      tg_chat_id: top.tg_chat_id,
      tg_user_id: top.tg_user_id,
      user_id: top.user_id,
      chain_id: top.chain_id,
      variant,
      variant_id: top.variant_id,
    });
    updateQueueItem(top.id, {
      sent_at: new Date().toISOString(),
      ...(!ok ? { cancelled_at: new Date().toISOString(), cancel_reason: "send_failed" } : {}),
    });
  }
}

function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function dispatchPeriodicStep(
  campaignId: TriggerCampaignId,
  step: TriggerMessageStep,
  ctx: {
    tg_chat_id: number;
    tg_user_id: number;
    user_id?: number;
    chain_id: string;
  },
): void {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return;
  const now = Date.now();
  const tz = panelTimezone();
  const when = nextTriggerSendWindowOpen(now, tz);
  if (when <= now) {
    void sendStepNow(campaignId, step, ctx);
    return;
  }
  enqueueTriggerItem({
    campaign_id: campaignId,
    step_id: step.id,
    chain_id: ctx.chain_id,
    tg_chat_id: ctx.tg_chat_id,
    tg_user_id: ctx.tg_user_id,
    user_id: ctx.user_id,
    scheduled_at: new Date(when).toISOString(),
    priority: campaign.priority,
  });
}

async function scanPeriodicTriggersOnce(): Promise<void> {
  if (!getTelegramBotToken() || !isTriggerMailingsGloballyEnabled()) return;
  const tz = getPanelSettings().ui.timezone?.trim() || "Asia/Yekaterinburg";
  const today = ymdInTimezone(Date.now(), tz);
  const now = Date.now();
  for (const u of listUsers().filter((x) => x.tg_id && x.enable === 1)) {
    const chatId = Number(u.tg_id);
    if (getUserMeta(chatId).bot_blocked) continue;
    const expMs = userExpiryMs(u);
    if (expMs > 0) {
      const expYmd = ymdInTimezone(expMs, tz);
      const daysBefore = daysBetweenYmd(today, expYmd);
      const daysAfter = daysBetweenYmd(expYmd, today);
      const expiryCamp = getCampaignById("subscription_expiry");
      if (expiryCamp?.enabled) {
        for (const step of expiryCamp.steps) {
          if (!step.enabled) continue;
          let match = false;
          if (step.schedule_kind === "days_before_expiry" && daysBefore === step.schedule_value && daysAfter <= 0) match = true;
          if (step.schedule_kind === "days_after_expiry" && daysAfter === step.schedule_value && daysBefore < 0) match = true;
          if (!match) continue;
          const firedKey = `subscription_expiry:${step.id}:${expYmd}`;
          if (hasFiredKey(chatId, firedKey)) continue;
          markFiredKey(chatId, firedKey);
          bumpStats("subscription_expiry", step.id, undefined, "triggered");
          dispatchPeriodicStep("subscription_expiry", step, {
            tg_chat_id: chatId,
            tg_user_id: chatId,
            user_id: u.id,
            chain_id: `exp_${step.id}_${expYmd}`,
          });
        }
      }
      const returnCamp = getCampaignById("user_return");
      if (returnCamp?.enabled && daysBefore < 0 && !isUserActive(u, now)) {
        for (const step of returnCamp.steps) {
          if (!step.enabled || step.schedule_kind !== "days_after_expiry" || daysAfter !== step.schedule_value) continue;
          const firedKey = `user_return:${step.id}:${expYmd}`;
          if (hasFiredKey(chatId, firedKey)) continue;
          markFiredKey(chatId, firedKey);
          bumpStats("user_return", step.id, undefined, "triggered");
          dispatchPeriodicStep("user_return", step, {
            tg_chat_id: chatId,
            tg_user_id: chatId,
            user_id: u.id,
            chain_id: `ret_${step.id}_${expYmd}`,
          });
        }
      }
    }
    const meta = getUserMeta(chatId);
    const inactCamp = getCampaignById("inactivity");
    if (inactCamp?.enabled && meta.last_activity_at) {
      const inactiveDays = Math.floor((now - Date.parse(meta.last_activity_at)) / 86400000);
      for (const step of inactCamp.steps) {
        if (!step.enabled || step.schedule_kind !== "days_inactive" || inactiveDays < step.schedule_value) continue;
        const firedKey = `inactivity:${step.id}:${step.schedule_value}`;
        if (hasFiredKey(chatId, firedKey)) continue;
        markFiredKey(chatId, firedKey);
        bumpStats("inactivity", step.id, undefined, "triggered");
        dispatchPeriodicStep("inactivity", step, {
          tg_chat_id: chatId,
          tg_user_id: chatId,
          user_id: u.id,
          chain_id: `ina_${step.id}`,
        });
      }
    }
  }
}

let loopTimer: ReturnType<typeof setInterval> | null = null;

export function startTriggerMailingsLoop(): void {
  if (loopTimer) return;
  void processQueueOnce().catch((e) => console.error("[trigger-mailings] queue:", e));
  void scanPeriodicTriggersOnce().catch((e) => console.error("[trigger-mailings] scan:", e));
  loopTimer = setInterval(() => {
    void processQueueOnce().catch((e) => console.error("[trigger-mailings] queue:", e));
  }, 60_000);
  setInterval(() => {
    void scanPeriodicTriggersOnce().catch((e) => console.error("[trigger-mailings] scan:", e));
    pruneSentQueue();
  }, 15 * 60_000);
  console.log("[trigger-mailings] loop started");
}

export { getTriggerMailingsConfig, getTriggerMailingsStore, setTriggerMailingsConfig, statsKey, TRIGGER_CAMPAIGN_PRIORITY };
