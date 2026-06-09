import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  applyPromoCodeForUser,
  claimReferralReward,
  finishDropperPlay,
  findUsersByTelegramChatId,
  getDropperGameConfig,
  getDropperStatsForTgUser,
  getGameTicketsPerPurchase,
  getReferralReward,
  getReferralProgram,
  getSubscriptionShop,
  getWebAppActiveGame,
  createSupportAppeal,
  getSupportAppeal,
  getSupportAppealsConfig,
  patchSupportAppealPhotoPaths,
  getUser,
  listReferralRewardsForInviterUsers,
  markPaymentSessionPendingAdmin,
  registerPromoCodeUsage,
  startDropperPlaySession,
  startPaymentAwaitingProof,
  sumDropperTicketsForTgUser,
  exchangeRouletteGbPiggyForTicket,
  getRouletteGbPiggy,
  getRoulettePurchaseDiscount,
  listRouletteSpinsForTgUser,
  listRouletteTicketPurchasesForTgUser,
  ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD,
  userHasUnlimitedTrafficForRoulette,
  updateUserRow,
  userAllowedOnServers,
  userHasActiveSubscription,
  type UserRow,
} from "../db.js";
import { formatStatsHtml, fmtBytes, subscriptionPublicName } from "../telegram/format.js";
import { notifyDropperPrizeApplied } from "../telegram/dropperTickets.js";
import { getRoulettePublicConfig, notifyRouletteSpinToUser, spinRouletteForUser } from "../rouletteGame.js";
import { buyRouletteTicketsForUser, getRouletteTicketShopPublicForUser } from "../rouletteTicketShop.js";
import { getTelegramBotToken, getTelegramPaymentNotifyChatIds, getTelegramPaymentUrl } from "../telegram/env.js";
import { sendTelegramHtml, sendTelegramPhotoBinary } from "../telegram/api.js";
import { escHtml } from "../telegram/format.js";
import { pushClientListToAllDeployedServers } from "../userSync.js";
import { saveAppealUserPhoto } from "../supportAppealFiles.js";
import { notifyAdminsNewSupportAppeal } from "../supportAppealsNotify.js";
import { getTestPlanRuntimeMeta, isTestSubscriptionEligible } from "../testSubscription.js";
import { formatAdminPaymentAmountLine, resolvePurchasePrice } from "../purchaseDiscount.js";
import {
  buildWhitelistOfferForMiniApp,
  checkWhitelistPurchaseAllowed,
  createPendingWhitelistPurchase,
  findActiveSubscriptionForTg,
  findWhitelistPurchaseTarget,
  getWhitelistPurchasePriceRub,
  logWhitelistPurchaseOpened,
} from "../whitelistPurchaseService.js";
import { getWhitelistVaultSettings } from "../whitelistVaultDb.js";

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
  pay_kind?: unknown;
  user_id?: unknown;
  plan_id?: unknown;
  photo_base64?: unknown;
  photo_mime?: unknown;
  photo_name?: unknown;
  new_subscription_name?: unknown;
  promo_code?: unknown;
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

function subscriptionProfileStats(u: UserRow) {
  const now = Date.now();
  const active = userHasActiveSubscription(u);
  const allowed = userAllowedOnServers(u);
  const unlimitedTime = u.expiry_time <= 0;
  const unlimitedTraffic = u.total_gb <= 0;
  let remaining_ms: number | null = null;
  let remaining_days: number | null = null;
  if (u.expiry_time > 0) {
    remaining_ms = Math.max(0, u.expiry_time - now);
    remaining_days = remaining_ms > 0 ? Math.max(1, Math.ceil(remaining_ms / 86400000)) : 0;
  }
  let traffic_percent: number | null = null;
  let remaining_gb: number | null = null;
  if (u.total_gb > 0) {
    const limit = u.total_gb * 1073741824;
    const used = u.traffic_up + u.traffic_down;
    traffic_percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    remaining_gb = Math.max(0, Math.round((u.total_gb - used / (1024 * 1024 * 1024)) * 100) / 100);
  }
  const time_progress =
    unlimitedTime || remaining_ms == null
      ? null
      : remaining_ms <= 0
        ? 0
        : Math.min(100, Math.round((remaining_ms / (30 * 86400000)) * 100));
  return {
    subscription_active: active,
    access_ok: allowed,
    unlimited_time: unlimitedTime,
    unlimited_traffic: unlimitedTraffic,
    remaining_ms,
    remaining_days,
    remaining_gb,
    time_progress,
    traffic_percent,
    expiry_label:
      u.expiry_time > 0
        ? new Date(u.expiry_time).toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })
        : null,
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
    stats: subscriptionProfileStats(u),
    tickets: u.dropper_tickets,
    gb_piggy:
      u.total_gb <= 0
        ? {
            accumulated_gb: getRouletteGbPiggy(u.id),
            exchange_threshold: ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD,
            can_exchange: getRouletteGbPiggy(u.id) >= ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD,
          }
        : null,
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
  const testPlan = shop.test_plan;
  const testAvailable = isTestSubscriptionEligible(tgId);
  const dg = getDropperGameConfig();
  const activeGame = getWebAppActiveGame();
  const dgStats = getDropperStatsForTgUser(tgId);
  const tickets = sumDropperTicketsForTgUser(tgId);
  const ticketsPerPurchase = getGameTicketsPerPurchase();
  const wlTarget = findWhitelistPurchaseTarget(tgId, linked);
  const whitelist = buildWhitelistOfferForMiniApp(linked, tgId);
  const instrPhotoPath = getWhitelistVaultSettings().instruction.photo_path;
  const base = String(process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
  const whitelist_instruction_photo_url =
    instrPhotoPath && base
      ? `${base}/api/whitelist-vault/instruction/photo/${encodeURIComponent(instrPhotoPath)}`
      : null;
  res.json({
    tg_id: tgId,
    name: displayName,
    avatar_url: avatarDataUrl,
    stats_html: linked.length > 0 ? formatStatsHtml(linked) : "Подписок пока нет.",
    subscriptions,
    payment_url: shop.payment_url.trim() || getTelegramPaymentUrl(),
    plans: shop.plans,
    topup_plans: shop.topup_plans,
    test_plan: {
      enabled: testPlan.enabled,
      available: testAvailable,
      title: testPlan.title,
      total_gb: testPlan.total_gb,
      days: testPlan.days,
      price_rub: testPlan.price_rub,
    },
    sales_disabled_for_new: linked.length === 0 && shop.sales_disabled,
    roulette_purchase_discount: (() => {
      const d = getRoulettePurchaseDiscount(tgId);
      return d ? { discount_percent: d.discount_percent } : null;
    })(),
    active_game: activeGame,
    game_tab_visible: activeGame !== "none",
    tickets_per_purchase: ticketsPerPurchase,
    dropper: {
      enabled: activeGame === "dropper",
      tickets,
      reward_gb: dg.reward_gb,
      reward_days: dg.reward_days,
      flight_duration_sec: dg.flight_duration_sec,
      flight_speed_mult: dg.flight_speed_mult,
      side_hit_death_enabled: dg.side_hit_death_enabled,
      plays: dgStats.plays,
      wins: dgStats.wins,
      won_gb: dgStats.won_gb,
      won_days: dgStats.won_days,
    },
    roulette: {
      ...getRoulettePublicConfig(),
      tickets,
      ticket_shop: getRouletteTicketShopPublicForUser(tgId),
      history: listRouletteSpinsForTgUser(tgId, 20).map((s) => ({
        kind: "spin" as const,
        id: s.id,
        date: s.created_at,
        prize: s.prize_title,
        status: s.status,
        error_message: s.error_message,
      })),
      ticket_purchase_history: listRouletteTicketPurchasesForTgUser(tgId, 20).map((t) => ({
        kind: "ticket_purchase" as const,
        id: t.id,
        date: t.created_at,
        tickets: t.amount,
        payment_type: t.source === "purchase_for_days" ? ("subscription_days" as const) : ("traffic_gb" as const),
        cost: t.spent_resource_amount ?? 0,
      })),
    },
    support_appeals: {
      enabled: getSupportAppealsConfig().enabled,
    },
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
    whitelist: {
      ...whitelist,
      instruction: {
        ...whitelist.instruction,
        photo_url: whitelist_instruction_photo_url,
      },
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

router.post("/webapp/promo/preview", async (req, res) => {
  const body = (req.body ?? {}) as { init_data?: unknown; code?: unknown; original_price_rub?: unknown };
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  const code = String(body.code ?? "").trim();
  const original = Math.max(0, Math.floor(Number(body.original_price_rub) || 0));
  if (!tgId || !code) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  try {
    const calc = applyPromoCodeForUser({
      code,
      tg_user_id: tgId,
      original_price_rub: original,
    });
    res.json(calc);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "promo_not_found") {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg === "promo_already_used") {
      res.status(409).json({ error: msg });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

type SupportAppealBody = {
  init_data?: unknown;
  text?: unknown;
  photos?: unknown;
};

router.post("/webapp/support-appeal", async (req, res) => {
  const body = (req.body ?? {}) as SupportAppealBody;
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  if (!getSupportAppealsConfig().enabled) {
    res.status(403).json({ error: "support_disabled" });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  if (!tgId) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const text = String(body.text ?? "").trim().slice(0, 8000);
  const photosRaw = Array.isArray(body.photos) ? body.photos : [];
  const photoParts: { mime: string; bytes: Uint8Array; name: string }[] = [];
  for (const item of photosRaw.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const o = item as { base64?: unknown; mime?: unknown; name?: unknown };
    const b64 = String(o.base64 ?? "").trim();
    const parsed = parseDataUrl(b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`);
    if (!parsed) continue;
    photoParts.push({
      mime: String(o.mime ?? parsed.mime) || parsed.mime,
      bytes: parsed.bytes,
      name: String(o.name ?? "photo.jpg").trim() || "photo.jpg",
    });
  }
  if (!text && photoParts.length === 0) {
    res.status(400).json({ error: "empty_appeal" });
    return;
  }
  try {
    const linkedAppeal = findUsersByTelegramChatId(tgId);
    const row = createSupportAppeal({
      tg_chat_id: tgId,
      tg_user_id: tgId,
      tg_username: String(ver.user.username ?? "").trim() || undefined,
      tg_first_name: String(ver.user.first_name ?? "").trim() || undefined,
      user_id: linkedAppeal[0]?.id,
      text: text || "(без текста)",
      photo_file_ids: [],
      photo_paths: [],
      source: "webapp",
    });
    const photoPaths: string[] = [];
    for (let i = 0; i < photoParts.length; i++) {
      const p = photoParts[i]!;
      photoPaths.push(saveAppealUserPhoto(row.id, i, Buffer.from(p.bytes), p.mime));
    }
    if (photoPaths.length > 0) {
      patchSupportAppealPhotoPaths(row.id, photoPaths);
    }
    const appealForNotify = getSupportAppeal(row.id) ?? row;
    await notifyAdminsNewSupportAppeal(appealForNotify);
    const tag =
      ver.user.username && String(ver.user.username).trim()
        ? `@${escHtml(String(ver.user.username).replace(/^@/, ""))}`
        : escHtml(String(ver.user.first_name ?? "").trim() || `id ${tgId}`);
    const panelBase = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
    const captionBase =
      `📩 <b>Обращение из WebApp</b>\n` +
      `Пользователь: <b>${tag}</b> (chat <code>${tgId}</code>)\n\n` +
      `${text ? escHtml(text.slice(0, 500)) : "<i>без текста</i>"}\n\n` +
      (panelBase
        ? `Перейдите в панель «Обращения»: <a href="${escHtml(panelBase)}/support-appeals">${escHtml(panelBase)}/support-appeals</a>`
        : "");
    const admins = getTelegramPaymentNotifyChatIds();
    for (const adminChat of admins) {
      try {
        if (photoParts.length === 0) {
          await sendTelegramHtml(adminChat, captionBase);
        } else {
          for (let i = 0; i < photoParts.length; i++) {
            const p = photoParts[i]!;
            await sendTelegramPhotoBinary(adminChat, p.bytes, {
              caption: i === 0 ? captionBase : undefined,
              filename: p.name,
              mimeType: p.mime,
              parse_mode: "HTML",
            });
          }
        }
      } catch {
        // skip admin
      }
    }
    res.json({ ok: true, appeal_id: row.id });
  } catch (e) {
    console.error("[mysub] support-appeal:", e);
    res.status(500).json({ error: "submit_failed" });
  }
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
  const payKindRaw = String(body.pay_kind ?? "subscription").trim().toLowerCase();
  const payKind =
    payKindRaw === "topup"
      ? "topup"
      : payKindRaw === "test"
        ? "test"
        : payKindRaw === "white_lists"
          ? "white_lists"
          : "subscription";
  if (!tgId) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  if (payKind !== "test" && payKind !== "white_lists" && (!Number.isFinite(planId) || ![1, 2, 3].includes(planId))) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const newSubscriptionName = String(body.new_subscription_name ?? "").trim().slice(0, 25);
  const promoCode = String(body.promo_code ?? "").trim().replace(/\s+/g, "");
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

  if (linked.length === 0 && shop.sales_disabled) {
    res.status(403).json({ error: "sales_disabled" });
    return;
  }

  if (linked.length === 0 && shop.sales_disabled) {
    res.status(403).json({ error: "sales_disabled" });
    return;
  }

  if (payKind === "white_lists") {
    logWhitelistPurchaseOpened("webapp", tgId);
    if (promoCode) {
      res.status(400).json({ error: "promo_not_allowed_for_whitelist" });
      return;
    }
    const wlUser = target ?? findActiveSubscriptionForTg(tgId, linked);
    if (!wlUser) {
      res.status(403).json({ error: "no_active_subscription" });
      return;
    }
    const check = checkWhitelistPurchaseAllowed(wlUser);
    if (!check.ok) {
      res.status(403).json({ error: check.code, message: check.message });
      return;
    }
    const price = getWhitelistPurchasePriceRub();
    const caption =
      `<b>Оплата из WebApp (белые списки)</b>\n` +
      `Пользователь: <b>${String(ver.user.first_name ?? "").trim() || wlUser.name || "Пользователь"}</b> (chat <code>${tgId}</code>)\n` +
      `Подписка: <b>${escHtml(subscriptionPublicName(wlUser))}</b>\n` +
      `Сумма: <b>${price} ₽</b>`;
    const sessionId = startPaymentAwaitingProof(
      tgId,
      tgId,
      1,
      "white_lists",
      wlUser.id,
      undefined,
      {
        username: String(ver.user.username ?? "").trim() || undefined,
        first_name: String(ver.user.first_name ?? "").trim() || undefined,
      },
    );
    createPendingWhitelistPurchase({ user: wlUser, payment_id: sessionId, amount: price });
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
    return;
  }

  if (payKind === "test") {
    if (promoCode) {
      res.status(400).json({ error: "promo_not_allowed_for_test" });
      return;
    }
    if (linked.length > 0 || !isTestSubscriptionEligible(tgId)) {
      res.status(403).json({ error: "test_not_available" });
      return;
    }
    const meta = getTestPlanRuntimeMeta();
    const caption =
      `<b>Оплата из WebApp (тестовая подписка)</b>\n` +
      `Пользователь: <b>${String(ver.user.first_name ?? "").trim() || "Пользователь"}</b> (chat <code>${tgId}</code>)\n` +
      `Тест: ${meta.total_gb > 0 ? `${meta.total_gb} ГБ` : "безлимит"} / ${meta.days} дн.\n` +
      `Сумма: <b>${meta.priceRub} ₽</b>`;
    const sessionId = startPaymentAwaitingProof(
      tgId,
      tgId,
      1,
      "test",
      undefined,
      undefined,
      {
        username: String(ver.user.username ?? "").trim() || undefined,
        first_name: String(ver.user.first_name ?? "").trim() || undefined,
      },
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
    return;
  }

  if (payKind === "topup") {
    if (userId <= 0 || !target) {
      res.status(400).json({ error: "topup_target_required" });
      return;
    }
    const top = shop.topup_plans.find((p) => p.id === planId);
    if (!top) {
      res.status(400).json({ error: "bad_plan" });
      return;
    }
    let priceRes;
    try {
      priceRes = resolvePurchasePrice({
        tg_user_id: tgId,
        original_price_rub: top.price_rub,
        promo_code: promoCode || undefined,
        allow_referral: false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "promo_not_found") {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg === "promo_already_used") {
        res.status(409).json({ error: msg });
        return;
      }
      if (msg === "promo_inactive") {
        res.status(400).json({ error: msg });
        return;
      }
      if (msg === "promo_expired") {
        res.status(400).json({ error: msg });
        return;
      }
      res.status(400).json({ error: msg });
      return;
    }
    const promoLine = priceRes.promo_calc
      ? `\nПромокод: <b>${escHtml(priceRes.promo_calc.promo.code)}</b> (скидка ${priceRes.discount_percent}%)`
      : "";
    const caption =
      `<b>Оплата из WebApp (докупка ГБ)</b>\n` +
      `Пользователь: <b>${String(ver.user.first_name ?? "").trim() || target.name || "Пользователь"}</b> (chat <code>${tgId}</code>)\n` +
      `Подписка: <b>${escHtml(subscriptionPublicName(target))}</b>\n` +
      `Пакет докупки: <b>${top.id}</b> — +${top.add_gb} ГБ\n` +
      formatAdminPaymentAmountLine(top.price_rub, {
        roulette_discount_percent: priceRes.roulette_discount?.percent,
        referral_discount_percent: priceRes.referral_discount_percent,
      }) +
      promoLine;
    const sessionId = startPaymentAwaitingProof(
      tgId,
      tgId,
      top.id,
      "topup",
      target.id,
      undefined,
      { username: String(ver.user.username ?? "").trim() || undefined, first_name: String(ver.user.first_name ?? "").trim() || undefined },
      {
        roulette_discount_percent: priceRes.roulette_discount?.percent,
        roulette_discount_spin_id: priceRes.roulette_discount?.spin_id,
      },
    );
    if (priceRes.promo_calc) {
      try {
        registerPromoCodeUsage({
          code: priceRes.promo_calc.promo.code,
          tg_user_id: tgId,
          tg_username: String(ver.user.username ?? "").trim() || undefined,
          tg_first_name: String(ver.user.first_name ?? "").trim() || undefined,
          session_id: sessionId,
        });
      } catch {
        // no-op
      }
    }
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
    return;
  }

  const plan = shop.plans.find((p) => p.id === planId);
  if (!plan) {
    res.status(400).json({ error: "bad_plan" });
    return;
  }
  let priceRes;
  try {
    priceRes = resolvePurchasePrice({
      tg_user_id: tgId,
      original_price_rub: plan.price_rub,
      promo_code: promoCode || undefined,
      target_user_id: target?.id,
      new_subscription_name: target ? undefined : newSubscriptionName || "Новая подписка",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "promo_not_found") {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg === "promo_already_used") {
      res.status(409).json({ error: msg });
      return;
    }
    if (msg === "promo_inactive") {
      res.status(400).json({ error: msg });
      return;
    }
    if (msg === "promo_expired") {
      res.status(400).json({ error: msg });
      return;
    }
    res.status(400).json({ error: msg });
    return;
  }
  const promoLine = priceRes.promo_calc
    ? `\nПромокод: <b>${escHtml(priceRes.promo_calc.promo.code)}</b> (скидка ${priceRes.discount_percent}%)`
    : "";

  const caption =
    `<b>Оплата из WebApp</b>\n` +
    `Пользователь: <b>${String(ver.user.first_name ?? "").trim() || target?.name || "Пользователь"}</b> (chat <code>${tgId}</code>)\n` +
    (target
      ? `Подписка: <b>${escHtml(subscriptionPublicName(target))}</b>\n`
      : `Новая подписка: <b>${newSubscriptionName || "Без названия"}</b>\n`) +
    `Тариф: <b>${plan.id}</b> — ${plan.total_gb > 0 ? `${plan.total_gb} ГБ` : "безлимит"} / ${plan.days} дн.\n` +
    formatAdminPaymentAmountLine(plan.price_rub, {
      roulette_discount_percent: priceRes.roulette_discount?.percent,
      referral_discount_percent: priceRes.referral_discount_percent,
    }) +
    promoLine;
  const sessionId = startPaymentAwaitingProof(
    tgId,
    tgId,
    plan.id,
    "subscription",
    target?.id,
    target ? undefined : newSubscriptionName || "Новая подписка",
    { username: String(ver.user.username ?? "").trim() || undefined, first_name: String(ver.user.first_name ?? "").trim() || undefined },
    {
      inviter_user_id: priceRes.referral_inviter_user_id,
      discount_percent: priceRes.referral_discount_percent,
      roulette_discount_percent: priceRes.roulette_discount?.percent,
      roulette_discount_spin_id: priceRes.roulette_discount?.spin_id,
    },
  );
  if (priceRes.promo_calc) {
    try {
      registerPromoCodeUsage({
        code: priceRes.promo_calc.promo.code,
        tg_user_id: tgId,
        tg_username: String(ver.user.username ?? "").trim() || undefined,
        tg_first_name: String(ver.user.first_name ?? "").trim() || undefined,
        session_id: sessionId,
      });
    } catch {
      // no-op: validated above, ignore race
    }
  }
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

router.post("/webapp/dropper/start", (req, res) => {
  const body = (req.body ?? {}) as { init_data?: unknown; user_id?: unknown; practice?: unknown };
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  const practice = body.practice === true || body.practice === 1 || body.practice === "1";
  const uid = Math.floor(Number(body.user_id));
  if (!tgId) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  if (!practice && (!Number.isFinite(uid) || uid <= 0)) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const started = startDropperPlaySession(tgId, practice && (!Number.isFinite(uid) || uid <= 0) ? 0 : uid, { practice });
  if (!started.ok) {
    const code = started.error;
    if (code === "game_disabled") {
      res.status(403).json({ error: code });
      return;
    }
    if (code === "no_tickets") {
      res.status(409).json({ error: code });
      return;
    }
    if (code === "forbidden") {
      res.status(403).json({ error: code });
      return;
    }
    res.status(400).json({ error: code });
    return;
  }
  res.json({ session_id: started.session_id, seed: started.seed });
});

router.post("/webapp/dropper/finish", async (req, res) => {
  const body = (req.body ?? {}) as {
    init_data?: unknown;
    session_id?: unknown;
    won?: unknown;
    flight_ms?: unknown;
    choice?: unknown;
    reward_user_id?: unknown;
  };
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  const sessionId = String(body.session_id ?? "").trim();
  const won = body.won === true || body.won === 1 || body.won === "1";
  const flightMs = Math.max(0, Math.floor(Number(body.flight_ms) || 0));
  const ch = String(body.choice ?? "").trim().toLowerCase();
  const choice = ch === "gb" || ch === "days" ? (ch as "gb" | "days") : undefined;
  const rewardUserRaw = body.reward_user_id;
  const rewardUserId =
    rewardUserRaw != null && rewardUserRaw !== ""
      ? Math.floor(Number(rewardUserRaw))
      : undefined;
  if (!tgId || !sessionId) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const result = finishDropperPlay({
    tgUserId: tgId,
    sessionId,
    won,
    flightMs,
    choice,
    rewardUserId:
      rewardUserId != null && Number.isFinite(rewardUserId) && rewardUserId > 0 ? rewardUserId : undefined,
  });
  if (!result.ok) {
    if (result.error === "choice_required") {
      res.status(400).json({ error: result.error });
      return;
    }
    if (result.error === "session_not_found") {
      res.status(404).json({ error: result.error });
      return;
    }
    res.status(400).json({ error: result.error });
    return;
  }
  if (result.prizeApplied) {
    try {
      await notifyDropperPrizeApplied(tgId, result.prizeApplied);
    } catch (e) {
      console.error("[mysub] dropper prize telegram:", e);
    }
  }
  if (!result.practice) {
    try {
      await pushClientListToAllDeployedServers();
    } catch {
      // ignore
    }
  }
  res.json({ ok: true });
});

router.post("/webapp/roulette/spin", async (req, res) => {
  const body = (req.body ?? {}) as { init_data?: unknown; user_id?: unknown };
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  if (!tgId) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const userId = Math.floor(Number(body.user_id));
  const result = await spinRouletteForUser(tgId, {
    user_id: Number.isFinite(userId) && userId > 0 ? userId : undefined,
  });
  if (!result.ok) {
    const err = result.error ?? "spin_failed";
    if (err.includes("билет") || err.includes("ticket") || err === "no_tickets") {
      res.status(409).json({ error: err });
      return;
    }
    if (err.includes("выключ") || err.includes("disabled")) {
      res.status(403).json({ error: err });
      return;
    }
    res.status(400).json({ error: err });
    return;
  }
  try {
    await pushClientListToAllDeployedServers();
  } catch {
    // ignore
  }
  const piggyUserId = result.spin?.user_id;
  const piggyGb =
    piggyUserId && userHasUnlimitedTrafficForRoulette(piggyUserId) ? getRouletteGbPiggy(piggyUserId) : null;
  res.json({
    ok: true,
    prize: result.prize,
    prize_index: result.prize_index,
    tickets_remaining: result.tickets_remaining,
    user_id: piggyUserId,
    spin: result.spin,
    ...(piggyGb != null
      ? {
          gb_piggy: {
            accumulated_gb: piggyGb,
            exchange_threshold: ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD,
            can_exchange: piggyGb >= ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD,
          },
        }
      : {}),
  });
});

router.post("/webapp/roulette/exchange-piggy", async (req, res) => {
  const body = (req.body ?? {}) as { init_data?: unknown; user_id?: unknown };
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  const userId = Math.floor(Number(body.user_id));
  if (!tgId || !Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const result = exchangeRouletteGbPiggyForTicket(tgId, userId);
  if (!result.ok) {
    const code = result.error;
    if (code === "not_enough_gb") {
      res.status(409).json({ error: code });
      return;
    }
    if (code === "piggy_not_available") {
      res.status(403).json({ error: code });
      return;
    }
    res.status(400).json({ error: code });
    return;
  }
  res.json({
    ok: true,
    tickets_remaining: result.tickets_remaining,
    gb_piggy: {
      accumulated_gb: result.accumulated_gb,
      exchange_threshold: ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD,
      can_exchange: result.accumulated_gb >= ROULETTE_GB_PIGGY_EXCHANGE_THRESHOLD,
    },
  });
});

router.post("/webapp/roulette/notify", async (req, res) => {
  const body = (req.body ?? {}) as { init_data?: unknown; spin_id?: unknown };
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  const spinId = Math.floor(Number(body.spin_id));
  if (!tgId || !Number.isFinite(spinId) || spinId <= 0) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const result = await notifyRouletteSpinToUser(tgId, spinId);
  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

router.post("/webapp/roulette/buy-tickets", async (req, res) => {
  const body = (req.body ?? {}) as { init_data?: unknown; paymentType?: unknown; tickets?: unknown; user_id?: unknown };
  const initData = String(body.init_data ?? "").trim();
  const ver = verifyTelegramWebAppInitData(initData);
  if (!ver.ok) {
    res.status(401).json({ error: "tg_webapp_auth_required", reason: ver.reason });
    return;
  }
  const tgId = parseTgId(String(ver.user.id ?? ""));
  if (!tgId) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  const paymentRaw = String(body.paymentType ?? "").trim();
  if (paymentRaw !== "subscription_days" && paymentRaw !== "traffic_gb") {
    res.status(400).json({ error: "Некорректный способ оплаты." });
    return;
  }
  const tickets = Math.floor(Number(body.tickets) || 0);
  if (tickets <= 0) {
    res.status(400).json({ error: "Укажите количество билетов." });
    return;
  }

  const userId = Math.floor(Number(body.user_id));
  const result = await buyRouletteTicketsForUser(
    tgId,
    paymentRaw,
    tickets,
    Number.isFinite(userId) && userId > 0 ? userId : undefined,
  );
  if (!result.ok) {
    const err = result.error;
    if (err.includes("выключ") || err.includes("отключен")) {
      res.status(403).json({ error: err });
      return;
    }
    if (err.includes("Недостаточно") || err.includes("безлимит") || err.includes("Минималь") || err.includes("Максималь")) {
      res.status(409).json({ error: err });
      return;
    }
    res.status(400).json({ error: err });
    return;
  }

  try {
    await pushClientListToAllDeployedServers();
  } catch {
    // ignore
  }

  res.json({
    ok: true,
    tickets_count: result.tickets_count,
    tickets_added: result.tickets_added,
    cost: result.cost,
    payment_type: result.payment_type,
    remaining_days: result.remaining_days,
    remaining_gb: result.remaining_gb,
  });
});

export default router;
