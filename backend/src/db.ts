import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import {
  defaultRealityFlow,
  defaultRealitySni,
  normalizeFlow,
  randomRealityShortId,
} from "./realityKeygen.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

export type CreateUserInput = {
  name?: string;
  email?: string;
  vless_uuid?: string;
  sub_token?: string;
  flow?: string;
  total_gb?: number;
  expiry_time?: number;
  enable?: number;
  tg_id?: string;
  comment?: string;
  traffic_up?: number;
  traffic_down?: number;
  remote_port?: number | null;
  reality_pbk?: string;
  reality_fp?: string;
  reality_sni?: string;
  reality_sid?: string;
  reality_spx?: string;
  /** 0 = все развёрнутые серверы в подписке; иначе только первые N по порядку id. */
  subscription_server_count?: number;
  /** Служебные поля синхронизации с Xray (не задавать из формы клиента). */
  online_snapshot?: number;
  stats_synced_at?: number;
  /** Последний «сырой» снимок счётчиков Xray (для корректного инкремента после рестартов). */
  stats_raw_up?: number;
  stats_raw_down?: number;
  /** legacy = старый plain/tls; reality = использовать Reality-профиль в ссылках. */
  connection_profile?: "legacy" | "reality";
};

export type UserRow = {
  id: number;
  name: string;
  email: string;
  vless_uuid: string;
  sub_token: string;
  flow: string;
  total_gb: number;
  expiry_time: number;
  enable: number;
  tg_id: string;
  comment: string;
  traffic_up: number;
  traffic_down: number;
  remote_port: number | null;
  reality_pbk: string;
  reality_fp: string;
  reality_sni: string;
  reality_sid: string;
  reality_spx: string;
  subscription_server_count: number;
  /** 1 = при последнем опросе Xray сообщал online>0 для этого UUID. */
  online_snapshot: number;
  /** Время последнего успешного sync трафика с узлов (ms). */
  stats_synced_at: number;
  /** Последний «сырой» снимок uplink/downlink из Xray; -1 = ещё не инициализировано. */
  stats_raw_up: number;
  stats_raw_down: number;
  connection_profile: "legacy" | "reality";
  created_at: string;
  updated_at: string;
};

export type PaymentPlanId = 1 | 2 | 3;

export type PaymentSessionRow = {
  id: string;
  tg_chat_id: number;
  tg_user_id: number;
  plan_id: PaymentPlanId;
  created_at: string;
  status: "awaiting_proof" | "pending_admin";
  proof_file_id?: string;
  /** Снимок из Telegram при выборе тарифа — для имени клиента в панели. */
  tg_username?: string;
  tg_first_name?: string;
};

export type SubscriptionShopPlanRow = {
  id: PaymentPlanId;
  title: string;
  total_gb: number;
  days: number;
  price_rub: number;
};

/** Магазин в боте: цены, ссылка на оплату, отключение продажи новым клиентам. */
export type SubscriptionShopConfig = {
  sales_disabled: boolean;
  /** Пусто — взять из TELEGRAM_PAYMENT_URL / дефолт. */
  payment_url: string;
  plans: SubscriptionShopPlanRow[];
};

export type ServerRow = {
  id: number;
  name: string;
  /** ISO 3166-1 alpha-2 (NL, DE, …) — для флага в подписке; пусто = без флага. */
  country_code: string;
  host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_password_enc: string;
  vless_port: number;
  vless_uuid: string | null;
  xray_config_path: string | null;
  /** Снимок транспорта inbound tzadmin-vless для корректной подписки (заполняется при деплое). */
  sub_port: number;
  sub_network: string;
  sub_security: string;
  sub_type: string;
  sub_host: string;
  sub_path: string;
  sub_sni: string;
  sub_fp: string;
  sub_alpn: string;
  sub_allow_insecure: number;
  sub_reality_pbk: string;
  sub_reality_sid: string;
  sub_reality_spx: string;
  vless_deployed: number;
  last_ssh_ok: number;
  last_error: string | null;
  updated_at: string;
};

type FileStore = {
  subscription_token: string | null;
  next_server_id: number;
  next_user_id: number;
  servers: ServerRow[];
  users: UserRow[];
  payment_sessions: PaymentSessionRow[];
  subscription_shop: SubscriptionShopConfig;
};

function defaultSubscriptionShop(): SubscriptionShopConfig {
  return {
    sales_disabled: false,
    payment_url: "",
    plans: [
      { id: 1, title: "Трафик 100 ГБ/мес, 30 дней", total_gb: 100, days: 30, price_rub: 90 },
      { id: 2, title: "Трафик 250 ГБ/мес, 30 дней", total_gb: 250, days: 30, price_rub: 115 },
      { id: 3, title: "Трафик безлимит, 30 дней", total_gb: 0, days: 30, price_rub: 155 },
    ],
  };
}

function emptyStore(): FileStore {
  return {
    subscription_token: null,
    next_server_id: 1,
    next_user_id: 1,
    servers: [],
    users: [],
    payment_sessions: [],
    subscription_shop: defaultSubscriptionShop(),
  };
}

export function normalizeSubscriptionShop(raw: unknown): SubscriptionShopConfig {
  const base = defaultSubscriptionShop();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const sales_disabled = o.sales_disabled === true || o.sales_disabled === 1 || o.sales_disabled === "1";
  const payment_url = String(o.payment_url ?? "").trim();
  const plansIn = Array.isArray(o.plans) ? o.plans : [];
  const byId = new Map<PaymentPlanId, SubscriptionShopPlanRow>();
  for (const p of base.plans) byId.set(p.id, { ...p });
  for (const rawPlan of plansIn) {
    if (!rawPlan || typeof rawPlan !== "object") continue;
    const pl = rawPlan as Record<string, unknown>;
    const id = Number(pl.id) as PaymentPlanId;
    if (id !== 1 && id !== 2 && id !== 3) continue;
    const cur = byId.get(id)!;
    const title = pl.title != null ? String(pl.title).trim() : cur.title;
    const total_gb = pl.total_gb != null ? Math.max(0, Math.floor(Number(pl.total_gb))) : cur.total_gb;
    const days = pl.days != null ? Math.max(1, Math.floor(Number(pl.days))) : cur.days;
    const price_rub = pl.price_rub != null ? Math.max(0, Math.floor(Number(pl.price_rub))) : cur.price_rub;
    byId.set(id, {
      id,
      title: title || cur.title,
      total_gb,
      days,
      price_rub: Number.isFinite(price_rub) ? price_rub : cur.price_rub,
    });
  }
  return {
    sales_disabled,
    payment_url,
    plans: ([1, 2, 3] as const).map((id) => byId.get(id)!),
  };
}

function normalizePaymentSession(raw: unknown): PaymentSessionRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? "").trim();
  const plan = Number(o.plan_id);
  if (!id || ![1, 2, 3].includes(plan)) return null;
  const chat = Number(o.tg_chat_id);
  const usr = Number(o.tg_user_id);
  if (!Number.isFinite(chat) || !Number.isFinite(usr)) return null;
  const st = o.status === "pending_admin" ? "pending_admin" : "awaiting_proof";
  return {
    id,
    tg_chat_id: chat,
    tg_user_id: usr,
    plan_id: plan as PaymentPlanId,
    created_at: String(o.created_at ?? new Date().toISOString()),
    status: st,
    proof_file_id: o.proof_file_id != null ? String(o.proof_file_id) : undefined,
    tg_username: o.tg_username != null ? String(o.tg_username).trim() : undefined,
    tg_first_name: o.tg_first_name != null ? String(o.tg_first_name).trim() : undefined,
  };
}

function normalizeCountryCode(raw: unknown): string {
  const t = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return t.length === 2 ? t : "";
}

export function normalizeServer(s: ServerRow): ServerRow {
  const host = (s.host ?? "").trim() || "0.0.0.0";
  const name = (s.name ?? "").trim() || host;
  return {
    ...s,
    host,
    name,
    country_code: normalizeCountryCode(s.country_code),
    xray_config_path: s.xray_config_path ?? null,
    sub_port: Number(s.sub_port) > 0 ? Number(s.sub_port) : Number(s.vless_port) || 0,
    sub_network: String(s.sub_network ?? "").trim(),
    sub_security: String(s.sub_security ?? "").trim().toLowerCase(),
    sub_type: String(s.sub_type ?? "").trim(),
    sub_host: String(s.sub_host ?? "").trim(),
    sub_path: String(s.sub_path ?? "").trim(),
    sub_sni: String(s.sub_sni ?? "").trim(),
    sub_fp: String(s.sub_fp ?? "").trim(),
    sub_alpn: String(s.sub_alpn ?? "").trim(),
    sub_allow_insecure: s.sub_allow_insecure === 1 ? 1 : 0,
    sub_reality_pbk: String(s.sub_reality_pbk ?? "").trim(),
    sub_reality_sid: String(s.sub_reality_sid ?? "").trim(),
    sub_reality_spx: String(s.sub_reality_spx ?? "").trim() || "/",
  };
}

const BYTES_PER_GB = 1073741824;
/** Значения ниже ~1e10 считаем Unix seconds (x-ui и старые импорты), иначе — миллисекунды. */
const MAX_UNIX_SECONDS_AS_MS_THRESHOLD = 10_000_000_000;

/**
 * Окончание в 12:00:00 по **локальному времени сервера** на календарный день из `ms`.
 * Часовой пояс сервера и браузера админки лучше совместить (например `TZ=Europe/Moscow` в Docker/systemd).
 */
export function snapExpiryTimeToNoonLocal(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/** Приводит срок к миллисекундам для сравнения с Date.now(); время — полдень выбранного дня. */
export function coerceExpiryTimeMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ms = n < MAX_UNIX_SECONDS_AS_MS_THRESHOLD ? Math.round(n * 1000) : Math.round(n);
  return snapExpiryTimeToNoonLocal(ms);
}

/** Лимит в ГБ; если в поле попали байты (импорт), переводим в ГБ. */
function coerceTotalGbField(raw: unknown): number {
  let gb = Number(raw);
  if (!Number.isFinite(gb) || gb < 0) return 0;
  if (gb > BYTES_PER_GB) gb = Math.max(1, Math.ceil(gb / BYTES_PER_GB));
  return gb;
}

function normalizeUser(u: UserRow): UserRow {
  const mode = String((u as { connection_profile?: unknown }).connection_profile ?? "legacy").toLowerCase();
  return {
    id: u.id,
    name: u.name ?? "user",
    email: u.email ?? u.name ?? "user",
    vless_uuid: u.vless_uuid,
    sub_token: String(u.sub_token ?? "").trim(),
    flow: normalizeFlow(u.flow ?? ""),
    total_gb: coerceTotalGbField(u.total_gb),
    expiry_time: coerceExpiryTimeMs(u.expiry_time),
    enable: u.enable === 0 ? 0 : 1,
    tg_id: u.tg_id ?? "",
    comment: u.comment ?? "",
    traffic_up: Number(u.traffic_up) || 0,
    traffic_down: Number(u.traffic_down) || 0,
    remote_port: u.remote_port != null && u.remote_port > 0 ? u.remote_port : null,
    reality_pbk: u.reality_pbk ?? "",
    reality_fp: u.reality_fp ?? "chrome",
    reality_sni: (u.reality_sni ?? "").trim() || defaultRealitySni(),
    reality_sid: u.reality_sid ?? "",
    reality_spx: u.reality_spx ?? "/",
    subscription_server_count: Math.max(0, Math.floor(Number(u.subscription_server_count) || 0)),
    online_snapshot: u.online_snapshot === 1 ? 1 : 0,
    stats_synced_at: Number.isFinite(Number(u.stats_synced_at))
      ? Math.max(0, Math.floor(Number(u.stats_synced_at)))
      : 0,
    stats_raw_up: Number.isFinite(Number(u.stats_raw_up)) ? Math.max(-1, Math.floor(Number(u.stats_raw_up))) : -1,
    stats_raw_down: Number.isFinite(Number(u.stats_raw_down))
      ? Math.max(-1, Math.floor(Number(u.stats_raw_down)))
      : -1,
    connection_profile: mode === "reality" ? "reality" : "legacy",
    created_at: u.created_at ?? new Date().toISOString(),
    updated_at: u.updated_at ?? u.created_at ?? new Date().toISOString(),
  };
}

function readStore(): FileStore {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw) as FileStore;
    if (!Array.isArray(parsed.servers)) return emptyStore();
    const users = Array.isArray(parsed.users) ? parsed.users.map((x) => normalizeUser(x as UserRow)) : [];
    const sessionsRaw = Array.isArray((parsed as { payment_sessions?: unknown }).payment_sessions)
      ? (parsed as { payment_sessions: unknown[] }).payment_sessions
      : [];
    const payment_sessions = sessionsRaw
      .map((x) => normalizePaymentSession(x))
      .filter((x): x is PaymentSessionRow => x != null);
    return {
      subscription_token: parsed.subscription_token ?? null,
      next_server_id: Number(parsed.next_server_id) > 0 ? Number(parsed.next_server_id) : 1,
      next_user_id: Number(parsed.next_user_id) > 0 ? Number(parsed.next_user_id) : 1,
      servers: parsed.servers.map((x) => normalizeServer(x as ServerRow)),
      users,
      payment_sessions,
      subscription_shop: normalizeSubscriptionShop(
        (parsed as { subscription_shop?: unknown }).subscription_shop,
      ),
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: FileStore): void {
  const dir = path.dirname(dataPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(store, null, 2), "utf8");
}

function mutate(fn: (store: FileStore) => void): void {
  const store = readStore();
  fn(store);
  writeStore(store);
}

export function listServersOrdered(): ServerRow[] {
  return [...readStore().servers].sort((a, b) => a.id - b.id);
}

export function listDeployedServers(): ServerRow[] {
  return listServersOrdered().filter((r) => r.vless_deployed === 1 && r.vless_uuid != null);
}

/** Узлы в подписке: 0 или больше числа развёрнутых — все; иначе первые N по порядку id. */
export function serversForUserSubscription(user: UserRow): ServerRow[] {
  const rows = listDeployedServers();
  const lim = Math.floor(Number(user.subscription_server_count) || 0);
  if (lim <= 0 || rows.length === 0 || lim >= rows.length) return rows;
  return rows.slice(0, lim);
}

/**
 * Как в 3x-ui: один Reality-inbound — pbk/sni/sid общие. Подписка подставляет их из карточки
 * пользователя в sub_* сервера, если SSH так и не вытащил ключ из JSON.
 */
export function backfillDeployedServerRealityFromUser(user: UserRow): void {
  const pbk = (user.reality_pbk ?? "").trim();
  const sid = (user.reality_sid ?? "").trim();
  const sni = (user.reality_sni ?? "").trim();
  const fp = (user.reality_fp ?? "").trim();
  const spx = (user.reality_spx ?? "").trim();
  if (!pbk && !sid && !sni && !fp) return;

  for (const r of serversForUserSubscription(user)) {
    if (String(r.sub_security ?? "").trim().toLowerCase() !== "reality") continue;
    const patch: Partial<ServerRow> = {};
    if (pbk && !String(r.sub_reality_pbk ?? "").trim()) patch.sub_reality_pbk = pbk;
    if (sid && !String(r.sub_reality_sid ?? "").trim()) patch.sub_reality_sid = sid;
    if (sni && !String(r.sub_sni ?? "").trim()) patch.sub_sni = sni;
    if (fp && !String(r.sub_fp ?? "").trim()) patch.sub_fp = fp;
    if (spx && spx !== "/" && !String(r.sub_reality_spx ?? "").trim()) patch.sub_reality_spx = spx;
    if (Object.keys(patch).length > 0) updateServer(r.id, patch);
  }
}

export function getServer(id: number): ServerRow | undefined {
  return readStore().servers.find((s) => s.id === id);
}

export function createServer(row: Omit<ServerRow, "id" | "updated_at">): number {
  let newId = 0;
  mutate((store) => {
    newId = store.next_server_id++;
    store.servers.push(
      normalizeServer({
        ...row,
        id: newId,
        updated_at: new Date().toISOString(),
      } as ServerRow),
    );
  });
  return newId;
}

export function deleteServer(id: number): void {
  mutate((store) => {
    store.servers = store.servers.filter((s) => s.id !== id);
  });
}

export function updateServer(id: number, patch: Partial<ServerRow>): void {
  mutate((store) => {
    const i = store.servers.findIndex((s) => s.id === id);
    if (i === -1) return;
    store.servers[i] = normalizeServer({
      ...store.servers[i],
      ...patch,
      id,
      updated_at: new Date().toISOString(),
    } as ServerRow);
  });
}

/** Подписка и синхронизация UUID на Xray только для «живых» клиентов. */
export function userAllowedOnServers(u: UserRow): boolean {
  if (u.enable === 0) return false;
  if (u.expiry_time > 0 && Date.now() > u.expiry_time) return false;
  if (u.total_gb > 0) {
    const limitBytes = u.total_gb * 1073741824;
    if (u.traffic_up + u.traffic_down >= limitBytes) return false;
  }
  return true;
}

export function listUsers(): UserRow[] {
  return [...readStore().users].sort((a, b) => a.id - b.id);
}

export function getUser(id: number): UserRow | undefined {
  return readStore().users.find((u) => u.id === id);
}

/** Клиенты, у которых в панели указан этот Telegram user id (кому выдали подписку). */
export function findUsersByTelegramChatId(chatId: number | string): UserRow[] {
  const key = String(chatId).trim();
  if (!key) return [];
  return listUsers().filter((u) => String(u.tg_id ?? "").trim() === key);
}

export function getUserBySubToken(token: string): UserRow | undefined {
  const t = token.trim();
  const users = readStore().users;
  const exact = users.find((u) => String(u.sub_token ?? "").trim() === t);
  if (exact) return exact;
  const lower = t.toLowerCase();
  return users.find((u) => String(u.sub_token ?? "").trim().toLowerCase() === lower);
}

export function findUserByVlessUuid(uuid: string): UserRow | undefined {
  return readStore().users.find((u) => u.vless_uuid === uuid);
}

/** Как x-ui subId: 16 символов [a-z0-9] — длинный hex ломал импорт подписки в части клиентов. */
function randomSubToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[buf[i]! % alphabet.length]!;
  }
  return out;
}

/** Как в x-ui при импорте. */
function subTokenImportOk(s: string): boolean {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(s);
}

/** Старый генератор: randomBytes(24).toString("hex") — клиенты подписки часто не принимают. */
function isLegacyAutoHexSubToken(s: string): boolean {
  return s.length === 48 && /^[0-9a-f]+$/i.test(s);
}

/** Параметры Reality с уже настроенного клиента (тот же inbound на сервере). */
function templateRealityFromPeers(users: UserRow[]): {
  reality_pbk: string;
  reality_fp: string;
  reality_sni: string;
  reality_sid: string;
  reality_spx: string;
  remote_port: number | null;
} | undefined {
  for (const u of users) {
    const pbk = (u.reality_pbk ?? "").trim();
    const sid = (u.reality_sid ?? "").trim();
    if (!pbk || !sid) continue;
    return {
      reality_pbk: pbk,
      reality_fp: (u.reality_fp ?? "").trim() || "chrome",
      reality_sni: (u.reality_sni ?? "").trim() || defaultRealitySni(),
      reality_sid: sid,
      reality_spx: (u.reality_spx ?? "").trim() || "/",
      remote_port: u.remote_port != null && u.remote_port > 0 ? u.remote_port : null,
    };
  }
  return undefined;
}

function templateRealityFromServers(servers: ServerRow[]): {
  reality_pbk: string;
  reality_fp: string;
  reality_sni: string;
  reality_sid: string;
  reality_spx: string;
  remote_port: number | null;
} | undefined {
  for (const s of servers) {
    if (String(s.sub_security ?? "").trim().toLowerCase() !== "reality") continue;
    const pbk = String(s.sub_reality_pbk ?? "").trim();
    const sid = String(s.sub_reality_sid ?? "").trim();
    const sni = String(s.sub_sni ?? "").trim();
    if (!pbk || !sid || !sni) continue;
    return {
      reality_pbk: pbk,
      reality_fp: String(s.sub_fp ?? "").trim() || "chrome",
      reality_sni: sni,
      reality_sid: sid,
      reality_spx: String(s.sub_reality_spx ?? "").trim() || "/",
      remote_port: Number(s.sub_port) > 0 ? Number(s.sub_port) : Number(s.vless_port) || null,
    };
  }
  return undefined;
}

export function createUser(input: CreateUserInput = {}): UserRow {
  const now = new Date().toISOString();
  let created: UserRow | undefined;
  mutate((store) => {
    const id = store.next_user_id++;
    let sub = (input.sub_token ?? "").trim();
    const dup = store.users.some((u) => u.sub_token === sub);
    if (!sub || !subTokenImportOk(sub) || isLegacyAutoHexSubToken(sub) || dup) {
      do {
        sub = randomSubToken();
      } while (store.users.some((u) => u.sub_token === sub));
    }
    const uuid = (input.vless_uuid ?? "").trim() || uuidv4();
    if (store.users.some((u) => u.vless_uuid === uuid)) {
      throw new Error("Пользователь с таким UUID уже есть.");
    }
    const name = (input.name ?? "").trim() || `user-${id}`;
    let remote_port: number | null =
      input.remote_port != null && Number(input.remote_port) > 0 ? Number(input.remote_port) : null;
    const requestedMode = String(input.connection_profile ?? "").toLowerCase();
    let connection_profile: "legacy" | "reality" = requestedMode === "reality" ? "reality" : "legacy";
    let reality_pbk = (input.reality_pbk ?? "").trim();
    let reality_fp = (input.reality_fp ?? "").trim() || "chrome";
    let reality_sni = (input.reality_sni ?? "").trim() || defaultRealitySni();
    let reality_sid = (input.reality_sid ?? "").trim() || randomRealityShortId();
    let reality_spx = (input.reality_spx ?? "").trim() || "/";
    if (!reality_pbk) {
      const tmpl = templateRealityFromServers(store.servers) ?? templateRealityFromPeers(store.users);
      if (tmpl) {
        reality_pbk = tmpl.reality_pbk;
        reality_fp = tmpl.reality_fp;
        reality_sni = tmpl.reality_sni;
        reality_sid = tmpl.reality_sid;
        reality_spx = tmpl.reality_spx;
        if (tmpl.remote_port != null) remote_port = tmpl.remote_port;
        if (requestedMode !== "legacy") connection_profile = "reality";
      }
    }
    if (connection_profile === "legacy" && (process.env.AUTO_REALITY_FOR_NEW_USERS ?? "0") === "1") {
      if (reality_pbk && reality_sid && reality_sni) connection_profile = "reality";
    }
    created = normalizeUser({
      id,
      name,
      email: (input.email ?? "").trim() || name,
      vless_uuid: uuid,
      sub_token: sub,
      flow: normalizeFlow(input.flow ?? "") || defaultRealityFlow(),
      total_gb: coerceTotalGbField(input.total_gb),
      expiry_time: coerceExpiryTimeMs(input.expiry_time),
      enable: input.enable === undefined ? 1 : input.enable === 0 ? 0 : 1,
      tg_id: (input.tg_id ?? "").trim(),
      comment: (input.comment ?? "").trim(),
      traffic_up: Number(input.traffic_up) || 0,
      traffic_down: Number(input.traffic_down) || 0,
      remote_port,
      reality_pbk,
      reality_fp,
      reality_sni,
      reality_sid,
      reality_spx,
      subscription_server_count: Math.max(0, Math.floor(Number(input.subscription_server_count) || 0)),
      online_snapshot: 0,
      stats_synced_at: 0,
      stats_raw_up: -1,
      stats_raw_down: -1,
      connection_profile,
      created_at: now,
      updated_at: now,
    });
    store.users.push(created);
  });
  return created!;
}

export function updateUserRow(id: number, patch: Partial<CreateUserInput>): UserRow | undefined {
  let out: UserRow | undefined;
  mutate((store) => {
    const i = store.users.findIndex((u) => u.id === id);
    if (i === -1) return;
    const cur = store.users[i];
    const merged: UserRow = normalizeUser({
      ...cur,
      name: patch.name !== undefined ? String(patch.name).trim() || cur.name : cur.name,
      email: patch.email !== undefined ? String(patch.email).trim() || cur.email : cur.email,
      flow:
        patch.flow !== undefined
          ? normalizeFlow(String(patch.flow)) || defaultRealityFlow()
          : normalizeFlow(cur.flow),
      total_gb: patch.total_gb !== undefined ? coerceTotalGbField(patch.total_gb) : cur.total_gb,
      expiry_time: patch.expiry_time !== undefined ? coerceExpiryTimeMs(patch.expiry_time) : cur.expiry_time,
      enable: patch.enable !== undefined ? (patch.enable === 0 ? 0 : 1) : cur.enable,
      tg_id: patch.tg_id !== undefined ? String(patch.tg_id).trim() : cur.tg_id,
      comment: patch.comment !== undefined ? String(patch.comment).trim() : cur.comment,
      traffic_up: patch.traffic_up !== undefined ? Number(patch.traffic_up) : cur.traffic_up,
      traffic_down: patch.traffic_down !== undefined ? Number(patch.traffic_down) : cur.traffic_down,
      remote_port:
        patch.remote_port !== undefined
          ? patch.remote_port != null && patch.remote_port > 0
            ? patch.remote_port
            : null
          : cur.remote_port,
      reality_pbk: patch.reality_pbk !== undefined ? String(patch.reality_pbk).trim() : cur.reality_pbk,
      reality_fp: patch.reality_fp !== undefined ? String(patch.reality_fp).trim() || "chrome" : cur.reality_fp,
      reality_sni:
        patch.reality_sni !== undefined
          ? String(patch.reality_sni).trim() || defaultRealitySni()
          : cur.reality_sni,
      reality_sid: patch.reality_sid !== undefined ? String(patch.reality_sid).trim() : cur.reality_sid,
      reality_spx: patch.reality_spx !== undefined ? String(patch.reality_spx).trim() || "/" : cur.reality_spx,
      subscription_server_count:
        patch.subscription_server_count !== undefined
          ? Math.max(0, Math.floor(Number(patch.subscription_server_count) || 0))
          : cur.subscription_server_count,
      updated_at: new Date().toISOString(),
    });
    store.users[i] = merged;
    out = merged;
  });
  return out;
}

/** Обновить трафик и снимок «онлайн» из агрегата по UUID (только для пользователей из списка). */
export function applyUsersTrafficSnapshot(
  rows: Array<{ vless_uuid: string; traffic_up: number; traffic_down: number; online: boolean }>,
  syncedAtMs: number,
): number {
  let n = 0;
  mutate((store) => {
    for (let i = 0; i < store.users.length; i++) {
      const u = store.users[i];
      const hit = rows.find((r) => r.vless_uuid === u.vless_uuid);
      if (!hit) continue;
      const candUp = Number.isFinite(Number(hit.traffic_up)) ? Math.max(0, Math.floor(Number(hit.traffic_up))) : u.traffic_up;
      const candDown = Number.isFinite(Number(hit.traffic_down))
        ? Math.max(0, Math.floor(Number(hit.traffic_down)))
        : u.traffic_down;
      const prevRawUp = Number.isFinite(Number(u.stats_raw_up)) ? Number(u.stats_raw_up) : -1;
      const prevRawDown = Number.isFinite(Number(u.stats_raw_down)) ? Number(u.stats_raw_down) : -1;
      const hasRawBaseline = prevRawUp >= 0 && prevRawDown >= 0;
      let up = u.traffic_up;
      let down = u.traffic_down;
      if (!hasRawBaseline) {
        // Первая инициализация baseline: прибавляем текущий raw-снимок как новый сессионный прирост.
        // Иначе первый заметный трафик после деплоя "теряется" до следующего цикла sync.
        up = Math.max(0, Math.floor(Number(u.traffic_up) || 0) + candUp);
        down = Math.max(0, Math.floor(Number(u.traffic_down) || 0) + candDown);
      } else {
        const addUp = candUp >= prevRawUp ? candUp - prevRawUp : candUp;
        const addDown = candDown >= prevRawDown ? candDown - prevRawDown : candDown;
        up = Math.max(0, Math.floor(Number(u.traffic_up) || 0) + Math.max(0, addUp));
        down = Math.max(0, Math.floor(Number(u.traffic_down) || 0) + Math.max(0, addDown));
      }
      store.users[i] = normalizeUser({
        ...u,
        traffic_up: up,
        traffic_down: down,
        online_snapshot: hit.online ? 1 : 0,
        stats_synced_at: syncedAtMs,
        stats_raw_up: candUp,
        stats_raw_down: candDown,
        updated_at: new Date().toISOString(),
      });
      n++;
    }
  });
  return n;
}

export function clientUuidsForServer(serverUuid: string | null): string[] {
  const u = new Set<string>();
  if (serverUuid) u.add(serverUuid);
  for (const row of readStore().users) {
    if (userAllowedOnServers(row)) u.add(row.vless_uuid);
  }
  return [...u];
}

export function deleteUser(id: number): UserRow | undefined {
  let removed: UserRow | undefined;
  mutate((store) => {
    const i = store.users.findIndex((u) => u.id === id);
    if (i === -1) return;
    removed = store.users[i];
    store.users.splice(i, 1);
  });
  return removed;
}

function repairBrokenSubTokens(): void {
  const store = readStore();
  const used = new Set(store.users.map((u) => u.sub_token));
  let changed = false;
  for (let i = 0; i < store.users.length; i++) {
    if (!isLegacyAutoHexSubToken(store.users[i].sub_token)) continue;
    let sub: string;
    do {
      sub = randomSubToken();
    } while (used.has(sub));
    used.add(sub);
    store.users[i] = normalizeUser({
      ...store.users[i],
      sub_token: sub,
      updated_at: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) writeStore(store);
}

/** У клиентов без Reality подставить параметры с «эталонного» пользователя (один inbound). */
function repairUsersRealityFromPeers(): void {
  const store = readStore();
  const tmpl = templateRealityFromPeers(store.users);
  if (!tmpl) return;
  let changed = false;
  for (let i = 0; i < store.users.length; i++) {
    const u = store.users[i];
    if ((u.reality_pbk ?? "").trim()) continue;
    store.users[i] = normalizeUser({
      ...u,
      reality_pbk: tmpl.reality_pbk,
      reality_fp: tmpl.reality_fp,
      reality_sni: tmpl.reality_sni,
      reality_sid: tmpl.reality_sid,
      reality_spx: tmpl.reality_spx,
      remote_port: tmpl.remote_port != null ? tmpl.remote_port : u.remote_port,
      updated_at: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) writeStore(store);
}

export function getPaymentSession(id: string): PaymentSessionRow | undefined {
  return readStore().payment_sessions.find((s) => s.id === id);
}

export function findAwaitingProofSessionByChat(tg_chat_id: number): PaymentSessionRow | undefined {
  return readStore().payment_sessions.find(
    (s) => s.tg_chat_id === tg_chat_id && s.status === "awaiting_proof",
  );
}

export function findPendingAdminSessionByChat(tg_chat_id: number): PaymentSessionRow | undefined {
  return readStore().payment_sessions.find(
    (s) => s.tg_chat_id === tg_chat_id && s.status === "pending_admin",
  );
}

/** Новая заявка: сбрасываем все незавершённые сессии этого чата. */
export function startPaymentAwaitingProof(
  tg_chat_id: number,
  tg_user_id: number,
  plan_id: PaymentPlanId,
  tgProfile?: { username?: string; first_name?: string },
): string {
  const id = randomBytes(8).toString("hex");
  const un = (tgProfile?.username ?? "").trim().replace(/^@/, "");
  const fn = (tgProfile?.first_name ?? "").trim();
  mutate((store) => {
    const prev = store.payment_sessions ?? [];
    store.payment_sessions = prev.filter((s) => s.tg_chat_id !== tg_chat_id);
    store.payment_sessions.push({
      id,
      tg_chat_id,
      tg_user_id,
      plan_id,
      created_at: new Date().toISOString(),
      status: "awaiting_proof",
      ...(un ? { tg_username: un } : {}),
      ...(fn ? { tg_first_name: fn } : {}),
    });
  });
  return id;
}

export function markPaymentSessionPendingAdmin(sessionId: string, proof_file_id: string): boolean {
  let ok = false;
  mutate((store) => {
    const rows = store.payment_sessions ?? [];
    const i = rows.findIndex((s) => s.id === sessionId && s.status === "awaiting_proof");
    if (i === -1) return;
    rows[i] = { ...rows[i]!, status: "pending_admin", proof_file_id };
    ok = true;
  });
  return ok;
}

export function deletePaymentSession(sessionId: string): void {
  mutate((store) => {
    store.payment_sessions = (store.payment_sessions ?? []).filter((s) => s.id !== sessionId);
  });
}

export function getSubscriptionShop(): SubscriptionShopConfig {
  return normalizeSubscriptionShop(readStore().subscription_shop);
}

export function setSubscriptionShop(config: SubscriptionShopConfig): void {
  mutate((store) => {
    store.subscription_shop = normalizeSubscriptionShop(config);
  });
}

export function initDb(): void {
  if (!fs.existsSync(dataPath)) {
    writeStore(emptyStore());
    return;
  }
  repairBrokenSubTokens();
  repairUsersRealityFromPeers();
}
