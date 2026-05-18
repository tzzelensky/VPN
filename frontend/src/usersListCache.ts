import type { ServerDto, UserDto } from "./api";

export type UsersListCache = {
  users: UserDto[];
  previews: Record<number, { count: number }>;
  deployedServers: ServerDto[];
};

let cache: UsersListCache | null = null;

export function readUsersListCache(): UsersListCache | null {
  return cache;
}

export function writeUsersListCache(data: UsersListCache): void {
  cache = data;
}

export function clearUsersListCache(): void {
  cache = null;
}
