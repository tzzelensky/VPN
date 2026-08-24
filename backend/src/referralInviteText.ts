export type ReferralInviteVars = {
  ref_link: string;
  discount: string;
  brand: string;
};

/** Бренд для реферальных сообщений. Пустое / «HSN» → нейтральный «Сервис», без слова VPN. */
export function referralBrandLabel(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim();
  if (!s || /^hsn$/i.test(s)) return "Сервис";
  return s;
}

/** Подстановка переменных в текст приглашения (панель / бот / WebApp). */
export function applyReferralInviteVars(template: string, vars: ReferralInviteVars): string {
  const t = String(template ?? "");
  return t
    .replace(/\{ref_link\}/gi, vars.ref_link)
    .replace(/\{discount\}/gi, vars.discount)
    .replace(/\{brand\}/gi, referralBrandLabel(vars.brand));
}

export function sampleReferralLink(botUsername: string, inviterUserId = 12345): string {
  const bot = String(botUsername ?? "").trim().replace(/^@/, "");
  return bot ? `https://t.me/${bot}?start=ref_${inviterUserId}` : `ref_${inviterUserId}`;
}
