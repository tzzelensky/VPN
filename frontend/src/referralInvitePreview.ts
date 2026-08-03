/** Бренд для реферальных сообщений: короткое «HSN» показываем как «HSN VPN». */
export function referralBrandLabel(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim();
  if (!s || /^hsn$/i.test(s)) return "HSN VPN";
  return s;
}

export function applyReferralInviteVars(
  template: string,
  vars: { ref_link: string; discount: string; brand: string },
): string {
  return String(template ?? "")
    .replace(/\{ref_link\}/gi, vars.ref_link)
    .replace(/\{discount\}/gi, vars.discount)
    .replace(/\{brand\}/gi, referralBrandLabel(vars.brand));
}
