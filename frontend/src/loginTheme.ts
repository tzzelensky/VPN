export type LoginAccent = "aurora" | "ocean" | "sunset" | "violet";

const ACCENT_KEY = "vpn-admin-login-accent";

export const LOGIN_ACCENTS: Array<{ id: LoginAccent; label: string }> = [
  { id: "aurora", label: "Аврора" },
  { id: "ocean", label: "Океан" },
  { id: "sunset", label: "Закат" },
  { id: "violet", label: "Фиолет" },
];

export function getLoginAccent(): LoginAccent {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    if (v === "aurora" || v === "ocean" || v === "sunset" || v === "violet") return v;
  } catch {
    /* ignore */
  }
  return "aurora";
}

export function applyLoginAccent(accent: LoginAccent = getLoginAccent()): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-login-accent", accent);
  }
}

export function setLoginAccent(accent: LoginAccent): void {
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    /* ignore */
  }
  applyLoginAccent(accent);
  window.dispatchEvent(new CustomEvent("login-accent-change", { detail: accent }));
}
