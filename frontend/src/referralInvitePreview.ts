export function applyReferralInviteVars(
  template: string,
  vars: { ref_link: string; discount: string; brand: string },
): string {
  return String(template ?? "")
    .replace(/\{ref_link\}/gi, vars.ref_link)
    .replace(/\{discount\}/gi, vars.discount)
    .replace(/\{brand\}/gi, vars.brand);
}
