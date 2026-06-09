import { appendReferralAdminGift, getUser, snapExpiryTimeToNoonLocal, updateUserRow, type UserRow } from "./db.js";
import { logCommunicationMessage } from "./communicationLog.js";
import { sendTelegramHtml } from "./telegram/api.js";
import { escHtml, subscriptionPublicName } from "./telegram/format.js";
import { pushClientListToAllDeployedServers } from "./userSync.js";

const DAY_MS = 86_400_000;
const INFLIGHT_MS = 8000;
const inflightByUser = new Map<number, number>();

export type AdminGiftJobInput = {
  user_id: number;
  kind: "gb" | "days";
  amount: number;
  admin_comment?: string;
};

export function tryBeginAdminGiftJob(userId: number): boolean {
  const id = Math.floor(userId);
  if (id <= 0) return false;
  const now = Date.now();
  const prev = inflightByUser.get(id) ?? 0;
  if (now - prev < INFLIGHT_MS) return false;
  inflightByUser.set(id, now);
  return true;
}

function endAdminGiftJob(userId: number): void {
  inflightByUser.delete(Math.floor(userId));
}

function giftBodyForUser(user: UserRow, kind: "gb" | "days", amount: number): string {
  const userLabel = subscriptionPublicName(user);
  return kind === "gb"
    ? `🎁 <b>Подарок от администратора!</b>\n\nВам начислено <b>+${amount} ГБ</b> на подписку «${escHtml(userLabel)}».`
    : `🎁 <b>Подарок от администратора!</b>\n\nСрок подписки «${escHtml(userLabel)}» продлён на <b>${amount} дн.</b>`;
}

function applyAdminGift(user: UserRow, kind: "gb" | "days", amount: number): boolean {
  if (kind === "gb") {
    if (user.total_gb <= 0) return false;
    updateUserRow(user.id, { total_gb: user.total_gb + amount });
    return true;
  }
  const base = Math.max(Date.now(), user.expiry_time > 0 ? user.expiry_time : 0);
  updateUserRow(user.id, { expiry_time: snapExpiryTimeToNoonLocal(base + amount * DAY_MS) });
  return true;
}

export function runAdminGiftJob(input: AdminGiftJobInput): void {
  runAdminGiftJobs([input]);
}

export function runAdminGiftJobs(inputs: AdminGiftJobInput[]): void {
  if (inputs.length === 0) return;
  void (async () => {
    const jobs = inputs.map((x) => ({
      userId: Math.floor(x.user_id),
      kind: x.kind,
      amount: Math.max(1, Math.floor(Number(x.amount) || 1)),
      admin_comment: x.admin_comment,
    }));
    try {
      const applied: UserRow[] = [];
      for (const job of jobs) {
        const user = getUser(job.userId);
        if (!user) continue;
        const tgKey = String(user.tg_id ?? "").trim();
        const tgChatId = Number(tgKey);
        if (!tgKey || !Number.isFinite(tgChatId) || tgChatId <= 0) continue;
        if (job.kind === "gb" && user.total_gb <= 0) continue;
        if (!applyAdminGift(user, job.kind, job.amount)) continue;
        applied.push(user);
      }

      if (applied.length > 0) {
        try {
          await pushClientListToAllDeployedServers();
        } catch (e) {
          console.error("[referral] push after admin gift:", e);
        }
      }

      for (const job of jobs) {
        const fresh = getUser(job.userId);
        if (!fresh) continue;
        if (!applied.some((u) => u.id === fresh.id)) continue;

        const tgChatId = Number(String(fresh.tg_id ?? "").trim());
        if (!Number.isFinite(tgChatId) || tgChatId <= 0) continue;

        const giftBody = giftBodyForUser(fresh, job.kind, job.amount);
        let messageSent = false;
        try {
          await sendTelegramHtml(tgChatId, giftBody);
          messageSent = true;
        } catch (e) {
          console.error("[referral] admin gift notify:", e);
        }

        appendReferralAdminGift({
          user_id: fresh.id,
          user_name: fresh.name,
          kind: job.kind,
          amount: job.amount,
          granted_by: "Администратор",
          admin_comment: job.admin_comment,
          telegram_sent: messageSent,
        });

        logCommunicationMessage({
          automatic: true,
          source_label: "Админ: подарок",
          text: giftBody.replace(/<[^>]+>/g, ""),
          has_photo: false,
          recipients: [{ user_id: fresh.id, user_name: fresh.name }],
          sent: messageSent ? 1 : 0,
          attempted: 1,
          failed: messageSent ? 0 : 1,
        });
      }
    } finally {
      for (const job of jobs) endAdminGiftJob(job.userId);
    }
  })();
}
