import { Router } from "express";
import {
  getReferralProgram,
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
