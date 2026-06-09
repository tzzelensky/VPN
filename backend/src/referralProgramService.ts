import {
  getReferralProgram,
  getUser,
  listAllReferralRewards,
  listReferralAdminGifts,
  listReferralInvites,
  listReferralSettingsHistory,
  type ReferralAdminGiftRow,
  type ReferralProgramConfig,
  type ReferralRewardRow,
  type ReferralSettingsChangeRow,
} from "./db.js";
import { getPanelSettings } from "./panelSettings.js";
import { sampleReferralLink } from "./referralInviteText.js";
import { subscriptionPublicName } from "./telegram/format.js";

export type ReferralStatsDto = {
  total_invites: number;
  active_invites: number;
  gb_issued: number;
  days_issued: number;
  avg_discount_percent: number | null;
  conversion_percent: number | null;
  manual_gifts_count: number;
};

export type ReferralEventKind = "invitation" | "reward" | "admin_gift" | "error";

export type ReferralEventDto = {
  kind: ReferralEventKind;
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

export type ReferralMetaDto = {
  bot_username: string;
  brand_name: string;
  sample_ref_link: string;
};

function userPublicName(userId: number, fallback = ""): string {
  const u = getUser(userId);
  if (u) return subscriptionPublicName(u).trim() || fallback || `Клиент #${userId}`;
  return fallback || `Клиент #${userId}`;
}

function rewardStatusRu(r: ReferralRewardRow): { status: string; note?: string; legacy?: boolean } {
  if (r.status === "pending") return { status: "ожидает выбора награды" };
  if (r.claimed_kind === "gb" || r.claimed_kind === "days") return { status: "начислено" };
  return {
    status: "начислено",
    note: "в старых записях тип подарка не сохранялся",
    legacy: true,
  };
}

function inviterRewardText(r: ReferralRewardRow, claimed: boolean): string {
  if (!claimed) return `до +${r.reward_gb} ГБ или +${r.reward_days} дн.`;
  if (r.claimed_kind === "gb") return `+${r.reward_gb} ГБ`;
  if (r.claimed_kind === "days") return `+${r.reward_days} дн.`;
  return "награда получена";
}

export function getReferralMeta(): ReferralMetaDto {
  const bot = (process.env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  const brand = getPanelSettings().panel.brandName.trim() || "HSN";
  return {
    bot_username: bot,
    brand_name: brand,
    sample_ref_link: sampleReferralLink(bot),
  };
}

export function computeReferralStats(): ReferralStatsDto {
  const cfg = getReferralProgram();
  const invites = listReferralInvites();
  const rewards = listAllReferralRewards();
  const gifts = listReferralAdminGifts();
  const active_invites = invites.filter((i) => i.consumed === 0).length;
  const total_invites = invites.length;

  let gb_issued = 0;
  let days_issued = 0;
  for (const r of rewards) {
    if (r.status !== "claimed") continue;
    if (r.claimed_kind === "gb") gb_issued += r.reward_gb;
    else if (r.claimed_kind === "days") days_issued += r.reward_days;
  }
  for (const g of gifts) {
    if (g.kind === "gb") gb_issued += g.amount;
    else days_issued += g.amount;
  }

  const avg_discount_percent = rewards.length > 0 ? cfg.invited_discount_percent : null;

  const conversion_percent =
    total_invites > 0 ? Math.round((rewards.length / total_invites) * 1000) / 10 : null;

  return {
    total_invites,
    active_invites,
    gb_issued,
    days_issued,
    avg_discount_percent,
    conversion_percent,
    manual_gifts_count: gifts.length,
  };
}

export function buildReferralEvents(): ReferralEventDto[] {
  const cfg = getReferralProgram();
  const events: ReferralEventDto[] = [];

  for (const inv of listReferralInvites()) {
    const inviter = userPublicName(inv.inviter_user_id);
    const hasReward = listAllReferralRewards().some((r) => r.invitee_tg_user_id === inv.tg_user_id);
    if (hasReward) continue;
    events.push({
      kind: "invitation",
      created_at: inv.created_at,
      inviter_name: inviter,
      invitee_name: `Telegram ${inv.tg_user_id}`,
      reward_text: `скидка ${cfg.invited_discount_percent}%`,
      status: inv.consumed === 1 ? "ссылка использована" : "ожидает покупки",
    });
  }

  for (const r of listAllReferralRewards()) {
    const inviter = userPublicName(r.inviter_user_id);
    const invitee = (r.invitee_name && r.invitee_name.trim()) || `Telegram ${r.invitee_tg_user_id}`;
    const st = rewardStatusRu(r);
    let reward_text = inviterRewardText(r, r.status === "claimed");
    if (r.status === "pending") reward_text = "награда ещё не выбрана";

    events.push({
      kind: "reward",
      created_at: r.created_at,
      inviter_name: inviter,
      invitee_name: invitee,
      reward_text,
      status: st.status,
      status_note: st.note,
      legacy: st.legacy,
    });
  }

  for (const g of listReferralAdminGifts()) {
    const giftRu = g.kind === "gb" ? `+${g.amount} ГБ` : `+${g.amount} дн.`;
    const base: ReferralEventDto = {
      kind: "admin_gift",
      created_at: g.created_at,
      user_name: g.user_name.trim() || userPublicName(g.user_id),
      inviter_name: g.granted_by?.trim() || "Администратор",
      invitee_name: g.user_name.trim() || userPublicName(g.user_id),
      reward_text: giftRu,
      status: g.telegram_sent === false ? "ошибка отправки" : "начислено",
      admin_comment: g.admin_comment,
      granted_by: g.granted_by,
      telegram_sent: g.telegram_sent ?? null,
    };
    events.push(base);
    if (g.telegram_sent === false) {
      events.push({
        ...base,
        kind: "error",
        status: "Telegram не доставлен",
        line: `Не удалось отправить сообщение о подарке «${base.invitee_name}».`,
      });
    }
  }

  return events.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function buildReferralReport(): ReferralReportRowDto[] {
  const cfg = getReferralProgram();
  const rewards = listAllReferralRewards();
  const invites = listReferralInvites();
  const rows: ReferralReportRowDto[] = [];

  for (const r of rewards) {
    const inviter = userPublicName(r.inviter_user_id);
    const invitee = (r.invitee_name && r.invitee_name.trim()) || `Telegram ${r.invitee_tg_user_id}`;
    const claimed = r.status === "claimed";
    rows.push({
      inviter_name: inviter,
      invitee_name: invitee,
      invited_at: r.created_at,
      purchased: true,
      discount_percent: cfg.invited_discount_percent,
      inviter_reward: inviterRewardText(r, claimed),
      invitee_reward: `скидка ${cfg.invited_discount_percent}%`,
      status: claimed ? "награда начислена" : "ожидает выбора награды",
      rewarded_at: claimed ? r.created_at : null,
    });
  }

  for (const inv of invites) {
    if (rewards.some((r) => r.invitee_tg_user_id === inv.tg_user_id)) continue;
    rows.push({
      inviter_name: userPublicName(inv.inviter_user_id),
      invitee_name: `Telegram ${inv.tg_user_id}`,
      invited_at: inv.created_at,
      purchased: inv.consumed === 1,
      discount_percent: cfg.invited_discount_percent,
      inviter_reward: "—",
      invitee_reward: `скидка ${cfg.invited_discount_percent}%`,
      status: inv.consumed === 1 ? "ссылка активирована" : "ожидает покупки",
      rewarded_at: null,
    });
  }

  return rows.sort((a, b) => Date.parse(b.invited_at) - Date.parse(a.invited_at));
}

export function referralSettingsHistoryForClient(): ReferralSettingsChangeRow[] {
  return listReferralSettingsHistory();
}

export function referralEventsToLegacyLines(events: ReferralEventDto[]): { line: string; created_at: string }[] {
  return events.map((e) => {
    if (e.line) return { line: e.line, created_at: e.created_at };
    if (e.kind === "admin_gift" || e.kind === "error") {
      const who = e.invitee_name ?? e.user_name ?? "клиент";
      return {
        line: `${e.granted_by ?? "Админ"} начислил «${who}» — ${e.reward_text ?? "подарок"}.`,
        created_at: e.created_at,
      };
    }
    const inv = e.inviter_name ?? "Пригласивший";
    const guest = e.invitee_name ?? "приглашённый";
    return {
      line: `${inv} пригласил «${guest}» — ${e.reward_text ?? ""} (${e.status ?? ""}).`,
      created_at: e.created_at,
    };
  });
}

export function csvEscape(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function reportToCsv(rows: ReferralReportRowDto[]): string {
  const header = [
    "Пригласивший",
    "Приглашенный",
    "Дата приглашения",
    "Купил",
    "Скидка %",
    "Награда пригласившему",
    "Награда приглашенному",
    "Статус",
    "Дата начисления",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        csvEscape(r.inviter_name),
        csvEscape(r.invitee_name),
        csvEscape(r.invited_at),
        csvEscape(r.purchased ? "да" : "нет"),
        csvEscape(r.discount_percent),
        csvEscape(r.inviter_reward),
        csvEscape(r.invitee_reward),
        csvEscape(r.status),
        csvEscape(r.rewarded_at ?? ""),
      ].join(","),
    ),
  ];
  return "\uFEFF" + lines.join("\r\n");
}

export function eventsToCsv(events: ReferralEventDto[]): string {
  const header = ["Тип", "Кто", "Кому", "Награда", "Статус", "Дата", "Комментарий"];
  const kindRu: Record<ReferralEventKind, string> = {
    invitation: "Приглашение",
    reward: "Награда",
    admin_gift: "Ручной подарок",
    error: "Ошибка",
  };
  const lines = [
    header.join(","),
    ...events.map((e) =>
      [
        csvEscape(kindRu[e.kind] ?? e.kind),
        csvEscape(e.inviter_name ?? e.granted_by ?? ""),
        csvEscape(e.invitee_name ?? e.user_name ?? ""),
        csvEscape(e.reward_text ?? ""),
        csvEscape(e.status ?? ""),
        csvEscape(e.created_at),
        csvEscape(e.admin_comment ?? ""),
      ].join(","),
    ),
  ];
  return "\uFEFF" + lines.join("\r\n");
}
