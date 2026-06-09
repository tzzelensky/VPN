import { Router } from "express";
import { isFcmConfigured, sendPanelPushToAll } from "../fcm.js";
import { listPanelFcmTokens, registerPanelFcmToken, unregisterPanelFcmToken } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
router.use(requireAuth);

router.get("/status", (_req, res) => {
  res.json({
    fcm_configured: isFcmConfigured(),
    registered_devices: listPanelFcmTokens().length,
  });
});

router.post("/test", async (_req, res) => {
  try {
    await sendPanelPushToAll({
      title: "Тест push",
      body: "Если видите это — уведомления работают.",
      data: { path: "/support-appeals", type: "test" },
    });
    res.json({ ok: true, devices: listPanelFcmTokens().length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/register", (req, res) => {
  const token = String(req.body?.token ?? "").trim();
  if (token.length < 20) {
    res.status(400).json({ error: "token_required" });
    return;
  }
  registerPanelFcmToken(token);
  const total = listPanelFcmTokens().length;
  console.log(`[fcm] token registered (${token.slice(0, 12)}…), total=${total}`);
  res.json({ ok: true, total });
});

router.delete("/register", (req, res) => {
  const token = String(req.body?.token ?? "").trim();
  if (token) unregisterPanelFcmToken(token);
  res.json({ ok: true });
});

export default router;
