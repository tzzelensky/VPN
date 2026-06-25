export type DeviceLimitExceededMode = "stub" | "empty" | "instruction";
export type DeviceSlotPurchaseValidity = "subscription_end" | "30_days" | "forever" | "custom";
export type DeviceLimitScope = "all" | "selected";

export type DeviceLimitSettings = {
  enabled: boolean;
  /** all = все подписки; selected = только отмеченные на вкладке «Подписки». */
  limit_scope: DeviceLimitScope;
  default_slots: number;
  auto_bind: boolean;
  on_limit_exceeded: DeviceLimitExceededMode;
  purchase_enabled: boolean;
  purchase_price_rub: number;
  purchase_validity: DeviceSlotPurchaseValidity;
  purchase_max_extra: number;
  updated_at: string;
};

export function defaultDeviceLimitSettings(): DeviceLimitSettings {
  return {
    enabled: false,
    limit_scope: "selected",
    default_slots: 2,
    auto_bind: true,
    on_limit_exceeded: "stub",
    purchase_enabled: true,
    purchase_price_rub: 99,
    purchase_validity: "subscription_end",
    purchase_max_extra: 3,
    updated_at: new Date().toISOString(),
  };
}

function readBool(v: unknown, fallback = false): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return fallback;
}

export function normalizeDeviceLimitSettings(raw: unknown): DeviceLimitSettings {
  const d = defaultDeviceLimitSettings();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  const exceeded = String(o.on_limit_exceeded ?? "").trim();
  const validity = String(o.purchase_validity ?? "").trim();
  const scopeRaw = String(o.limit_scope ?? "").trim();
  const limit_scope: DeviceLimitScope = scopeRaw === "all" ? "all" : "selected";
  const prevEnabled = o.enabled !== undefined ? readBool(o.enabled, d.enabled) : d.enabled;
  return {
    enabled: prevEnabled,
    limit_scope,
    default_slots: Math.max(1, Math.min(20, Math.floor(Number(o.default_slots) || d.default_slots))),
    auto_bind: o.auto_bind === false || o.auto_bind === 0 ? false : true,
    on_limit_exceeded:
      exceeded === "empty" || exceeded === "instruction" ? exceeded : "stub",
    purchase_enabled: o.purchase_enabled === false || o.purchase_enabled === 0 ? false : true,
    purchase_price_rub: Math.max(1, Math.floor(Number(o.purchase_price_rub) || d.purchase_price_rub)),
    purchase_validity:
      validity === "30_days" || validity === "forever" || validity === "custom"
        ? validity
        : "subscription_end",
    purchase_max_extra: Math.max(0, Math.min(20, Math.floor(Number(o.purchase_max_extra) ?? d.purchase_max_extra))),
    updated_at: String(o.updated_at ?? "").trim() || new Date().toISOString(),
  };
}

export function isDeviceLimitGloballyEnabled(settings?: DeviceLimitSettings): boolean {
  return normalizeDeviceLimitSettings(settings).enabled;
}
