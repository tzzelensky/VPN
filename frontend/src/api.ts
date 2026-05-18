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
  vless_deployed: boolean;
  last_ssh_ok: boolean;
  last_error: string | null;
  updated_at: string;
};

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
  body: { name?: string; country_code?: string },
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
  /** 0 = все развёрнутые серверы в подписке */
  subscription_server_count: number;
  /** Включено ли ограничение устройств для подписки. */
  device_limit_enabled: boolean;
  /** Максимум устройств при включенном ограничении. */
  device_limit_count: number;
  /** Лимит скорости, Мбит/с; 0 = без ограничения. */
  speed_limit_mbps: number;
  /** К подписке дописываются последние 4 узла + happ (белые списки). По умолчанию выкл. */
  whitelist_happ_enabled: boolean;
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
  created_at: string;
  updated_at: string;
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
  device_limit_enabled?: boolean;
  device_limit_count?: number;
  speed_limit_mbps?: number;
  whitelist_happ_enabled?: boolean;
};

function bodyFromPayload(p: CreateUserPayload): Record<string, unknown> {
  return {
    ...p,
    enable: p.enable === undefined ? undefined : p.enable ? 1 : 0,
  };
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

export async function importUserJson(json: unknown): Promise<{ user: UserDto }> {
  const res = await fetch("/api/users/import", {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(typeof json === "string" ? { json } : json),
  });
  return handle(res);
}

export async function importUserJsonStream(json: unknown, onEvent: (ev: NdjsonEvent) => void): Promise<void> {
  const body = typeof json === "string" ? { json } : json;
  await postNdjsonStream("/api/users/import?stream=1", onEvent, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}


export async function fetchRealityKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const res = await fetch("/api/users/reality-key", { method: "POST", credentials: "include" });
  return handle(res);
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}`, { method: "DELETE", credentials: "include" });
  await handle(res);
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

export type SubscriptionShopDto = {
  sales_disabled: boolean;
  payment_url: string;
  plans: SubscriptionShopPlanDto[];
  topup_plans: TopUpShopPlanDto[];
};

export type SubscriptionShopActivityEntry = { line: string; created_at: string };

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
  }>;
  payment_url: string;
  plans: Array<{ id: number; title: string; total_gb: number; days: number; price_rub: number }>;
  topup_plans: Array<{ id: number; title: string; add_gb: number; price_rub: number }>;
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
  pay_kind?: "subscription" | "topup";
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

export type PromoCodeDto = {
  id: string;
  name: string;
  code: string;
  discount_percent: number;
  one_time_per_user: boolean;
  active: boolean;
  valid_until: string;
  created_at: string;
  updated_at: string;
  usages_count: number;
};

export type PromoCodeUsageDto = {
  id: string;
  promo_id: string;
  promo_code: string;
  tg_user_id: number;
  tg_username?: string;
  tg_first_name?: string;
  applied_at: string;
  session_id?: string;
};

export async function listPromoCodes(): Promise<{ promos: PromoCodeDto[] }> {
  const res = await fetch("/api/promo-codes", { credentials: "include" });
  return handle(res);
}

export async function createPromoCode(payload: {
  name: string;
  code: string;
  discount_percent: number;
  one_time_per_user: boolean;
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
    discount_percent: number;
    one_time_per_user: boolean;
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
