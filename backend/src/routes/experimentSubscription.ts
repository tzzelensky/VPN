import { Router } from "express";
import { getExperimentSubscriptionPayload } from "../experimentService.js";

const router = Router();

router.get("/:token", (req, res) => {
  const token = decodeURIComponent(String(req.params.token ?? "").trim());
  if (!token) {
    res.status(404).send("not found");
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  const titleB64 = Buffer.from("VPN Experiment", "utf8").toString("base64");
  res.setHeader("Profile-Title", `base64:${titleB64}`);
  res.setHeader("profile-update-interval", "1");
  res.send(getExperimentSubscriptionPayload(token));
});

export default router;
