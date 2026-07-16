import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getUser } from "../db.js";
import { patchTriggerCampaign } from "../triggerMailingsStore.js";
import {
  getTriggerMailingsConfig,
  getTriggerMailingsStore,
  sendManualTriggerCampaign,
  sendTriggerTest,
  setTriggerMailingsConfig,
} from "../triggerMailingsService.js";
import {
  normalizeTriggerMailingsConfig,
  type TriggerAudience,
  type TriggerCampaignId,
} from "../triggerMailingsTypes.js";
import { listTriggerHistory } from "../triggerMailingsHistoryStore.js";

const router = Router();
router.use(requireAuth);

router.get("/", (_req, res) => {
  const store = getTriggerMailingsStore();
  res.json({ config: store.config, stats: store.stats });
});

router.put("/", (req, res) => {
  const cfg = setTriggerMailingsConfig(normalizeTriggerMailingsConfig(req.body?.config ?? req.body));
  res.json({ config: cfg, stats: getTriggerMailingsStore().stats });
});

router.patch("/campaigns/:id", (req, res) => {
  const id = String(req.params.id ?? "") as TriggerCampaignId;
  const updated = patchTriggerCampaign(id, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ campaign: updated, stats: getTriggerMailingsStore().stats[id] ?? {} });
});

router.post("/test", async (req, res) => {
  const campaign_id = String(req.body?.campaign_id ?? "") as TriggerCampaignId;
  const step_id = String(req.body?.step_id ?? "");
  const user_id = Number(req.body?.user_id);
  const tg_chat_id = Number(req.body?.tg_chat_id);
  let chatId = tg_chat_id;
  if (!chatId && user_id > 0) {
    const u = getUser(user_id);
    chatId = Number(u?.tg_id);
  }
  if (!campaign_id || !step_id || !chatId) {
    res.status(400).json({ error: "bad_request" });
    return;
  }
  const r = await sendTriggerTest({
    campaign_id,
    step_id,
    tg_chat_id: chatId,
    variant_id: req.body?.variant_id ? String(req.body.variant_id) : undefined,
  });
  res.json(r);
});

router.post("/send-manual", async (req, res) => {
  const campaign_id = String(req.body?.campaign_id ?? "") as TriggerCampaignId;
  const audience = req.body?.audience ? (String(req.body.audience) as TriggerAudience) : undefined;
  if (!campaign_id) {
    res.status(400).json({ error: "bad_request" });
    return;
  }
  const r = await sendManualTriggerCampaign(campaign_id, audience);
  res.json(r);
});

router.get("/history", (req, res) => {
  const campaign_id = req.query.campaign_id ? (String(req.query.campaign_id) as TriggerCampaignId) : undefined;
  const from = req.query.from ? String(req.query.from) : undefined;
  const to = req.query.to ? String(req.query.to) : undefined;
  const limit = Number(req.query.limit);
  const items = listTriggerHistory({
    campaign_id,
    from,
    to,
    limit: Number.isFinite(limit) ? limit : 200,
  });
  res.json({ items });
});

export default router;
