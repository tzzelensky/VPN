import {
  clientUuidsForServer,
  getServer,
  listDeployedServers,
  updateServer,
  type ServerRow,
} from "./db.js";
import {
  alterInboundUsersViaApi,
  TZADMIN_XRAY_CONFIG_PATH,
  removeClientUuidFromTzadmin,
  syncServerClientUuids,
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
/** Последний успешно синхронизированный набор UUID по server.id (для дельта-обновлений через Xray API). */
const lastSyncedUuidSetByServerId = new Map<number, Set<string>>();

function signatureForUuids(uuids: string[]): string {
  return [...uuids].sort().join(",");
}

function setFromUuids(uuids: string[]): Set<string> {
  return new Set(uuids.map((x) => x.trim()).filter(Boolean));
}

/** Обновить inbound на всех развёрнутых серверах по текущим пользователям в БД. */
export async function pushClientListToAllDeployedServers(log?: SshLog): Promise<void> {
  const run = async () => {
    for (const row of listDeployedServers()) {
      const path = await resolveConfigPath(row, log);
      const uuids = clientUuidsForServer(row.vless_uuid);
      const sig = signatureForUuids(uuids);
      const prevSig = lastSyncedSignatureByServerId.get(row.id);
      if (prevSig === sig) {
        log?.(`Синхронизация ${row.host} пропущена: список UUID не изменился.`);
        continue;
      }
      const nextSet = setFromUuids(uuids);
      const prevSet = lastSyncedUuidSetByServerId.get(row.id);
      if (prevSet) {
        const add: string[] = [];
        const rem: string[] = [];
        for (const id of nextSet) if (!prevSet.has(id)) add.push(id);
        for (const id of prevSet) if (!nextSet.has(id)) rem.push(id);
        // Быстрый путь без рестарта: точечный add/remove пользователей через HandlerService.
        if (add.length + rem.length > 0 && add.length + rem.length <= 4) {
          const fast = await alterInboundUsersViaApi(
            sshCfg(row),
            { configPath: path, preferredVlessPort: row.vless_port, addUuids: add, removeUuids: rem },
            log,
          );
          if (fast.ok) {
            log?.(`Быстрый sync ${row.host}: ${fast.detail}`);
            lastSyncedSignatureByServerId.set(row.id, sig);
            lastSyncedUuidSetByServerId.set(row.id, nextSet);
            continue;
          }
          log?.(`Быстрый sync недоступен на ${row.host}, fallback на полный sync: ${fast.detail}`);
        }
      }
      log?.(`Синхронизация ${row.host} → ${path} (${uuids.length} UUID), порт ${row.vless_port}…`);
      const r = await syncServerClientUuids(
        sshCfg(row),
        {
          configPath: path,
          vlessPort: row.vless_port,
          clientUuids: uuids,
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
      lastSyncedUuidSetByServerId.set(row.id, nextSet);
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
      lastSyncedUuidSetByServerId.delete(row.id);
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
      lastSyncedUuidSetByServerId.delete(row.id);
    }
  }
}
