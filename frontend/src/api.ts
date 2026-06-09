import type { PanelSettings, PanelSettingsResponse } from "./panelSettingsTypes";

const jsonHeaders = { "Content-Type": "application/json" };

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function authMe(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  return handle(res);
}

export type LoginStepOneResponse = { ok: true } | { ok: false; requires_code: true };

export async function login(username: string, password: string): Promise<LoginStepOneResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ username, password }),
  });
  return handle(res);
}

export async function loginVerifyCode(code: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/auth/login/verify", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ code }),
  });
  return handle(res);
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
}

export type ServerDto = {
  id: number;
  name: string;
  country_code: string;
  /** Флаг-emoji с бэкенда (дублирует country_code). */
  country_flag: string;
  host: string;
  ssh_port: number;
  ssh_user: string;
  vless_port: number;
  vless_uuid: string | null;
  xray_config_path: string | null;
  /** Снимок streamSettings inbound после деплоя — для корректной подписки. */
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
  sub_port?: number;
  subscription_settings?: ServerSubscriptionSettingsDto;
  subscription_settings_custom?: boolean;
  vless_deployed: boolean;
  experimental_only?: boolean;
  last_ssh_ok: boolean;
  last_error: string | null;
  updated_at: string;
  /** У всех клиентов этот узел в subscription_server_ids. */
  in_all_subscriptions?: boolean;
  subscription_users_total?: number;
  subscription_users_missing?: number;
};

export async function addServerToAllSubscriptions(
  id: number,
): Promise<{ ok: boolean; updated_users: number; server: ServerDto }> {
  const res = await fetch(`/api/servers/${id}/add-to-all-subscriptions`, {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export async function listServers(): Promise<ServerDto[]> {
  const res = await fetch("/api/servers", { credentials: "include" });
  return handle(res);
}

export async function addServer(body: {
  name?: string;
  country_code?: string;
  host: string;
  ssh_user: string;
  ssh_password: string;
  ssh_port?: number;
  vless_port?: number;
}): Promise<{ id: number }> {
  const res = await fetch("/api/servers", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function patchServer(
  id: number,
  body: { name?: string; country_code?: string; experimental_only?: boolean },
): Promise<{ server: ServerDto }> {
  const res = await fetch(`/api/servers/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function deleteServer(id: number): Promise<void> {
  const res = await fetch(`/api/servers/${id}`, { method: "DELETE", credentials: "include" });
  await handle(res);
}

export type ServerSubscriptionSettingsVlessDto = {
  flow: "" | "xtls-rprx-vision";
  encryption: string;
  auth_mode: "" | "x25519" | "ml-kem-768";
  decrypt_value: string;
  encrypt_value: string;
};

export type ServerSubscriptionSettingsDto = {
  address_mode: "host" | "custom";
  address_override: string;
  vless_port: number;
  remarks: string;
  flow: "" | "xtls-rprx-vision";
  network: "tcp" | "grpc" | "ws" | "xhttp";
  security: "reality" | "tls" | "none";
  encryption: string;
  vless: ServerSubscriptionSettingsVlessDto;
  reality: {
    public_key: string;
    private_key: string;
    server_name: string;
    short_id: string;
    spider_x: string;
    fingerprint: string;
    allow_insecure: boolean;
    show: boolean;
  };
  tcp: { header_type: string };
  grpc: { service_name: string; authority: string; mode: boolean };
  ws: { path: string; host: string };
  mux: {
    enabled: boolean;
    concurrency: number;
    xudp_concurrency: number;
    xudp_proxy_udp443: string;
  };
  dns: {
    query_strategy: "UseIP" | "UseIPv4" | "UseIPv6" | "UseIPv4v6";
    servers: string[];
  };
  sniffing: {
    enabled: boolean;
    dest_override: ("http" | "tls" | "quic")[];
  };
};

export async function loadServerSubscriptionSettings(id: number): Promise<{
  settings: ServerSubscriptionSettingsDto;
  custom: boolean;
  server: ServerDto;
}> {
  const res = await fetch(`/api/servers/${id}/subscription-settings`, { credentials: "include" });
  return handle(res);
}

export async function saveServerSubscriptionSettings(
  id: number,
  settings: ServerSubscriptionSettingsDto,
): Promise<{
  ok: boolean;
  settings: ServerSubscriptionSettingsDto;
  server: ServerDto;
  server_apply?: {
    ok: boolean;
    detail: string;
    applied_port?: number;
    pushed?: string[];
    firewall?: {
      opened: boolean;
      detail: string;
      manual_command?: string | null;
      cloud_security_group_hint?: string | null;
    };
  };
}> {
  const res = await fetch(`/api/servers/${id}/subscription-settings`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ settings }),
  });
  return handle(res);
}

export async function resetServerSubscriptionSettings(id: number): Promise<{
  ok: boolean;
  settings: ServerSubscriptionSettingsDto;
  server: ServerDto;
}> {
  const res = await fetch(`/api/servers/${id}/subscription-settings/reset`, {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export async function syncServerSubscriptionSettings(id: number): Promise<{
  ok: boolean;
  settings: ServerSubscriptionSettingsDto;
  server: ServerDto;
}> {
  const res = await fetch(`/api/servers/${id}/subscription-settings/sync-from-server`, {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export type SubscriptionCheckItemDto = {
  level: "ok" | "warn" | "err";
  text: string;
  field?: string;
};

export async function previewServerSubscriptionSettings(
  id: number,
  settings: ServerSubscriptionSettingsDto,
  userId?: number,
): Promise<{
  summary: Record<string, unknown>;
  json: Record<string, unknown>;
  vless_uri: string;
  checklist: SubscriptionCheckItemDto[];
  outcome: string[];
}> {
  const res = await fetch(`/api/servers/${id}/subscription-settings/preview`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ settings, user_id: userId }),
  });
  return handle(res);
}

export async function checkServerSubscriptionSettings(
  id: number,
  settings: ServerSubscriptionSettingsDto,
): Promise<{
  ok: boolean;
  checklist: SubscriptionCheckItemDto[];
  outcome: string[];
  validation_errors: { field: string; message: string }[];
}> {
  const res = await fetch(`/api/servers/${id}/subscription-settings/check`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ settings }),
  });
  return handle(res);
}

export async function fetchSubscriptionSettingGenerators(): Promise<{
  short_id: string;
  spider_x: string;
  public_key: string;
  private_key: string;
}> {
  const res = await fetch("/api/servers/subscription-settings/generators", { credentials: "include" });
  return handle(res);
}

export async function fetchVlessAuthGenerator(
  serverId: number,
  mode: "x25519" | "ml-kem-768",
): Promise<{
  auth_mode: "x25519" | "ml-kem-768";
  encrypt_value: string;
  decrypt_value: string;
  encryption: string;
}> {
  const res = await fetch(`/api/servers/${serverId}/subscription-settings/generators/vless-auth`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ mode }),
  });
  return handle(res);
}

export const SUBSCRIPTION_FLOWS = ["", "xtls-rprx-vision"] as const;

export const SUBSCRIPTION_FINGERPRINTS = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
  "randomized",
  "randomizednoalpn",
  "unsafe",
] as const;

export const SUBSCRIPTION_SNI_PRESETS = [
  "www.oracle.com",
  "www.microsoft.com",
  "www.apple.com",
  "www.nvidia.com",
  "www.cloudflare.com",
  "custom",
] as const;

export type NdjsonEvent =
  | { type: "log"; msg: string; t?: number }
  | {
      type: "done";
      ok?: boolean;
      detail?: string;
      uuid?: string;
      configPath?: string;
      user?: UserDto;
      hints?: {
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
      };
    }
  | { type: "error"; message: string };

export async function postNdjsonStream(
  url: string,
  onEvent: (ev: NdjsonEvent) => void,
  init?: RequestInit,
): Promise<void> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    method: init?.method ?? "POST",
    headers: { Accept: "application/x-ndjson", ...init?.headers },
  });
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    buf += dec.decode(value ?? new Uint8Array(), { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as NdjsonEvent;
      onEvent(ev);
    }
    if (done) break;
  }
}

export async function testServerStream(id: number, onEvent: (ev: NdjsonEvent) => void): Promise<void> {
  await postNdjsonStream(`/api/servers/${id}/test?stream=1`, onEvent, { method: "POST" });
}

export async function installXrayStream(id: number, onEvent: (ev: NdjsonEvent) => void): Promise<void> {
  await postNdjsonStream(`/api/servers/${id}/install-xray?stream=1`, onEvent, { method: "POST" });
}

export async function deployVlessStream(id: number, onEvent: (ev: NdjsonEvent) => void): Promise<void> {
  await postNdjsonStream(`/api/servers/${id}/deploy-vless?stream=1`, onEvent, { method: "POST" });
}

export type UserDto = {
  id: number;
  name: string;
  email: string;
  vless_uuid: string;
  sub_token: string;
  subscription_url: string;
  flow: string;
  total_gb: number;
  expiry_time: number;
  enable: boolean;
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
  /** 0 = все развёрнутые серверы в подписке (legacy) */
  subscription_server_count: number;
  /** Id серверов в подписке (явный выбор). */
  subscription_server_ids: number[];
  /** Включено ли ограничение устройств для подписки. */
  device_limit_enabled: boolean;
  /** Максимум устройств при включенном ограничении. */
  device_limit_count: number;
  /** Лимит скорости, Мбит/с; 0 = без ограничения. */
  speed_limit_mbps: number;
  /** К подписке дописываются последние 4 узла + happ (белые списки). По умолчанию выкл. */
  whitelist_happ_enabled: boolean;
  /** Оплаченный продукт «белые списки» (не ручное назначение). */
  whitelist_purchased?: boolean;
  whitelist_active_until?: number;
  whitelist_purchase_id?: string;
  /** Активность по данным Xray (обновляется при опросе узлов). */
  online: boolean;
  /** Число текущих подключенных устройств (по последнему опросу узлов). */
  online_devices: number;
  /** Unix ms последнего sync трафика с узлов. */
  stats_synced_at: number;
  /** Билеты «Дроппер»; при одинаковом tg_id сумма по записям — общий пул в WebApp. */
  dropper_tickets: number;
  /** Победы в дроппере: при том же tg_id — общее число для Telegram; иначе по строке подписки. */
  dropper_wins: number;
  extra_vless_links: ExtraVlessLinkDto[];
  created_at: string;
  updated_at: string;
};

export type ExtraVlessLinkDto = {
  id: string;
  uri: string;
  label: string;
};

export type CreateUserPayload = {
  name?: string;
  email?: string;
  vless_uuid?: string;
  sub_token?: string;
  flow?: string;
  total_gb?: number;
  expiry_time?: number;
  enable?: boolean;
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
  subscription_server_count?: number;
  subscription_server_ids?: number[];
  device_limit_enabled?: boolean;
  device_limit_count?: number;
  speed_limit_mbps?: number;
  whitelist_happ_enabled?: boolean;
  extra_vless_links?: ExtraVlessLinkDto[];
};

function bodyFromPayload(p: CreateUserPayload): Record<string, unknown> {
  return compactPatch(p);
}

export async function listUsers(): Promise<UserDto[]> {
  const res = await fetch("/api/users", { credentials: "include" });
  return handle(res);
}

export async function createUser(payload: CreateUserPayload): Promise<{ user: UserDto }> {
  const res = await fetch("/api/users", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(bodyFromPayload(payload)),
  });
  return handle(res);
}

export async function createUserStream(payload: CreateUserPayload, onEvent: (ev: NdjsonEvent) => void): Promise<void> {
  await postNdjsonStream("/api/users?stream=1", onEvent, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(bodyFromPayload(payload)),
  });
}

function compactPatch(p: Partial<CreateUserPayload>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (k === "enable") out[k] = v ? 1 : 0;
    else if (k === "device_limit_enabled") out[k] = v ? 1 : 0;
    else if (k === "whitelist_happ_enabled") out[k] = v ? 1 : 0;
    else out[k] = v;
  }
  return out;
}

export async function patchUser(id: number, payload: Partial<CreateUserPayload>): Promise<{ user: UserDto }> {
  const res = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(compactPatch(payload)),
  });
  return handle(res);
}

export async function fetchRealityKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const res = await fetch("/api/users/reality-key", { method: "POST", credentials: "include" });
  return handle(res);
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}`, { method: "DELETE", credentials: "include" });
  await handle(res);
}

export async function bulkDeleteInactiveUsers(body: {
  user_ids: number[];
  send_message?: boolean;
  message?: string;
}): Promise<{
  ok: boolean;
  attempted: number;
  deleted: number;
  notified: number;
  delete_failures: Array<{ user_id: number; user_name: string; error: string }>;
  notify_failures: Array<{ user_id: number; user_name: string; error: string }>;
}> {
  const res = await fetch("/api/users/bulk-delete-inactive", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function userPreview(id: number): Promise<{ count: number; links: string[] }> {
  const res = await fetch(`/api/users/${id}/preview`, { credentials: "include" });
  return handle(res);
}

export async function notifyUserExpiring(
  id: number,
  opts?: { tg_id?: string; expiry_time?: number },
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/users/${id}/notify-expiry`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(opts ?? {}),
  });
  return handle(res);
}

export async function notifyUserExpired(
  id: number,
  opts?: { tg_id?: string; expiry_time?: number },
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/users/${id}/notify-expired`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(opts ?? {}),
  });
  return handle(res);
}

export async function resetUserTraffic(id: number): Promise<{ ok: boolean; user: UserDto }> {
  const res = await fetch(`/api/users/${id}/reset-traffic`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({}),
  });
  return handle(res);
}

export type SubscriptionShopPlanDto = {
  id: number;
  title: string;
  total_gb: number;
  days: number;
  price_rub: number;
};

export type TopUpShopPlanDto = {
  id: number;
  title: string;
  add_gb: number;
  price_rub: number;
};

export type TestSubscriptionPlanDto = {
  enabled: boolean;
  title: string;
  total_gb: number;
  days: number;
  price_rub: number;
};

export type SubscriptionShopDto = {
  sales_disabled: boolean;
  payment_url: string;
  plans: SubscriptionShopPlanDto[];
  topup_plans: TopUpShopPlanDto[];
  test_plan: TestSubscriptionPlanDto;
};

export type SubscriptionShopActivityEntry = { line: string; created_at: string };

export type TestSubscriptionEntryDto = {
  id: number;
  name: string;
  tg_id: string;
  line: string;
  created_at: string;
  expiry_time: number;
};

export async function loadTestSubscriptions(): Promise<{ entries: TestSubscriptionEntryDto[] }> {
  const res = await fetch("/api/subscription-shop/test-subscriptions", { credentials: "include" });
  return handle(res);
}

export async function deleteTestSubscription(userId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/subscription-shop/test-subscriptions/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handle(res);
}

export async function loadSubscriptionShop(): Promise<SubscriptionShopDto> {
  const res = await fetch("/api/subscription-shop", { credentials: "include" });
  return handle(res);
}

export async function loadSubscriptionShopActivity(): Promise<{
  subscriptions: SubscriptionShopActivityEntry[];
  topups: SubscriptionShopActivityEntry[];
}> {
  const res = await fetch("/api/subscription-shop/activity", { credentials: "include" });
  return handle(res);
}

export async function pushAllUserClients(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/users/push-all", { method: "POST", credentials: "include" });
  return handle(res);
}

export async function syncUserStatsFromServers(): Promise<{
  ok: boolean;
  updated: number;
  errors: string[];
  warns: string[];
  ms: number;
}> {
  const res = await fetch("/api/users/sync-stats", { method: "POST", credentials: "include" });
  return handle(res);
}

export async function saveSubscriptionShop(body: SubscriptionShopDto): Promise<SubscriptionShopDto> {
  const res = await fetch("/api/subscription-shop", {
    method: "PUT",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export type CommunicationTargetDto = {
  id: number;
  name: string;
  tg_id: string;
  enable: boolean;
  has_chat: boolean;
};

export async function listCommunicationTargets(): Promise<{ users: CommunicationTargetDto[] }> {
  const res = await fetch("/api/communications/targets", { credentials: "include" });
  return handle(res);
}

export type SendCommunicationPayload = {
  mode: "global" | "single" | "selected" | "segment";
  text: string;
  user_id?: number;
  user_ids?: number[];
  segment_id?: string;
  mark_enabled?: boolean;
  mark_text?: string;
  photo_base64?: string;
  photo_mime?: string;
  photo_name?: string;
  buttons?: Array<"pay" | "ref" | "sub" | "buygb" | "webapp">;
};

export type SendCommunicationResult = {
  ok: boolean;
  sent: number;
  attempted: number;
  failed: number;
  failures: Array<{ user_id: number; user_name: string; error: string }>;
};

export async function sendCommunication(payload: SendCommunicationPayload): Promise<SendCommunicationResult> {
  const res = await fetch("/api/communications/send", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export type CommunicationSegmentDto = {
  id: string;
  name: string;
  user_ids: number[];
  days_mode: "any" | "exact" | "range";
  days_exact?: number;
  days_from?: number;
  days_to?: number;
  gb_mode: "any" | "exact" | "range";
  gb_exact?: number;
  gb_from?: number;
  gb_to?: number;
  preset_enabled: boolean;
  preset_text: string;
  system_key?: string;
  created_at: string;
  updated_at: string;
};

export async function listCommunicationSegments(): Promise<{ segments: CommunicationSegmentDto[] }> {
  const res = await fetch("/api/communications/segments", { credentials: "include" });
  return handle(res);
}

export async function createCommunicationSegment(payload: Omit<CommunicationSegmentDto, "id" | "created_at" | "updated_at">): Promise<CommunicationSegmentDto> {
  const res = await fetch("/api/communications/segments", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function patchCommunicationSegment(
  id: string,
  payload: Omit<CommunicationSegmentDto, "id" | "created_at" | "updated_at">,
): Promise<CommunicationSegmentDto> {
  const res = await fetch(`/api/communications/segments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function deleteCommunicationSegment(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/communications/segments/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handle(res);
}

export async function refreshTestSubscriptionSegment(id: string): Promise<CommunicationSegmentDto> {
  const res = await fetch(`/api/communications/segments/${encodeURIComponent(id)}/refresh-test-subscriptions`, {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export type CommunicationMessageLogDto = {
  id: string;
  sent_at: string;
  automatic: boolean;
  source_label: string;
  mode?: "global" | "single" | "selected" | "segment";
  segment_id?: string;
  segment_name?: string;
  text: string;
  has_photo: boolean;
  recipients: Array<{ user_id: number; user_name: string }>;
  sent: number;
  attempted: number;
  failed: number;
};

export async function listCommunicationHistory(limit = 200): Promise<{ items: CommunicationMessageLogDto[] }> {
  const res = await fetch(`/api/communications/history?limit=${encodeURIComponent(String(limit))}`, {
    credentials: "include",
  });
  return handle(res);
}

export async function listCommunicationSegmentUsers(id: string): Promise<{ users: Array<{ id: number; name: string; tg_id: string }> }> {
  const res = await fetch(`/api/communications/segments/${encodeURIComponent(id)}/users`, { credentials: "include" });
  return handle(res);
}

export type SurveyMode = "global" | "single" | "selected" | "segment";

export type SurveyDto = {
  id: number;
  title: string;
  message_text: string;
  photo_path: string | null;
  allow_feedback: boolean;
  created_at: number;
  created_by: string;
  sent_at: number | null;
  status: "draft" | "sending" | "sent" | "failed" | "partially_failed" | "completed" | "archived";
  recipient_mode: SurveyMode;
  recipient_user_id?: number | null;
  recipient_user_ids?: number[];
  recipient_segment_id?: string | null;
  recipients_count: number;
  delivered_count: number;
  answered_count: number;
  send_ok?: number;
  send_failed?: number;
  stats?: {
    answered_count: number;
    average_rating: number | null;
    distribution: Record<number, number>;
  };
};

export type SurveyReportDto = {
  stats: NonNullable<SurveyDto["stats"]>;
  total_recipients: number;
  send_ok: number;
  send_failed: number;
  answered: number;
  response_rate: number;
  max_dist: number;
};

export type SurveyRecipientDto = {
  id: number;
  survey_id: number;
  user_id: number;
  telegram_chat_id: number;
  status: string;
  sent_at: number | null;
  error_message: string | null;
  user_name: string;
  telegram_username: string | null;
  phone: string | null;
  rating: number | null;
  feedback_text: string | null;
  rating_answered_at: number | null;
  feedback_answered_at: number | null;
};

export type SaveSurveyPayload = {
  id?: number;
  title: string;
  message_text: string;
  allow_feedback: boolean;
  mode: SurveyMode;
  user_id?: number;
  user_ids?: number[];
  segment_id?: string;
  photo_base64?: string;
  photo_mime?: string;
  photo_name?: string;
  clear_photo?: boolean;
  send?: boolean;
};

export async function listSurveys(): Promise<{ surveys: SurveyDto[] }> {
  const res = await fetch("/api/communications/surveys", { credentials: "include" });
  return handle(res);
}

export async function getSurveyDetail(id: number): Promise<{
  survey: SurveyDto;
  stats: SurveyDto["stats"];
  report: SurveyReportDto;
  recipients: SurveyRecipientDto[];
}> {
  const res = await fetch(`/api/communications/surveys/${id}`, { credentials: "include" });
  return handle(res);
}

export async function saveSurvey(payload: SaveSurveyPayload): Promise<{ survey: SurveyDto }> {
  const res = await fetch("/api/communications/surveys", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function sendSurvey(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/communications/surveys/${id}/send`, {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export async function deleteSurveyDraft(id: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/communications/surveys/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handle(res);
}

export async function archiveSurvey(id: number): Promise<{ ok: boolean; survey: SurveyDto }> {
  const res = await fetch(`/api/communications/surveys/${id}/archive`, {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export function surveyExportUrl(id: number): string {
  return `/api/communications/surveys/${id}/export.csv`;
}

export type PanelSettingsPatchPayload = {
  settings?: Partial<PanelSettings>;
  botToken?: string;
};

export async function fetchPanelSettings(): Promise<PanelSettingsResponse> {
  const res = await fetch("/api/settings", { credentials: "include" });
  return handle(res);
}

export async function patchPanelSettings(payload: PanelSettingsPatchPayload): Promise<PanelSettingsResponse> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function patchPanelSectionOrder(order: PanelSettings["sectionOrder"]): Promise<PanelSettingsResponse> {
  const res = await fetch("/api/settings/section-order", {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ order }),
  });
  return handle(res);
}

export async function uploadPanelAvatar(photo_base64: string, photo_mime: string): Promise<PanelSettingsResponse> {
  const res = await fetch("/api/settings/avatar", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ photo_base64, photo_mime }),
  });
  return handle(res);
}

export async function deletePanelAvatar(): Promise<PanelSettingsResponse> {
  const res = await fetch("/api/settings/avatar", { method: "DELETE", credentials: "include" });
  return handle(res);
}

export async function resetPanelSettings(): Promise<PanelSettingsResponse> {
  const res = await fetch("/api/settings/reset", { method: "POST", credentials: "include" });
  return handle(res);
}

export async function importPanelSettings(settings: PanelSettings): Promise<PanelSettingsResponse> {
  const res = await fetch("/api/settings/import", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ settings }),
  });
  return handle(res);
}

export async function testTelegramBot(botToken?: string): Promise<{ ok: boolean; username?: string; name?: string; message?: string; error?: string }> {
  const res = await fetch("/api/settings/telegram/test-bot", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(botToken ? { botToken } : {}),
  });
  return handle(res);
}

export async function testTelegramAdminMessage(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/settings/telegram/test-message", {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export async function fetchPanelSystemInfo(): Promise<Record<string, unknown>> {
  const res = await fetch("/api/settings/system", { credentials: "include" });
  return handle(res);
}

export function panelSettingsExportUrl(): string {
  return "/api/settings/export";
}

export type ReferralProgramDto = {
  enabled: boolean;
  inviter_reward_gb: number;
  inviter_reward_days: number;
  invited_discount_percent: number;
  invite_copy_text: string;
};

export async function loadReferralProgram(): Promise<ReferralProgramDto> {
  const res = await fetch("/api/referral-program", { credentials: "include" });
  return handle(res);
}

export async function saveReferralProgram(body: ReferralProgramDto): Promise<ReferralProgramDto> {
  const res = await fetch("/api/referral-program", {
    method: "PUT",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export type ReferralRewardLogEntry = { line: string; created_at: string };

export async function loadReferralRewardsLog(): Promise<{ entries: ReferralRewardLogEntry[] }> {
  const res = await fetch("/api/referral-program/rewards-log", { credentials: "include" });
  return handle(res);
}

export type ReferralStatsDto = {
  total_invites: number;
  active_invites: number;
  gb_issued: number;
  days_issued: number;
  avg_discount_percent: number | null;
  conversion_percent: number | null;
  manual_gifts_count: number;
};

export type ReferralMetaDto = {
  bot_username: string;
  brand_name: string;
  sample_ref_link: string;
};

export type ReferralEventDto = {
  kind: "invitation" | "reward" | "admin_gift" | "error";
  created_at: string;
  inviter_name?: string;
  invitee_name?: string;
  user_name?: string;
  reward_text?: string;
  status?: string;
  status_note?: string;
  admin_comment?: string;
  granted_by?: string;
  telegram_sent?: boolean | null;
  legacy?: boolean;
  line?: string;
};

export type ReferralReportRowDto = {
  inviter_name: string;
  invitee_name: string;
  invited_at: string;
  purchased: boolean;
  discount_percent: number;
  inviter_reward: string;
  invitee_reward: string;
  status: string;
  rewarded_at: string | null;
};

export type ReferralSettingsHistoryEntry = {
  id: string;
  changed_by: string;
  field: string;
  field_label: string;
  old_value: string;
  new_value: string;
  created_at: string;
};

export async function loadReferralStats(): Promise<ReferralStatsDto> {
  const res = await fetch("/api/referral-program/stats", { credentials: "include" });
  return handle(res);
}

export async function loadReferralMeta(): Promise<ReferralMetaDto> {
  const res = await fetch("/api/referral-program/meta", { credentials: "include" });
  return handle(res);
}

export async function loadReferralEvents(params?: {
  kind?: string;
  q?: string;
  from?: string;
  to?: string;
}): Promise<{ entries: ReferralEventDto[] }> {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set("kind", params.kind);
  if (params?.q) qs.set("q", params.q);
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`/api/referral-program/events${suffix}`, { credentials: "include" });
  return handle(res);
}

export async function loadReferralReport(): Promise<{ rows: ReferralReportRowDto[] }> {
  const res = await fetch("/api/referral-program/report", { credentials: "include" });
  return handle(res);
}

export async function loadReferralSettingsHistory(): Promise<{ entries: ReferralSettingsHistoryEntry[] }> {
  const res = await fetch("/api/referral-program/settings-history", { credentials: "include" });
  return handle(res);
}

export function referralEventsExportUrl(params?: { kind?: string }): string {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set("kind", params.kind);
  const suffix = qs.toString() ? `?${qs}` : "";
  return `/api/referral-program/export/events.csv${suffix}`;
}

export function referralEventsXlsxExportUrl(params?: { kind?: string }): string {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set("kind", params.kind);
  const suffix = qs.toString() ? `?${qs}` : "";
  return `/api/referral-program/export/events.xlsx${suffix}`;
}

export function referralReportExportUrl(): string {
  return "/api/referral-program/export/report.csv";
}

export function referralReportXlsxExportUrl(): string {
  return "/api/referral-program/export/report.xlsx";
}

export async function grantReferralAdminGift(payload: {
  user_ids: number[];
  kind: "gb" | "days";
  amount: number;
  admin_comment?: string;
}): Promise<{ ok: boolean; queued: number; errors?: { user_id: number; error: string }[] }> {
  const res = await fetch("/api/referral-program/admin-gift", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export type MySubProfileDto = {
  tg_id: number;
  name: string;
  avatar_url: string | null;
  stats_html: string;
  subscriptions: Array<{
    id: number;
    name: string;
    subscription_url: string;
    enable: boolean;
    allowed: boolean;
    total_gb: number;
    traffic_up: number;
    traffic_down: number;
    used_text: string;
    total_text: string;
    expiry_time: number;
    tickets?: number;
    gb_piggy?: RouletteGbPiggyDto | null;
    stats: {
      subscription_active: boolean;
      access_ok: boolean;
      unlimited_time: boolean;
      unlimited_traffic: boolean;
      remaining_ms: number | null;
      remaining_days: number | null;
      remaining_gb?: number | null;
      time_progress: number | null;
      traffic_percent: number | null;
      expiry_label: string | null;
    };
  }>;
  payment_url: string;
  plans: Array<{ id: number; title: string; total_gb: number; days: number; price_rub: number }>;
  topup_plans: Array<{ id: number; title: string; add_gb: number; price_rub: number }>;
  test_plan?: {
    enabled: boolean;
    available: boolean;
    title: string;
    total_gb: number;
    days: number;
    price_rub: number;
  };
  sales_disabled_for_new?: boolean;
  roulette_purchase_discount?: { discount_percent: number } | null;
  active_game?: "none" | "dropper" | "roulette";
  game_tab_visible?: boolean;
  tickets_per_purchase?: number;
  dropper: {
    enabled: boolean;
    tickets: number;
    reward_gb: number;
    reward_days: number;
    /** Целевая длительность полёта (сек), из настроек игры. */
    flight_duration_sec: number;
    /** Множитель скорости падения (1 = по умолчанию). */
    flight_speed_mult: number;
    /** Умирать ли от бокового касания препятствия. */
    side_hit_death_enabled: boolean;
    plays: number;
    wins: number;
    won_gb: number;
    won_days: number;
  };
  roulette?: {
    enabled: boolean;
    tickets: number;
    tickets_per_purchase: number;
    chance_sum: number;
    prizes: MySubRoulettePrizeDto[];
    ticket_shop?: RouletteTicketShopPublicDto;
    history: Array<{
      kind?: "spin";
      id: number;
      date: string;
      prize: string;
      status: string;
      error_message?: string | null;
    }>;
    ticket_purchase_history?: Array<{
      kind: "ticket_purchase";
      id: string;
      date: string;
      tickets: number;
      payment_type: "subscription_days" | "traffic_gb";
      cost: number;
    }>;
  };
  support_appeals: {
    enabled: boolean;
  };
  referral: {
    enabled: boolean;
    invite_copy_text: string;
    invite_link: string;
    invited_friends: Array<{
      reward_id: string;
      name: string;
      tg_user_id: number;
      status: "pending" | "claimed";
      created_at: string;
      reward_gb: number;
      reward_days: number;
    }>;
  };
  whitelist?: {
    visible: boolean;
    status: "hidden" | "not_connected" | "connected" | "suspended" | "expired";
    access_status?: "none" | "active" | "suspended" | "expired";
    price_rub: number;
    description: string;
    active_until: string | null;
    remaining_days?: number | null;
    can_buy: boolean;
    block_reason?: string | null;
    purchase_user_id?: number | null;
    instruction: {
      title: string;
      text: string;
      has_photo: boolean;
      photo_url?: string | null;
    };
  };
};

export async function loadMySubProfile(tgId: number): Promise<MySubProfileDto> {
  const res = await fetch(`/api/mysub/${tgId}/profile`);
  return handle(res);
}

export async function loadMySubWebAppProfile(initData: string): Promise<MySubProfileDto> {
  const res = await fetch("/api/mysub/webapp/profile", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ init_data: initData }),
  });
  return handle(res);
}

export async function sendMySubPaymentProof(payload: {
  init_data: string;
  pay_kind?: "subscription" | "topup" | "test" | "white_lists";
  user_id?: number;
  plan_id: number;
  photo_base64: string;
  photo_mime?: string;
  photo_name?: string;
  new_subscription_name?: string;
  promo_code?: string;
}): Promise<{ ok: boolean }> {
  const res = await fetch("/api/mysub/webapp/payment-proof", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function sendMySubSupportAppeal(payload: {
  init_data: string;
  text: string;
  photos?: Array<{ base64: string; mime?: string; name?: string }>;
}): Promise<{ ok: boolean; appeal_id?: string }> {
  const res = await fetch("/api/mysub/webapp/support-appeal", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export type SupportAppealStatus = "new" | "in_progress" | "closed";

export type SupportAppealDto = {
  id: string;
  tg_chat_id: number;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  user_id?: number;
  text: string;
  text_preview?: string;
  photo_file_ids: string[];
  photo_paths: string[];
  photo_count?: number;
  status: SupportAppealStatus;
  source: "bot" | "webapp";
  created_at: string;
  updated_at: string;
  taken_at?: string;
  closed_at?: string;
  admin_reply_text?: string;
  admin_reply_photo_paths?: string[];
};

export type SupportAppealsConfigDto = { enabled: boolean };

export type SupportAppealsPageDto = {
  config: SupportAppealsConfigDto;
  appeals: SupportAppealDto[];
};

export async function loadSupportAppeals(): Promise<SupportAppealsPageDto> {
  const res = await fetch("/api/support-appeals", { credentials: "include" });
  return handle(res);
}

export async function saveSupportAppealsConfig(cfg: SupportAppealsConfigDto): Promise<SupportAppealsConfigDto> {
  const res = await fetch("/api/support-appeals/config", {
    method: "PUT",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(cfg),
  });
  return handle(res);
}

export async function takeSupportAppeal(id: string): Promise<{ ok: boolean; appeal: SupportAppealDto }> {
  const res = await fetch(`/api/support-appeals/${encodeURIComponent(id)}/take`, {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export function supportAppealPhotoUrl(id: string, photoIndex: number): string {
  return `/api/support-appeals/${encodeURIComponent(id)}/photo/${photoIndex}`;
}

export function supportAppealReplyPhotoUrl(id: string, photoIndex: number): string {
  return `/api/support-appeals/${encodeURIComponent(id)}/reply-photo/${photoIndex}`;
}

export async function completeSupportAppeal(
  id: string,
  payload: { reply_text: string; photos?: Array<{ base64: string; mime?: string; name?: string }> },
): Promise<{ ok: boolean; appeal: SupportAppealDto }> {
  const res = await fetch(`/api/support-appeals/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function deleteSupportAppeal(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/support-appeals/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handle(res);
}

export async function claimMySubReferralReward(payload: {
  init_data: string;
  reward_id: string;
  kind: "gb" | "days";
}): Promise<{ ok: boolean }> {
  const res = await fetch("/api/mysub/webapp/referral-reward", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export type DropperGameConfigDto = {
  enabled: boolean;
  reward_gb: number;
  reward_days: number;
  tickets_per_purchase: number;
  /** Длительность полёта до финиша (сек), 15–180. */
  flight_duration_sec: number;
  /** Множитель скорости падения на клиенте, 0.25–4 (1 = база). */
  flight_speed_mult: number;
  /** Умирать ли от удара о бок препятствия. */
  side_hit_death_enabled: boolean;
};

export type DropperAdminReportDto = {
  total_plays: number;
  total_wins: number;
  total_loses: number;
  unique_players: number;
  unique_winners: number;
  gifts_gb_choices: number;
  gifts_days_choices: number;
};

export async function loadDropperGameConfig(): Promise<DropperGameConfigDto> {
  const res = await fetch("/api/dropper-game", { credentials: "include" });
  return handle(res);
}

export async function saveDropperGameConfig(body: DropperGameConfigDto): Promise<DropperGameConfigDto> {
  const res = await fetch("/api/dropper-game", {
    method: "PUT",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function grantDropperGameTickets(body: {
  user_ids: number[];
  tickets: number;
}): Promise<{ ok: boolean; selected_rows: number; unique_pools: number; tickets_each: number }> {
  const res = await fetch("/api/dropper-game/grant-tickets", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function resetAllDropperGameTickets(): Promise<{ ok: boolean }> {
  const res = await fetch("/api/dropper-game/reset-all-tickets", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
  });
  return handle(res);
}

export async function setDropperUserTicketsPool(body: {
  user_id: number;
  tickets: number;
}): Promise<{ ok: boolean }> {
  const res = await fetch("/api/dropper-game/set-user-tickets", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function loadDropperGameReport(): Promise<DropperAdminReportDto> {
  const res = await fetch("/api/dropper-game/report", { credentials: "include" });
  return handle(res);
}

export async function startDropperSession(payload: {
  init_data: string;
  user_id: number;
  practice?: boolean;
}): Promise<{ session_id: string; seed: number }> {
  const res = await fetch("/api/mysub/webapp/dropper/start", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function finishDropperSession(payload: {
  init_data: string;
  session_id: string;
  won: boolean;
  flight_ms: number;
  choice?: "gb" | "days";
  reward_user_id?: number;
}): Promise<{ ok: boolean }> {
  const res = await fetch("/api/mysub/webapp/dropper/finish", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export type MySubRoulettePrizeDto = {
  id: string;
  title: string;
  type: string;
  value: number;
  color: string;
  icon: string;
  win_text: string;
};

export type RouletteGbPiggyDto = {
  accumulated_gb: number;
  exchange_threshold: number;
  can_exchange: boolean;
};

export async function spinMySubRoulette(initData: string, userId: number): Promise<{
  ok: boolean;
  prize?: MySubRoulettePrizeDto;
  prize_index?: number;
  tickets_remaining?: number;
  user_id?: number;
  gb_piggy?: RouletteGbPiggyDto;
  spin?: {
    id: number;
    prize_title?: string;
    prize_display_message?: string | null;
  };
}> {
  const res = await fetch("/api/mysub/webapp/roulette/spin", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ init_data: initData, user_id: userId }),
  });
  return handle(res);
}

export async function exchangeMySubRoulettePiggy(initData: string, userId: number): Promise<{
  ok: boolean;
  tickets_remaining: number;
  gb_piggy: RouletteGbPiggyDto;
}> {
  const res = await fetch("/api/mysub/webapp/roulette/exchange-piggy", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ init_data: initData, user_id: userId }),
  });
  return handle(res);
}

export async function notifyMySubRouletteSpin(initData: string, spinId: number): Promise<{ ok: boolean }> {
  const res = await fetch("/api/mysub/webapp/roulette/notify", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ init_data: initData, spin_id: spinId }),
  });
  return handle(res);
}

export type WebAppActiveGame = "none" | "dropper" | "roulette";

export type RouletteTicketShopConfigDto = {
  enabled: boolean;
  price_days_per_ticket: number;
  price_gb_per_ticket: number;
  min_tickets: number;
  max_tickets: number;
  allow_days: boolean;
  allow_gb: boolean;
  notify_telegram_on_purchase: boolean;
};

export type RouletteTicketShopPublicDto = {
  enabled: boolean;
  visible: boolean;
  price_days_per_ticket: number;
  price_gb_per_ticket: number;
  min_tickets: number;
  max_tickets: number;
  allow_days: boolean;
  allow_gb: boolean;
  balances: {
    remaining_days: number | null;
    remaining_gb: number | null;
    unlimited_traffic: boolean;
    unlimited_time: boolean;
    has_active_subscription: boolean;
  };
};

export type GameSettingsDto = {
  active_game: WebAppActiveGame;
  tickets_per_purchase: number;
  roulette_enabled: boolean;
  dropper_enabled: boolean;
  chance_sum: number;
  prizes: RoulettePrizeAdminDto[];
  ticket_shop?: RouletteTicketShopConfigDto;
};

export type RouletteTicketPurchaseRowDto = {
  id: string;
  user_id: number;
  tg_user_id: number;
  user_name: string;
  tg_username: string;
  tickets_amount: number;
  payment_type: "subscription_days" | "traffic_gb";
  spent_amount: number;
  status: string;
  error_message: string | null;
  created_at: string;
};

export type RoulettePrizeAdminDto = {
  id: string;
  title: string;
  type: string;
  value: number;
  chance_percent: number;
  active: boolean;
  color: string;
  icon: string;
  win_text: string;
  sort_order: number;
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type RouletteStatsDto = {
  total_spins: number;
  spins_today: number;
  subscription_days_given: number;
  traffic_gb_given: number;
  tariff_upgrades: number;
  top_prize: string;
};

export type RouletteReportRowDto = {
  id: number;
  user_id: number;
  tg_user_id: number;
  user_name: string;
  tg_username: string;
  prize_id: string;
  prize_title: string;
  ticket_spent: boolean;
  result_type: string;
  result_value: number;
  status: string;
  error_message: string | null;
  created_at: string;
};

export async function loadGameSettings(): Promise<GameSettingsDto> {
  const res = await fetch("/api/roulette-game/settings", { credentials: "include" });
  return handle(res);
}

export async function saveGameSettings(body: {
  active_game?: WebAppActiveGame;
  tickets_per_purchase?: number;
  ticket_shop?: Partial<RouletteTicketShopConfigDto>;
}): Promise<GameSettingsDto> {
  const res = await fetch("/api/roulette-game/settings", {
    method: "PUT",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handle(res);
}

export async function saveRoulettePrizes(prizes: RoulettePrizeAdminDto[]): Promise<{ prizes: RoulettePrizeAdminDto[]; chance_sum: number }> {
  const res = await fetch("/api/roulette-game/prizes", {
    method: "PUT",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ prizes }),
  });
  return handle(res);
}

export async function normalizeRouletteChances(): Promise<{ prizes: RoulettePrizeAdminDto[]; chance_sum: number }> {
  const res = await fetch("/api/roulette-game/prizes/normalize-chances", {
    method: "POST",
    credentials: "include",
  });
  return handle(res);
}

export async function loadRouletteStats(): Promise<RouletteStatsDto> {
  const res = await fetch("/api/roulette-game/stats", { credentials: "include" });
  return handle(res);
}

export async function loadRouletteReport(params?: Record<string, string>): Promise<{ rows: RouletteReportRowDto[]; total: number }> {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await fetch(`/api/roulette-game/report${qs}`, { credentials: "include" });
  return handle(res);
}

export async function testRouletteSpin(): Promise<{ ok: boolean; prize?: RoulettePrizeAdminDto; prize_index?: number }> {
  const res = await fetch("/api/roulette-game/test-spin", { method: "POST", credentials: "include" });
  return handle(res);
}

export async function loadRouletteTicketPurchases(
  params?: Record<string, string>,
): Promise<{ rows: RouletteTicketPurchaseRowDto[]; total: number }> {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await fetch(`/api/roulette-game/ticket-purchases${qs}`, { credentials: "include" });
  return handle(res);
}

export function rouletteTicketPurchasesExportCsvUrl(params?: Record<string, string>): string {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `/api/roulette-game/ticket-purchases/export.csv${qs}`;
}

export type BuyRouletteTicketsResultDto = {
  ok: boolean;
  tickets_count: number;
  tickets_added: number;
  cost: number;
  payment_type: "subscription_days" | "traffic_gb";
  remaining_days: number | null;
  remaining_gb: number | null;
  error?: string;
};

export async function buyMySubRouletteTickets(
  initData: string,
  paymentType: "subscription_days" | "traffic_gb",
  tickets: number,
  userId: number,
): Promise<BuyRouletteTicketsResultDto> {
  const res = await fetch("/api/mysub/webapp/roulette/buy-tickets", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ init_data: initData, paymentType, tickets, user_id: userId }),
  });
  return handle(res);
}

export type PromoCodeDto = {
  id: string;
  name: string;
  code: string;
  type: "percent" | "rub" | "gb" | "days" | "combo";
  discount_percent: number;
  discount_rub: number;
  gift_gb: number;
  gift_days: number;
  one_time_per_user: boolean;
  max_uses_total?: number;
  max_uses_per_user: number;
  min_purchase_rub?: number;
  first_purchase_only: boolean;
  new_users_only: boolean;
  apply_plan_ids?: number[];
  admin_note?: string;
  active: boolean;
  valid_until: string;
  created_at: string;
  updated_at: string;
  usages_count: number;
  total_usages_count?: number;
  status?: "active" | "inactive" | "expired" | "limit_reached";
};

export type PromoCodeUsageDto = {
  id: string;
  promo_id: string;
  promo_code: string;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  user_name?: string;
  phone?: string;
  applied_at: string;
  session_id?: string;
  plan_id?: number;
  plan_title?: string;
  original_price_rub?: number;
  final_price_rub?: number;
  discount_rub?: number;
  bonus_gb?: number;
  bonus_days?: number;
  status?: "applied" | "error";
  error?: string;
};

export async function listPromoCodes(): Promise<{ promos: PromoCodeDto[] }> {
  const res = await fetch("/api/promo-codes", { credentials: "include" });
  return handle(res);
}

export async function createPromoCode(payload: {
  name: string;
  code: string;
  type: "percent" | "rub" | "gb" | "days" | "combo";
  discount_percent: number;
  discount_rub?: number;
  gift_gb?: number;
  gift_days?: number;
  one_time_per_user: boolean;
  max_uses_total?: number;
  max_uses_per_user?: number;
  min_purchase_rub?: number;
  first_purchase_only?: boolean;
  new_users_only?: boolean;
  apply_plan_ids?: number[];
  admin_note?: string;
  active?: boolean;
  valid_until?: string;
}): Promise<PromoCodeDto> {
  const res = await fetch("/api/promo-codes", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function patchPromoCode(
  promoId: string,
  payload: Partial<{
    name: string;
    code: string;
    type: "percent" | "rub" | "gb" | "days" | "combo";
    discount_percent: number;
    discount_rub: number;
    gift_gb: number;
    gift_days: number;
    one_time_per_user: boolean;
    max_uses_total: number;
    max_uses_per_user: number;
    min_purchase_rub: number;
    first_purchase_only: boolean;
    new_users_only: boolean;
    apply_plan_ids: number[];
    admin_note: string;
    active: boolean;
    valid_until: string;
  }>,
): Promise<PromoCodeDto> {
  const res = await fetch(`/api/promo-codes/${encodeURIComponent(promoId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function listPromoCodeUsages(promoId: string): Promise<{ usages: PromoCodeUsageDto[] }> {
  const res = await fetch(`/api/promo-codes/${encodeURIComponent(promoId)}/usages`, { credentials: "include" });
  return handle(res);
}

export async function duplicatePromoCode(promoId: string, payload?: { code?: string }): Promise<PromoCodeDto> {
  const res = await fetch(`/api/promo-codes/${encodeURIComponent(promoId)}/duplicate`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload ?? {}),
  });
  return handle(res);
}

export async function getPromoCodeReport(
  promoId: string,
): Promise<{
  promo: PromoCodeDto & {
    status: "active" | "inactive" | "expired" | "limit_reached";
    usages_count: number;
    unique_users_count: number;
    sum_discount_rub: number;
    sum_bonus_gb: number;
    sum_bonus_days: number;
  };
  usages: PromoCodeUsageDto[];
}> {
  const res = await fetch(`/api/promo-codes/${encodeURIComponent(promoId)}/report`, { credentials: "include" });
  return handle(res);
}

export function promoCodeReportCsvUrl(promoId: string): string {
  return `/api/promo-codes/${encodeURIComponent(promoId)}/export.csv`;
}

export function promoCodeReportXlsxUrl(promoId: string): string {
  return `/api/promo-codes/${encodeURIComponent(promoId)}/export.xlsx`;
}

export async function deletePromoCode(promoId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/promo-codes/${encodeURIComponent(promoId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handle(res);
}

export async function previewMySubPromoCode(payload: {
  init_data: string;
  code: string;
  original_price_rub: number;
}): Promise<{
  promo: { code: string; discount_percent: number };
  final_price_rub: number;
  original_price_rub: number;
  discount_rub: number;
  discount_percent: number;
}> {
  const res = await fetch("/api/mysub/webapp/promo/preview", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export type XrayLogLevel = "none" | "error" | "warning" | "info" | "debug";

export type XrayLogStreamDto = {
  path: string | null;
  status: "ok" | "empty" | "not_found" | "no_path" | "too_large" | "permission_denied" | "unreadable";
  lines: string[];
  highlights: string[][];
  message?: string;
};

export type XrayLogsSnapshotDto = {
  server_id: number;
  server_name: string;
  host: string;
  config_path: string;
  log: {
    loglevel: XrayLogLevel;
    accessPath: string | null;
    errorPath: string | null;
    dnsLog: boolean;
  };
  xray_running: boolean;
  access: XrayLogStreamDto;
  error: XrayLogStreamDto;
  hint: string | null;
};

export async function fetchServerXrayLogs(serverId: number, lines = 300): Promise<XrayLogsSnapshotDto> {
  const res = await fetch(`/api/servers/${serverId}/xray-logs?lines=${lines}`, { credentials: "include" });
  return handle(res);
}

export async function patchServerXrayLogLevel(
  serverId: number,
  loglevel: XrayLogLevel,
): Promise<XrayLogsSnapshotDto> {
  const res = await fetch(`/api/servers/${serverId}/xray-logs/loglevel`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ loglevel }),
  });
  return handle(res);
}

export async function clearServerXrayLogs(
  serverId: number,
  targets: ("access" | "error")[],
): Promise<{ cleared: string[]; errors: string[]; snapshot: XrayLogsSnapshotDto }> {
  const res = await fetch(`/api/servers/${serverId}/xray-logs/clear`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ targets }),
  });
  return handle(res);
}

export type ExperimentPresetDto = {
  id: string;
  label: string;
  description: string;
  defaults: Record<string, unknown>;
};

export type ExperimentDto = {
  id: number;
  name: string;
  server_id: number;
  server_name: string;
  host: string;
  preset_id: string;
  port: number;
  network: string;
  security: string;
  flow: string;
  fingerprint: string;
  server_name_sni: string;
  inbound_tag: string;
  vless_uuid_masked: string;
  reality_pbk_masked: string;
  reality_sid_masked: string;
  sub_url: string;
  vless_uri: string;
  status: string;
  deploy_error: string | null;
  diag_status: string;
  diag_has_accepted: boolean;
  diag_has_handshake_fail: boolean;
  user_note: "" | "works" | "fail" | "partial";
  query_strategy: string;
  sniff_quic: boolean;
  dns_mode: string;
  mux_enabled: boolean;
  port_warning: string | null;
  active_on_443: boolean;
  experimental_only_server: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateExperimentPayload = {
  name: string;
  server_id: number;
  preset_id?: string;
  port?: number;
  network?: "tcp" | "ws" | "grpc";
  security?: "reality" | "tls" | "none";
  flow?: string;
  fingerprint?: string;
  server_name?: string;
  query_strategy?: "UseIP" | "UseIPv4";
  sniff_quic?: boolean;
  dns_mode?: "default" | "proxy" | "no_direct_dns";
  mux_enabled?: boolean;
  xudp_enabled?: boolean;
  mtu?: number | null;
  log_level?: string;
  force_non_443?: boolean;
  replace_443_slot?: boolean;
};

export async function listExperimentPresets(): Promise<{ presets: ExperimentPresetDto[] }> {
  const res = await fetch("/api/experiments/presets", { credentials: "include" });
  return handle(res);
}

export async function listExperiments(): Promise<{ experiments: ExperimentDto[] }> {
  const res = await fetch("/api/experiments", { credentials: "include" });
  return handle(res);
}

export async function createExperiment(
  payload: CreateExperimentPayload,
): Promise<
  ExperimentDto & {
    port_warning?: string | null;
    deploy_post_check?: PortCheckDto | null;
    firewall_open?: FirewallOpenDto | null;
  }
> {
  const res = await fetch("/api/experiments", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function fetchExperimentPortPlan(serverId: number, port = 443): Promise<PortPlanDto> {
  const res = await fetch(`/api/experiments/port-plan?server_id=${serverId}&port=${port}`, { credentials: "include" });
  return handle(res);
}

export async function fetchMobileTestInfo(): Promise<{
  mobile_warning: string;
  honest_test_hint: string;
  options: string[];
}> {
  const res = await fetch("/api/experiments/mobile-test-info", { credentials: "include" });
  return handle(res);
}

export async function activateMobilePreset(serverId: number, presetId: string): Promise<ExperimentDto> {
  const res = await fetch("/api/experiments/activate-mobile", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ server_id: serverId, preset_id: presetId }),
  });
  return handle(res);
}

export async function checkExperimentPort(id: number): Promise<PortCheckDto> {
  const res = await fetch(`/api/experiments/${id}/port-check`, { method: "POST", credentials: "include" });
  return handle(res);
}

export async function fetchExperimentDiagnosticReport(id: number): Promise<{ text: string }> {
  const res = await fetch(`/api/experiments/${id}/diagnostic-report`, { credentials: "include" });
  return handle(res);
}

export type PortPlanDto = {
  host: string;
  listen_ip: string;
  requested_port: number;
  experimental_only: boolean;
  port_443_free: boolean;
  port_443_blockers: { tag: string; port: number; protocol: string }[];
  assigned_port: number | null;
  can_use_443: boolean;
  honest_mobile_test_possible: boolean;
  warning: string | null;
  mobile_test_hint: string;
};

export type PortCheckDto = {
  ok: boolean;
  host: string;
  port: number;
  inbound_tag: string | null;
  checks: { name: string; ok: boolean; detail: string }[];
  xray_running: boolean;
  port_listening: boolean;
  inbound_in_config: boolean;
  firewall_hint: string | null;
  diag_status: string;
  diag_status_key: string;
  diag_has_incoming: boolean;
  diag_has_accepted: boolean;
  diag_has_handshake_fail: boolean;
  cloud_security_group_hint: string | null;
};

export type FirewallOpenDto = {
  kind: string;
  opened: boolean;
  already_open: boolean;
  detail: string;
  manual_command: string | null;
  cloud_security_group_hint: string | null;
};

export async function fetchExperimentClientJson(id: number): Promise<{ json: Record<string, unknown> }> {
  const res = await fetch(`/api/experiments/${id}/client-json`, { credentials: "include" });
  return handle(res);
}

export async function deleteExperiment(id: number): Promise<void> {
  const res = await fetch(`/api/experiments/${id}`, { method: "DELETE", credentials: "include" });
  await handle(res);
}

export async function diagnoseExperiment(id: number): Promise<{
  experiment: ExperimentDto;
  logs: { status: string; has_accepted: boolean; has_handshake_fail: boolean; lines: string[]; highlights: string[][] };
}> {
  const res = await fetch(`/api/experiments/${id}/diagnose`, { method: "POST", credentials: "include" });
  return handle(res);
}

export async function patchExperimentNote(
  id: number,
  user_note: "" | "works" | "fail" | "partial",
): Promise<ExperimentDto> {
  const res = await fetch(`/api/experiments/${id}/note`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ user_note }),
  });
  return handle(res);
}

export type VlessCheckStatusDto = "available" | "unavailable" | "unstable" | "never" | "checking";

export type ConfigVaultKeyDto = {
  id: number;
  name: string;
  raw_uri?: string;
  masked_uri: string;
  active: boolean;
  added_to_subscriptions: boolean;
  last_check_at: string | null;
  last_check_status: VlessCheckStatusDto;
  last_check_latency_ms: number | null;
  last_error: string | null;
  unavailable_since: string | null;
  notify_on_fail: boolean;
  created_at: string;
  updated_at: string;
};

export type ConfigVaultCheckDto = {
  id: number;
  key_id: number;
  checked_at: string;
  attempts_total: number;
  attempts_success: number;
  attempts_failed: number;
  avg_latency_ms: number | null;
  min_latency_ms: number | null;
  max_latency_ms: number | null;
  status: "available" | "unavailable" | "unstable";
  error_message: string | null;
  triggered_by: "manual" | "auto";
  notification_sent: boolean;
};

export type ConfigVaultSettingsDto = {
  auto_check_enabled: boolean;
  interval_minutes: number;
  attempts_per_check: number;
  attempt_timeout_sec: number;
  test_url: string;
  notify_on_unavailable: boolean;
  notify_on_recovery: boolean;
  notify_cooldown_minutes: number;
  last_auto_run_at: string | null;
};

export type ConfigVaultOverviewDto = {
  stats: {
    total: number;
    in_subscriptions: number;
    available: number;
    unavailable: number;
    unstable: number;
    never: number;
    last_auto_run_at: string | null;
  };
  telegram_configured: boolean;
  settings: ConfigVaultSettingsDto;
  keys: ConfigVaultKeyDto[];
};

function parseApiError(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* ignore */
  }
  return text || "Ошибка запроса";
}

async function handleVault<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseApiError(text));
  }
  return res.json() as Promise<T>;
}

export async function loadConfigVault(): Promise<ConfigVaultOverviewDto> {
  const res = await fetch("/api/config-vault", { credentials: "include" });
  return handleVault(res);
}

export async function createConfigVaultKey(body: {
  name: string;
  raw_uri: string;
  active?: boolean;
  notify_on_fail?: boolean;
}): Promise<{ key: ConfigVaultKeyDto }> {
  const res = await fetch("/api/config-vault", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function updateConfigVaultKey(
  id: number,
  body: Partial<{ name: string; raw_uri: string; active: boolean; notify_on_fail: boolean }>,
): Promise<{ key: ConfigVaultKeyDto }> {
  const res = await fetch(`/api/config-vault/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function deleteConfigVaultKey(id: number): Promise<void> {
  const res = await fetch(`/api/config-vault/${id}`, { method: "DELETE", credentials: "include" });
  await handleVault(res);
}

export async function setConfigVaultSubscriptions(id: number, added: boolean): Promise<{ key: ConfigVaultKeyDto }> {
  const res = await fetch(`/api/config-vault/${id}/subscriptions`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ added }),
  });
  return handleVault(res);
}

export async function checkConfigVaultKey(id: number): Promise<{ key: ConfigVaultKeyDto; check: ConfigVaultCheckDto }> {
  const res = await fetch(`/api/config-vault/${id}/check`, { method: "POST", credentials: "include" });
  return handleVault(res);
}

export async function checkAllConfigVaultKeys(): Promise<
  ConfigVaultOverviewDto & { checked: number; started?: boolean; already_running?: boolean; total?: number }
> {
  const res = await fetch("/api/config-vault/check-all", { method: "POST", credentials: "include" });
  return handleVault(res);
}

export async function pollUntilVaultChecksDone(
  fetchKeys: () => Promise<{ keys: Array<{ last_check_status: string }> }>,
  total: number,
  opts?: { intervalMs?: number; maxWaitMs?: number },
): Promise<void> {
  const intervalMs = opts?.intervalMs ?? 1500;
  const maxWaitMs = opts?.maxWaitMs ?? Math.max(20000, total * 12000);
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const r = await fetchKeys();
    if (!r.keys.some((k) => k.last_check_status === "checking")) return;
  }
}

export async function importConfigVaultKeys(body: {
  text: string;
  name_prefix?: string;
  active?: boolean;
  notify_on_fail?: boolean;
}): Promise<{ added: number; skipped_duplicates: number; errors: string[]; keys: ConfigVaultKeyDto[] }> {
  const res = await fetch("/api/config-vault/import", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function patchConfigVaultSettings(
  patch: Partial<ConfigVaultSettingsDto>,
): Promise<ConfigVaultOverviewDto> {
  const res = await fetch("/api/config-vault/settings", {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  });
  return handleVault(res);
}

export async function listConfigVaultChecks(
  id: number,
  params?: { status?: string; triggered_by?: string; limit?: number },
): Promise<{ checks: ConfigVaultCheckDto[] }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.triggered_by) q.set("triggered_by", params.triggered_by);
  if (params?.limit) q.set("limit", String(params.limit));
  const res = await fetch(`/api/config-vault/${id}/checks?${q}`, { credentials: "include" });
  return handleVault(res);
}

export function configVaultExportUrl(mode: "all" | "active" | "subscriptions" | "available", format: "txt" | "json"): string {
  return `/api/config-vault/export?mode=${mode}&format=${format}`;
}

export async function fetchConfigVaultKeyRaw(id: number): Promise<{ key: ConfigVaultKeyDto; parsed: Record<string, unknown> | null }> {
  const res = await fetch(`/api/config-vault/${id}`, { credentials: "include" });
  return handleVault(res);
}

export type WhitelistAssignmentModeDto = "none" | "all" | "selected";

export type WhitelistVaultKeyDto = {
  id: number;
  name: string;
  raw_uri?: string;
  masked_uri: string;
  source_type: "manual_vless" | "json_import";
  active: boolean;
  include_in_sale?: boolean;
  assignment_mode: WhitelistAssignmentModeDto;
  assigned_user_ids?: number[];
  assigned_users_count: number;
  assignment_label: string;
  last_check_at: string | null;
  last_check_status: VlessCheckStatusDto;
  last_check_latency_ms: number | null;
  last_error: string | null;
  notify_on_fail: boolean;
  created_at: string;
  updated_at: string;
};

export type WhitelistVaultSettingsDto = {
  enabled: boolean;
  auto_check_enabled: boolean;
  interval_minutes: number;
  attempts_per_check: number;
  attempt_timeout_sec: number;
  test_url: string;
  notify_on_unavailable: boolean;
  notify_cooldown_minutes: number;
  last_auto_run_at: string | null;
  purchase: {
    sale_enabled: boolean;
    price_rub: number;
    duration: "subscription_end" | "30_days" | "forever";
    miniapp_description: string;
    bot_description: string;
    issue_unavailable_keys: boolean;
  };
  instruction: {
    title: string;
    text: string;
    photo_path: string | null;
  };
};

export type WhitelistPurchaseRowDto = {
  id: string;
  user_id: number;
  user_name: string;
  tg_id: string;
  payment_id: string;
  amount: number;
  status: "pending" | "paid" | "failed" | "refunded";
  activated_at: string | null;
  expires_at: string | null;
  instruction_sent: boolean;
  instruction_error: string | null;
  activation_error: string | null;
  created_at: string;
  updated_at: string;
};

export type WhitelistVaultOverviewDto = {
  stats: {
    total: number;
    available: number;
    unavailable: number;
    unstable: number;
    never: number;
    assigned_users: number;
    last_auto_run_at: string | null;
    enabled: boolean;
  };
  telegram_configured: boolean;
  disabled_warning: string | null;
  purchase_warning?: string | null;
  purchase_visible?: boolean;
  sale_keys_count?: number;
  settings: WhitelistVaultSettingsDto;
  keys: WhitelistVaultKeyDto[];
};

export async function loadWhitelistVault(): Promise<WhitelistVaultOverviewDto> {
  const res = await fetch("/api/whitelist-vault", { credentials: "include" });
  return handleVault(res);
}

export async function patchWhitelistVaultSettings(
  patch: Partial<WhitelistVaultSettingsDto>,
): Promise<WhitelistVaultOverviewDto> {
  const res = await fetch("/api/whitelist-vault/settings", {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  });
  return handleVault(res);
}

export async function createWhitelistVaultKey(body: {
  name: string;
  raw_uri: string;
  active?: boolean;
  include_in_sale?: boolean;
  notify_on_fail?: boolean;
  assignment_mode?: WhitelistAssignmentModeDto;
  assigned_user_ids?: number[];
}): Promise<{ key: WhitelistVaultKeyDto }> {
  const res = await fetch("/api/whitelist-vault", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function updateWhitelistVaultKey(
  id: number,
  body: Partial<{
    name: string;
    raw_uri: string;
    active: boolean;
    include_in_sale: boolean;
    notify_on_fail: boolean;
    assignment_mode: WhitelistAssignmentModeDto;
    assigned_user_ids: number[];
  }>,
): Promise<{ key: WhitelistVaultKeyDto }> {
  const res = await fetch(`/api/whitelist-vault/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function deleteWhitelistVaultKey(id: number): Promise<void> {
  const res = await fetch(`/api/whitelist-vault/${id}`, { method: "DELETE", credentials: "include" });
  await handleVault(res);
}

export async function setWhitelistVaultAssignment(
  id: number,
  assignment_mode: WhitelistAssignmentModeDto,
  assigned_user_ids?: number[],
): Promise<{ key: WhitelistVaultKeyDto }> {
  const res = await fetch(`/api/whitelist-vault/${id}/assignment`, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ assignment_mode, assigned_user_ids }),
  });
  return handleVault(res);
}

export async function checkWhitelistVaultKey(
  id: number,
): Promise<{ key: WhitelistVaultKeyDto; check: ConfigVaultCheckDto }> {
  const res = await fetch(`/api/whitelist-vault/${id}/check`, { method: "POST", credentials: "include" });
  return handleVault(res);
}

export async function bulkRenameWhitelistVaultKeys(body: {
  ids: number[];
  remark: string;
}): Promise<{ updated: number; errors: string[]; keys: WhitelistVaultKeyDto[] }> {
  const res = await fetch("/api/whitelist-vault/bulk/rename", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function bulkAssignWhitelistVaultKeys(body: {
  ids: number[];
  assignment_mode: WhitelistAssignmentModeDto;
  assigned_user_ids?: number[];
}): Promise<{ updated: number; errors: string[]; keys: WhitelistVaultKeyDto[] }> {
  const res = await fetch("/api/whitelist-vault/bulk/assignment", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function bulkDeleteWhitelistVaultKeys(body: {
  ids?: number[];
  delete_all?: boolean;
}): Promise<{ deleted: number; keys: WhitelistVaultKeyDto[] }> {
  const res = await fetch("/api/whitelist-vault/bulk/delete", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function checkAllWhitelistVaultKeys(): Promise<
  WhitelistVaultOverviewDto & { checked: number; started?: boolean; already_running?: boolean; total?: number }
> {
  const res = await fetch("/api/whitelist-vault/check-all", { method: "POST", credentials: "include" });
  return handleVault(res);
}

export async function importWhitelistVaultKeys(body: {
  text: string;
  name_prefix?: string;
  active?: boolean;
  include_in_sale?: boolean;
  notify_on_fail?: boolean;
  assignment_mode?: WhitelistAssignmentModeDto;
  assigned_user_ids?: number[];
}): Promise<{ added: number; skipped_duplicates: number; errors: string[]; keys: WhitelistVaultKeyDto[] }> {
  const res = await fetch("/api/whitelist-vault/import", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function importWhitelistVaultJson(body: {
  json: string;
  name?: string;
  active?: boolean;
  include_in_sale?: boolean;
  notify_on_fail?: boolean;
  assignment_mode?: WhitelistAssignmentModeDto;
  assigned_user_ids?: number[];
}): Promise<{ key: WhitelistVaultKeyDto; keys?: WhitelistVaultKeyDto[]; added?: number }> {
  const res = await fetch("/api/whitelist-vault/import-json", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return handleVault(res);
}

export async function parseWhitelistVaultJson(
  json: string,
): Promise<{ uri: string; name: string; parsed: Record<string, unknown> | null }> {
  const res = await fetch("/api/whitelist-vault/parse-json", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ json }),
  });
  return handleVault(res);
}

export async function listWhitelistVaultChecks(
  id: number,
  params?: { status?: string; triggered_by?: string; limit?: number },
): Promise<{ checks: ConfigVaultCheckDto[] }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.triggered_by) q.set("triggered_by", params.triggered_by);
  if (params?.limit) q.set("limit", String(params.limit));
  const res = await fetch(`/api/whitelist-vault/${id}/checks?${q}`, { credentials: "include" });
  return handleVault(res);
}

export async function fetchWhitelistVaultKeyRaw(
  id: number,
): Promise<{ key: WhitelistVaultKeyDto; parsed: Record<string, unknown> | null }> {
  const res = await fetch(`/api/whitelist-vault/${id}`, { credentials: "include" });
  return handleVault(res);
}

export async function listWhitelistPurchases(): Promise<{ purchases: WhitelistPurchaseRowDto[] }> {
  const res = await fetch("/api/whitelist-vault/purchases", { credentials: "include" });
  return handleVault(res);
}

export async function patchWhitelistPurchaseSettings(
  patch: Partial<WhitelistVaultSettingsDto["purchase"]>,
): Promise<WhitelistVaultOverviewDto> {
  const res = await fetch("/api/whitelist-vault/purchase-settings", {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  });
  return handleVault(res);
}

export async function patchWhitelistInstructionSettings(
  patch: Partial<WhitelistVaultSettingsDto["instruction"]>,
): Promise<WhitelistVaultOverviewDto> {
  const res = await fetch("/api/whitelist-vault/instruction", {
    method: "PATCH",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  });
  return handleVault(res);
}

export async function uploadWhitelistInstructionPhoto(photo_base64: string): Promise<WhitelistVaultOverviewDto> {
  const res = await fetch("/api/whitelist-vault/instruction/photo", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ photo_base64 }),
  });
  return handleVault(res);
}

export async function deleteWhitelistInstructionPhoto(): Promise<WhitelistVaultOverviewDto> {
  const res = await fetch("/api/whitelist-vault/instruction/photo", { method: "DELETE", credentials: "include" });
  return handleVault(res);
}

export async function testWhitelistInstruction(admin_chat_id: number): Promise<{ ok: boolean }> {
  const res = await fetch("/api/whitelist-vault/instruction/test", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify({ admin_chat_id }),
  });
  return handleVault(res);
}
