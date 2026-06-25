import { getAutoCommunicationsConfig } from "../autoCommunicationsStore.js";
import { fillAutoMessageTemplate } from "../autoCommunicationsTypes.js";
import { logCommunicationMessage, stripHtmlPreview } from "../communicationLog.js";
import { listUsers, updateUserRow, type UserRow } from "../db.js";
import { sendTelegramHtml } from "./api.js";
import { getTelegramBotToken } from "./env.js";
import { buyGbReminderInline } from "./keyboards.js";
import { subscriptionPublicName } from "./format.js";

const BYTES_PER_GB = 1073741824;

type TrafficBucket = "ok" | "low30" | "empty";

function trafficBucket(u: UserRow, lowThresholdGb: number): TrafficBucket {
  const totalGb = Number(u.total_gb) || 0;
  if (totalGb <= 0) return "ok";
  const usedBytes = Math.max(0, Number(u.traffic_up) || 0) + Math.max(0, Number(u.traffic_down) || 0);
  const remainGb = totalGb - usedBytes / BYTES_PER_GB;
  if (remainGb <= 0) return "empty";
  if (remainGb <= lowThresholdGb) return "low30";
  return "ok";
}

function targetChatId(u: UserRow): number | null {
  const chat = Number(String(u.tg_id ?? "").trim());
  if (!Number.isFinite(chat) || chat <= 0) return null;
  return chat;
}

function remainGbText(u: UserRow): string {
  const totalGb = Math.max(0, Number(u.total_gb) || 0);
  const usedBytes = Math.max(0, Number(u.traffic_up) || 0) + Math.max(0, Number(u.traffic_down) || 0);
  const remain = Math.max(0, totalGb - usedBytes / BYTES_PER_GB);
  if (remain >= 10) return `${Math.floor(remain)} ГБ`;
  if (remain >= 1) return `${remain.toFixed(1)} ГБ`;
  return `${remain.toFixed(2)} ГБ`;
}

async function sendLowTrafficReminder(u: UserRow, chatId: number): Promise<void> {
  const cfg = getAutoCommunicationsConfig().traffic;
  const subLabel = subscriptionPublicName(u);
  const vars = {
    subscription: subLabel,
    remaining_gb: remainGbText(u),
    threshold_gb: String(cfg.low_gb_threshold),
  };
  const body = fillAutoMessageTemplate(cfg.low_message, vars);
  const sourceLabel = fillAutoMessageTemplate(cfg.source_label_low, vars);
  await sendTelegramHtml(chatId, body, buyGbReminderInline);
  logCommunicationMessage({
    automatic: true,
    source_label: sourceLabel,
    text: stripHtmlPreview(body),
    has_photo: false,
    recipients: [{ user_id: u.id, user_name: u.name }],
    sent: 1,
    attempted: 1,
    failed: 0,
  });
}

async function sendEmptyTrafficReminder(u: UserRow, chatId: number): Promise<void> {
  const cfg = getAutoCommunicationsConfig().traffic;
  const subLabel = subscriptionPublicName(u);
  const vars = {
    subscription: subLabel,
    remaining_gb: remainGbText(u),
    threshold_gb: String(cfg.low_gb_threshold),
  };
  const body = fillAutoMessageTemplate(cfg.empty_message, vars);
  await sendTelegramHtml(chatId, body, buyGbReminderInline);
  logCommunicationMessage({
    automatic: true,
    source_label: cfg.source_label_empty,
    text: stripHtmlPreview(body),
    has_photo: false,
    recipients: [{ user_id: u.id, user_name: u.name }],
    sent: 1,
    attempted: 1,
    failed: 0,
  });
}

export async function runAutoTrafficNotificationsOnce(): Promise<void> {
  const cfg = getAutoCommunicationsConfig().traffic;
  if (!cfg.enabled || !getTelegramBotToken()) return;
  const users = listUsers();
  for (const u of users) {
    if (u.enable === 0) continue;
    if (cfg.skip_test_subscriptions && u.is_test_subscription === 1) continue;
    if ((Number(u.total_gb) || 0) <= 0) continue;
    const chatId = targetChatId(u);
    if (!chatId) continue;

    const nowBucket = trafficBucket(u, cfg.low_gb_threshold);
    const prev =
      u.traffic_notify_state === "low30" || u.traffic_notify_state === "empty" ? u.traffic_notify_state : "";

    if (nowBucket === "ok") {
      if (prev) updateUserRow(u.id, { traffic_notify_state: "" });
      continue;
    }

    if (nowBucket === "low30") {
      if (prev === "low30") continue;
      try {
        await sendLowTrafficReminder(u, chatId);
        updateUserRow(u.id, { traffic_notify_state: "low30" });
      } catch (e) {
        console.error("[telegram] low traffic notify:", u.id, e);
      }
      continue;
    }

    if (prev === "empty") continue;
    try {
      await sendEmptyTrafficReminder(u, chatId);
      updateUserRow(u.id, { traffic_notify_state: "empty" });
    } catch (e) {
      console.error("[telegram] empty traffic notify:", u.id, e);
    }
  }
}

export function startAutoTrafficNotifyLoop(): void {
  const envMsRaw = Number(process.env.TELEGRAM_TRAFFIC_NOTIFY_INTERVAL_MS);
  const envMs = Number.isFinite(envMsRaw) && envMsRaw >= 60_000 ? Math.floor(envMsRaw) : null;
  let busy = false;
  let lastRunAt = 0;
  const tick = async () => {
    if (busy) return;
    const cfg = getAutoCommunicationsConfig().traffic;
    const intervalMs = envMs ?? cfg.interval_minutes * 60_000;
    const now = Date.now();
    if (now - lastRunAt < intervalMs) return;
    busy = true;
    lastRunAt = now;
    try {
      await runAutoTrafficNotificationsOnce();
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(() => {
    void tick();
  }, 60_000);
}
