const ERROR_MAP: Record<string, string> = {
  device_limit_disabled: "Ограничение устройств сейчас выключено.",
  device_limit_reached: "Достигнут лимит устройств.",
  tg_webapp_auth_required: "Требуется авторизация через Telegram.",
  promo_not_found: "Промокод не найден.",
  promo_not_for_user: "Этот промокод предназначен другому пользователю.",
  promo_already_used: "Этот промокод уже был использован.",
  promo_inactive: "Промокод сейчас неактивен.",
  promo_expired: "Срок действия промокода истёк.",
  promo_new_users_only: "Промокод только для новых пользователей.",
  support_disabled: "Поддержка временно недоступна.",
  game_disabled: "Игра сейчас недоступна.",
  no_tickets: "Нет билетов для игры.",
  disabled: "Ежедневный подарок сейчас недоступен.",
  no_prize: "Подарок на сегодня ещё не готов.",
  already_claimed: "Вы уже получили сегодняшний подарок для этой подписки.",
  prize_limit_reached: "Этот подарок можно получить ограниченное число раз.",
  no_subscription: "Для получения подарка нужна активная подписка.",
  subscription_required: "Выберите подписку, для которой хотите получить подарок.",
  user_not_found: "Подписка не найдена.",
  invalid_discount: "Некорректная скидка в настройках подарка.",
  invalid_promo_discount: "Некорректный процент скидки в настройках подарка.",
  invalid_gb: "Некорректный объём ГБ в настройках подарка.",
  invalid_days: "Некорректное число дней в настройках подарка.",
  unlimited_traffic: "На безлимитном тарифе ГБ начисляются в копилку игры.",
  apply_failed: "Не удалось применить подарок. Попробуйте позже.",
  no_claim: "У пользователя нет выдачи за выбранный день.",
  forbidden: "Действие недоступно.",
  bad_payload: "Некорректный запрос.",
};

export function formatMySubError(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "Что-то пошло не так. Попробуйте ещё раз.";

  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      const code = String(parsed.error ?? "").trim();
      if (code && ERROR_MAP[code]) return ERROR_MAP[code];
      if (parsed.message) return String(parsed.message);
      if (code) return code.replace(/_/g, " ");
    } catch {
      /* ignore */
    }
  }

  for (const [code, msg] of Object.entries(ERROR_MAP)) {
    if (text.includes(code)) return msg;
  }

  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}
