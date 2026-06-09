const DAY_MS = 86_400_000;

/** Совпадает с snapExpiryTimeToNoonLocal на бэкенде. */
export function snapExpiryTimeToNoonLocal(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/** Можно списать costDays, оставив минимум 1 полный день подписки. */
export function canAffordRouletteDaysPurchase(expiryTime: number, costDays: number): boolean {
  if (expiryTime <= 0 || costDays <= 0) return false;
  const now = Date.now();
  const subAfter = snapExpiryTimeToNoonLocal(expiryTime - costDays * DAY_MS);
  return subAfter >= now && subAfter - now >= DAY_MS;
}

export function maxRouletteTicketsWithDays(
  expiryTime: number,
  pricePerTicket: number,
  cap: number,
): number {
  if (expiryTime <= 0 || pricePerTicket <= 0 || cap < 1) return 0;
  let lo = 0;
  let hi = cap;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (canAffordRouletteDaysPurchase(expiryTime, mid * pricePerTicket)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
