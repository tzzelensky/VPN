import sharp from "sharp";

export type MenuBannerUser = {
  username?: string;
  first_name?: string;
};

const BANNER_W = 1280;
const BANNER_H = 720;
const MAX_LABEL_CHARS = 28;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateLabel(raw: string, max = MAX_LABEL_CHARS): string {
  const s = String(raw ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}

/** Подпись на баннере профиля: `@user, ваш профиль`. */
export function profileBannerLabel(from?: MenuBannerUser | null): string {
  const username = String(from?.username ?? "").trim();
  const first = String(from?.first_name ?? "").trim();
  const name = username ? `@${username}` : first || "друг";
  return truncateLabel(`${name}, ваш профиль`);
}

/** Подпись для гостя без подписки: `Добро пожаловать, @name`. */
export function welcomeBannerLabel(from?: MenuBannerUser | null): string {
  const username = String(from?.username ?? "").trim();
  const first = String(from?.first_name ?? "").trim();
  const name = username ? `@${username}` : first || "друг";
  return truncateLabel(`Добро пожаловать, ${name}`);
}

export type MenuBannerKind = "profile" | "welcome";

function buildBannerSvg(label: string): string {
  const safe = escapeXml(label);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_W}" height="${BANNER_H}" viewBox="0 0 ${BANNER_W} ${BANNER_H}">
  <defs>
    <radialGradient id="vignette" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#12182a"/>
      <stop offset="100%" stop-color="#070b14"/>
    </radialGradient>
    <linearGradient id="lineGlow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0"/>
      <stop offset="35%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#7dd3fc" stop-opacity="1"/>
      <stop offset="65%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="titleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <filter id="titleGlow" x="-20%" y="-40%" width="140%" height="180%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#vignette)"/>
  <text
    x="50%" y="44%"
    text-anchor="middle"
    dominant-baseline="middle"
    fill="url(#titleGrad)"
    font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
    font-size="96"
    font-weight="700"
    letter-spacing="2"
    filter="url(#titleGlow)"
  >HSN-VPN</text>
  <rect x="18%" y="54%" width="64%" height="3" rx="1.5" fill="url(#lineGlow)"/>
  <text
    x="50%" y="64%"
    text-anchor="middle"
    dominant-baseline="middle"
    fill="#f8fafc"
    font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
    font-size="36"
    font-weight="400"
    letter-spacing="3"
  >${safe}</text>
</svg>`;
}

export async function renderMenuBannerPng(label: string): Promise<Buffer> {
  const svg = buildBannerSvg(label);
  return sharp(Buffer.from(svg, "utf8")).png({ compressionLevel: 8 }).toBuffer();
}

export async function renderMenuBannerForUser(
  from?: MenuBannerUser | null,
  kind: MenuBannerKind = "profile",
): Promise<Buffer> {
  const label = kind === "welcome" ? welcomeBannerLabel(from) : profileBannerLabel(from);
  return renderMenuBannerPng(label);
}
