import { createHash, randomUUID } from "node:crypto";
import type { UserRow } from "./db.js";
import { normalizeClientIp } from "./deviceLimitSubscription.js";
import type { DeviceLimitSettings } from "./deviceLimitSettings.js";
import { getDeviceLimitSettings } from "./deviceLimitStore.js";
import { deviceLimitCalcSettingsForUser, isDeviceLimitActiveForUser } from "./deviceLimitEffective.js";
import { parseDeviceFromUserAgent, isUsefulDeviceName, stableUserAgentFingerprintKey } from "./deviceNameFromUa.js";

export type UserDeviceSlot = {
  id: string;
  label: string;
  device_name: string;
  device_type: string;
  user_agent: string;
  created_at: string;
  first_seen_at: string;
  last_seen_at: string;
  last_ip: string;
  active: number;
  blocked: number;
  deleted_at: string;
};

export function userDeviceTotalLimit(
  user: Pick<UserRow, "device_limit_count" | "device_extra_slots" | "device_limit_enabled" | "is_test_subscription">,
  settings?: Pick<DeviceLimitSettings, "enabled" | "default_slots">,
): number {
  const extra = Math.max(0, Math.floor(Number(user.device_extra_slots) || 0));
  const calc = settings ?? deviceLimitCalcSettingsForUser(user);
  if (calc?.enabled) {
    const globalDefault = Math.max(1, Math.floor(Number(calc.default_slots) || 1));
    return globalDefault + extra;
  }
  const base = Math.max(1, Math.floor(Number(user.device_limit_count) || 1));
  return base + extra;
}

export function activeDeviceSlots(slots: UserDeviceSlot[]): UserDeviceSlot[] {
  return normalizeDeviceSlots(slots).filter((s) => s.active === 1 && !s.deleted_at);
}

export function allowedDeviceSlots(slots: UserDeviceSlot[]): UserDeviceSlot[] {
  return activeDeviceSlots(slots).filter((s) => s.blocked !== 1);
}

/** Оставляет в пределах лимита самые старые устройства; новые сверх лимита помечает blocked. */
export function reconcileSlotsToLimit(slots: UserDeviceSlot[], limit: number): UserDeviceSlot[] {
  const next = normalizeDeviceSlots(slots).map((s) => ({ ...s }));
  const activeIdx = next
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.active === 1 && !s.deleted_at)
    .sort((a, b) => Date.parse(a.s.last_seen_at) - Date.parse(b.s.last_seen_at));
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  for (let k = 0; k < activeIdx.length; k++) {
    const { i } = activeIdx[k]!;
    const keep = k < cap;
    next[i] = { ...next[i]!, blocked: keep ? 0 : 1 };
  }
  return next;
}

export function reconcileUserDeviceSlots(
  user: Pick<UserRow, "device_slots" | "device_limit_count" | "device_extra_slots" | "device_limit_enabled" | "is_test_subscription">,
): UserDeviceSlot[] {
  if (!isDeviceLimitActiveForUser(user)) return normalizeDeviceSlots(user.device_slots);
  const calcSettings = deviceLimitCalcSettingsForUser(user);
  const limit = userDeviceTotalLimit(user, calcSettings);
  const deduped = dedupeStableDuplicateSlots(normalizeDeviceSlots(user.device_slots));
  return reconcileSlotsToLimit(deduped, limit);
}

export function normalizeDeviceId(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^fp:[a-f0-9]{8,40}$/i.test(s)) return s.toLowerCase();
  if (/^ip:[a-f0-9]{8,40}$/i.test(s)) return s.toLowerCase();
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
      ? s.toLowerCase()
      : "";
  if (uuid) return uuid;
  if (/^[0-9a-f]{16,40}$/i.test(s)) return s.toLowerCase();
  return "";
}

export function deviceFingerprintFromUserAgent(uaRaw: string): string {
  const key = stableUserAgentFingerprintKey(uaRaw);
  if (!key) return "";
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 20);
  return `fp:${hash}`;
}

function userAgentsMatchStable(a: string, b: string): boolean {
  const ka = stableUserAgentFingerprintKey(a);
  const kb = stableUserAgentFingerprintKey(b);
  return Boolean(ka && kb && ka === kb);
}

/** Найти существующий слот того же физического устройства (модель + тип + клиент). */
function findSlotByStableIdentity(slots: UserDeviceSlot[], ua: string): number {
  const trimmed = String(ua ?? "").trim();
  if (!trimmed) return -1;
  const parsed = parseDeviceFromUserAgent(trimmed);
  const key = stableUserAgentFingerprintKey(trimmed);
  const candidates: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (s.active !== 1 || s.deleted_at) continue;
    const name = String(s.device_name || s.label || "").trim();
    const sameName = isUsefulDeviceName(parsed.device_name) && name === parsed.device_name;
    const sameType =
      s.device_type === parsed.device_type ||
      s.device_type === "unknown" ||
      parsed.device_type === "unknown";
    const slotUa = String(s.user_agent || "").trim();
    const sameKey = key && slotUa && stableUserAgentFingerprintKey(slotUa) === key;
    const sameUa = slotUa && userAgentsMatchStable(slotUa, trimmed);
    if ((sameName && sameType) || sameKey || sameUa) candidates.push(i);
  }
  if (candidates.length === 0) return -1;
  candidates.sort((a, b) => Date.parse(slots[b]!.last_seen_at) - Date.parse(slots[a]!.last_seen_at));
  return candidates[0]!;
}

export function deviceIdFromClientIp(ip: string): string {
  const normalized = normalizeClientIp(ip);
  const hash = createHash("sha256")
    .update(normalized || String(ip ?? "").trim())
    .digest("hex")
    .slice(0, 20);
  return `ip:${hash}`;
}

/** Имя-заглушка после миграции из онлайн (без UA): «Устройство 1» или старый формат с IP. */
export function isMigrationPlaceholderDeviceName(nameRaw: string): boolean {
  const name = String(nameRaw ?? "").trim();
  if (!name) return true;
  if (/^Устройство\s+\d+$/i.test(name)) return true;
  if (/^Устройство\s*·\s*(?:\d{1,3}\.){3}\d{1,3}$/i.test(name)) return true;
  return name === "Устройство";
}

export function isMigrationPlaceholderSlot(slot: Pick<UserDeviceSlot, "id" | "device_name" | "label" | "user_agent">): boolean {
  const name = String(slot.device_name || slot.label || "").trim();
  if (isMigrationPlaceholderDeviceName(name)) return true;
  if (String(slot.id ?? "").toLowerCase().startsWith("ip:") && !isUsefulDeviceName(name)) return true;
  return false;
}

function findMigrationSlotForRequest(slots: UserDeviceSlot[], ip: string, hasUa: boolean): number {
  if (ip) {
    const byIp = findMigrationSlotByIp(slots, ip);
    if (byIp >= 0) return byIp;
  }
  if (!hasUa) return -1;
  let placeholderIdx = -1;
  let count = 0;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (s.active !== 1 || s.deleted_at) continue;
    if (!isMigrationPlaceholderSlot(s)) continue;
    count++;
    placeholderIdx = i;
  }
  return count === 1 ? placeholderIdx : -1;
}

function preferredDeviceIdForRegistration(ua: string, explicitId: string): string {
  const fp = ua ? deviceFingerprintFromUserAgent(ua) : "";
  if (fp) return fp;
  return normalizeDeviceId(explicitId);
}

/** Схлопнуть дубли одного физического устройства (оставить последний по активности). */
function dedupeStableDuplicateSlots(slots: UserDeviceSlot[]): UserDeviceSlot[] {
  const slotKey = (s: UserDeviceSlot): string => {
    const ua = String(s.user_agent || "").trim();
    if (ua) {
      const k = stableUserAgentFingerprintKey(ua);
      if (k) return k;
    }
    const name = String(s.device_name || s.label || "").trim();
    if (isUsefulDeviceName(name)) {
      return `${s.device_type || "unknown"}|${name}`.toLowerCase();
    }
    return "";
  };

  const byKey = new Map<string, number[]>();
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    if (s.active !== 1 || s.deleted_at) continue;
    const key = slotKey(s);
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(i);
    byKey.set(key, arr);
  }

  const drop = new Set<number>();
  for (const indices of byKey.values()) {
    if (indices.length <= 1) continue;
    const sorted = [...indices].sort(
      (a, b) => Date.parse(slots[b]!.last_seen_at) - Date.parse(slots[a]!.last_seen_at),
    );
    for (const i of sorted.slice(1)) drop.add(i);
  }
  if (drop.size === 0) return slots;

  const now = new Date().toISOString();
  return slots.map((s, i) =>
    drop.has(i) ? { ...s, active: 0, deleted_at: s.deleted_at || now } : s,
  );
}

function findMigrationSlotByIp(slots: UserDeviceSlot[], ip: string): number {
  const normalized = normalizeClientIp(ip);
  if (!normalized) return -1;
  return slots.findIndex(
    (s) =>
      s.active === 1 &&
      !s.deleted_at &&
      normalizeClientIp(s.last_ip) === normalized &&
      isMigrationPlaceholderSlot(s),
  );
}

function deviceNameOnTouch(
  cur: UserDeviceSlot,
  ua: string,
  explicit?: string,
): string {
  if (explicit?.trim()) return explicit.trim();
  const parsed = parseDeviceFromUserAgent(ua || cur.user_agent);
  const curName = String(cur.device_name || cur.label || "").trim();
  if (isMigrationPlaceholderDeviceName(curName) && isUsefulDeviceName(parsed.device_name)) {
    return parsed.device_name;
  }
  if (ua && isUsefulDeviceName(parsed.device_name)) return parsed.device_name;
  return curName || parsed.device_name || "Устройство";
}

export function deviceFingerprintFromRequest(req: {
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const ua = String(req.headers?.["user-agent"] ?? "").trim();
  return deviceFingerprintFromUserAgent(ua);
}

export function resolveSubscriptionDeviceId(
  user: Pick<UserRow, "device_slots">,
  resolved: { deviceId: string; matchedBy: "did" | "header" | "fingerprint" | "none" },
  userAgent: string,
): string {
  const ua = String(userAgent ?? "").trim();
  const fp = ua ? deviceFingerprintFromUserAgent(ua) : "";
  const id = normalizeDeviceId(resolved.deviceId);
  const slots = normalizeDeviceSlots(user.device_slots);

  if (fp) {
    const byFp = slots.findIndex((s) => s.active === 1 && !s.deleted_at && s.id === fp);
    if (byFp >= 0) return fp;
  }

  const stableIdx = findSlotByStableIdentity(slots, ua);
  if (stableIdx >= 0) return slots[stableIdx]!.id;

  if (resolved.matchedBy === "fingerprint" || resolved.matchedBy === "none") {
    return id || fp;
  }

  if (!id) return fp;
  if (!ua) return id;

  const slot = slots.find((s) => s.id === id);
  if (!slot) return fp || id;

  const slotUa = String(slot.user_agent ?? "").trim();
  if (!slotUa || userAgentsMatchStable(slotUa, ua)) return id;

  const slotType = parseDeviceFromUserAgent(slotUa).device_type;
  const uaType = parseDeviceFromUserAgent(ua).device_type;
  if (slotType !== "unknown" && uaType !== "unknown" && slotType !== uaType) {
    return fp || id;
  }
  return id;
}

export function resolveDeviceIdFromRequest(req: {
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}): { deviceId: string; matchedBy: "did" | "header" | "fingerprint" | "none" } {
  const q = req.query ?? {};
  const fromQuery = normalizeDeviceId(String(q.did ?? q.device ?? ""));
  if (fromQuery) return { deviceId: fromQuery, matchedBy: "did" };
  const hdr = req.headers?.["x-device-id"] ?? req.headers?.["x-sub-device"];
  const fromHeader = normalizeDeviceId(Array.isArray(hdr) ? String(hdr[0] ?? "") : String(hdr ?? ""));
  if (fromHeader) return { deviceId: fromHeader, matchedBy: "header" };
  const fp = deviceFingerprintFromRequest(req);
  if (fp) return { deviceId: fp, matchedBy: "fingerprint" };
  return { deviceId: "", matchedBy: "none" };
}

export function normalizeDeviceSlots(raw: unknown): UserDeviceSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: UserDeviceSlot[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = normalizeDeviceId(String(o.id ?? ""));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const created = String(o.created_at ?? o.first_seen_at ?? "").trim() || new Date().toISOString();
    const lastSeen = String(o.last_seen_at ?? "").trim() || created;
    const label = String(o.label ?? o.device_name ?? "").trim() || `Устройство ${out.length + 1}`;
    out.push({
      id,
      label,
      device_name: String(o.device_name ?? "").trim() || label,
      device_type: String(o.device_type ?? "").trim() || "unknown",
      user_agent: String(o.user_agent ?? "").trim(),
      created_at: created,
      first_seen_at: String(o.first_seen_at ?? "").trim() || created,
      last_seen_at: lastSeen,
      last_ip: normalizeClientIp(String(o.last_ip ?? "")),
      active: Number(o.active) === 0 ? 0 : 1,
      blocked: Number(o.blocked) === 1 ? 1 : 0,
      deleted_at: String(o.deleted_at ?? "").trim(),
    });
  }
  return out;
}

export function newDeviceSlot(
  label: string,
  opts?: { requestIp?: string; userAgent?: string; deviceId?: string },
): UserDeviceSlot {
  const now = new Date().toISOString();
  const parsed = parseDeviceFromUserAgent(opts?.userAgent);
  const name = label.trim() || parsed.device_name;
  return {
    id: normalizeDeviceId(opts?.deviceId) || randomUUID(),
    label: name,
    device_name: name,
    device_type: parsed.device_type,
    user_agent: String(opts?.userAgent ?? "").trim(),
    created_at: now,
    first_seen_at: now,
    last_seen_at: now,
    last_ip: normalizeClientIp(opts?.requestIp),
    active: 1,
    blocked: 0,
    deleted_at: "",
  };
}

export type DeviceLimitEval = {
  allowed: boolean;
  slots: UserDeviceSlot[];
  registered: number;
  reason?: string;
  eventType?: string;
};

export function evaluateDeviceLimitAccess(
  user: Pick<UserRow, "device_limit_enabled" | "device_limit_count" | "device_extra_slots" | "device_slots" | "is_test_subscription">,
  deviceId: string,
  opts?: {
    requestIp?: string;
    userAgent?: string;
    deviceName?: string;
    touchOnly?: boolean;
    autoBind?: boolean;
    globalEnabled?: boolean;
    defaultSlots?: number;
  },
): DeviceLimitEval {
  const slots = dedupeStableDuplicateSlots(reconcileUserDeviceSlots(user));
  const active = activeDeviceSlots(slots);
  const allowed = allowedDeviceSlots(slots);
  const calcSettings = deviceLimitCalcSettingsForUser(user);
  const limit = userDeviceTotalLimit(user, calcSettings);
  const ip = normalizeClientIp(opts?.requestIp);
  const ua = String(opts?.userAgent ?? "").trim();
  const now = new Date().toISOString();

  if (!isDeviceLimitActiveForUser(user)) {
    return { allowed: true, slots, registered: active.length };
  }

  let id = normalizeDeviceId(deviceId);
  if (!id && ua) id = normalizeDeviceId(deviceFingerprintFromUserAgent(ua));

  const touchSlot = (index: number, reactivate = false): UserDeviceSlot[] => {
    const next = [...slots];
    const cur = next[index]!;
    const parsed = parseDeviceFromUserAgent(ua || cur.user_agent);
    const nextName = deviceNameOnTouch(cur, ua, opts?.deviceName);
    next[index] = {
      ...cur,
      last_seen_at: now,
      last_ip: ip || cur.last_ip,
      user_agent: ua || cur.user_agent,
      device_type: cur.device_type !== "unknown" ? cur.device_type : parsed.device_type,
      device_name: nextName,
      label: nextName,
      active: 1,
      ...(reactivate ? { deleted_at: "", blocked: 0 } : {}),
    };
    return next;
  };

  let idx = slots.findIndex((s) => s.id === id);

  const bindMigrationSlot = (migIdx: number): UserDeviceSlot[] => {
    let next = touchSlot(migIdx);
    const boundId = normalizeDeviceId(id);
    if (boundId && !/^ip:/i.test(boundId) && next[migIdx]!.id !== boundId) {
      if (!next.some((s, i) => i !== migIdx && s.id === boundId)) {
        next = [...next];
        next[migIdx] = { ...next[migIdx]!, id: boundId };
      }
    }
    return next;
  };

  if (idx < 0) {
    const migIdx = findMigrationSlotForRequest(slots, ip, Boolean(ua));
    if (migIdx >= 0) {
      return { allowed: true, slots: bindMigrationSlot(migIdx), registered: active.length };
    }
  }

  if (idx >= 0) {
    const cur = slots[idx]!;
    if (cur.deleted_at) {
      if (opts?.touchOnly) {
        return {
          allowed: false,
          slots,
          registered: active.length,
          reason: "device_deleted",
        };
      }
      if (allowed.length >= limit) {
        return {
          allowed: false,
          slots,
          registered: active.length,
          reason: "limit_reached",
          eventType: "device_limit_reached",
        };
      }
      const parsedIncoming = parseDeviceFromUserAgent(ua);
      const curUa = String(cur.user_agent || "").trim();
      const curType = String(cur.device_type || "unknown").trim() || "unknown";
      const incomingType = String(parsedIncoming.device_type || "unknown").trim() || "unknown";
      const deletedSignatureChanged =
        (ua && curUa && curUa !== ua) ||
        (incomingType !== "unknown" && curType !== "unknown" && incomingType !== curType);
      if (deletedSignatureChanged && ua) {
        const collisionId = createHash("sha256")
          .update(`${id}|${ua}|${ip || ""}`)
          .digest("hex")
          .slice(0, 20);
        const collisionIdx = slots.findIndex((s) => s.id === collisionId);
        if (collisionIdx >= 0) {
          const collision = slots[collisionIdx]!;
          if (collision.deleted_at) {
            return {
              allowed: true,
              slots: touchSlot(collisionIdx, true),
              registered: active.length + 1,
              reason: "device_reactivated",
              eventType: "device_registered",
            };
          }
          return { allowed: true, slots: touchSlot(collisionIdx), registered: active.length };
        }
        const added = newDeviceSlot(opts?.deviceName?.trim() || parsedIncoming.device_name, {
          requestIp: ip,
          userAgent: ua,
          deviceId: collisionId,
        });
        return {
          allowed: true,
          slots: [...slots, added],
          registered: active.length + 1,
          reason: "device_id_collision",
          eventType: "device_registered",
        };
      }
      return {
        allowed: true,
        slots: touchSlot(idx, true),
        registered: active.length + 1,
        reason: "device_reactivated",
        eventType: "device_registered",
      };
    }
    if (cur.blocked === 1) {
      return {
        allowed: false,
        slots,
        registered: active.length,
        reason: "device_blocked",
        eventType: "subscription_blocked_by_device_limit",
      };
    }
    // Один и тот же did/header может прилетать с разных устройств.
    // Если сигнатура устройства изменилась, считаем это новым устройством и не перезаписываем текущий слот.
    const parsedIncoming = parseDeviceFromUserAgent(ua);
    const curType = String(cur.device_type || "unknown").trim() || "unknown";
    const incomingType = String(parsedIncoming.device_type || "unknown").trim() || "unknown";
    const signatureChanged =
      !isMigrationPlaceholderSlot(cur) &&
      incomingType !== "unknown" &&
      curType !== "unknown" &&
      incomingType !== curType;
    if (
      signatureChanged &&
      !opts?.touchOnly
    ) {
      if (allowed.length >= limit) {
        return {
          allowed: false,
          slots,
          registered: active.length,
          reason: "limit_reached",
          eventType: "device_limit_reached",
        };
      }
      const collisionId = createHash("sha256")
        .update(`${id}|${ua}|${ip || ""}`)
        .digest("hex")
        .slice(0, 20);
      const added = newDeviceSlot(opts?.deviceName?.trim() || parsedIncoming.device_name, {
        requestIp: ip,
        userAgent: ua,
        deviceId: collisionId,
      });
      return {
        allowed: true,
        slots: [...slots, added],
        registered: active.length + 1,
        reason: "device_id_collision",
        eventType: "device_registered",
      };
    }
    return { allowed: true, slots: touchSlot(idx), registered: active.length };
  }

  if (!id) {
    const stableIdx = findSlotByStableIdentity(slots, ua);
    if (stableIdx >= 0) {
      return { allowed: true, slots: touchSlot(stableIdx), registered: active.length };
    }

    const sameUaIdx = ua
      ? slots.findIndex(
          (s) =>
            s.active === 1 &&
            !s.deleted_at &&
            userAgentsMatchStable(String(s.user_agent || "").trim(), ua),
        )
      : -1;
    if (sameUaIdx >= 0) {
      return { allowed: true, slots: touchSlot(sameUaIdx), registered: active.length };
    }

    // Fallback для миграции/старых записей без UA — дедуп по IP или единственной заглушке.
    const sameSessionIdx = findMigrationSlotForRequest(slots, ip, Boolean(ua));
    if (sameSessionIdx >= 0) {
      return { allowed: true, slots: touchSlot(sameSessionIdx), registered: active.length };
    }

    // Не регистрируем "фантомные" устройства на запросах без did и без UA:
    // это обычно сервисные/прокси-запросы, которые иначе забивают лимит.
    if (!ua) {
      return { allowed: true, slots, registered: active.length, reason: "no_device_fingerprint" };
    }

    if (opts?.touchOnly) {
      return { allowed: false, slots, registered: active.length, reason: "unknown_device" };
    }
    if (allowed.length >= limit) {
      return {
        allowed: false,
        slots,
        registered: active.length,
        reason: "no_device_id",
        eventType: "subscription_blocked_by_device_limit",
      };
    }
    const parsed = parseDeviceFromUserAgent(ua);
    const added = newDeviceSlot(opts?.deviceName?.trim() || parsed.device_name, {
      requestIp: ip,
      userAgent: ua,
      deviceId: preferredDeviceIdForRegistration(ua, ""),
    });
    return {
      allowed: true,
      slots: [...slots, added],
      registered: active.length + 1,
      reason: "no_device_id",
      eventType: "device_registered",
    };
  }

  if (opts?.touchOnly) {
    return { allowed: false, slots, registered: active.length, reason: "unknown_device" };
  }

  {
    const stableIdx = findSlotByStableIdentity(slots, ua);
    if (stableIdx >= 0) {
      return { allowed: true, slots: bindMigrationSlot(stableIdx), registered: active.length };
    }
    const migIdx = findMigrationSlotForRequest(slots, ip, Boolean(ua));
    if (migIdx >= 0) {
      return { allowed: true, slots: bindMigrationSlot(migIdx), registered: active.length };
    }
  }

  if (allowed.length >= limit) {
    return {
      allowed: false,
      slots,
      registered: active.length,
      reason: "limit_reached",
      eventType: "device_limit_reached",
    };
  }

  const parsed = parseDeviceFromUserAgent(ua);
  const added = newDeviceSlot(opts?.deviceName?.trim() || parsed.device_name, {
    requestIp: ip,
    userAgent: ua,
    deviceId: preferredDeviceIdForRegistration(ua, id),
  });
  const next = [...slots, added];
  return { allowed: true, slots: next, registered: active.length + 1, eventType: "device_registered" };
}

export function deviceLimitNoticeLines(
  user: Pick<UserRow, "device_limit_count" | "device_extra_slots" | "device_limit_enabled" | "is_test_subscription">,
  registered: number,
  settings?: Pick<DeviceLimitSettings, "on_limit_exceeded">,
): string[] {
  const calc = deviceLimitCalcSettingsForUser(user);
  const limit = userDeviceTotalLimit(user, calc);
  const mode = settings?.on_limit_exceeded ?? "stub";
  if (mode === "empty") {
    return ["Лимит устройств исчерпан"];
  }
  const bot = (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  const lines = [
    "Лимит устройств исчерпан",
    `Разрешено: ${limit} · зарегистрировано: ${registered}`,
    "Откройте HSN VPN и купите дополнительное место для устройства",
    "Или удалите старое устройство в приложении",
  ];
  if (mode === "instruction") {
    lines.push("Скопируйте ссылку для нового устройства после покупки места");
  }
  if (bot) lines.push(`@${bot}`);
  return lines;
}

export function deviceLimitNoticeTitle(): string {
  return "Лимит устройств исчерпан";
}
