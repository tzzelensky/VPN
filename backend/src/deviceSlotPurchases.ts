import { randomBytes } from "node:crypto";

export type DeviceSlotPurchaseStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded";

export type DeviceSlotPurchaseRow = {
  id: string;
  user_id: number;
  subscription_id: number;
  payment_id: string;
  slots_count: number;
  price_per_slot: number;
  amount_total: number;
  status: DeviceSlotPurchaseStatus;
  activated_at: string;
  expires_at: number;
  admin_comment: string;
  created_at: string;
  updated_at: string;
};

export function normalizeDeviceSlotPurchases(raw: unknown): DeviceSlotPurchaseRow[] {
  if (!Array.isArray(raw)) return [];
  const out: DeviceSlotPurchaseRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id) continue;
    const status = String(o.status ?? "").trim() as DeviceSlotPurchaseStatus;
    out.push({
      id,
      user_id: Math.max(0, Math.floor(Number(o.user_id) || 0)),
      subscription_id: Math.max(0, Math.floor(Number(o.subscription_id) || 0)),
      payment_id: String(o.payment_id ?? "").trim(),
      slots_count: Math.max(1, Math.floor(Number(o.slots_count) || 1)),
      price_per_slot: Math.max(0, Math.floor(Number(o.price_per_slot) || 0)),
      amount_total: Math.max(0, Math.floor(Number(o.amount_total) || 0)),
      status:
        status === "pending" ||
        status === "paid" ||
        status === "failed" ||
        status === "cancelled" ||
        status === "refunded"
          ? status
          : "pending",
      activated_at: String(o.activated_at ?? "").trim(),
      expires_at: Math.max(0, Math.floor(Number(o.expires_at) || 0)),
      admin_comment: String(o.admin_comment ?? "").trim(),
      created_at: String(o.created_at ?? "").trim() || new Date().toISOString(),
      updated_at: String(o.updated_at ?? "").trim() || new Date().toISOString(),
    });
  }
  return out;
}

export function newDeviceSlotPurchase(
  input: Omit<DeviceSlotPurchaseRow, "id" | "created_at" | "updated_at" | "activated_at"> & {
    id?: string;
    activated_at?: string;
  },
): DeviceSlotPurchaseRow {
  const now = new Date().toISOString();
  return {
    id: input.id?.trim() || randomBytes(8).toString("hex"),
    user_id: input.user_id,
    subscription_id: input.subscription_id,
    payment_id: input.payment_id,
    slots_count: input.slots_count,
    price_per_slot: input.price_per_slot,
    amount_total: input.amount_total,
    status: input.status,
    activated_at: input.activated_at?.trim() || "",
    expires_at: input.expires_at,
    admin_comment: input.admin_comment ?? "",
    created_at: now,
    updated_at: now,
  };
}
