import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  claimReferralReward,
  findUsersByTelegramChatId,
  getReferralReward,
  getReferralProgram,
  getSubscriptionShop,
  getUser,
  listReferralRewardsForInviterUsers,
  markPaymentSessionPendingAdmin,
  startPaymentAwaitingProof,
  updateUserRow,
  userAllowedOnServers,
} from "../db.js";
import { formatStatsHtml, fmtBytes } from "../telegram/format.js";
import { getTelegramBotToken, getTelegramPaymentNotifyChatIds, getTelegramPaymentUrl } from "../telegram/env.js";
import { sendTelegramPhotoBinary } from "../telegram/api.js";
import { pushClientListToAllDeployedServers } from "../userSync.js";

const router = Router();

type TgChatResult = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo?: { small_file_id?: string; big_file_id?: string };
};

type TgFileResult = { file_path?: string };
type WebAppUser = { id?: number; first_name?: string; last_name?: string; username?: string };
type SendProofBody = {
  init_data?: unknown;
  user_id?: unknown;
  plan_id?: unknown;
  photo_base64?: unknown;
  photo_mime?: unknown;
  photo_name?: unknown;
  new_subscription_name?: unknown;
};
type ClaimReferralBody = {
  init_data?: unknown;
  reward_id?: unknown;
  kind?: unknown;
};
function adminDecisionKeyboard(sessionId: string) {
  return {
    inline_keyboard: [
      [
        { text: "Подтвердить", callback_data: `pok:${sessionId}` },
        { text: "Платёж не поступил", callback_data: `pnx:${sessionId}` },
      ],
    ],
  };
}

function publicSubUrl(subToken: string): string {
  const base = (process.env.PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${base}/sub/${encodeURIComponent(subToken)}`;
}

function parseTgId(raw: string): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function verifyTelegramWebAppInitData(initData: string): { ok: true; user: WebAppUser } | { ok: false; reason: string } {
  const token = getTelegramBotToken();
  if (!token) return { ok: false, reason: "telegram_not_configured" };
  const raw = String(initData ?? "").trim();
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

async function tgCall<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result?: T };
    return data.ok ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}

async function resolveChatProfile(tgId: number): Promise<{ displayName: string; bigFileId: string | null }> {
  const chat = await tgCall<TgChatResult>("getChat", { chat_id: tgId });
  if (!chat) return { displayName: "Пользователь", bigFileId: null };
  const full = `${String(chat.first_name ?? "").trim()} ${String(chat.last_name ?? "").trim()}`.trim();
  const displayName = full || (chat.username ? `@${chat.username}` : "Пользователь");
  const bigFileId = String(chat.photo?.big_file_id ?? "").trim() || null;
  return { displayName, bigFileId };
}

async function fetchPhotoBytesByFileId(fileId: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const token = getTelegramBotToken();
  if (!token) return null;
  const fileInfo = await tgCall<TgFileResult>("getFile", { file_id: fileId });
  const filePath = String(fileInfo?.file_path ?? "").trim();
  if (!filePath) return null;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) return null;
  const ab = await fileRes.arrayBuffer();
  const ct = String(fileRes.headers.get("content-type") ?? "").toLowerCase();
  const mime = ct.includes("png") ? "image/png" : ct.includes("webp") ? "image/webp" : "image/jpeg";
  return { bytes: Buffer.from(ab), mime };
}

router.get("/:tgId(\\d+)/profile", async (req, res) => {
  res.status(401).json({ error: "tg_webapp_auth_required" });
});

router.get("/:tgId(\\d+)/avatar", async (req, res) => {
  res.status(401).send("tg_webapp_auth_required");
});

router.post("/webapp/profile", async (req, res) => {
  const initData = String((req.body as { init_data?: unknown })?.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  if (!tgId) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: "bad_user_id" });
    return;
  }
  const linked = findUsersByTelegramChatId(tgId);
  const chat = await resolveChatProfile(tgId);
  const displayName =
    `${String(ver.user.first_name ?? "").trim()} ${String(ver.user.last_name ?? "").trim()}`.trim() ||
    (ver.user.username ? `@${ver.user.username}` : "") ||
    chat.displayName ||
    linked[0]?.name ||
    "Пользователь";
  let avatarDataUrl: string | null = null;
  if (chat.bigFileId) {
    const photo = await fetchPhotoBytesByFileId(chat.bigFileId);
    if (photo) {
      avatarDataUrl = `data:${photo.mime};base64,${photo.bytes.toString("base64")}`;
    }
  }
  const subscriptions = linked.map((u) => ({
    id: u.id,
    name: u.name,
    subscription_url: publicSubUrl(u.sub_token),
    enable: u.enable === 1,
    allowed: userAllowedOnServers(u),
    total_gb: u.total_gb,
    traffic_up: u.traffic_up,
    traffic_down: u.traffic_down,
    used_text: fmtBytes(u.traffic_up + u.traffic_down),
    total_text: u.total_gb > 0 ? fmtBytes(u.total_gb * 1073741824) : "∞",
    expiry_time: u.expiry_time,
  }));
  const referralCfg = getReferralProgram();
  const inviterIds = linked.map((u) => u.id);
  const rewardRows = listReferralRewardsForInviterUsers(inviterIds).sort((a, b) => {
    const ta = Date.parse(a.created_at || "");
    const tb = Date.parse(b.created_at || "");
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  const botName = String(process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  const inviteLink = linked[0] && botName ? `https://t.me/${botName}?start=ref_${linked[0].id}` : "";
  const shop = getSubscriptionShop();
  res.json({
    tg_id: tgId,
    name: displayName,
    avatar_url: avatarDataUrl,
    stats_html: linked.length > 0 ? formatStatsHtml(linked) : "Подписок пока нет.",
    subscriptions,
    payment_url: shop.payment_url.trim() || getTelegramPaymentUrl(),
    plans: shop.plans,
    referral: {
      enabled: referralCfg.enabled,
      invite_copy_text: referralCfg.invite_copy_text,
      invite_link: inviteLink,
      invited_friends: rewardRows.map((r) => ({
        reward_id: r.id,
        name: String(r.invitee_name || "Пользователь"),
        tg_user_id: r.invitee_tg_user_id,
        status: r.status,
        created_at: r.created_at,
        reward_gb: r.reward_gb,
        reward_days: r.reward_days,
      })),
    },
  });
});

router.post("/webapp/referral-reward", async (req, res) => {
  const body = (req.body ?? {}) as ClaimReferralBody;
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  const rewardId = String(body.reward_id ?? "").trim();
  const kind = String(body.kind ?? "").trim().toLowerCase();
  if (!tgId || !rewardId || (kind !== "gb" && kind !== "days")) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const reward = getReferralReward(rewardId);
  if (!reward || reward.status !== "pending") {
    res.status(404).json({ error: "reward_not_found" });
    return;
  }
  const inviter = getUser(reward.inviter_user_id);
  if (!inviter || String(inviter.tg_id ?? "").trim() !== String(tgId).trim()) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (kind === "gb") {
    if (inviter.total_gb <= 0) {
      res.status(400).json({ error: "inviter_unlimited_choose_days" });
      return;
    }
    updateUserRow(inviter.id, { total_gb: inviter.total_gb + reward.reward_gb });
  } else {
    const base = Math.max(Date.now(), inviter.expiry_time > 0 ? inviter.expiry_time : 0);
    updateUserRow(inviter.id, { expiry_time: base + reward.reward_days * 86400000 });
  }
  claimReferralReward(reward.id, kind);
  try {
    await pushClientListToAllDeployedServers();
  } catch {
    // ignore sync errors for UI flow
  }
  res.json({ ok: true });
});

function parseDataUrl(input: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(input.trim());
  if (!m) return null;
  const mime = m[1] || "image/jpeg";
  const b64 = m[2] || "";
  try {
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return null;
    return { mime, bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
}

router.post("/webapp/payment-proof", async (req, res) => {
  const body = (req.body ?? {}) as SendProofBody;
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  const rawUserId = Number(body.user_id);
  const userId = Number.isFinite(rawUserId) && rawUserId > 0 ? Math.floor(rawUserId) : 0;
  const planId = Number(body.plan_id);
  if (!tgId || !Number.isFinite(planId) || ![1, 2, 3].includes(planId)) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const newSubscriptionName = String(body.new_subscription_name ?? "").trim().slice(0, 25);
  const linked = findUsersByTelegramChatId(tgId);
  const target = userId > 0 ? linked.find((u) => u.id === userId) ?? null : null;
  if (userId > 0 && !target) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const b64 = String(body.photo_base64 ?? "").trim();
  const parsed = parseDataUrl(b64);
  if (!parsed) {
    res.status(400).json({ error: "invalid_photo" });
    return;
  }
  const shop = getSubscriptionShop();
  const plan = shop.plans.find((p) => p.id === planId);
  if (!plan) {
    res.status(400).json({ error: "bad_plan" });
    return;
  }
  const caption =
    `<b>Оплата из WebApp</b>\n` +
    `Пользователь: <b>${String(ver.user.first_name ?? "").trim() || target?.name || "Пользователь"}</b> (chat <code>${tgId}</code>)\n` +
    (target
      ? `Подписка: <b>#${target.id} ${target.name}</b>\n`
      : `Новая подписка: <b>${newSubscriptionName || "Без названия"}</b>\n`) +
    `Тариф: <b>${plan.id}</b> — ${plan.total_gb > 0 ? `${plan.total_gb} ГБ` : "безлимит"} / ${plan.days} дн.\n` +
    `Сумма: <b>${plan.price_rub} ₽</b>`;
  const sessionId = startPaymentAwaitingProof(
    tgId,
    tgId,
    plan.id,
    "subscription",
    target?.id,
    target ? undefined : newSubscriptionName || "Новая подписка",
    { username: String(ver.user.username ?? "").trim() || undefined, first_name: String(ver.user.first_name ?? "").trim() || undefined },
  );
  markPaymentSessionPendingAdmin(sessionId, "webapp");

  let sent = 0;
  const admins = getTelegramPaymentNotifyChatIds();
  for (const chatId of admins) {
    try {
      await sendTelegramPhotoBinary(chatId, parsed.bytes, {
        caption,
        filename: String(body.photo_name ?? "proof.jpg").trim() || "proof.jpg",
        mimeType: String(body.photo_mime ?? parsed.mime) || parsed.mime,
        parse_mode: "HTML",
        reply_markup: adminDecisionKeyboard(sessionId),
      });
      sent++;
    } catch {
      // skip
    }
  }
  if (sent === 0) {
    res.status(502).json({ error: "send_failed" });
    return;
  }
  res.json({ ok: true });
});

export default router;
