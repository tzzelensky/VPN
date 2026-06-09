export function subscriptionLabel(u: { name?: string | null; email?: string | null }): string {
  const name = String(u.name ?? u.email ?? "").trim();
  return name || "Подписка";
}
