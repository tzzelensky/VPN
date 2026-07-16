/** Узкий экран — мобильная оболочка админ-панели в браузере. */
export function isAdminMobileShell(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.classList.contains("admin-mobile-app")) return true;
  return window.matchMedia("(max-width: 960px)").matches;
}

/** Зоны со своим скроллом — жесты не перехватывает свайп меню. */
export const ADMIN_MOBILE_SCROLL_AREA_SELECTOR =
  ".admin-mobile-scroll-x, .admin-mobile-scroll-y, .table-wrap, .users-dash-wrap, .dropper-tickets-admin-scroll-wrap, .dropper-grant-users-wrap, select[multiple], .comms-history-list, .ref-ios-wheel-scroll, .promos-list-scroll, .live-log-body, .appeals-mobile-list, .admin-stats-popover, .admin-stats-popover-list, .modal-backdrop, .modal, .user-modal-body";

export function isAdminMobileScrollArea(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(ADMIN_MOBILE_SCROLL_AREA_SELECTOR);
}
