import { randomBytes } from "node:crypto";

export type DeviceLimitEventType =
  | "device_registered"
  | "device_removed"
  | "device_limit_reached"
  | "device_slot_purchase_created"
  | "device_slot_purchase_paid"
  | "device_slot_purchase_failed"
  | "fallback_used_without_did"
  | "subscription_blocked_by_device_limit"
  | "device_renamed"
  | "device_blocked"
  | "admin_slot_added";

export type DeviceLimitEventRow = {
  id: string;
  user_id: number;
  subscription_id: number;
  device_id: string;
  event_type: DeviceLimitEventType | string;
  message: string;
  metadata_json: string;
  created_at: string;
};

export function normalizeDeviceLimitEvents(raw: unknown): DeviceLimitEventRow[] {
  if (!Array.isArray(raw)) return [];
  const out: DeviceLimitEventRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      user_id: Math.max(0, Math.floor(Number(o.user_id) || 0)),
      subscription_id: Math.max(0, Math.floor(Number(o.subscription_id) || 0)),
      device_id: String(o.device_id ?? "").trim(),
      event_type: String(o.event_type ?? "").trim() || "unknown",
      message: String(o.message ?? "").trim(),
      metadata_json: String(o.metadata_json ?? "").trim() || "{}",
      created_at: String(o.created_at ?? "").trim() || new Date().toISOString(),
    });
  }
  return out;
}

export function newDeviceLimitEvent(
  input: Omit<DeviceLimitEventRow, "id" | "created_at"> & { id?: string },
): DeviceLimitEventRow {
  return {
    id: input.id?.trim() || randomBytes(8).toString("hex"),
    user_id: input.user_id,
    subscription_id: input.subscription_id,
    device_id: input.device_id,
    event_type: input.event_type,
    message: input.message,
    metadata_json: input.metadata_json || "{}",
    created_at: new Date().toISOString(),
  };
}
