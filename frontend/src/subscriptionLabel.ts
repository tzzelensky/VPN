export function subscriptionLabel(u: { name?: string | null; email?: string | null }): string {
  const name = String(u.name ?? u.email ?? "").trim();
  return name || "Подписка";
}

export function subscriptionTariffLabel(
  sub: { total_gb: number },
  plans?: Array<{ total_gb: number; title: string }>,
): string {
  const plan = plans?.find((p) => p.total_gb === sub.total_gb);
  if (plan?.title?.trim()) return plan.title.trim();
  return sub.total_gb > 0 ? `${sub.total_gb} ГБ` : "безлимит";
}

export function subscriptionProfileHeading(
  sub: { name?: string | null; email?: string | null; total_gb: number },
  plans?: Array<{ total_gb: number; title: string }>,
): string {
  return `${subscriptionTariffLabel(sub, plans)} · ${subscriptionLabel(sub)}`;
}
