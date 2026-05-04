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
    const invLabel = inv ? `User #${inv.id} ${String(inv.name ?? "").trim()}`.trim() : `User #${r.inviter_user_id}`;
    const invitee = (r.invitee_name && r.invitee_name.trim()) || `tg:${r.invitee_tg_user_id}`;
    const inviteeLabel = `User ${invitee}`;
    let gift: string;
    if (r.status === "pending") gift = "pending";
    else if (r.claimed_kind === "gb") gift = `+${r.reward_gb} GB`;
    else if (r.claimed_kind === "days") gift = `+${r.reward_days} days`;
    else gift = "claimed";
    const line = `${invLabel} invite ${inviteeLabel} - ${invLabel} select gift ${gift}`;
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
