import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { getTelegramProxy } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";
import { mtprotoSecretForTelegramLink } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxyDeploy.js";

const serverId = Number(process.argv[2] || 4);
const proxyId = Number(process.argv[3] || 18);
const row = getTelegramProxy(proxyId);
const s = getServer(serverId);
if (!s || !row) process.exit(1);

const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };
const svc = `tzadmin-proxy-${proxyId}`;
const port = row.port;
const linkSecret = mtprotoSecretForTelegramLink(row.secret);
const tme = `https://t.me/proxy?server=${encodeURIComponent(row.host)}&port=${port}&secret=${encodeURIComponent(linkSecret)}`;

const cmd = [
  `echo 'TME_LINK=${tme}'`,
  `systemctl cat ${svc} 2>/dev/null | head -25`,
  `systemctl is-active ${svc}`,
  `ss -tlnp | grep :${port}`,
  `journalctl -u ${svc} -n 25 --no-pager`,
].join("; ");

const r = await sshExecCommand(cfg, cmd);
process.stdout.write(r.stdout || "");
