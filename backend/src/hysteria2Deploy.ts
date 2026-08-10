import { randomBytes } from "node:crypto";
import {
  clientUuidsForServer,
  getServer,
  listServersOrdered,
  updateServer,
  type ServerRow,
} from "./db.js";
import { tryOpenFirewallUdpPort } from "./experimentFirewall.js";
import {
  HYSTERIA2_BIN_PATH,
  HYSTERIA2_CERT_PATH,
  HYSTERIA2_CONFIG_DIR,
  HYSTERIA2_CONFIG_PATH,
  HYSTERIA2_DEFAULT_PORT,
  HYSTERIA2_DEFAULT_SNI,
  HYSTERIA2_KEY_PATH,
  HYSTERIA2_RELEASE_URL,
  HYSTERIA2_SERVICE_NAME,
  HYSTERIA2_STATS_LISTEN,
} from "./hysteria2Constants.js";
import { sshExecCommand, type SshConfig, type SshLog } from "./ssh.js";

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Случайный UDP-порт HY2 (не совпадает с текущим). */
export function pickHysteria2UdpPort(exclude?: number): number {
  const ex = Math.floor(Number(exclude) || 0);
  for (let i = 0; i < 48; i++) {
    const p = 20000 + Math.floor(Math.random() * 40000); // 20000–59999
    if (p >= 1024 && p <= 65535 && p !== ex) return p;
  }
  return ex === HYSTERIA2_DEFAULT_PORT ? HYSTERIA2_DEFAULT_PORT + 1 : HYSTERIA2_DEFAULT_PORT;
}

function yamlEscape(s: string): string {
  if (/^[\w.@+-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

export function buildHysteria2ConfigYaml(input: {
  port: number;
  sni: string;
  statsSecret: string;
  userUuids: string[];
}): string {
  const port = Math.max(1, Math.floor(Number(input.port) || HYSTERIA2_DEFAULT_PORT));
  const lines: string[] = [
    `listen: :${port}`,
    ``,
    `tls:`,
    `  cert: ${HYSTERIA2_CERT_PATH}`,
    `  key: ${HYSTERIA2_KEY_PATH}`,
    ``,
    `auth:`,
    `  type: userpass`,
    `  userpass:`,
  ];
  const uuids = [...new Set(input.userUuids.map((u) => String(u).trim()).filter(Boolean))];
  if (uuids.length === 0) {
    lines.push(`    "__placeholder__": "__placeholder__"`);
  } else {
    for (const id of uuids) {
      lines.push(`    ${yamlEscape(id)}: ${yamlEscape(id)}`);
    }
  }
  lines.push(
    ``,
    `trafficStats:`,
    `  listen: ${HYSTERIA2_STATS_LISTEN}`,
    `  secret: ${yamlEscape(input.statsSecret)}`,
    ``,
    `bandwidth:`,
    `  up: 1 gbps`,
    `  down: 1 gbps`,
  );
  void input.sni;
  return `${lines.join("\n")}\n`;
}

const UNIT_FILE = `[Unit]
Description=tzadmin Hysteria2
After=network.target

[Service]
Type=simple
ExecStart=${HYSTERIA2_BIN_PATH} server -c ${HYSTERIA2_CONFIG_PATH}
Restart=on-failure
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
`;

async function ensureBinary(cfg: SshConfig, log?: SshLog): Promise<void> {
  const check = await sshExecCommand(cfg, `test -x ${shellQuote(HYSTERIA2_BIN_PATH)} && echo ok || true`);
  if (check.stdout.includes("ok")) {
    log?.("Hysteria2 binary уже установлен.");
    return;
  }
  log?.("Скачиваю Hysteria2 binary…");
  const cmd = [
    `set -e`,
    `tmpdir=$(mktemp -d)`,
    `curl -fsSL ${shellQuote(HYSTERIA2_RELEASE_URL)} -o "$tmpdir/hysteria"`,
    `chmod +x "$tmpdir/hysteria"`,
    `sudo mv "$tmpdir/hysteria" ${shellQuote(HYSTERIA2_BIN_PATH)}`,
    `rm -rf "$tmpdir"`,
    `${shellQuote(HYSTERIA2_BIN_PATH)} version || true`,
  ].join(" && ");
  const r = await sshExecCommand(cfg, cmd);
  if (r.code !== 0) {
    throw new Error(`Не удалось установить Hysteria2: ${r.stderr || r.stdout || `code ${r.code}`}`);
  }
  log?.("Hysteria2 binary установлен.");
}

async function ensureSelfSignedCert(cfg: SshConfig, sni: string, log?: SshLog, forceRegenerate = false): Promise<void> {
  if (!forceRegenerate) {
    const check = await sshExecCommand(
      cfg,
      `test -f ${shellQuote(HYSTERIA2_CERT_PATH)} && test -f ${shellQuote(HYSTERIA2_KEY_PATH)} && echo ok || true`,
    );
    if (check.stdout.includes("ok")) {
      log?.("TLS-сертификат Hysteria2 уже есть.");
      return;
    }
  }
  log?.("Генерирую self-signed сертификат для Hysteria2 (с SAN)…");
  const cn = sni || HYSTERIA2_DEFAULT_SNI;
  const san = `DNS:${cn}`;
  const cmd = [
    `sudo mkdir -p ${shellQuote(HYSTERIA2_CONFIG_DIR)}`,
    `sudo openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${shellQuote(HYSTERIA2_KEY_PATH)} -out ${shellQuote(HYSTERIA2_CERT_PATH)} -days 3650 -subj ${shellQuote(`/CN=${cn}`)} -addext ${shellQuote(`subjectAltName=${san}`)}`,
    `sudo chmod 600 ${shellQuote(HYSTERIA2_KEY_PATH)}`,
    `sudo chmod 644 ${shellQuote(HYSTERIA2_CERT_PATH)}`,
  ].join(" && ");
  const r = await sshExecCommand(cfg, cmd);
  if (r.code !== 0) {
    throw new Error(`Не удалось создать сертификат: ${r.stderr || r.stdout || `code ${r.code}`}`);
  }
}

/** SHA-256 fingerprint leaf-сертификата (hex без двоеточий). */
async function readCertSha256(cfg: SshConfig): Promise<string> {
  const cmd = [
    `openssl x509 -in ${shellQuote(HYSTERIA2_CERT_PATH)} -noout -fingerprint -sha256`,
  ].join(" && ");
  const r = await sshExecCommand(cfg, cmd);
  if (r.code !== 0) {
    throw new Error(`Не удалось прочитать fingerprint сертификата: ${r.stderr || r.stdout || `code ${r.code}`}`);
  }
  const line = String(r.stdout || "").trim();
  const m = line.match(/=?\s*([0-9A-Fa-f:]+)\s*$/);
  const hex = (m?.[1] || "").replace(/:/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`Некорректный fingerprint сертификата: ${line.slice(0, 120)}`);
  }
  return hex;
}

async function writeRemoteFile(cfg: SshConfig, path: string, content: string): Promise<void> {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  const cmd = [
    `sudo mkdir -p $(dirname ${shellQuote(path)})`,
    `echo ${shellQuote(b64)} | base64 -d | sudo tee ${shellQuote(path)} >/dev/null`,
  ].join(" && ");
  const r = await sshExecCommand(cfg, cmd);
  if (r.code !== 0) {
    throw new Error(`Не удалось записать ${path}: ${r.stderr || r.stdout || `code ${r.code}`}`);
  }
}

async function restartService(cfg: SshConfig, log?: SshLog): Promise<void> {
  await writeRemoteFile(cfg, `/etc/systemd/system/${HYSTERIA2_SERVICE_NAME}.service`, UNIT_FILE);
  const cmd = [
    `sudo systemctl daemon-reload`,
    `sudo systemctl enable ${HYSTERIA2_SERVICE_NAME}`,
    `sudo systemctl restart ${HYSTERIA2_SERVICE_NAME}`,
    `sleep 1`,
    `sudo systemctl is-active ${HYSTERIA2_SERVICE_NAME}`,
  ].join(" && ");
  const r = await sshExecCommand(cfg, cmd);
  if (r.code !== 0 || !/active/.test(r.stdout)) {
    const st = await sshExecCommand(cfg, `sudo journalctl -u ${HYSTERIA2_SERVICE_NAME} -n 30 --no-pager || true`);
    throw new Error(
      `Сервис ${HYSTERIA2_SERVICE_NAME} не запустился: ${r.stderr || r.stdout}\n${st.stdout.slice(0, 800)}`,
    );
  }
  log?.(`Сервис ${HYSTERIA2_SERVICE_NAME} активен.`);
}

export type DeployHysteria2Options = {
  /** Сменить UDP-порт (кнопка «Обновить Hysteria2»). */
  rotatePort?: boolean;
  /** Перевыпустить cert и перезаписать unit/config с нуля. */
  forceRedeploy?: boolean;
};

export async function deployOrSyncHysteria2(
  cfg: SshConfig,
  server: ServerRow,
  log?: SshLog,
  opts?: DeployHysteria2Options,
): Promise<
  | { ok: true; port: number; sni: string; statsSecret: string; certSha256: string }
  | { ok: false; detail: string }
> {
  try {
    const rawPort = Math.floor(Number(server.hysteria2_port) || 0);
    const currentPort =
      rawPort >= 1024 && rawPort <= 65535 ? rawPort : HYSTERIA2_DEFAULT_PORT;
    const rotatePort = opts?.rotatePort === true;
    const forceRedeploy = opts?.forceRedeploy === true || rotatePort;
    const port = rotatePort ? pickHysteria2UdpPort(currentPort) : currentPort;
    const sni = String(server.hysteria2_sni ?? "").trim() || HYSTERIA2_DEFAULT_SNI;
    const statsSecret =
      forceRedeploy
        ? randomBytes(16).toString("hex")
        : String(server.hysteria2_stats_secret ?? "").trim() || randomBytes(16).toString("hex");
    const uuids = clientUuidsForServer(server.vless_uuid);

    if (rotatePort) {
      log?.(`Hysteria2: новый порт UDP ${port} (было ${currentPort}), пользователей ${uuids.length}…`);
    } else {
      log?.(`Hysteria2: порт UDP ${port}, пользователей ${uuids.length}…`);
    }
    await ensureBinary(cfg, log);

    let needRegen = forceRedeploy;
    if (!needRegen) {
      // Перевыпустить cert с SAN если старый без SAN
      const sanCheck = await sshExecCommand(
        cfg,
        `openssl x509 -in ${shellQuote(HYSTERIA2_CERT_PATH)} -noout -ext subjectAltName 2>/dev/null | grep -q DNS && echo san_ok || echo no_san`,
      );
      needRegen = !sanCheck.stdout.includes("san_ok");
      if (needRegen) log?.("Сертификат без SAN — перевыпускаю…");
    } else {
      log?.("Полное обновление HY2 — перевыпускаю TLS-сертификат…");
    }
    await ensureSelfSignedCert(cfg, sni, log, needRegen);
    const certSha256 = await readCertSha256(cfg);
    log?.(`TLS pin (pcs): ${certSha256.slice(0, 16)}…`);

    const yaml = buildHysteria2ConfigYaml({ port, sni, statsSecret, userUuids: uuids });
    await writeRemoteFile(cfg, HYSTERIA2_CONFIG_PATH, yaml);
    log?.(`Конфиг записан: ${HYSTERIA2_CONFIG_PATH}`);

    const fw = await tryOpenFirewallUdpPort(cfg, port);
    log?.(`Firewall ${port}/udp: ${fw.detail}`);

    await restartService(cfg, log);
    return { ok: true, port, sni, statsSecret, certSha256 };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log?.(detail);
    return { ok: false, detail };
  }
}

export async function syncHysteria2OnServer(serverId: number, log?: SshLog): Promise<void> {
  const row = getServer(serverId);
  if (!row || row.hysteria2_deployed !== 1) return;
  const cfg: SshConfig = {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
  const r = await deployOrSyncHysteria2(cfg, row, log);
  if (!r.ok) {
    updateServer(serverId, { last_error: r.detail });
    throw new Error(r.detail);
  }
  updateServer(serverId, {
    hysteria2_port: r.port,
    hysteria2_sni: r.sni,
    hysteria2_stats_secret: r.statsSecret,
    hysteria2_config_path: HYSTERIA2_CONFIG_PATH,
    hysteria2_cert_sha256: r.certSha256,
    hysteria2_deployed: 1,
    last_error: null,
    last_ssh_ok: 1,
  });
}

export async function pushHysteria2ClientsToAllDeployedServers(log?: SshLog): Promise<void> {
  for (const row of listServersOrdered()) {
    if (row.hysteria2_deployed !== 1) continue;
    try {
      await syncHysteria2OnServer(row.id, log);
    } catch (e) {
      log?.(`Hysteria2 sync ${row.host}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
