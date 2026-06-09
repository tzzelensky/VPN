import {
  applyWhitelistVaultCheckResult,
  countSaleWhitelistKeys,
  getWhitelistVaultKey,
  getWhitelistVaultSettings,
  isWhitelistPurchaseVisible,
  listWhitelistVaultKeys,
  saveWhitelistVaultSettings,
  setWhitelistVaultKeyChecking,
  updateWhitelistVaultNotifyState,
  whitelistKeyForApi,
  whitelistVaultStats,
} from "./whitelistVaultDb.js";
import { getPanelSettings } from "./panelSettings.js";
import { sendTelegramHtml } from "./telegram/api.js";
import { getTelegramAdminIds, getTelegramBotToken } from "./telegram/env.js";
import { probeVlessEndpoint } from "./vlessKeyChecker.js";

let whitelistVaultCheckAllRunning = false;

export function isWhitelistVaultCheckAllRunning(): boolean {
  return whitelistVaultCheckAllRunning;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function telegramConfiguredForWhitelistVault(): boolean {
  return Boolean(getTelegramBotToken() && getTelegramAdminIds().length > 0);
}

function notifyCooldownOk(lastNotifyAt: string | null, cooldownMin: number): boolean {
  if (!lastNotifyAt) return true;
  const last = Date.parse(lastNotifyAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= cooldownMin * 60000;
}

async function notifyAdminsHtml(body: string): Promise<boolean> {
  if (!getTelegramBotToken()) return false;
  const ids = getTelegramAdminIds();
  if (ids.length === 0) return false;
  let ok = false;
  for (const chatId of ids) {
    try {
      await sendTelegramHtml(chatId, body);
      ok = true;
    } catch (e) {
      console.error(
        "[whitelist-vault] telegram notify failed:",
        e instanceof Error ? e.message : e,
        "chatId=",
        chatId,
      );
    }
  }
  return ok;
}

export async function runWhitelistVaultCheckForKey(
  keyId: number,
  triggeredBy: "manual" | "auto",
): Promise<{ key: Record<string, unknown>; check: unknown }> {
  const settings = getWhitelistVaultSettings();
  const keyBefore = getWhitelistVaultKey(keyId);
  if (!keyBefore) throw new Error("Ключ не найден");
  if (!keyBefore.active && triggeredBy === "auto") {
    throw new Error("Ключ отключён");
  }
  setWhitelistVaultKeyChecking(keyId);
  const probe = await probeVlessEndpoint(
    keyBefore.raw_uri,
    settings.attempts_per_check,
    settings.attempt_timeout_sec,
    settings.test_url,
  );
  const settingsAll = getWhitelistVaultSettings();
  let notification_sent = false;
  const prev_status = keyBefore.last_check_status;

  const notifyUnavailable =
    settingsAll.notify_on_unavailable &&
    keyBefore.notify_on_fail &&
    probe.status === "unavailable" &&
    prev_status !== "unavailable" &&
    notifyCooldownOk(keyBefore.last_notify_at, settingsAll.notify_cooldown_minutes);

  if (notifyUnavailable) {
    const body = `⚠️ <b>Проблема с VLESS белых списков: ${escHtml(keyBefore.name)} недоступен</b>`;
    notification_sent = await notifyAdminsHtml(body);
    updateWhitelistVaultNotifyState(keyId, {
      last_notified_status: "unavailable",
      last_notify_at: new Date().toISOString(),
    });
  }

  const { key, check } = applyWhitelistVaultCheckResult(keyId, {
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
    key: whitelistKeyForApi(key, !maskSecrets),
    check,
  };
}

export function startWhitelistVaultCheckAllBackground(
  triggeredBy: "manual" | "auto",
): { total: number; already_running: boolean } {
  const total = listWhitelistVaultKeys().filter((k) => k.active).length;
  if (whitelistVaultCheckAllRunning) return { total, already_running: true };
  whitelistVaultCheckAllRunning = true;
  void runWhitelistVaultCheckAll(triggeredBy).finally(() => {
    whitelistVaultCheckAllRunning = false;
  });
  return { total, already_running: false };
}

export async function runWhitelistVaultCheckAll(triggeredBy: "manual" | "auto"): Promise<number> {
  const keys = listWhitelistVaultKeys().filter((k) => k.active);
  let done = 0;
  for (const k of keys) {
    try {
      await runWhitelistVaultCheckForKey(k.id, triggeredBy);
      done += 1;
    } catch (e) {
      console.error("[whitelist-vault] check key", k.id, e instanceof Error ? e.message : e);
    }
  }
  if (triggeredBy === "auto") {
    saveWhitelistVaultSettings({ last_auto_run_at: new Date().toISOString() });
  }
  return done;
}

export function getWhitelistVaultOverview() {
  const settings = getWhitelistVaultSettings();
  const saleKeys = countSaleWhitelistKeys();
  let purchase_warning: string | null = null;
  if (!settings.enabled) {
    purchase_warning = "Белые списки выключены. Покупка в Telegram-боте и Mini App скрыта.";
  } else if (!settings.purchase.sale_enabled) {
    purchase_warning =
      "Продажа белых списков выключена. Администратор может назначать белые списки вручную, но купить их нельзя.";
  } else if (saleKeys <= 0) {
    purchase_warning = "Нет активных VLESS-ключей белого списка для продажи. Покупка будет скрыта для пользователей.";
  } else if (settings.purchase.price_rub <= 0) {
    purchase_warning = "Укажите цену белых списков, иначе покупка будет скрыта.";
  }
  return {
    stats: whitelistVaultStats(),
    telegram_configured: telegramConfiguredForWhitelistVault(),
    settings,
    purchase_visible: isWhitelistPurchaseVisible(),
    sale_keys_count: saleKeys,
    disabled_warning: settings.enabled
      ? null
      : "Белые списки выключены. Пользователи не получают подписку с белым списком.",
    purchase_warning,
  };
}
