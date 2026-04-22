import { Router } from "express";
import {
  backfillDeployedServerRealityFromUser,
  getUserBySubToken,
  listUsers,
  userAllowedOnServers,
  type UserRow,
} from "../db.js";
import { buildSubscriptionPayload } from "../vlessLink.js";
import { subscriptionVlessLinksForUser } from "../subscriptionLinks.js";
import { setSubscriptionUserHeaders } from "../subscriptionMeta.js";
import { peekUserTrafficForSubscription, refreshUserTrafficFromServersIfDue } from "../xrayStatsPull.js";
import { pushClientListToAllDeployedServers } from "../userSync.js";
import { refreshMissingSubscriptionHintsIfDue } from "../subscriptionHintsRefresh.js";

const router = Router();

function deriveUsageForHeader(
  base: UserRow,
  peek: { up: number; down: number },
): { up: number; down: number } {
  const rawUp = Math.max(0, Math.floor(Number(peek.up) || 0));
  const rawDown = Math.max(0, Math.floor(Number(peek.down) || 0));
  const prevRawUp = Number.isFinite(Number(base.stats_raw_up)) ? Math.max(0, Math.floor(Number(base.stats_raw_up))) : -1;
  const prevRawDown = Number.isFinite(Number(base.stats_raw_down))
    ? Math.max(0, Math.floor(Number(base.stats_raw_down)))
    : -1;
  const hasRaw = prevRawUp >= 0 && prevRawDown >= 0;
  if (!hasRaw) {
    return { up: Math.max(0, rawUp), down: Math.max(0, rawDown) };
  }
  const addUp = rawUp >= prevRawUp ? rawUp - prevRawUp : rawUp;
  const addDown = rawDown >= prevRawDown ? rawDown - prevRawDown : rawDown;
  return {
    up: Math.max(0, Math.floor(Number(base.traffic_up) || 0) + Math.max(0, addUp)),
    down: Math.max(0, Math.floor(Number(base.traffic_down) || 0) + Math.max(0, addDown)),
  };
}

function resolveSubscriptionUser(rawToken: string): UserRow | undefined {
  const token = decodeURIComponent(String(rawToken ?? "").trim());
  const byToken = token ? getUserBySubToken(token) : undefined;
  if (byToken) return byToken;

  // Operational fallback: when token is missing/invalid and there is exactly one user,
  // still serve subscription so client links keep working after manual data edits.
  if ((process.env.SUBSCRIPTION_FALLBACK_SINGLE_USER ?? "1") === "1") {
    const rows = listUsers();
    if (rows.length === 1) return rows[0];
  }
  return undefined;
}

router.get("/:token", async (req, res) => {
  try {
    const user = resolveSubscriptionUser(String(req.params.token ?? ""));

    if (!user) {
      res.status(404).send("not found");
      return;
    }

    const base = getUserBySubToken(user.sub_token) ?? user;
    await refreshMissingSubscriptionHintsIfDue();
    backfillDeployedServerRealityFromUser(base);
    let headerUser: UserRow = base;
    try {
      const peek = await peekUserTrafficForSubscription(user);
      const headerUsage = deriveUsageForHeader(base, peek);
      headerUser = {
        ...base,
        traffic_up: headerUsage.up,
        traffic_down: headerUsage.down,
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

router.get("/", async (_req, res) => {
  try {
    const rows = listUsers();
    if (rows.length !== 1) {
      res.status(404).send("not found");
      return;
    }
    const only = rows[0];
    res.redirect(302, `/sub/${encodeURIComponent(only.sub_token)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).send(msg);
  }
});

export default router;
