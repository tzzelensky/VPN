export type ReferralInviteVars = {
  ref_link: string;
  discount: string;
  brand: string;
};

/** Подстановка переменных в текст приглашения (панель / бот / WebApp). */
export function applyReferralInviteVars(template: string, vars: ReferralInviteVars): string {
  const t = String(template ?? "");
  return t
    .replace(/\{ref_link\}/gi, vars.ref_link)
    .replace(/\{discount\}/gi, vars.discount)
    .replace(/\{brand\}/gi, vars.brand);
}

export function sampleReferralLink(botUsername: string, inviterUserId = 12345): string {
  const bot = String(botUsername ?? "").trim().replace(/^@/, "");
  return bot ? `https://t.me/${bot}?start=ref_${inviterUserId}` : `ref_${inviterUserId}`;
}
