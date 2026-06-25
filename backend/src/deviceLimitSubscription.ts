/** Утилиты IP для подписки (метаданные устройств, не для лимита). */

export function normalizeClientIp(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (s.startsWith("::ffff:")) return s.slice(7);
  return s;
}

export function getRequestClientIp(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return normalizeClientIp(fwd.split(",")[0]);
  }
  if (Array.isArray(fwd) && fwd[0]) {
    return normalizeClientIp(String(fwd[0]).split(",")[0]);
  }
  const real = req.headers?.["x-real-ip"];
  if (typeof real === "string" && real.trim()) return normalizeClientIp(real);
  if (req.ip) return normalizeClientIp(req.ip);
  return normalizeClientIp(req.socket?.remoteAddress);
}
