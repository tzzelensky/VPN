import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PaymentSessionRow } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

function storePath(): string {
  return (
    process.env.PAYMENT_SESSION_LOG_PATH ??
    path.join(path.dirname(dataPath), "payment_session_logs.json")
  );
}

export type PaymentSessionLogStatus =
  | "awaiting_proof"
  | "pending_admin"
  | "confirmed"
  | "rejected"
  | "cancelled";

export type PaymentSessionLogChannel = "chat" | "webapp" | "admin";

export type PaymentSessionChatMessage = {
  at: string;
  direction: "bot" | "user";
  text: string;
  has_photo?: boolean;
};

export type PaymentSessionLogRow = {
  id: string;
  tg_chat_id: number;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  target_user_id?: number;
  target_user_name?: string;
  new_subscription_name?: string;
  kind: PaymentSessionRow["kind"];
  plan_id: number;
  status: PaymentSessionLogStatus;
  channel: PaymentSessionLogChannel;
  amount_rub: number;
  amount_original_rub?: number;
  tariff_line: string;
  plan_title: string;
  discount_label?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  messages: PaymentSessionChatMessage[];
};

type PaymentSessionLogStoreFile = {
  sessions: PaymentSessionLogRow[];
};

const MAX_SESSIONS = 5000;
const MAX_MESSAGES = 50;

function emptyFile(): PaymentSessionLogStoreFile {
  return { sessions: [] };
}

function normalizeMessage(raw: unknown): PaymentSessionChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PaymentSessionChatMessage>;
  const direction = r.direction === "user" ? "user" : r.direction === "bot" ? "bot" : null;
  const text = String(r.text ?? "").trim();
  const at = String(r.at ?? "").trim();
  if (!direction || !text || !at) return null;
  return {
    at,
    direction,
    text: text.slice(0, 4000),
    ...(r.has_photo ? { has_photo: true } : {}),
  };
}

function normalizeStatus(raw: unknown): PaymentSessionLogStatus | null {
  if (
    raw === "awaiting_proof" ||
    raw === "pending_admin" ||
    raw === "confirmed" ||
    raw === "rejected" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return null;
}

function normalizeKind(raw: unknown): PaymentSessionRow["kind"] | null {
  if (
    raw === "subscription" ||
    raw === "topup" ||
    raw === "test" ||
    raw === "white_lists" ||
    raw === "device_slot" ||
    raw === "combo"
  ) {
    return raw;
  }
  return null;
}

function normalizeRow(raw: unknown): PaymentSessionLogRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PaymentSessionLogRow>;
  const id = String(r.id ?? "").trim();
  const kind = normalizeKind(r.kind);
  const status = normalizeStatus(r.status);
  const channel =
    r.channel === "webapp" ? "webapp" : r.channel === "admin" ? "admin" : r.channel === "chat" ? "chat" : null;
  const tg_chat_id = Number(r.tg_chat_id);
  const tg_user_id = Number(r.tg_user_id);
  const plan_id = Number(r.plan_id);
  const amount_rub = Number(r.amount_rub);
  const created_at = String(r.created_at ?? "").trim();
  const updated_at = String(r.updated_at ?? "").trim();
  const tariff_line = String(r.tariff_line ?? "").trim();
  const plan_title = String(r.plan_title ?? "").trim();
  if (
    !id ||
    !kind ||
    !status ||
    !channel ||
    !Number.isFinite(tg_chat_id) ||
    !Number.isFinite(tg_user_id) ||
    !Number.isFinite(plan_id) ||
    !Number.isFinite(amount_rub) ||
    !created_at ||
    !updated_at
  ) {
    return null;
  }
  const messages = Array.isArray(r.messages)
    ? r.messages.map(normalizeMessage).filter((m): m is PaymentSessionChatMessage => m != null)
    : [];
  return {
    id,
    tg_chat_id: Math.floor(tg_chat_id),
    tg_user_id: Math.floor(tg_user_id),
    kind,
    plan_id: Math.floor(plan_id),
    status,
    channel,
    amount_rub: Math.max(0, Math.floor(amount_rub)),
    tariff_line: tariff_line || "—",
    plan_title: plan_title || "—",
    created_at,
    updated_at,
    messages: messages.slice(-MAX_MESSAGES),
    ...(r.tg_username ? { tg_username: String(r.tg_username).trim().slice(0, 64) } : {}),
    ...(r.tg_first_name ? { tg_first_name: String(r.tg_first_name).trim().slice(0, 128) } : {}),
    ...(Number.isFinite(Number(r.target_user_id)) && Number(r.target_user_id) > 0
      ? { target_user_id: Math.floor(Number(r.target_user_id)) }
      : {}),
    ...(r.target_user_name ? { target_user_name: String(r.target_user_name).trim().slice(0, 128) } : {}),
    ...(r.new_subscription_name
      ? { new_subscription_name: String(r.new_subscription_name).trim().slice(0, 25) }
      : {}),
    ...(Number.isFinite(Number(r.amount_original_rub)) && Number(r.amount_original_rub) > 0
      ? { amount_original_rub: Math.floor(Number(r.amount_original_rub)) }
      : {}),
    ...(r.discount_label ? { discount_label: String(r.discount_label).slice(0, 500) } : {}),
    ...(r.completed_at ? { completed_at: String(r.completed_at) } : {}),
  };
}

function readFile(): PaymentSessionLogStoreFile {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PaymentSessionLogStoreFile>;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(normalizeRow).filter((s): s is PaymentSessionLogRow => s != null)
      : [];
    return { sessions };
  } catch {
    return emptyFile();
  }
}

function writeFile(data: PaymentSessionLogStoreFile): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

function mutate(fn: (store: PaymentSessionLogStoreFile) => void): void {
  const store = readFile();
  fn(store);
  store.sessions = store.sessions
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, MAX_SESSIONS);
  writeFile(store);
}

export function upsertPaymentSessionLog(row: PaymentSessionLogRow): void {
  mutate((store) => {
    const i = store.sessions.findIndex((s) => s.id === row.id);
    if (i === -1) {
      store.sessions.unshift(row);
      return;
    }
    const prev = store.sessions[i]!;
    store.sessions[i] = {
      ...row,
      messages: row.messages.length > 0 ? row.messages : prev.messages,
      created_at: prev.created_at || row.created_at,
    };
  });
}

/** Правка суммы в отчёте выручки; исходник сохраняется в amount_original_rub один раз. */
export function updatePaymentSessionLogAmount(id: string, amountRub: number): PaymentSessionLogRow | undefined {
  let out: PaymentSessionLogRow | undefined;
  mutate((store) => {
    const i = store.sessions.findIndex((s) => s.id === id);
    if (i === -1) return;
    const prev = store.sessions[i]!;
    const amount = Math.max(0, Math.round(Number(amountRub) || 0));
    const amount_original_rub =
      prev.amount_original_rub != null && Number.isFinite(Number(prev.amount_original_rub))
        ? prev.amount_original_rub
        : prev.amount_rub;
    const now = new Date().toISOString();
    out = { ...prev, amount_rub: amount, amount_original_rub, updated_at: now };
    store.sessions[i] = out;
  });
  return out;
}

export function updatePaymentSessionLogStatus(
  id: string,
  status: PaymentSessionLogStatus,
  patch?: Partial<Pick<PaymentSessionLogRow, "channel" | "completed_at">>,
): void {
  const now = new Date().toISOString();
  mutate((store) => {
    const i = store.sessions.findIndex((s) => s.id === id);
    if (i === -1) return;
    const prev = store.sessions[i]!;
    const terminal = status === "confirmed" || status === "rejected" || status === "cancelled";
    store.sessions[i] = {
      ...prev,
      status,
      updated_at: now,
      ...(patch?.channel ? { channel: patch.channel } : {}),
      ...(terminal ? { completed_at: patch?.completed_at ?? now } : {}),
    };
  });
}

export function appendPaymentSessionMessage(
  sessionId: string,
  msg: PaymentSessionChatMessage,
): void {
  const now = new Date().toISOString();
  mutate((store) => {
    const i = store.sessions.findIndex((s) => s.id === sessionId);
    if (i === -1) return;
    const prev = store.sessions[i]!;
    const messages = [...prev.messages, msg].slice(-MAX_MESSAGES);
    store.sessions[i] = { ...prev, messages, updated_at: now };
  });
}

export function cancelActivePaymentSessionLogsForChat(tgChatId: number, exceptId: string): void {
  const now = new Date().toISOString();
  mutate((store) => {
    for (let i = 0; i < store.sessions.length; i++) {
      const s = store.sessions[i]!;
      if (s.id === exceptId || s.tg_chat_id !== tgChatId) continue;
      // Только awaiting_proof: pending_admin — уже отправленные чеки, их нельзя сбрасывать.
      if (s.status !== "awaiting_proof") continue;
      store.sessions[i] = {
        ...s,
        status: "cancelled",
        updated_at: now,
        completed_at: now,
        messages: [
          ...s.messages,
          {
            at: now,
            direction: "bot" as const,
            text: "Сессия прервана: пользователь начал новую оплату.",
          },
        ].slice(-MAX_MESSAGES),
      };
    }
  });
}

export function getPaymentSessionLog(id: string): PaymentSessionLogRow | undefined {
  return readFile().sessions.find((s) => s.id === id);
}

export function findActivePaymentSessionLogByChat(tgChatId: number): PaymentSessionLogRow | undefined {
  return readFile().sessions.find(
    (s) =>
      s.tg_chat_id === tgChatId &&
      (s.status === "awaiting_proof" || s.status === "pending_admin"),
  );
}

export type PaymentSessionLogFilter = {
  from?: string;
  to?: string;
  status?: string;
};

function paymentSessionLogMatchesFilter(s: PaymentSessionLogRow, opts?: PaymentSessionLogFilter): boolean {
  const fromMs = opts?.from ? Date.parse(`${opts.from}T00:00:00.000Z`) : NaN;
  const toMs = opts?.to ? Date.parse(`${opts.to}T23:59:59.999Z`) : NaN;
  const statusFilter = String(opts?.status ?? "all").trim();
  if (statusFilter !== "all" && s.status !== statusFilter) return false;
  const ts = Date.parse(s.updated_at);
  if (Number.isFinite(fromMs) && ts < fromMs) return false;
  if (Number.isFinite(toMs) && ts > toMs) return false;
  return true;
}

export function listPaymentSessionLogs(opts?: PaymentSessionLogFilter & { limit?: number }): PaymentSessionLogRow[] {
  const limit = Math.max(1, Math.min(5000, Math.floor(Number(opts?.limit) || 300)));

  return readFile()
    .sessions.filter((s) => paymentSessionLogMatchesFilter(s, opts))
    .slice(0, limit);
}

export function deletePaymentSessionLogsMatching(opts?: PaymentSessionLogFilter): PaymentSessionLogRow[] {
  const removed: PaymentSessionLogRow[] = [];
  mutate((store) => {
    store.sessions = store.sessions.filter((s) => {
      if (!paymentSessionLogMatchesFilter(s, opts)) return true;
      removed.push(s);
      return false;
    });
  });
  return removed;
}

export function deletePaymentSessionLogById(id: string): PaymentSessionLogRow | undefined {
  const key = String(id ?? "").trim();
  if (!key) return undefined;
  let removed: PaymentSessionLogRow | undefined;
  mutate((store) => {
    const i = store.sessions.findIndex((s) => s.id === key);
    if (i === -1) return;
    removed = store.sessions[i];
    store.sessions.splice(i, 1);
  });
  return removed;
}
