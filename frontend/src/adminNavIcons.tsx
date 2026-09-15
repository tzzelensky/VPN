import type { ReactNode, SVGProps } from "react";
import type { PanelSectionKey } from "./panelSettingsTypes";

export type AdminNavIcon = (p: SVGProps<SVGSVGElement>) => ReactNode;

function iconProps(p: SVGProps<SVGSVGElement>) {
  return {
    viewBox: "0 0 24 24",
    width: 20,
    height: 20,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true as const,
    ...p,
  };
}

export function IconHome(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v10h14V10" strokeLinejoin="round" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function IconServers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <rect x="2" y="3" width="20" height="6" rx="1" />
      <rect x="2" y="15" width="20" height="6" rx="1" />
      <circle cx="7" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconUsers(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconShop(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

export function IconComms(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconAppeals(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M6 21v-2a6 6 0 0 1 12 0v2" />
    </svg>
  );
}

export function IconReferral(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconConfigVault(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M21 8v13H3V8" />
      <path d="M1 8h22v-3a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v3z" />
      <path d="M10 12h4" />
    </svg>
  );
}

export function IconWhiteFlag(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M5 21V4" strokeLinecap="round" />
      <path
        d="M5 4h13l-2.2 2.8L18 10H5V4z"
        fill="currentColor"
        fillOpacity="0.22"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconPromo(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconLogs(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}

export function IconProxy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function IconGame(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 12h4M8 10v4M15 11h.01M18 13h.01" />
    </svg>
  );
}

export function IconDevice(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function IconGift(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconProps(p)}>
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M12 8v13M3 12h18M12 8c-2.5 0-4-1.5-4-3.5S9.5 1 12 1s4 1.5 4 3.5S14.5 8 12 8z" />
    </svg>
  );
}

export const SECTION_NAV_ICONS: Record<PanelSectionKey, AdminNavIcon> = {
  servers: IconServers,
  users: IconUsers,
  logs: IconLogs,
  subscription_shop: IconShop,
  communications: IconComms,
  support_appeals: IconAppeals,
  referral_program: IconReferral,
  promo_codes: IconPromo,
  config_vault: IconConfigVault,
  whitelist_vault: IconWhiteFlag,
  telegram_proxies: IconProxy,
  roulette_game: IconGame,
  device_limit: IconDevice,
  daily_gift: IconGift,
};
