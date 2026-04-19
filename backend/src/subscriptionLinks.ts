import type { UserRow } from "./db.js";
import { serversForUserSubscription } from "./db.js";
import { serverNameForSubscription } from "./serverDisplay.js";
import { buildVlessUriForUser, vlessListLabel } from "./vlessLink.js";

/** Одна строка VLESS на каждый развёрнутый узел (с учётом subscription_server_count). */
export function subscriptionVlessLinksForUser(user: UserRow): string[] {
  const rows = serversForUserSubscription(user);
  return rows.map((r) =>
    buildVlessUriForUser(
      r.host,
      r.vless_port,
      user.vless_uuid,
      vlessListLabel(serverNameForSubscription(r), user),
      user,
      r,
    ),
  );
}
