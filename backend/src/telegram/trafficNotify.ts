import { listUsers, updateUserRow, type UserRow } from "../db.js";
import { sendTelegramHtml } from "./api.js";
import { getTelegramBotToken } from "./env.js";
import { buyGbReminderInline } from "./keyboards.js";

const BYTES_PER_GB = 1073741824;
const LOW_GB_THRESHOLD = 30;

type TrafficBucket = "ok" | "low30" | "empty";

function trafficBucket(u: UserRow): TrafficBucket {
  const totalGb = Number(u.total_gb) || 0;
  if (totalGb <= 0) return "ok";
  const usedBytes = Math.max(0, Number(u.traffic_up) || 0) + Math.max(0, Number(u.traffic_down) || 0);
  const remainGb = totalGb - usedBytes / BYTES_PER_GB;
  if (remainGb <= 0) return "empty";
  if (remainGb <= LOW_GB_THRESHOLD) return "low30";
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
  const subLabel = `#${u.id} ${u.name}`;
  const body =
    `<b>Внимание: трафик почти закончился.</b>\n\n` +
    `Подписка: <b>${subLabel}</b>\n` +
    `У вас осталось примерно <b>${remainGbText(u)}</b> (меньше 30 ГБ).\n\n` +
    `Чтобы не потерять доступ, докупите пакет трафика.`;
  await sendTelegramHtml(chatId, body, buyGbReminderInline);
}

async function sendEmptyTrafficReminder(u: UserRow, chatId: number): Promise<void> {
  const subLabel = `#${u.id} ${u.name}`;
  const body =
    `<b>Трафик закончился.</b>\n\n` +
    `Подписка: <b>${subLabel}</b>\n` +
    `Лимит по подписке исчерпан, доступ может быть ограничен.\n\n` +
    `Нажмите «Докупить ГБ», чтобы сразу пополнить баланс.`;
  await sendTelegramHtml(chatId, body, buyGbReminderInline);
}

export async function runAutoTrafficNotificationsOnce(): Promise<void> {
  if (!getTelegramBotToken()) return;
  const users = listUsers();
  for (const u of users) {
    if (u.enable === 0) continue;
    if ((Number(u.total_gb) || 0) <= 0) continue;
    const chatId = targetChatId(u);
    if (!chatId) continue;

    const nowBucket = trafficBucket(u);
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
  const intervalMsRaw = Number(process.env.TELEGRAM_TRAFFIC_NOTIFY_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(intervalMsRaw) && intervalMsRaw >= 60_000 ? Math.floor(intervalMsRaw) : 10 * 60 * 1000;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runAutoTrafficNotificationsOnce();
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(() => {
    void tick();
  }, intervalMs);
}
