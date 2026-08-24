import { Router } from "express";
import {
  backfillDeployedServerRealityFromUser,
  getUserBySubToken,
  listUsers,
  touchDeviceLimitForUser,
  userAllowedOnServers,
  type UserRow,
} from "../db.js";
import { getRequestClientIp } from "../deviceLimitSubscription.js";
import { getDeviceLimitSubscriptionPressure } from "../deviceLimitHappPush.js";
import { setRecentSubscriptionDeviceHit } from "../deviceLimitStore.js";
import { parseDeviceFromRequest, isUsefulDeviceName } from "../deviceNameFromUa.js";
import { resolveSubscriptionBase64, resolveSubscriptionLinks } from "../subscriptionResolve.js";
import {
  buildHappJsonSubscriptionBody,
  shouldServeHappJsonSubscription,
} from "../happSubscriptionJson.js";
import { isDeviceLimitActiveForUser } from "../deviceLimitEffective.js";
import { activeDeviceSlots, allowedDeviceSlots, resolveDeviceIdFromRequest, resolveSubscriptionDeviceId } from "../userDeviceSlots.js";
import { setSubscriptionUserHeaders } from "../subscriptionMeta.js";
import { getCachedSubscriptionPeek, refreshUserTrafficFromServersIfDue, scheduleSubscriptionPeekRefresh } from "../xrayStatsPull.js";
import { refreshMissingSubscriptionHintsIfDue } from "../subscriptionHintsRefresh.js";
import { isVpnSubscriptionClient } from "../subscriptionClientDetect.js";
import { buildSubscriptionDecoyHtml } from "../subscriptionLanding.js";

const router = Router();

/** Браузер/probe: всегда один и тот же HTML 200 — без oracle по существованию токена. */
function sendSubscriptionDecoy(res: import("express").Response): void {
  res.status(200);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  // Не светим subscription-* в CORS expose на витрине.
  res.removeHeader("Access-Control-Expose-Headers");
  res.type("html");
  res.send(buildSubscriptionDecoyHtml());
}

function activeDeviceCount(user: UserRow): number {
  return allowedDeviceSlots(user.device_slots ?? []).length;
}

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

  // Opt-in only: wrong token must not resolve to the sole user (token enumeration / ops leak).
  if ((process.env.SUBSCRIPTION_FALLBACK_SINGLE_USER ?? "0") === "1") {
    const rows = listUsers();
    if (rows.length === 1) return rows[0];
  }
  return undefined;
}

router.get("/:token", async (req, res) => {
  try {
    const vpnClient = isVpnSubscriptionClient(req);
    const user = resolveSubscriptionUser(String(req.params.token ?? ""));

    if (!vpnClient) {
      sendSubscriptionDecoy(res);
      return;
    }

    // VPN UA + неизвестный токен — тот же decoy (не text/plain «not found»).
    if (!user) {
      sendSubscriptionDecoy(res);
      return;
    }

    const base = getUserBySubToken(user.sub_token) ?? user;
    void refreshMissingSubscriptionHintsIfDue().catch((err) => {
      console.error("[subscription] hints refresh:", err instanceof Error ? err.message : err);
    });
    backfillDeployedServerRealityFromUser(base);
    const cachedPeek = getCachedSubscriptionPeek(base);
    scheduleSubscriptionPeekRefresh(base);
    let headerUser: UserRow = base;
    if (cachedPeek) {
      const headerUsage = deriveUsageForHeader(base, cachedPeek);
      headerUser = {
        ...base,
        traffic_up: headerUsage.up,
        traffic_down: headerUsage.down,
        online_devices: Math.max(0, Math.floor(Number(cachedPeek.online) || 0)),
        online_snapshot: Number(cachedPeek.online) > 0 ? 1 : 0,
      };
    }
    const requestIp = getRequestClientIp(req);
    const parsedClient = parseDeviceFromRequest(req);
    const userAgent = String(req.headers?.["user-agent"] ?? "").trim();
    const xClient = String(req.headers?.["x-client"] ?? "").trim();
    const resolvedForHit = resolveDeviceIdFromRequest(req);
    const hitDid =
      resolvedForHit.deviceId ||
      (userAgent ? resolveSubscriptionDeviceId(base, resolvedForHit, userAgent) : "");
    if (userAgent || parsedClient.device_name !== "Устройство") {
      setRecentSubscriptionDeviceHit(base.id, {
        ip: requestIp,
        ua: userAgent || parsedClient.device_name,
        did: hitDid,
      });
    }
    let subUser = headerUser;
    let deviceLimitDenied = false;
    let deviceLimitReason: string | undefined;
    let deviceLimitRegistered = activeDeviceCount(headerUser);
    if (isDeviceLimitActiveForUser(headerUser)) {
      const resolved = resolveDeviceIdFromRequest(req);
      const deviceId = resolveSubscriptionDeviceId(headerUser, resolved, userAgent);
      const access = touchDeviceLimitForUser(headerUser.id, deviceId, {
        requestIp,
        userAgent,
        deviceName: isUsefulDeviceName(parsedClient.device_name) ? parsedClient.device_name : undefined,
        matchedBy: resolved.matchedBy,
        autoBind: true,
      });
      if (access.user) {
        subUser = {
          ...access.user,
          // Для subscription-userinfo оставляем подсчитанные значения трафика из headerUser.
          traffic_up: headerUser.traffic_up,
          traffic_down: headerUser.traffic_down,
          online_devices: headerUser.online_devices,
          online_snapshot: headerUser.online_snapshot,
          stats_raw_up: headerUser.stats_raw_up,
          stats_raw_down: headerUser.stats_raw_down,
        };
        deviceLimitRegistered = activeDeviceCount(access.user);
      }
      deviceLimitDenied = !access.allowed;
      deviceLimitReason = access.reason;
    }
    const deviceLimitPressure = getDeviceLimitSubscriptionPressure(subUser, {
      denied: deviceLimitDenied,
      reason: deviceLimitReason,
    });
    void refreshUserTrafficFromServersIfDue(user).catch((err) => {
      console.error("[subscription] traffic refresh:", err instanceof Error ? err.message : err);
    });

    setSubscriptionUserHeaders(res, headerUser, { deviceLimitPressure });
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");

    const resolveCtx = {
      apply_device_limit: true as const,
      device_limit_denied: deviceLimitDenied,
      device_limit_registered: deviceLimitRegistered,
      device_limit_reason: deviceLimitReason,
      device_limit_pressure: deviceLimitPressure,
    };

    const links = resolveSubscriptionLinks(subUser, resolveCtx);
    // Happ JSON нельзя отдавать при пустых links: билдер иначе снова соберёт узлы из каталога.
    if (
      links.length > 0 &&
      !deviceLimitDenied &&
      shouldServeHappJsonSubscription(subUser, userAgent, xClient)
    ) {
      const happ = buildHappJsonSubscriptionBody(subUser, links);
      if (happ) {
        res.setHeader("Content-Type", happ.contentType);
        res.send(happ.body);
        return;
      }
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(resolveSubscriptionBase64(subUser, resolveCtx));
  } catch (e) {
    console.error("[subscription]", e instanceof Error ? e.message : e);
    res.status(500).type("text").send("error");
  }
});

/** Корень /goods|/sub — витрина, без redirect на реальный sub_token. */
router.get("/", (_req, res) => {
  sendSubscriptionDecoy(res);
});

export default router;
