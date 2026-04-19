import {
  clientUuidsForServer,
  getServer,
  listDeployedServers,
  updateServer,
  type ServerRow,
} from "./db.js";
import { detectXrayConfigPath, removeClientUuidFromTzadmin, syncServerClientUuids, type SshLog } from "./ssh.js";

function sshCfg(row: ServerRow) {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

export async function resolveConfigPath(row: ServerRow, log?: SshLog): Promise<string> {
  if (row.xray_config_path) return row.xray_config_path;
  const detected = await detectXrayConfigPath(sshCfg(row), log);
  const path = detected ?? "/usr/local/etc/xray/config.json";
  updateServer(row.id, { xray_config_path: path });
  return path;
}

/** Очередь: параллельные push ломали конфиг на сервере (два SSH подряд). */
let pushQueue: Promise<void> = Promise.resolve();

/** Обновить inbound на всех развёрнутых серверах по текущим пользователям в БД. */
export async function pushClientListToAllDeployedServers(log?: SshLog): Promise<void> {
  const run = async () => {
    for (const row of listDeployedServers()) {
      const path = await resolveConfigPath(row, log);
      const uuids = clientUuidsForServer(row.vless_uuid);
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
    }
  };
  const job = pushQueue.then(() => run());
  pushQueue = job.catch(() => {});
  await job;
}

export async function removeUserUuidFromAllServers(userVlessUuid: string, log?: SshLog): Promise<void> {
  for (const row of listDeployedServers()) {
    const path = await resolveConfigPath(row, log);
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
  }
}
