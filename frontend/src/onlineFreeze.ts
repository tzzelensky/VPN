import type { UserDto } from "./api";

let frozenOnlineByUserId: Record<number, boolean> = {};
let snapshotActive = false;

export function hasFrozenOnlineSnapshot(): boolean {
  return snapshotActive;
}

export function freezeOnlineFromUsers(users: Array<Pick<UserDto, "id" | "online">>): void {
  const next: Record<number, boolean> = {};
  for (const u of users) {
    next[u.id] = Boolean(u.online);
  }
  frozenOnlineByUserId = next;
  snapshotActive = true;
}

export function clearFrozenOnlineSnapshot(): void {
  frozenOnlineByUserId = {};
  snapshotActive = false;
}

/** Подмешать замороженный онлайн в список пользователей. */
export function applyFrozenOnline<T extends { id: number; online: boolean }>(users: T[]): T[] {
  if (!snapshotActive) return users;
  return users.map((u) => {
    if (Object.prototype.hasOwnProperty.call(frozenOnlineByUserId, u.id)) {
      return { ...u, online: Boolean(frozenOnlineByUserId[u.id]) };
    }
    return { ...u, online: false };
  });
}
