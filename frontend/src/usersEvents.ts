export const USERS_CHANGED_EVENT = "vpn-admin-users-changed";

export function notifyUsersChanged(): void {
  window.dispatchEvent(new CustomEvent(USERS_CHANGED_EVENT));
}
