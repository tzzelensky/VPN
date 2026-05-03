import {
  getServer,
  listDeployedServers,
  listUsers,
  updateServer,
  userAllowedOnServers,
  type ServerRow,
} from "./db.js";
import {
  alterInboundUsersViaApi,
  TZADMIN_XRAY_CONFIG_PATH,
  removeClientUuidFromTzadmin,
  syncServerClientUuids,
  type ManagedClientInput,
  type SshLog,
} from "./ssh.js";

function sshCfg(row: ServerRow) {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

export async function resolveConfigPath(row: ServerRow, log?: SshLog): Promise<string> {
  const path = TZADMIN_XRAY_CONFIG_PATH;
  if (row.xray_config_path !== path) {
    log?.(`Переключение на отдельный конфиг панели: ${path}`);
    updateServer(row.id, { xray_config_path: path });
  }
  return path;
}

/** Очередь: параллельные push ломали конфиг на сервере (два SSH подряд). */
let pushQueue: Promise<void> = Promise.resolve();
/** Последняя успешно синхронизированная сигнатура UUID по server.id. */
const lastSyncedSignatureByServerId = new Map<number, string>();
/** Последняя успешно синхронизированная карта клиентов по server.id (id -> deviceLimit maxIPs). */
const lastSyncedClientMapByServerId = new Map<number, Map<string, number | undefined>>();

function signatureForClients(clients: ManagedClientInput[]): string {
  return [...clients]
    .map((c) => ({ id: String(c.id ?? "").trim(), deviceLimit: Number(c.deviceLimit) }))
    .filter((c) => c.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (c) =>
        `${c.id}|${Number.isFinite(c.deviceLimit) && c.deviceLimit > 0 ? Math.floor(c.deviceLimit) : 0}`,
    )
    .join(",");
}

function mapFromClients(clients: ManagedClientInput[]): Map<string, number | undefined> {
  const out = new Map<string, number | undefined>();
  for (const raw of clients) {
    const id = String(raw.id ?? "").trim();
    if (!id) continue;
    const lim = Number(raw.deviceLimit);
    out.set(id, Number.isFinite(lim) && lim > 0 ? Math.floor(lim) : undefined);
  }
  return out;
}

function managedClientsForServer(serverUuid: string | null): ManagedClientInput[] {
  const out: ManagedClientInput[] = [];
  const seen = new Set<string>();
  const srv = String(serverUuid ?? "").trim();
  if (srv) {
    out.push({ id: srv });
    seen.add(srv.toLowerCase());
  }
  for (const u of listUsers()) {
    if (!userAllowedOnServers(u)) continue;
    const id = String(u.vless_uuid ?? "").trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      ...(u.device_limit_enabled === 1
        ? { deviceLimit: Math.max(1, Math.floor(Number(u.device_limit_count) || 1)) }
        : {}),
    });
  }
  return out;
}

/** Обновить inbound на всех развёрнутых серверах по текущим пользователям в БД. */
export async function pushClientListToAllDeployedServers(log?: SshLog): Promise<void> {
  const run = async () => {
    for (const row of listDeployedServers()) {
      const path = await resolveConfigPath(row, log);
      const clients = managedClientsForServer(row.vless_uuid);
      const sig = signatureForClients(clients);
      const prevSig = lastSyncedSignatureByServerId.get(row.id);
      if (prevSig === sig) {
        log?.(`Синхронизация ${row.host} пропущена: список клиентов не изменился.`);
        continue;
      }
      const nextMap = mapFromClients(clients);
      const prevMap = lastSyncedClientMapByServerId.get(row.id);
      if (prevMap) {
        const add: ManagedClientInput[] = [];
        const rem: string[] = [];
        let hasMutableUpdates = false;
        for (const [id, lim] of nextMap) {
          if (!prevMap.has(id)) add.push({ id, ...(lim != null ? { deviceLimit: lim } : {}) });
          else if ((prevMap.get(id) ?? undefined) !== lim) hasMutableUpdates = true;
        }
        for (const id of prevMap.keys()) if (!nextMap.has(id)) rem.push(id);
        const addNeedsFullSync = add.some((c) => Number(c.deviceLimit) > 0);
        // Быстрый путь без рестарта: только без лимита устройств (иначе не обновится policy.maxIPs в рантайме).
        if (
          !hasMutableUpdates &&
          !addNeedsFullSync &&
          add.length + rem.length > 0 &&
          add.length + rem.length <= 4
        ) {
          const fast = await alterInboundUsersViaApi(
            sshCfg(row),
            { configPath: path, preferredVlessPort: row.vless_port, addClients: add, removeUuids: rem },
            log,
          );
          if (fast.ok) {
            log?.(`Быстрый sync ${row.host}: ${fast.detail}`);
            lastSyncedSignatureByServerId.set(row.id, sig);
            lastSyncedClientMapByServerId.set(row.id, nextMap);
            continue;
          }
          log?.(`Быстрый sync недоступен на ${row.host}, fallback на полный sync: ${fast.detail}`);
        }
      }
      log?.(`Синхронизация ${row.host} → ${path} (${clients.length} клиентов), порт ${row.vless_port}…`);
      const r = await syncServerClientUuids(
        sshCfg(row),
        {
          configPath: path,
          vlessPort: row.vless_port,
          clientEntries: clients,
        },
        log,
      );
      if (!r.ok) {
        log?.(`Ошибка на ${row.host}: ${r.detail}`);
        continue;
      }
      if (r.hints) {
        updateServer(row.id, {
          sub_port: r.hints.sub_port || row.vless_port,
          sub_network: r.hints.sub_network,
          sub_security: r.hints.sub_security,
          sub_type: r.hints.sub_type,
          sub_host: r.hints.sub_host,
          sub_path: r.hints.sub_path,
          sub_sni: r.hints.sub_sni,
          sub_fp: r.hints.sub_fp,
          sub_alpn: r.hints.sub_alpn,
          sub_allow_insecure: r.hints.sub_allow_insecure,
          sub_reality_pbk: r.hints.sub_reality_pbk,
          sub_reality_sid: r.hints.sub_reality_sid,
          sub_reality_spx: r.hints.sub_reality_spx,
        });
      }
      lastSyncedSignatureByServerId.set(row.id, sig);
      lastSyncedClientMapByServerId.set(row.id, nextMap);
    }
  };
  const job = pushQueue.then(() => run());
  pushQueue = job.catch(() => {});
  await job;
}

export async function removeUserUuidFromAllServers(userVlessUuid: string, log?: SshLog): Promise<void> {
  for (const row of listDeployedServers()) {
    const path = await resolveConfigPath(row, log);
    const fast = await alterInboundUsersViaApi(
      sshCfg(row),
      { configPath: path, preferredVlessPort: row.vless_port, removeUuids: [userVlessUuid] },
      log,
    );
    if (fast.ok) {
      lastSyncedSignatureByServerId.delete(row.id);
      lastSyncedClientMapByServerId.delete(row.id);
      continue;
    }
    const fresh = getServer(row.id);
    const fallback = fresh?.vless_uuid ?? null;
    log?.(`Удаление UUID пользователя на ${row.host}…`);
    const r = await removeClientUuidFromTzadmin(
      sshCfg(row),
      {
        configPath: path,
        vlessPort: row.vless_port,
        removeUuid: userVlessUuid,
        fallbackServerUuid: fallback,
      },
      log,
    );
    if (!r.ok) log?.(`Ошибка на ${row.host}: ${r.detail}`);
    else {
      lastSyncedSignatureByServerId.delete(row.id);
      lastSyncedClientMapByServerId.delete(row.id);
    }
  }
}
