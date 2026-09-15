import { syncUserStatsFromServers, type UserDto } from "./api";
import {
  applyFrozenOnline,
  clearFrozenOnlineSnapshot,
  freezeOnlineFromUsers,
} from "./onlineFreeze";
import { prefetchUsersInBackground, USERS_CACHE_UPDATED_EVENT } from "./usersPrefetch";
import { readUsersListCache, writeUsersListCache, type UsersListCache } from "./usersListCache";

export const ONLINE_STATS_EVENT = "vpn-admin-online-stats";

export type OnlineStatsStatus = "idle" | "loading" | "ready";

export type OnlineStatsEventDetail = {
  status: OnlineStatsStatus;
  users?: UserDto[];
};

export { applyFrozenOnline, hasFrozenOnlineSnapshot } from "./onlineFreeze";

let status: OnlineStatsStatus = "idle";
let inflight: Promise<UsersListCache> | null = null;

function notify(detail: OnlineStatsEventDetail): void {
  window.dispatchEvent(new CustomEvent(ONLINE_STATS_EVENT, { detail }));
}

export function getOnlineStatsStatus(): OnlineStatsStatus {
  return status;
}

export function clearOnlineStatsSession(): void {
  status = "idle";
  inflight = null;
  clearFrozenOnlineSnapshot();
}

/**
 * Один sync онлайн за сессию (или принудительно).
 * Пока идёт — status=loading; после — freeze флагов и ready.
 */
export function ensureOnlineStatsSynced(opts?: { force?: boolean }): Promise<UsersListCache> {
  const force = Boolean(opts?.force);
  if (!force && status === "ready") {
    const cached = readUsersListCache();
    if (cached?.users) {
      const users = applyFrozenOnline(cached.users);
      return Promise.resolve({ ...cached, users });
    }
  }
  if (!force && inflight) return inflight;

  if (force && inflight) {
    const follow = inflight.catch(() => undefined).then(() => runOnlineSync());
    inflight = follow.finally(() => {
      if (inflight === follow) inflight = null;
    });
    return inflight;
  }

  const job = runOnlineSync().finally(() => {
    if (inflight === job) inflight = null;
  });
  inflight = job;
  return job;
}

async function runOnlineSync(): Promise<UsersListCache> {
  status = "loading";
  notify({ status: "loading" });
  try {
    await syncUserStatsFromServers();
  } catch {
    /* список всё равно подтянем */
  }
  const data = await prefetchUsersInBackground({ force: true, skipOnlineFreeze: true });
  freezeOnlineFromUsers(data.users);
  const users = applyFrozenOnline(data.users);
  const next: UsersListCache = { ...data, users };
  writeUsersListCache(next);
  window.dispatchEvent(new CustomEvent(USERS_CACHE_UPDATED_EVENT, { detail: next }));
  status = "ready";
  notify({ status: "ready", users });
  return next;
}
