import { createHmac, timingSafeEqual } from "node:crypto";
import { findUsersByTelegramChatId } from "../db.js";
import { getTelegramBotToken } from "./env.js";

export type WebAppUser = { id?: number; first_name?: string; last_name?: string; username?: string };

export function parseTgId(raw: string): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function allowLocalDevWebAppBypass(): boolean {
  const apiUrl = String(process.env.PUBLIC_API_URL ?? "").toLowerCase();
  const frontendOrigin = String(process.env.FRONTEND_ORIGIN ?? "").toLowerCase();
  return [apiUrl, frontendOrigin].some((value) => value.includes("localhost") || value.includes("127.0.0.1"));
}

export function verifyTelegramWebAppInitData(
  initData: string,
): { ok: true; user: WebAppUser } | { ok: false; reason: string } {
  const raw = String(initData ?? "").trim();
  if (allowLocalDevWebAppBypass() && raw.startsWith("local-dev:")) {
    const tgId = parseTgId(raw.slice("local-dev:".length));
    if (!tgId) return { ok: false, reason: "bad_user_id" };
    const linked = findUsersByTelegramChatId(tgId);
    const fallbackName = String(linked[0]?.name ?? "").trim();
    return {
      ok: true,
      user: {
        id: tgId,
        first_name: fallbackName || "Local",
        username: String(linked[0]?.tg_id ?? "").trim() || undefined,
      },
    };
  }
  const token = getTelegramBotToken();
  if (!token) return { ok: false, reason: "telegram_not_configured" };
  if (!raw) return { ok: false, reason: "init_data_required" };
  const p = new URLSearchParams(raw);
  const hash = String(p.get("hash") ?? "").trim().toLowerCase();
  if (!hash) return { ok: false, reason: "hash_missing" };
  const kv: string[] = [];
  const keys: string[] = [];
  p.forEach((_v, k) => {
    if (k !== "hash") keys.push(k);
  });
  keys.sort();
  for (const k of keys) kv.push(`${k}=${p.get(k) ?? ""}`);
  const dataCheckString = kv.join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const calc = createHmac("sha256", secret).update(dataCheckString).digest("hex").toLowerCase();
  const hashBuf = Buffer.from(hash, "hex");
  const calcBuf = Buffer.from(calc, "hex");
  if (hashBuf.length !== calcBuf.length || !timingSafeEqual(hashBuf, calcBuf)) {
    return { ok: false, reason: "bad_signature" };
  }
  const authDate = Number(p.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "bad_auth_date" };
  const ageSec = Math.floor(Date.now() / 1000) - Math.floor(authDate);
  if (ageSec > 86400) return { ok: false, reason: "auth_expired" };
  let user: WebAppUser = {};
  try {
    const parsed = JSON.parse(String(p.get("user") ?? "{}")) as WebAppUser;
    user = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { ok: false, reason: "bad_user_payload" };
  }
  const tgId = Number(user.id);
  if (!Number.isFinite(tgId) || tgId <= 0) return { ok: false, reason: "bad_user_id" };
  return { ok: true, user };
}
