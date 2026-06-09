import {
  applyConfigVaultCheckResult,
  configVaultStats,
  getConfigVaultKey,
  getConfigVaultSettings,
  listConfigVaultKeys,
  saveConfigVaultSettings,
  setConfigVaultKeyChecking,
  updateConfigVaultNotifyState,
  vaultKeyForApi,
} from "./configVaultDb.js";
import { maskProxyUri } from "./configVaultUri.js";
import { getPanelSettings } from "./panelSettings.js";
import { sendTelegramHtml } from "./telegram/api.js";
import { getTelegramAdminIds, getTelegramBotToken } from "./telegram/env.js";
import { probeVlessEndpoint } from "./vlessKeyChecker.js";

let configVaultCheckAllRunning = false;

export function isConfigVaultCheckAllRunning(): boolean {
  return configVaultCheckAllRunning;
}

function formatMoscowDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  } catch {
    return iso;
  }
}

export function telegramConfiguredForVault(): boolean {
  return Boolean(getTelegramBotToken() && getTelegramAdminIds().length > 0);
}

function notifyCooldownOk(lastNotifyAt: string | null, cooldownMin: number): boolean {
  if (!lastNotifyAt) return true;
  const last = Date.parse(lastNotifyAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= cooldownMin * 60000;
}

async function notifyAdminsHtml(body: string): Promise<boolean> {
  if (!getTelegramBotToken()) {
    console.warn("[config-vault] Telegram bot token не настроен");
    return false;
  }
  const ids = getTelegramAdminIds();
  if (ids.length === 0) {
    console.warn("[config-vault] Telegram admin IDs не настроены");
    return false;
  }
  let ok = false;
  for (const chatId of ids) {
    try {
      await sendTelegramHtml(chatId, body);
      ok = true;
    } catch (e) {
      console.error(
        "[config-vault] telegram notify failed:",
        e instanceof Error ? e.message : e,
        "chatId=",
        chatId,
      );
    }
  }
  return ok;
}

export async function runConfigVaultCheckForKey(
  keyId: number,
  triggeredBy: "manual" | "auto",
): Promise<{ key: Record<string, unknown>; check: unknown }> {
  const settings = getConfigVaultSettings();
  const keyBefore = getConfigVaultKey(keyId);
  if (!keyBefore) throw new Error("Ключ не найден");
  if (!keyBefore.active && triggeredBy === "auto") {
    throw new Error("Ключ отключён");
  }
  setConfigVaultKeyChecking(keyId);
  const probe = await probeVlessEndpoint(
    keyBefore.raw_uri,
    settings.attempts_per_check,
    settings.attempt_timeout_sec,
    settings.test_url,
  );
  const settingsAll = getConfigVaultSettings();
  let notification_sent = false;
  const prev_status = keyBefore.last_check_status;

  const notifyUnavailable =
    settingsAll.notify_on_unavailable &&
    keyBefore.notify_on_fail &&
    probe.status === "unavailable" &&
    prev_status !== "unavailable" &&
    notifyCooldownOk(keyBefore.last_notify_at, settingsAll.notify_cooldown_minutes);

  const notifyRecovery =
    settingsAll.notify_on_recovery &&
    keyBefore.notify_on_fail &&
    probe.status === "available" &&
    prev_status === "unavailable" &&
    notifyCooldownOk(keyBefore.last_notify_at, settingsAll.notify_cooldown_minutes);

  const checkedAt = new Date().toISOString();
  if (notifyUnavailable) {
    const masked = maskProxyUri(keyBefore.raw_uri);
    const body =
      `⚠️ <b>VLESS-ключ стал недоступен</b>\n\n` +
      `Название: <b>${keyBefore.name}</b>\n` +
      `Ключ: <code>${masked}</code>\n` +
      `Проверка: 0/${probe.attempts_total} успешных попыток\n` +
      `Ошибка: ${probe.last_error ?? "—"}\n` +
      `Время: ${formatMoscowDatetime(checkedAt)}\n\n` +
      `Проверьте сервер или уберите ключ из подписок.`;
    notification_sent = await notifyAdminsHtml(body);
    updateConfigVaultNotifyState(keyId, {
      last_notified_status: "unavailable",
      last_notify_at: new Date().toISOString(),
    });
  } else if (notifyRecovery) {
    const masked = maskProxyUri(keyBefore.raw_uri);
    const body =
      `✅ <b>VLESS-ключ снова доступен</b>\n\n` +
      `Название: <b>${keyBefore.name}</b>\n` +
      `Ключ: <code>${masked}</code>\n` +
      `Проверка: ${probe.attempts_success}/${probe.attempts_total}\n` +
      `Средняя задержка: ${probe.avg_latency_ms ?? "—"} мс\n` +
      `Время: ${formatMoscowDatetime(checkedAt)}`;
    notification_sent = await notifyAdminsHtml(body);
    updateConfigVaultNotifyState(keyId, {
      last_notified_status: "available",
      last_notify_at: new Date().toISOString(),
    });
  }

  const { key, check } = applyConfigVaultCheckResult(keyId, {
    status: probe.status,
    attempts_total: probe.attempts_total,
    attempts_success: probe.attempts_success,
    attempts_failed: probe.attempts_failed,
    avg_latency_ms: probe.avg_latency_ms,
    min_latency_ms: probe.min_latency_ms,
    max_latency_ms: probe.max_latency_ms,
    error_message: probe.last_error,
    triggered_by: triggeredBy,
    notification_sent,
  });

  const maskSecrets = getPanelSettings().security.maskSecrets;
  return {
    key: vaultKeyForApi(key, !maskSecrets),
    check,
  };
}

export function startConfigVaultCheckAllBackground(
  triggeredBy: "manual" | "auto",
): { total: number; already_running: boolean } {
  const total = listConfigVaultKeys().filter((k) => k.active).length;
  if (configVaultCheckAllRunning) return { total, already_running: true };
  configVaultCheckAllRunning = true;
  void runConfigVaultCheckAll(triggeredBy).finally(() => {
    configVaultCheckAllRunning = false;
  });
  return { total, already_running: false };
}

export async function runConfigVaultCheckAll(triggeredBy: "manual" | "auto"): Promise<number> {
  const keys = listConfigVaultKeys().filter((k) => k.active);
  let done = 0;
  for (const k of keys) {
    try {
      await runConfigVaultCheckForKey(k.id, triggeredBy);
      done += 1;
    } catch (e) {
      console.error("[config-vault] check key", k.id, e instanceof Error ? e.message : e);
    }
  }
  if (triggeredBy === "auto") {
    saveConfigVaultSettings({ last_auto_run_at: new Date().toISOString() });
  }
  return done;
}

export function getConfigVaultOverview() {
  return {
    stats: configVaultStats(),
    telegram_configured: telegramConfiguredForVault(),
    settings: getConfigVaultSettings(),
  };
}
