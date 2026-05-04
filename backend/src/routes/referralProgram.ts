import { Router } from "express";
import {
  getReferralProgram,
  getUser,
  listAllReferralRewards,
  normalizeReferralProgram,
  setReferralProgram,
  type ReferralProgramConfig,
} from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  res.json(getReferralProgram());
});

/** Лог наград за приглашения (для панели). */
router.get("/rewards-log", (_req, res) => {
  const entries = listAllReferralRewards().map((r) => {
    const inv = getUser(r.inviter_user_id);
    const invStr = inv ? `#${inv.id} ${String(inv.name ?? "").trim()}`.trim() : `#${r.inviter_user_id}`;
    const inviteeStr = (r.invitee_name && r.invitee_name.trim()) || `Telegram ${r.invitee_tg_user_id}`;

    let giftRu: string;
    if (r.status === "pending") {
      giftRu = "награда ещё не выбрана";
    } else if (r.claimed_kind === "gb") {
      giftRu = `выбран подарок: +${r.reward_gb} ГБ`;
    } else if (r.claimed_kind === "days") {
      giftRu = `выбран подарок: +${r.reward_days} дн.`;
    } else {
      giftRu = "награда получена (в старых записях тип подарка не сохранялся)";
    }

    const line = `${invStr} пригласил «${inviteeStr}» — для пригласившего (${invStr}): ${giftRu}.`;
    return { line, created_at: r.created_at };
  });
  res.json({ entries });
});

router.put("/", (req, res) => {
  try {
    const next = normalizeReferralProgram(req.body as ReferralProgramConfig);
    setReferralProgram(next);
    res.json(next);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
