import type { UserRow } from "./db.js";
import { serversForUserSubscription } from "./db.js";
import { HAPP_WHITELIST_SUBSCRIPTION_LINE } from "./happWhitelistLine.js";
import { serverNameForSubscription } from "./serverDisplay.js";
import { buildVlessUriForUser, vlessListLabel } from "./vlessLink.js";

/** Одна строка VLESS на каждый развёрнутый узел (с учётом subscription_server_count). */
export function subscriptionVlessLinksForUser(user: UserRow): string[] {
  let rows = serversForUserSubscription(user);
  if (user.whitelist_happ_enabled === 1 && rows.length > 0) {
    rows = rows.slice(-4);
  }
  const uris = rows.map((r) =>
    buildVlessUriForUser(
      r.host,
      r.vless_port,
      user.vless_uuid,
      vlessListLabel(serverNameForSubscription(r), user),
      user,
      r,
    ),
  );
  if (user.whitelist_happ_enabled === 1) {
    return [...uris, HAPP_WHITELIST_SUBSCRIPTION_LINE];
  }
  return uris;
}
