import { executeCommunicationSend } from "./communicationSend.js";
import { listDuePendingJobs, updateScheduledMailing } from "./scheduledMailingsStore.js";
import { getTelegramBotToken } from "./telegram/env.js";

const CHECK_MS = 60_000;

let loopTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function processDueOnce(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    if (!getTelegramBotToken()) return;
    const due = listDuePendingJobs();
    for (const job of due) {
      try {
        await executeCommunicationSend(job.payload);
        updateScheduledMailing(job.id, { status: "sent" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[scheduled-mailings] send failed:", job.id, msg);
        updateScheduledMailing(job.id, { status: "failed", error: msg.slice(0, 400) });
      }
    }
  } finally {
    ticking = false;
  }
}

export function startScheduledMailingsLoop(): void {
  if (loopTimer) return;
  void processDueOnce().catch((e) => console.error("[scheduled-mailings] tick:", e));
  loopTimer = setInterval(() => {
    void processDueOnce().catch((e) => console.error("[scheduled-mailings] tick:", e));
  }, CHECK_MS);
  console.log("[scheduled-mailings] loop started");
}
