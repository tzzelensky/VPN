import { Router } from "express";
import { getUserBySubToken, userAllowedOnServers, type UserRow } from "../db.js";
import { buildSubscriptionPayload } from "../vlessLink.js";
import { subscriptionVlessLinksForUser } from "../subscriptionLinks.js";
import { setSubscriptionUserHeaders } from "../subscriptionMeta.js";
import { peekUserTrafficForSubscription, refreshUserTrafficFromServersIfDue } from "../xrayStatsPull.js";
import { pushClientListToAllDeployedServers } from "../userSync.js";

const router = Router();

router.get("/:token", async (req, res) => {
  try {
    const token = decodeURIComponent(String(req.params.token ?? "").trim());
    const user = getUserBySubToken(token);

    if (!user) {
      res.status(404).send("not found");
      return;
    }

    const base = getUserBySubToken(token) ?? user;
    let headerUser: UserRow = base;
    try {
      const peek = await peekUserTrafficForSubscription(user);
      headerUser = {
        ...base,
        traffic_up: Math.max(base.traffic_up, peek.up),
        traffic_down: Math.max(base.traffic_down, peek.down),
      };
    } catch (e) {
      console.error("[subscription] peek traffic:", e instanceof Error ? e.message : e);
    }
    void refreshUserTrafficFromServersIfDue(user).catch((err) => {
      console.error("[subscription] traffic refresh:", err instanceof Error ? err.message : err);
    });

    // Синхронизация UUID в фоне — не блокируем ответ подписки.
    void pushClientListToAllDeployedServers().catch((err) => {
      console.error("[subscription] pushClientListToAllDeployedServers:", err instanceof Error ? err.message : err);
    });

    setSubscriptionUserHeaders(res, headerUser);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");

    if (!userAllowedOnServers(base)) {
      res.send(buildSubscriptionPayload([]));
      return;
    }

    const links = subscriptionVlessLinksForUser(base);
    res.send(buildSubscriptionPayload(links));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).send(msg);
  }
});

export default router;
