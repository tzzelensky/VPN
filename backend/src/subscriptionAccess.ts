import { userAllowedOnServers, type UserRow } from "./db.js";

export type SubscriptionAccessBlockReason = "expired" | "disabled" | "traffic" | "inactive";

export type SubscriptionAccessBlock = {
  reason: SubscriptionAccessBlockReason;
  /** Короткий заголовок для списка узлов / profile-title */
  title: string;
  /** Текст для announce / sub-info */
  message: string;
  /** Строки-заглушки в подписке (видны как «серверы») */
  noticeLines: string[];
};

export function isSubscriptionExpired(user: Pick<UserRow, "expiry_time">, now = Date.now()): boolean {
  const exp = Number(user.expiry_time) || 0;
  return exp > 0 && exp <= now;
}

/** Почему клиенту нельзя выдавать рабочие узлы (null = доступ есть). */
export function getSubscriptionAccessBlock(
  user: UserRow,
  now = Date.now(),
): SubscriptionAccessBlock | null {
  if (userAllowedOnServers(user)) return null;

  // Сначала срок: после авто-disable при истечении enable=0, но клиенту нужно «истекла».
  if (isSubscriptionExpired(user, now)) {
    return {
      reason: "expired",
      title: "Подписка истекла",
      message: "Подписка истекла. Обновите подписку после оплаты — узлы снова появятся.",
      noticeLines: ["Подписка истекла", "Оформите продление в боте или приложении"],
    };
  }

  if (user.enable !== 1) {
    return {
      reason: "disabled",
      title: "Подписка отключена",
      message: "Подписка отключена. Обратитесь в поддержку или оформите продление.",
      noticeLines: ["Подписка отключена", "Оформите продление в боте или приложении"],
    };
  }

  if (user.total_gb > 0) {
    const limitBytes = user.total_gb * 1073741824;
    if (user.traffic_up + user.traffic_down >= limitBytes) {
      return {
        reason: "traffic",
        title: "Лимит трафика исчерпан",
        message: "Лимит трафика исчерпан. Докупите трафик или дождитесь обновления лимита.",
        noticeLines: ["Лимит трафика исчерпан", "Докупите трафик в боте или приложении"],
      };
    }
  }

  return {
    reason: "inactive",
    title: "Подписка недоступна",
    message: "Подписка недоступна. Обратитесь в поддержку.",
    noticeLines: ["Подписка недоступна"],
  };
}
