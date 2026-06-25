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
const link = mtprotoSecretForTelegramLink(row.secret);

const cmd = [
  `echo '===PROXY==='`,
  `echo id=${proxyId} host=${row.host} port=${port}`,
  `echo secret_hex=${row.secret}`,
  `echo tme=https://t.me/proxy?server=${row.host}&port=${port}&secret=${link}`,
  `echo '===UNIT==='`,
  `systemctl cat ${svc} 2>/dev/null`,
  `echo '===STATUS==='`,
  `systemctl is-active ${svc}`,
  `/opt/tzadmin-proxy/bin/mtproto-proxy --help 2>&1 | head -3`,
  `echo '===LISTEN==='`,
  `ss -tlnp | grep -E ':${port}|:280${proxyId}' || true`,
  `echo '===ESTAB==='`,
  `ss -tn state established '( sport = :${port} )' 2>/dev/null || ss -tn | grep :${port} || true`,
  `echo '===JOURNAL 3h==='`,
  `journalctl -u ${svc} --since '3 hours ago' --no-pager 2>&1 | tail -80`,
  `echo '===STATS==='`,
  `curl -sS -m 3 http://127.0.0.1:280${proxyId}/stats 2>&1 | head -40`,
  `echo '===PORTS==='`,
  `ss -tlnp | grep -E ':(443|8443|444|2443) ' || true`,
].join("; ");

const r = await sshExecCommand(cfg, cmd);
process.stdout.write(r.stdout || "");
if (r.stderr) process.stderr.write(r.stderr);
