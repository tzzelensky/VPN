import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { getTelegramProxy, updateTelegramProxyRow } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";
import {
  deployTelegramProxyOnServer,
  generateMtprotoDdSecret,
  mtprotoSecretForTelegramLink,
} from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxyDeploy.js";

const proxyId = Number(process.argv[2] || 18);
const newPort = Number(process.argv[3] || 2053);

const row = getTelegramProxy(proxyId);
if (!row || row.deleted_at) {
  console.error("proxy not found", proxyId);
  process.exit(1);
}

const server = getServer(row.server_id);
if (!server) {
  console.error("server not found", row.server_id);
  process.exit(1);
}

const secret = generateMtprotoDdSecret();
const updated = updateTelegramProxyRow(proxyId, { secret, port: newPort, status: "unknown", last_error: null });
if (!updated) {
  console.error("update failed");
  process.exit(1);
}

const deploy = await deployTelegramProxyOnServer(server, {
  id: updated.id,
  type: updated.type,
  port: updated.port,
  secret: updated.secret,
  username: updated.username,
  password: updated.password,
  auth_enabled: updated.auth_enabled,
});

const cfg = {
  host: server.host,
  port: server.ssh_port,
  username: server.ssh_user,
  passwordEnc: server.ssh_password_enc,
};
const svc = `tzadmin-proxy-${proxyId}`;
const verify = await sshExecCommand(
  cfg,
  [
    `systemctl is-active ${svc}`,
    `/opt/tzadmin-proxy/bin/mtg access /opt/tzadmin-proxy/${proxyId}/mtg.toml 2>&1`,
    `/opt/tzadmin-proxy/bin/mtg doctor /opt/tzadmin-proxy/${proxyId}/mtg.toml 2>&1`,
    `ss -tlnp | grep :${newPort} || true`,
  ].join("; "),
);

const link = `https://t.me/proxy?server=${encodeURIComponent(updated.host)}&port=${newPort}&secret=${encodeURIComponent(mtprotoSecretForTelegramLink(secret))}`;
console.log(JSON.stringify({ proxyId, port: newPort, secret, tme_link: link, deploy, verify: verify.stdout }, null, 2));
