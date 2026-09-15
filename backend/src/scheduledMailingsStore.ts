import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  ScheduledMailingJob,
  ScheduledMailingListItem,
  ScheduledMailingPayload,
  ScheduledMailingStatus,
} from "./scheduledMailingsTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

function storePath(): string {
  return process.env.SCHEDULED_MAILINGS_PATH ?? path.join(path.dirname(dataPath), "scheduled_mailings.json");
}

type FileShape = { jobs: ScheduledMailingJob[] };

const KEEP_MS = 30 * 86_400_000;

function readFile(): FileShape {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as FileShape;
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs.filter(isJob) : [];
    return { jobs };
  } catch {
    return { jobs: [] };
  }
}

function isJob(x: unknown): x is ScheduledMailingJob {
  if (!x || typeof x !== "object") return false;
  const o = x as ScheduledMailingJob;
  return Boolean(o.id && o.send_at && o.payload && typeof o.payload === "object");
}

function writeFile(data: FileShape): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function prune(jobs: ScheduledMailingJob[]): ScheduledMailingJob[] {
  const cutoff = Date.now() - KEEP_MS;
  return jobs.filter((j) => {
    if (j.status === "pending") return true;
    const t = Date.parse(j.send_at);
    return Number.isFinite(t) && t >= cutoff;
  });
}

export function initScheduledMailingsStore(): void {
  const data = readFile();
  writeFile({ jobs: prune(data.jobs) });
}

export function addScheduledMailing(sendAtIso: string, payload: ScheduledMailingPayload): ScheduledMailingJob {
  const data = readFile();
  const job: ScheduledMailingJob = {
    id: randomBytes(8).toString("hex"),
    send_at: sendAtIso,
    created_at: new Date().toISOString(),
    status: "pending",
    payload,
  };
  data.jobs.push(job);
  writeFile({ jobs: prune(data.jobs) });
  return job;
}

export function listScheduledMailings(status?: ScheduledMailingStatus): ScheduledMailingListItem[] {
  const jobs = readFile().jobs.filter((j) => (status ? j.status === status : true));
  jobs.sort((a, b) => Date.parse(a.send_at) - Date.parse(b.send_at));
  return jobs.map(toListItem);
}

export function listDuePendingJobs(now = Date.now()): ScheduledMailingJob[] {
  return readFile()
    .jobs.filter((j) => j.status === "pending" && Date.parse(j.send_at) <= now)
    .sort((a, b) => Date.parse(a.send_at) - Date.parse(b.send_at));
}

export function updateScheduledMailing(
  id: string,
  patch: Partial<Pick<ScheduledMailingJob, "status" | "error">>,
): ScheduledMailingJob | null {
  const data = readFile();
  const idx = data.jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;
  data.jobs[idx] = { ...data.jobs[idx], ...patch };
  writeFile({ jobs: prune(data.jobs) });
  return data.jobs[idx];
}

export function cancelScheduledMailing(id: string): ScheduledMailingJob | null {
  const data = readFile();
  const job = data.jobs.find((j) => j.id === id);
  if (!job) return null;
  if (job.status !== "pending") return null;
  job.status = "cancelled";
  writeFile({ jobs: prune(data.jobs) });
  return job;
}

function toListItem(job: ScheduledMailingJob): ScheduledMailingListItem {
  const text = String(job.payload.text ?? "").trim();
  return {
    id: job.id,
    send_at: job.send_at,
    created_at: job.created_at,
    status: job.status,
    ...(job.error ? { error: job.error } : {}),
    title: String(job.payload.title ?? "").trim(),
    mode: job.payload.mode,
    ...(job.payload.segment_id ? { segment_id: job.payload.segment_id } : {}),
    text_preview: text.length > 140 ? `${text.slice(0, 140)}…` : text,
    has_photo: Boolean(job.payload.photo_base64),
    mark_enabled: job.payload.mark_enabled === true,
  };
}
