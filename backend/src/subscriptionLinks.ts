import type { ServerRow, UserRow } from "./db.js";
import { serversForUserSubscription } from "./db.js";
import { HAPP_WHITELIST_SUBSCRIPTION_LINE } from "./happWhitelistLine.js";
import { serverNameForSubscription } from "./serverDisplay.js";
import { buildVlessUriForUser, vlessListLabel } from "./vlessLink.js";

function vlessUriForRow(user: UserRow, r: ServerRow): string {
  return buildVlessUriForUser(
    r.host,
    r.vless_port,
    user.vless_uuid,
    vlessListLabel(serverNameForSubscription(r), user),
    user,
    r,
  );
}

/**
 * Одна строка VLESS на каждый развёрнутый узел (с учётом subscription_server_count).
 * При whitelist_happ_enabled: к этому списку в конце добавляются последние 4 узла (ещё раз как отдельные строки)
 * и строка happ://… (конфиг белых списков для Happ).
 */
export function subscriptionVlessLinksForUser(user: UserRow): string[] {
  const rows = serversForUserSubscription(user);
  const main = rows.map((r) => vlessUriForRow(user, r));
  if (user.whitelist_happ_enabled !== 1) return main;

  const tail = rows.length ? rows.slice(-4) : [];
  const tailUris = tail.map((r) => vlessUriForRow(user, r));
  return [...main, ...tailUris, HAPP_WHITELIST_SUBSCRIPTION_LINE];
}
