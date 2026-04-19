const A = 0x41;
const RI_A = 0x1f1e6;

export function countryFlagEmoji(alpha2: string): string {
  const c = alpha2.toUpperCase().replace(/[^A-Z]/g, "");
  if (c.length !== 2) return "";
  return String.fromCodePoint(...[...c].map((ch) => RI_A + (ch.charCodeAt(0) - A)));
}
