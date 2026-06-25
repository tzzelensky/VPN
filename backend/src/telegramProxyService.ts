import { getServer, listDeployedServers, type ServerRow } from "./db.js";
import { getPanelSettings } from "./panelSettings.js";
import { sendTelegramHtml } from "./telegram/api.js";
import { getTelegramAdminIds, getTelegramBotToken } from "./telegram/env.js";
import {
  appendTelegramProxyCheck,
  appendTelegramProxyEvent,
  countProxiesByServer,
  createTelegramProxyRow,
  getTelegramProxy,
  getTelegramProxySettings,
  listTelegramProxies,
  listTelegramProxyEvents,
  setTelegramProxySettings,
  softDeleteTelegramProxyRow,
  updateTelegramProxyRow,
} from "./telegramProxiesDb.js";
import type { TelegramProxyRow, TelegramProxyStatus, TelegramProxyType } from "./telegramProxiesTypes.js";
import {
  buildMtprotoLinks,
  buildProxyConnectionText,
  buildSocks5Links,
  checkTelegramProxyReachability,
  maskSecret,
} from "./telegramProxyCheck.js";
import {
  checkRemotePortInUse,
  deployTelegramProxyOnServer,
  fetchTelegramProxyServiceLogs,
  generateMtprotoDdSecret,
  generateMtprotoSecret,
  isMtprotoDdSecret,
  generateProxyCredentials,
  inspectMtprotoService,
  isValidMtprotoSecret,
  isVpnPortConflict,
  mtprotoSecretFrontingHost,
  purgeAllTelegramProxiesOnServer,
  restartTelegramProxyOnServer,
  sshCfgFromServer,
  stopAndRemoveTelegramProxyOnServer,
  type DeployProxyInput,
} from "./telegramProxyDeploy.js";
import { sshExecCommand } from "./ssh.js";

let checkAllRunning = false;

export function isTelegramProxyCheckAllRunning(): boolean {
  return checkAllRunning;
}

const DEFAULT_PORTS: Record<TelegramProxyType, number> = {
  mtproto: 8443,
  socks5: 1080,
  http: 8080,
};

function formatMoscowDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  } catch {
    return iso;
  }
}

function proxyTypeLabel(t: TelegramProxyType): string {
  if (t === "mtproto") return "MTProto";
  if (t === "socks5") return "SOCKS5";
  return "HTTP";
}

export function telegramConfiguredForProxies(): boolean {
  return Boolean(getTelegramBotToken() && getTelegramAdminIds().length > 0);
}

function notifyCooldownOk(lastCheckAt: string | null, cooldownMin: number): boolean {
  if (!lastCheckAt) return true;
  const last = Date.parse(lastCheckAt);
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
      console.error("[telegram-proxies] notify failed:", e instanceof Error ? e.message : e);
    }
  }
  return ok;
}

export function proxyForApi(row: TelegramProxyRow, revealSecrets = false) {
  const links =
    row.type === "mtproto"
      ? buildMtprotoLinks(row.host, row.port, row.secret)
      : row.type === "socks5"
        ? buildSocks5Links(
            row.host,
            row.port,
            row.auth_enabled ? row.username : undefined,
            row.auth_enabled ? row.password : undefined,
          )
        : null;
  return {
    id: row.id,
    server_id: row.server_id,
    name: row.name,
    type: row.type,
    host: row.host,
    port: row.port,
    username: revealSecrets ? row.username : row.username ? maskSecret(row.username) : "",
    password: revealSecrets ? row.password : row.password ? "••••••••" : "",
    secret: revealSecrets ? row.secret : row.secret ? "••••••••" : "",
    auth_enabled: row.auth_enabled,
    active: row.active,
    status: row.status,
    last_check_at: row.last_check_at,
    last_latency_ms: row.last_latency_ms,
    last_error: row.last_error,
    service_name: row.service_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tg_link: links?.tg ?? null,
    tme_link: links?.tme ?? null,
    mtproto_sni: row.type === "mtproto" ? mtprotoSecretFrontingHost(row.secret) : null,
    connection_text: revealSecrets ? buildProxyConnectionText(row) : null,
  };
}

function serverProxyAggregateStatus(proxies: TelegramProxyRow[]): TelegramProxyStatus | "none" {
  const active = proxies.filter((p) => p.active);
  if (active.length === 0) return "none";
  if (active.some((p) => p.status === "checking")) return "checking";
  if (active.some((p) => p.status === "unavailable" || p.status === "timeout" || p.status === "auth_error")) {
    return "unavailable";
  }
  if (active.every((p) => p.status === "available")) return "available";
  return "unknown";
}

export function getTelegramProxiesOverview() {
  const proxies = listTelegramProxies();
  const active = proxies.filter((p) => p.active);
  const settings = getTelegramProxySettings();
  return {
    stats: {
      total: proxies.length,
      available: active.filter((p) => p.status === "available").length,
      unavailable: active.filter((p) => p.status === "unavailable" || p.status === "timeout" || p.status === "auth_error").length,
      mtproto: proxies.filter((p) => p.type === "mtproto").length,
      socks5: proxies.filter((p) => p.type === "socks5").length,
      http: proxies.filter((p) => p.type === "http").length,
      last_auto_run_at: settings.last_auto_run_at,
    },
    telegram_configured: telegramConfiguredForProxies(),
    settings,
  };
}

export function listServersForProxies() {
  const servers = listDeployedServers();
  const allProxies = listTelegramProxies();
  return servers.map((s) => {
    const serverProxies = allProxies.filter((p) => p.server_id === s.id);
    const lastCheck = serverProxies
      .map((p) => p.last_check_at)
      .filter(Boolean)
      .sort()
      .pop() ?? null;
    return {
      id: s.id,
      name: s.name,
      country: s.country_code ?? "",
      host: s.host,
      ssh_ok: Boolean(s.last_ssh_ok),
      xray_ok: Boolean(s.vless_deployed),
      proxy_count: serverProxies.length,
      proxy_status: serverProxyAggregateStatus(serverProxies),
      last_proxy_check_at: lastCheck,
    };
  });
}

async function validatePortForServer(
  server: ServerRow,
  port: number,
  excludeProxyId?: number,
): Promise<void> {
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error("Некорректный порт");
  }
  if (isVpnPortConflict(server, port)) {
    throw new Error("Этот порт используется VPN. Прокси не должен конфликтовать с VPN-подписками.");
  }
  const localConflict = listTelegramProxies({ server_id: server.id }).some(
    (p) => p.port === port && p.id !== excludeProxyId,
  );
  if (localConflict) {
    throw new Error(`Порт ${port} уже используется другим прокси на этом сервере.`);
  }
  const cfg = sshCfgFromServer(server);
  try {
    const inUse = await checkRemotePortInUse(cfg, port);
    if (inUse) throw new Error(`Порт ${port} уже используется. Выберите другой порт.`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Порт")) throw e;
    throw new Error(`Не удалось проверить порт на сервере: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function suggestFreePort(serverId: number, type: TelegramProxyType): Promise<number> {
  const server = getServer(serverId);
  if (!server) throw new Error("Сервер не найден");
  let port = DEFAULT_PORTS[type];
  for (let i = 0; i < 50; i++) {
    try {
      await validatePortForServer(server, port);
      return port;
    } catch {
      port += 1;
    }
  }
  throw new Error("Не удалось подобрать свободный порт");
}

export type CreateProxyInput = {
  server_id: number;
  name: string;
  type: TelegramProxyType;
  port?: number;
  auth_enabled?: boolean;
  username?: string;
  password?: string;
  secret?: string;
  auto_generate?: boolean;
  active?: boolean;
};

export async function createTelegramProxy(input: CreateProxyInput) {
  const server = getServer(input.server_id);
  if (!server) throw new Error("Сервер не найден");
  const type = input.type;
  const name = String(input.name ?? "").trim().slice(0, 120) || `${proxyTypeLabel(type)} ${server.name}`;
  let port = input.port != null ? Math.floor(Number(input.port)) : await suggestFreePort(server.id, type);
  await validatePortForServer(server, port);

  let secret = String(input.secret ?? "").trim();
  let username = String(input.username ?? "").trim();
  let password = String(input.password ?? "").trim();
  const autoGen = input.auto_generate !== false;
  let auth_enabled = input.auth_enabled !== false;

  if (type === "mtproto") {
    if (!secret && autoGen) secret = generateMtprotoDdSecret();
    if (!secret) throw new Error("Для MTProto нужен secret");
    if (!isValidMtprotoSecret(secret) && !isMtprotoDdSecret(secret)) {
      throw new Error("Secret MTProto невалиден: нужен dd (32 hex) или ee (FakeTLS + домен)");
    }
    auth_enabled = true;
  } else {
    if (autoGen || (!username && !password)) {
      const creds = generateProxyCredentials();
      if (!username) username = creds.username;
      if (!password) password = creds.password;
    }
    if (!auth_enabled) {
      username = "";
      password = "";
    }
  }

  const host = server.host.trim();
  const row = createTelegramProxyRow({
    server_id: server.id,
    name,
    type,
    host,
    port,
    username,
    password,
    secret,
    auth_enabled,
    active: input.active !== false,
  });

  try {
    const deployInput: DeployProxyInput = {
      id: row.id,
      type: row.type,
      port: row.port,
      secret: row.secret,
      username: row.username,
      password: row.password,
      auth_enabled: row.auth_enabled,
    };
    const deploy = await deployTelegramProxyOnServer(server, deployInput);
    appendTelegramProxyEvent({
      proxy_id: row.id,
      server_id: server.id,
      event_type: "created",
      message: `Прокси «${row.name}» (${proxyTypeLabel(type)}) создан на ${host}:${port}${deploy.firewall ? `. ${deploy.firewall}` : ""}`,
    });
    const updated = updateTelegramProxyRow(row.id, { status: "unknown" }) ?? row;
    return { proxy: proxyForApi(updated, true), deploy };
  } catch (e) {
    softDeleteTelegramProxyRow(row.id);
    try {
      await stopAndRemoveTelegramProxyOnServer(server, row);
    } catch {
      /* ignore cleanup errors */
    }
    appendTelegramProxyEvent({
      proxy_id: row.id,
      server_id: server.id,
      event_type: "deploy_error",
      message: `Ошибка развертывания «${row.name}»: ${e instanceof Error ? e.message : String(e)}`,
    });
    throw e;
  }
}

export type UpdateProxyInput = {
  name?: string;
  port?: number;
  auth_enabled?: boolean;
  username?: string;
  password?: string;
  secret?: string;
  active?: boolean;
};

export async function updateTelegramProxy(id: number, input: UpdateProxyInput) {
  const row = getTelegramProxy(id);
  if (!row) throw new Error("Прокси не найден");
  const server = getServer(row.server_id);
  if (!server) throw new Error("Сервер не найден");

  const patch: Partial<TelegramProxyRow> = {};
  if (input.name != null) patch.name = String(input.name).trim().slice(0, 120) || row.name;
  if (input.active != null) patch.active = Boolean(input.active);
  if (input.auth_enabled != null) patch.auth_enabled = Boolean(input.auth_enabled);
  if (input.username != null) patch.username = String(input.username).slice(0, 120);
  if (input.password != null) patch.password = String(input.password).slice(0, 200);
  if (input.secret != null) {
    const nextSecret = String(input.secret).slice(0, 256);
    if (row.type === "mtproto" && nextSecret && !isValidMtprotoSecret(nextSecret) && !isMtprotoDdSecret(nextSecret)) {
      throw new Error("Secret MTProto невалиден: нужен dd (32 hex) или ee (FakeTLS + домен)");
    }
    patch.secret = nextSecret;
  }

  let redeploy = false;
  if (input.port != null) {
    const port = Math.floor(Number(input.port));
    if (port !== row.port) {
      await validatePortForServer(server, port, id);
      patch.port = port;
      redeploy = true;
    }
  }
  if (input.secret != null && input.secret !== row.secret) redeploy = true;
  if (input.username != null && input.username !== row.username) redeploy = true;
  if (input.password != null && input.password !== row.password) redeploy = true;
  if (input.auth_enabled != null && input.auth_enabled !== row.auth_enabled) redeploy = true;

  const merged = { ...row, ...patch };
  if (redeploy) {
    await stopAndRemoveTelegramProxyOnServer(server, row);
    await deployTelegramProxyOnServer(server, {
      id: row.id,
      type: merged.type,
      port: merged.port,
      secret: merged.secret,
      username: merged.username,
      password: merged.password,
      auth_enabled: merged.auth_enabled,
    });
    appendTelegramProxyEvent({
      proxy_id: row.id,
      server_id: server.id,
      event_type: "updated",
      message: `Прокси «${merged.name}» обновлён и переразвёрнут`,
    });
  } else if (Object.keys(patch).length > 0) {
    appendTelegramProxyEvent({
      proxy_id: row.id,
      server_id: server.id,
      event_type: "updated",
      message: `Прокси «${merged.name}» обновлён`,
    });
  }

  const updated = updateTelegramProxyRow(id, patch);
  if (!updated) throw new Error("Не удалось сохранить прокси");
  return { proxy: proxyForApi(updated, true) };
}

export async function deleteTelegramProxy(id: number) {
  const row = getTelegramProxy(id);
  if (!row) throw new Error("Прокси не найден");
  const server = getServer(row.server_id);
  if (server) {
    try {
      await stopAndRemoveTelegramProxyOnServer(server, row);
    } catch (e) {
      appendTelegramProxyEvent({
        proxy_id: row.id,
        server_id: server.id,
        event_type: "delete_error",
        message: `Ошибка удаления с сервера: ${e instanceof Error ? e.message : String(e)}`,
      });
      throw e;
    }
    appendTelegramProxyEvent({
      proxy_id: id,
      server_id: server.id,
      event_type: "deleted",
      message: `Прокси «${row.name}» удалён`,
    });
  } else {
    appendTelegramProxyEvent({
      proxy_id: id,
      server_id: row.server_id,
      event_type: "deleted",
      message: `Прокси «${row.name}» удалён из панели (сервер #${row.server_id} уже удалён)`,
    });
  }
  softDeleteTelegramProxyRow(id);
}

export async function restartTelegramProxy(id: number) {
  const row = getTelegramProxy(id);
  if (!row) throw new Error("Прокси не найден");
  const server = getServer(row.server_id);
  if (!server) throw new Error("Сервер не найден");
  await restartTelegramProxyOnServer(server, row.id);
  appendTelegramProxyEvent({
    proxy_id: row.id,
    server_id: server.id,
    event_type: "restarted",
    message: `Прокси «${row.name}» перезапущен`,
  });
  return { proxy: proxyForApi(row) };
}

export async function getTelegramProxyLogs(proxyId: number, lines = 80): Promise<{ logs: string }> {
  const row = getTelegramProxy(proxyId);
  if (!row) throw new Error("Прокси не найден");
  const server = getServer(row.server_id);
  if (!server) throw new Error("Сервер не найден");
  const logs = await fetchTelegramProxyServiceLogs(sshCfgFromServer(server), row.id, lines);
  return { logs };
}

export async function purgeServerProxies(serverId: number): Promise<{ removed: number; errors: string[] }> {
  const server = getServer(serverId);
  const proxies = listTelegramProxies({ server_id: serverId });
  if (!server) {
    let removed = 0;
    for (const p of proxies) {
      softDeleteTelegramProxyRow(p.id);
      removed += 1;
    }
    if (removed > 0) {
      appendTelegramProxyEvent({
        proxy_id: null,
        server_id: serverId,
        event_type: "purge_server",
        message: `Очистка прокси для удалённого сервера #${serverId}: снято с учёта ${removed}`,
      });
    }
    return { removed, errors: [] };
  }
  const ids = proxies.map((p) => p.id);
  const errors = await purgeAllTelegramProxiesOnServer(server, ids);
  let removed = 0;
  for (const p of proxies) {
    softDeleteTelegramProxyRow(p.id);
    removed += 1;
  }
  appendTelegramProxyEvent({
    proxy_id: null,
    server_id: serverId,
    event_type: "purge_server",
    message: `Полная очистка прокси на «${server.name}»: удалено ${removed}, ошибок ${errors.length}`,
  });
  return { removed, errors };
}

export async function runTelegramProxyCheck(
  proxyId: number,
  triggeredBy: "manual" | "auto",
): Promise<{ proxy: ReturnType<typeof proxyForApi>; check: unknown }> {
  const settings = getTelegramProxySettings();
  const row = getTelegramProxy(proxyId);
  if (!row) throw new Error("Прокси не найден");
  if (!row.active && triggeredBy === "auto") throw new Error("Прокси отключён");

  updateTelegramProxyRow(proxyId, { status: "checking" });

  let lastResult = await checkTelegramProxyReachability(row, settings.attempt_timeout_sec * 1000);
  for (let attempt = 1; attempt < settings.attempts_per_check; attempt++) {
    if (lastResult.status === "available") break;
    lastResult = await checkTelegramProxyReachability(row, settings.attempt_timeout_sec * 1000);
  }

  const server = getServer(row.server_id);

  if (row.type === "mtproto" && server) {
    try {
      const diag = await inspectMtprotoService(sshCfgFromServer(server), row.id, row.port);
      const diagMsg = [...diag.errors, ...diag.warnings].filter(Boolean).join("; ");
      if (diag.errors.length > 0) {
        lastResult = {
          status: "unavailable",
          latency_ms: lastResult.latency_ms,
          error_message: diagMsg || lastResult.error_message,
        };
      } else if (diag.warnings.length > 0 && lastResult.status === "available") {
        lastResult = {
          ...lastResult,
          error_message: diagMsg,
        };
      } else if (lastResult.status !== "available" && diagMsg) {
        lastResult = {
          ...lastResult,
          error_message: [lastResult.error_message, diagMsg].filter(Boolean).join("; "),
        };
      }
    } catch (e) {
      const msg = `Диагностика сервера: ${e instanceof Error ? e.message : String(e)}`;
      if (lastResult.status === "available") {
        lastResult = { ...lastResult, error_message: msg };
      } else {
        lastResult = {
          ...lastResult,
          error_message: [lastResult.error_message, msg].filter(Boolean).join("; "),
        };
      }
    }
  }

  const prev_status = row.status;
  const settingsAll = getTelegramProxySettings();
  let notification_sent = false;
  const checkedAt = new Date().toISOString();

  const becameUnavailable =
    settingsAll.notify_on_unavailable &&
    lastResult.status !== "available" &&
    prev_status === "available" &&
    notifyCooldownOk(row.last_check_at, settingsAll.notify_cooldown_minutes);

  const becameAvailable =
    settingsAll.notify_on_recovery &&
    lastResult.status === "available" &&
    (prev_status === "unavailable" || prev_status === "timeout" || prev_status === "auth_error") &&
    notifyCooldownOk(row.last_check_at, settingsAll.notify_cooldown_minutes);

  if (becameUnavailable && server) {
    const body =
      `⚠️ <b>Проблема с Telegram-прокси</b>\n\n` +
      `Прокси: <b>${row.name}</b>\n` +
      `Тип: ${proxyTypeLabel(row.type)}\n` +
      `Сервер: ${server.name}\n` +
      `Адрес: ${row.host}:${row.port}\n` +
      `Статус: недоступен\n` +
      `Ошибка: ${lastResult.error_message ?? "—"}\n` +
      `Время: ${formatMoscowDatetime(checkedAt)}`;
    notification_sent = await notifyAdminsHtml(body);
    updateTelegramProxyRow(proxyId, { last_notified_status: lastResult.status });
    appendTelegramProxyEvent({
      proxy_id: proxyId,
      server_id: row.server_id,
      event_type: "became_unavailable",
      message: `Прокси «${row.name}» недоступен: ${lastResult.error_message ?? "—"}`,
    });
  } else if (becameAvailable && server) {
    const body =
      `✅ <b>Telegram-прокси снова доступен</b>\n\n` +
      `Прокси: <b>${row.name}</b>\n` +
      `Тип: ${proxyTypeLabel(row.type)}\n` +
      `Сервер: ${server.name}\n` +
      `Адрес: ${row.host}:${row.port}\n` +
      `Задержка: ${lastResult.latency_ms ?? "—"} мс\n` +
      `Время: ${formatMoscowDatetime(checkedAt)}`;
    notification_sent = await notifyAdminsHtml(body);
    updateTelegramProxyRow(proxyId, { last_notified_status: "available" });
    appendTelegramProxyEvent({
      proxy_id: proxyId,
      server_id: row.server_id,
      event_type: "recovered",
      message: `Прокси «${row.name}» снова доступен (${lastResult.latency_ms ?? "—"} мс)`,
    });
  }

  const check = appendTelegramProxyCheck({
    proxy_id: proxyId,
    checked_at: checkedAt,
    status: lastResult.status,
    latency_ms: lastResult.latency_ms,
    error_message: lastResult.error_message,
    triggered_by: triggeredBy,
    notification_sent,
  });

  const updated =
    updateTelegramProxyRow(proxyId, {
      status: lastResult.status,
      last_check_at: checkedAt,
      last_latency_ms: lastResult.latency_ms,
      last_error: lastResult.error_message,
    }) ?? row;

  if (triggeredBy === "manual") {
    appendTelegramProxyEvent({
      proxy_id: proxyId,
      server_id: row.server_id,
      event_type: "checked",
      message: `Проверка «${row.name}»: ${lastResult.status}${lastResult.latency_ms != null ? `, ${lastResult.latency_ms} мс` : ""}`,
    });
  }

  const reveal = !getPanelSettings().security.maskSecrets;
  return { proxy: proxyForApi(updated, reveal), check };
}

export function startTelegramProxyCheckAllBackground(
  triggeredBy: "manual" | "auto",
): { total: number; already_running: boolean } {
  const total = listTelegramProxies().filter((p) => p.active).length;
  if (checkAllRunning) return { total, already_running: true };
  checkAllRunning = true;
  void runTelegramProxyCheckAll(triggeredBy).finally(() => {
    checkAllRunning = false;
  });
  return { total, already_running: false };
}

export async function runTelegramProxyCheckAll(triggeredBy: "manual" | "auto"): Promise<number> {
  const proxies = listTelegramProxies().filter((p) => p.active);
  let done = 0;
  for (const p of proxies) {
    try {
      await runTelegramProxyCheck(p.id, triggeredBy);
      done += 1;
    } catch (e) {
      console.error("[telegram-proxies] check", p.id, e instanceof Error ? e.message : e);
    }
  }
  if (triggeredBy === "auto") {
    setTelegramProxySettings({ last_auto_run_at: new Date().toISOString() });
  }
  return done;
}

export async function checkServerSshQuick(serverId: number): Promise<boolean> {
  const server = getServer(serverId);
  if (!server) throw new Error("Сервер не найден");
  const cfg = sshCfgFromServer(server);
  const r = await sshExecCommand(cfg, "echo ok");
  return r.code === 0 && r.stdout.includes("ok");
}

export function listProxyEvents(limit = 200) {
  return listTelegramProxyEvents(limit);
}

export function saveProxySettings(patch: Parameters<typeof setTelegramProxySettings>[0]) {
  return setTelegramProxySettings(patch);
}
