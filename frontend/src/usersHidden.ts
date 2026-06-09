const STORAGE_KEY = "vpn-admin-users-hidden";

function normalizeIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))];
}

export function readHiddenUserIds(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeHiddenUserIds(ids: number[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeIds(ids)));
}

export function hideUserId(id: number): number[] {
  const next = normalizeIds([...readHiddenUserIds(), Math.floor(id)]);
  writeHiddenUserIds(next);
  return next;
}

export function unhideUserId(id: number): number[] {
  const target = Math.floor(id);
  const next = readHiddenUserIds().filter((x) => x !== target);
  writeHiddenUserIds(next);
  return next;
}

export function pruneHiddenUserIds(existingUserIds: number[]): number[] {
  if (existingUserIds.length === 0) return readHiddenUserIds();
  const existing = new Set(existingUserIds.map((x) => Math.floor(x)));
  const prev = readHiddenUserIds();
  const next = prev.filter((id) => existing.has(id));
  if (next.length !== prev.length) writeHiddenUserIds(next);
  return next;
}
