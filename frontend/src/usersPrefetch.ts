import { listServers, listUsers } from "./api";
import { applyFrozenOnline, hasFrozenOnlineSnapshot } from "./onlineFreeze";
import { readUsersListCache, writeUsersListCache, type UsersListCache } from "./usersListCache";

export const USERS_CACHE_UPDATED_EVENT = "vpn-admin-users-cache-updated";

let inflight: Promise<UsersListCache> | null = null;
let lastFetchedAt = 0;
const MIN_INTERVAL_MS = 45_000;

function notifyCacheUpdated(data: UsersListCache): void {
  window.dispatchEvent(new CustomEvent(USERS_CACHE_UPDATED_EVENT, { detail: data }));
}

async function fetchUsersListCache(opts?: { skipOnlineFreeze?: boolean }): Promise<UsersListCache> {
  const [usersRaw, servers] = await Promise.all([listUsers(), listServers()]);
  const deployed = servers.filter((s) => s.vless_deployed);
  const prev = readUsersListCache();
  const users =
    opts?.skipOnlineFreeze || !hasFrozenOnlineSnapshot() ? usersRaw : applyFrozenOnline(usersRaw);
  const data: UsersListCache = {
    users,
    previews: prev?.previews ?? {},
    deployedServers: deployed,
  };
  writeUsersListCache(data);
  lastFetchedAt = Date.now();
  notifyCacheUpdated(data);
  return data;
}

/** Загрузить пользователей и серверы в кэш (дедупликация параллельных вызовов). */
export function prefetchUsersInBackground(opts?: {
  force?: boolean;
  /** Не подмешивать freeze — сырой ответ API (после sync-stats). */
  skipOnlineFreeze?: boolean;
}): Promise<UsersListCache> {
  const now = Date.now();
  const cached = readUsersListCache();
  if (!opts?.force && inflight) return inflight;
  if (!opts?.force && cached?.users && now - lastFetchedAt < MIN_INTERVAL_MS) {
    const users = hasFrozenOnlineSnapshot() ? applyFrozenOnline(cached.users) : cached.users;
    return Promise.resolve({ ...cached, users });
  }

  const job = (
    opts?.force && inflight
      ? inflight.catch(() => undefined).then(() => fetchUsersListCache({ skipOnlineFreeze: opts.skipOnlineFreeze }))
      : fetchUsersListCache({ skipOnlineFreeze: opts?.skipOnlineFreeze })
  ).finally(() => {
    if (inflight === job) inflight = null;
  });
  inflight = job;
  return job;
}
