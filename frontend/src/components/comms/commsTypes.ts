export type BroadcastMode = "global" | "selected" | "segment";

export type MessageButtonId = "pay" | "ref" | "sub" | "buygb" | "webapp" | "whitelist";

export type AudienceCard = "global" | "users" | "segment" | "new_segment";

export const MESSAGE_BUTTON_OPTIONS: { id: MessageButtonId; label: string; short: string }[] = [
  { id: "pay", label: "Оплата подписки", short: "Оплата" },
  { id: "sub", label: "Подписка", short: "Подписка" },
  { id: "buygb", label: "Докупить ГБ", short: "Купить ГБ" },
  { id: "whitelist", label: "Белые списки", short: "Белые списки" },
  { id: "ref", label: "Пригласи друга", short: "Пригласить" },
  { id: "webapp", label: "Открыть приложение", short: "Приложение" },
];

export function buttonLabel(id: MessageButtonId): string {
  return MESSAGE_BUTTON_OPTIONS.find((b) => b.id === id)?.label ?? id;
}

export function isTestSubscriptionSystemSegment(s: { id: string; system_key?: string | null }): boolean {
  return s.system_key === "test_subscriptions" || s.id === "sys_test_subscriptions";
}

export function isWhitelistConnectedSystemSegment(s: { id: string; system_key?: string | null }): boolean {
  return s.system_key === "whitelist_connected" || s.id === "sys_whitelist_connected";
}

export function isSystemCommunicationSegment(s: { id: string; system_key?: string | null }): boolean {
  return isTestSubscriptionSystemSegment(s) || isWhitelistConnectedSystemSegment(s);
}
