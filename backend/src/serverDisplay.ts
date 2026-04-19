import type { ServerRow } from "./db.js";

const LETTER_A = 0x41;
const REGIONAL_INDICATOR_A = 0x1f1e6;

/** Два латинских символа A–Z → флаг (emoji regional indicators). */
export function countryFlagEmoji(alpha2: string | undefined | null): string {
  const c = String(alpha2 ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (c.length !== 2) return "";
  const codePoints = [...c].map((ch) => REGIONAL_INDICATOR_A + (ch.charCodeAt(0) - LETTER_A));
  return String.fromCodePoint(...codePoints);
}

/** Имя узла в подписке: флаг + название (как в v2rayNG). */
export function serverNameForSubscription(r: Pick<ServerRow, "name" | "country_code" | "host">): string {
  const flag = countryFlagEmoji(r.country_code);
  const nm = (r.name || "").trim() || (r.host || "").trim() || "node";
  return flag ? `${flag} ${nm}` : nm;
}
