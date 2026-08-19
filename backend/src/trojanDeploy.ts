import {
  clientUuidsForServer,
  getServer,
  listServersOrdered,
  updateServer,
  type ServerRow,
} from "./db.js";
import { tryOpenFirewallPort } from "./experimentFirewall.js";
import {
  TROJAN_CERT_PATH,
  TROJAN_CONFIG_DIR,
  TROJAN_DEFAULT_PORT,
  TROJAN_DEFAULT_SNI,
  TROJAN_INBOUND_TAG,
  TROJAN_KEY_PATH,
  TROJAN_LOOPBACK_PORT,
} from "./trojanConstants.js";
import {
  TZADMIN_XRAY_CONFIG_PATH,
  mutateXrayConfigAndRestart,
  sshExecCommand,
  type SshConfig,
  type SshLog,
} from "./ssh.js";

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function ensureSelfSignedCert(cfg: SshConfig, sni: string, log?: SshLog, forceRegenerate = false): Promise<void> {
  if (!forceRegenerate) {
    const check = await sshExecCommand(
      cfg,
      `test -f ${shellQuote(TROJAN_CERT_PATH)} && test -f ${shellQuote(TROJAN_KEY_PATH)} && echo ok || true`,
    );
    if (check.stdout.includes("ok")) {
      log?.("TLS-сертификат Trojan уже есть.");
      return;
    }
  }
  log?.("Генерирую self-signed сертификат для Trojan (с SAN)…");
  const cn = sni || TROJAN_DEFAULT_SNI;
  const san = `DNS:${cn}`;
  const cmd = [
    `sudo mkdir -p ${shellQuote(TROJAN_CONFIG_DIR)}`,
    `sudo openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${shellQuote(TROJAN_KEY_PATH)} -out ${shellQuote(TROJAN_CERT_PATH)} -days 3650 -subj ${shellQuote(`/CN=${cn}`)} -addext ${shellQuote(`subjectAltName=${san}`)}`,
    `sudo chmod 600 ${shellQuote(TROJAN_KEY_PATH)}`,
    `sudo chmod 644 ${shellQuote(TROJAN_CERT_PATH)}`,
  ].join(" && ");
  const r = await sshExecCommand(cfg, cmd);
  if (r.code !== 0) {
    throw new Error(`Не удалось создать сертификат Trojan: ${r.stderr || r.stdout || `code ${r.code}`}`);
  }
}

async function readCertSha256(cfg: SshConfig): Promise<string> {
  const r = await sshExecCommand(
    cfg,
    `openssl x509 -in ${shellQuote(TROJAN_CERT_PATH)} -noout -fingerprint -sha256`,
  );
  if (r.code !== 0) {
    throw new Error(`Не удалось прочитать fingerprint Trojan: ${r.stderr || r.stdout || `code ${r.code}`}`);
  }
  const line = String(r.stdout || "").trim();
  const m = line.match(/=?\s*([0-9A-Fa-f:]+)\s*$/);
  const hex = (m?.[1] || "").replace(/:/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`Некорректный fingerprint Trojan: ${line.slice(0, 120)}`);
  }
  return hex;
}

async function nginxHasStream443(cfg: SshConfig): Promise<boolean> {
  const r = await sshExecCommand(
    cfg,
    `grep -Rqs ssl_preread /etc/nginx/stream.d 2>/dev/null && echo yes || true`,
  );
  return r.stdout.includes("yes");
}

async function patchNginxSniMap(cfg: SshConfig, sni: string, loopbackPort: number, log?: SshLog): Promise<void> {
  const host = sni.trim() || TROJAN_DEFAULT_SNI;
  const r = await sshExecCommand(
    cfg,
    `python3 - <<'PY'
from pathlib import Path
import re
p = Path("/etc/nginx/stream.d/vpn-front-sni.conf")
if not p.is_file():
    raise SystemExit("no stream sni conf")
t = p.read_text()
host = ${JSON.stringify(host)}
port = ${loopbackPort}
needle = f"127.0.0.1:{port}"
if host in t and needle in t:
    print("sni_map_ok")
else:
    line = f"    {host}    {needle};"
    t2, n = re.subn(r"(map \\$ssl_preread_server_name \\$vpn_sni_backend \\{)", r"\\1\\n" + line, t, count=1)
    if n != 1:
        raise SystemExit("map block not found")
    p.write_text(t2)
    print("sni_map_patched")
PY
nginx -t && systemctl reload nginx && echo nginx_ok`,
  );
  if (r.code !== 0) {
    throw new Error(`Не удалось обновить nginx SNI для Trojan: ${r.stderr || r.stdout}`);
  }
  log?.(`Nginx SNI ${host} → 127.0.0.1:${loopbackPort}`);
}

function buildTrojanInbound(port: number, listen: string, clients: { password: string; email: string }[]): Record<string, unknown> {
  return {
    tag: TROJAN_INBOUND_TAG,
    listen,
    port,
    protocol: "trojan",
    settings: { clients },
    streamSettings: {
      network: "tcp",
      security: "tls",
      tlsSettings: {
        certificates: [{ certificateFile: TROJAN_CERT_PATH, keyFile: TROJAN_KEY_PATH }],
      },
    },
  };
}

export type DeployTrojanOptions = {
  forceRedeploy?: boolean;
};

export async function deployOrSyncTrojan(
  cfg: SshConfig,
  server: ServerRow,
  log?: SshLog,
  opts?: DeployTrojanOptions,
): Promise<{ ok: true; port: number; listenPort: number; sni: string; certSha256: string } | { ok: false; detail: string }> {
  try {
    const sni = String(server.trojan_sni ?? "").trim() || TROJAN_DEFAULT_SNI;
    const uuids = clientUuidsForServer(server.vless_uuid);
    const clients = uuids.filter(Boolean).map((id) => ({ password: id, email: id }));
    if (clients.length === 0) {
      clients.push({ password: "__placeholder__", email: "__placeholder__" });
    }

    const stream443 = await nginxHasStream443(cfg);
    const listen = stream443 ? "127.0.0.1" : "0.0.0.0";
    const listenPort = stream443 ? TROJAN_LOOPBACK_PORT : TROJAN_DEFAULT_PORT;
    const advertisedPort = stream443 ? 443 : listenPort;

    log?.(
      stream443
        ? `Trojan: публичный TCP 443 (SNI ${sni}) → 127.0.0.1:${listenPort}, пользователей ${uuids.length}…`
        : `Trojan: TCP ${listenPort}, пользователей ${uuids.length}…`,
    );

    await ensureSelfSignedCert(cfg, sni, log, opts?.forceRedeploy === true);
    const certSha256 = await readCertSha256(cfg);
    log?.(`TLS pin (pcs): ${certSha256.slice(0, 16)}…`);

    const configPath = server.xray_config_path?.trim() || TZADMIN_XRAY_CONFIG_PATH;
    await mutateXrayConfigAndRestart(
      cfg,
      configPath,
      (parsed) => {
        if (!Array.isArray(parsed.inbounds)) parsed.inbounds = [];
        const inbounds = parsed.inbounds as Record<string, unknown>[];
        const next = buildTrojanInbound(listenPort, listen, clients);
        const idx = inbounds.findIndex((ib) => String(ib.tag ?? "") === TROJAN_INBOUND_TAG);
        if (idx >= 0) inbounds[idx] = next;
        else inbounds.push(next);
        parsed.inbounds = inbounds;
      },
      log,
    );

    if (stream443) {
      await patchNginxSniMap(cfg, sni, listenPort, log);
    } else {
      const fw = await tryOpenFirewallPort(cfg, listenPort);
      log?.(`Firewall ${listenPort}/tcp: ${fw.detail}`);
    }

    return { ok: true, port: advertisedPort, listenPort, sni, certSha256 };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log?.(detail);
    return { ok: false, detail };
  }
}

export async function syncTrojanOnServer(serverId: number, log?: SshLog): Promise<void> {
  const row = getServer(serverId);
  if (!row || row.trojan_deployed !== 1) return;
  const cfg: SshConfig = {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
  const r = await deployOrSyncTrojan(cfg, row, log);
  if (!r.ok) {
    updateServer(serverId, { last_error: r.detail });
    throw new Error(r.detail);
  }
  updateServer(serverId, {
    trojan_port: r.port,
    trojan_sni: r.sni,
    trojan_cert_sha256: r.certSha256,
    trojan_deployed: 1,
    last_error: null,
    last_ssh_ok: 1,
  });
}

export async function pushTrojanClientsToAllDeployedServers(log?: SshLog): Promise<void> {
  for (const row of listServersOrdered()) {
    if (row.trojan_deployed !== 1) continue;
    try {
      await syncTrojanOnServer(row.id, log);
    } catch (e) {
      log?.(`Trojan sync ${row.host}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
