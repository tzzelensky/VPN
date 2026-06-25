import { listServers, listUsers } from "./api";
import { readUsersListCache, writeUsersListCache, type UsersListCache } from "./usersListCache";

export const USERS_CACHE_UPDATED_EVENT = "vpn-admin-users-cache-updated";

let inflight: Promise<UsersListCache> | null = null;
let lastFetchedAt = 0;
const MIN_INTERVAL_MS = 8_000;

function notifyCacheUpdated(data: UsersListCache): void {
  window.dispatchEvent(new CustomEvent(USERS_CACHE_UPDATED_EVENT, { detail: data }));
}

async function fetchUsersListCache(): Promise<UsersListCache> {
  const [users, servers] = await Promise.all([listUsers(), listServers()]);
  const deployed = servers.filter((s) => s.vless_deployed);
  const prev = readUsersListCache();
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
export function prefetchUsersInBackground(opts?: { force?: boolean }): Promise<UsersListCache> {
  const now = Date.now();
  const cached = readUsersListCache();
  if (!opts?.force && inflight) return inflight;
  if (!opts?.force && cached?.users && now - lastFetchedAt < MIN_INTERVAL_MS) {
    return Promise.resolve(cached);
  }

  const job = (opts?.force && inflight ? inflight.catch(() => undefined).then(() => fetchUsersListCache()) : fetchUsersListCache()).finally(
    () => {
      if (inflight === job) inflight = null;
    },
  );
  inflight = job;
  return job;
}
