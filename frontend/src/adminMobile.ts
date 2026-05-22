/** WebView APK (VpnAdminPanel) или узкий экран — мобильная оболочка панели. */
export function isAdminMobileShell(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.classList.contains("admin-mobile-app")) return true;
  if (/VpnAdminPanel/i.test(navigator.userAgent)) return true;
  return window.matchMedia("(max-width: 960px)").matches;
}
