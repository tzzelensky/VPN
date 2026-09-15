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
  viaConfigForApi,
} from "./configVaultDb.js";
import { maskProxyUri } from "./configVaultUri.js";
import { listServersOrdered, type ServerRow } from "./db.js";
import { getPanelSettings } from "./panelSettings.js";
import { sendTelegramHtml } from "./telegram/api.js";
import { getTelegramAdminIds, getTelegramBotToken } from "./telegram/env.js";
import { probeVlessEndpoint, type VlessProbeResult } from "./vlessKeyChecker.js";
import {
  probeTcpHostPortViaSocks,
  probeVlessEndpointViaSocks,
  runWithViaConfigTunnel,
  tryRefreshTzadminSubscription,
  type ViaConfigSubscriptionRefreshResult,
  type ViaConfigTunnel,
} from "./configVaultViaConfig.js";
import type { VlessKeyRow } from "./configVaultTypes.js";

let configVaultCheckAllRunning = false;

export type ViaCheckRunProgress = {
  running: boolean;
  total: number;
  done: number;
  success: number;
  failed: number;
  failed_names: string[];
};

let viaCheckRunProgress: ViaCheckRunProgress | null = null;

export function isConfigVaultCheckAllRunning(): boolean {
  return configVaultCheckAllRunning;
}

export function getViaCheckRunProgress(): ViaCheckRunProgress | null {
  return viaCheckRunProgress ? { ...viaCheckRunProgress, failed_names: [...viaCheckRunProgress.failed_names] } : null;
}

type ServerProbeTarget = {
  label: string;
  host: string;
  port: number;
};

function vlessListenPort(server: ServerRow): number {
  const sub = Math.floor(Number(server.sub_port) || 0);
  if (sub >= 1 && sub <= 65535) return sub;
  const vless = Math.floor(Number(server.vless_port) || 0);
  return vless >= 1 && vless <= 65535 ? vless : 0;
}

/** Цели пинга: VLESS + HY2/Trojan, если развёрнуты. */
export function collectPanelServerProbeTargets(servers: ServerRow[] = listServersOrdered()): ServerProbeTarget[] {
  const out: ServerProbeTarget[] = [];
  for (const s of servers) {
    const host = String(s.host ?? "").trim();
    if (!host) continue;
    const name = String(s.name || host).trim() || host;
    if (s.vless_deployed === 1) {
      const port = vlessListenPort(s);
      if (port) out.push({ label: `${name} · VLESS`, host, port });
    }
    if (s.hysteria2_deployed === 1) {
      const raw = Math.floor(Number(s.hysteria2_port) || 0);
      const port = raw >= 1024 && raw <= 65535 ? raw : 36712;
      out.push({ label: `${name} · HY2`, host, port });
    }
    if (s.trojan_deployed === 1) {
      const raw = Math.floor(Number(s.trojan_port) || 0);
      const port = raw >= 1 && raw <= 65535 ? raw : 443;
      out.push({ label: `${name} · Trojan`, host, port });
    }
  }
  return out;
}

function bumpViaCheckProgress(label: string, status: VlessProbeResult["status"]) {
  if (!viaCheckRunProgress) return;
  viaCheckRunProgress.done += 1;
  if (status === "available") {
    viaCheckRunProgress.success += 1;
  } else {
    viaCheckRunProgress.failed += 1;
    viaCheckRunProgress.failed_names.push(label);
  }
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

function shouldUseViaConfig(): boolean {
  const s = getConfigVaultSettings();
  return s.via_config.check_only_via === true && Boolean(String(s.via_config.raw ?? "").trim());
}

async function applyProbeAndNotify(
  keyBefore: VlessKeyRow,
  probe: VlessProbeResult,
  triggeredBy: "manual" | "auto",
): Promise<{ key: Record<string, unknown>; check: unknown }> {
  const settingsAll = getConfigVaultSettings();
  let notification_sent = false;
  const prev_status = keyBefore.last_check_status;
  const keyId = keyBefore.id;

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

async function probeKey(
  key: VlessKeyRow,
  tunnel: ViaConfigTunnel | null,
): Promise<VlessProbeResult> {
  const settings = getConfigVaultSettings();
  if (tunnel) {
    return probeVlessEndpointViaSocks(
      key.raw_uri,
      tunnel.socksHost,
      tunnel.socksPort,
      settings.attempts_per_check,
      settings.attempt_timeout_sec,
    );
  }
  return probeVlessEndpoint(
    key.raw_uri,
    settings.attempts_per_check,
    settings.attempt_timeout_sec,
    settings.test_url,
  );
}

export async function runConfigVaultCheckForKey(
  keyId: number,
  triggeredBy: "manual" | "auto",
  opts?: { tunnel?: ViaConfigTunnel | null; forceVia?: boolean },
): Promise<{ key: Record<string, unknown>; check: unknown }> {
  const settings = getConfigVaultSettings();
  const keyBefore = getConfigVaultKey(keyId);
  if (!keyBefore) throw new Error("Ключ не найден");
  if (!keyBefore.active && triggeredBy === "auto") {
    throw new Error("Ключ отключён");
  }
  setConfigVaultKeyChecking(keyId);

  const useVia = opts?.forceVia === true || (opts?.tunnel != null) || shouldUseViaConfig();
  let probe: VlessProbeResult;

  if (opts?.tunnel) {
    probe = await probeKey(keyBefore, opts.tunnel);
  } else if (useVia) {
    const raw = String(settings.via_config.raw ?? "").trim();
    if (!raw) throw new Error("Сторонний конфиг не задан");
    probe = await runWithViaConfigTunnel(raw, async (tunnel) => probeKey(keyBefore, tunnel));
  } else {
    probe = await probeKey(keyBefore, null);
  }

  return applyProbeAndNotify(keyBefore, probe, triggeredBy);
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

  const runBatch = async (tunnel: ViaConfigTunnel | null) => {
    for (const k of keys) {
      try {
        await runConfigVaultCheckForKey(k.id, triggeredBy, { tunnel });
        done += 1;
      } catch (e) {
        console.error("[config-vault] check key", k.id, e instanceof Error ? e.message : e);
      }
    }
  };

  if (shouldUseViaConfig()) {
    const raw = String(getConfigVaultSettings().via_config.raw ?? "").trim();
    await runWithViaConfigTunnel(raw, async (tunnel) => runBatch(tunnel));
  } else {
    await runBatch(null);
  }

  if (triggeredBy === "auto") {
    saveConfigVaultSettings({ last_auto_run_at: new Date().toISOString() });
  }
  return done;
}

/**
 * Ручная проверка всех ключей через сторонний конфиг (даже если check_only_via выкл).
 * При check_servers — дополнительно пинг VLESS/HY2/Trojan серверов панели.
 * Обновление подписки tzadmin выполняется сразу (если включено), ключи/серверы — в фоне.
 */
export async function startConfigVaultCheckAllViaConfigBackground(): Promise<{
  total: number;
  already_running: boolean;
  subscription_refresh: ViaConfigSubscriptionRefreshResult | null;
  servers_targets: number;
}> {
  const keys = listConfigVaultKeys().filter((k) => k.active);
  const settings = getConfigVaultSettings();
  const raw = String(settings.via_config.raw ?? "").trim();
  if (!raw) throw new Error("Сначала сохраните сторонний конфиг");
  const serverTargets =
    settings.via_config.check_servers === true ? collectPanelServerProbeTargets() : [];
  const total = keys.length + serverTargets.length;
  if (configVaultCheckAllRunning) {
    return {
      total: viaCheckRunProgress?.total ?? total,
      already_running: true,
      subscription_refresh: null,
      servers_targets: serverTargets.length,
    };
  }

  let subscription_refresh: ViaConfigSubscriptionRefreshResult | null = null;
  if (settings.via_config.try_refresh_subscription) {
    subscription_refresh = await tryRefreshTzadminSubscription();
  }

  configVaultCheckAllRunning = true;
  viaCheckRunProgress = {
    running: true,
    total,
    done: 0,
    success: 0,
    failed: 0,
    failed_names: [],
  };

  void runWithViaConfigTunnel(raw, async (tunnel) => {
    for (const k of keys) {
      try {
        const result = await runConfigVaultCheckForKey(k.id, "manual", { tunnel, forceVia: true });
        const status = String((result.key as { last_check_status?: string }).last_check_status ?? "");
        bumpViaCheckProgress(
          k.name,
          status === "available" || status === "unstable" || status === "unavailable"
            ? status
            : "unavailable",
        );
      } catch (e) {
        console.error("[config-vault] via-check key", k.id, e instanceof Error ? e.message : e);
        bumpViaCheckProgress(k.name, "unavailable");
      }
    }
    for (const t of serverTargets) {
      try {
        const probe = await probeTcpHostPortViaSocks(
          t.host,
          t.port,
          tunnel.socksHost,
          tunnel.socksPort,
          settings.attempts_per_check,
          settings.attempt_timeout_sec,
        );
        bumpViaCheckProgress(t.label, probe.status);
        if (probe.status !== "available") {
          console.warn(
            `[config-vault] via-check server ${t.label} ${t.host}:${t.port} → ${probe.status}`,
            probe.last_error ?? "",
          );
        }
      } catch (e) {
        console.error("[config-vault] via-check server", t.label, e instanceof Error ? e.message : e);
        bumpViaCheckProgress(t.label, "unavailable");
      }
    }
  })
    .catch((e) => {
      console.error("[config-vault] check-all-via-config", e instanceof Error ? e.message : e);
    })
    .finally(() => {
      if (viaCheckRunProgress) viaCheckRunProgress.running = false;
      configVaultCheckAllRunning = false;
    });

  return { total, already_running: false, subscription_refresh, servers_targets: serverTargets.length };
}

export function getConfigVaultOverview() {
  const settings = getConfigVaultSettings();
  const { via_config, ...rest } = settings;
  return {
    stats: configVaultStats(),
    telegram_configured: telegramConfiguredForVault(),
    settings: {
      ...rest,
      via_config: viaConfigForApi(via_config, false),
    },
    via_check_run: getViaCheckRunProgress(),
  };
}
