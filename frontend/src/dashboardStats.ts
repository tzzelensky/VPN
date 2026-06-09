import type { UserDto } from "./api";

const BYTES_PER_GB = 1073741824;
const DAY_MS = 86_400_000;
const EXPIRY_SOON_MS = 3 * DAY_MS;
const TRAFFIC_LOW_GB = 30;

export type DashboardStats = {
  totalClients: number;
  onlineCount: number;
  expiringSoonCount: number;
};

function usedBytes(u: UserDto): number {
  return (Number(u.traffic_up) || 0) + (Number(u.traffic_down) || 0);
}

export function isExpirySoon(u: UserDto, now: number): boolean {
  if (!u.expiry_time || u.expiry_time <= 0) return false;
  const left = u.expiry_time - now;
  return left > 0 && left <= EXPIRY_SOON_MS;
}

export function isTrafficSoon(u: UserDto): boolean {
  const totalGb = Number(u.total_gb) || 0;
  if (totalGb <= 0) return false;
  const remainGb = totalGb - usedBytes(u) / BYTES_PER_GB;
  return remainGb <= TRAFFIC_LOW_GB;
}

export function remainingTrafficGb(u: UserDto): number | null {
  const totalGb = Number(u.total_gb) || 0;
  if (totalGb <= 0) return null;
  return Math.max(0, Number((totalGb - usedBytes(u) / BYTES_PER_GB).toFixed(2)));
}

export function computeDashboardStats(users: UserDto[]): DashboardStats {
  const now = Date.now();
  let onlineCount = 0;
  let expiringSoonCount = 0;
  for (const u of users) {
    if (u.online) onlineCount++;
    if (!u.enable) continue;
    if (isExpirySoon(u, now) || isTrafficSoon(u)) expiringSoonCount++;
  }
  return {
    totalClients: users.length,
    onlineCount,
    expiringSoonCount,
  };
}
