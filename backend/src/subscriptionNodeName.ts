/** Название узла в подписке: «База (ИмяПользователя)», как у серверов. */
export function formatSubscriptionNodeName(
  baseName: string,
  userName?: string | null,
): string {
  const base = String(baseName ?? "").trim().slice(0, 120);
  const u = String(userName ?? "").trim();
  if (!u) return base;
  const suffix = ` (${u})`;
  if (base.endsWith(suffix)) return base.slice(0, 120);
  return `${base}${suffix}`.slice(0, 120);
}
