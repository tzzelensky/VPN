import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { getTelegramProxy, updateTelegramProxyRow } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";
import {
  buildMtprotoConfig,
  deployTelegramProxyOnServer,
  generateMtprotoSecret,
} from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxyDeploy.js";

const proxyId = Number(process.argv[2] || 18);
const port = Number(process.argv[3] || 2443);

const row = getTelegramProxy(proxyId);
const server = getServer(row?.server_id ?? 0);
if (!row || !server || row.deleted_at) {
  console.error("proxy/server missing");
  process.exit(1);
}

const secret = generateMtprotoSecret();
const updated = updateTelegramProxyRow(proxyId, { secret, port, status: "unknown", last_error: null });
if (!updated) process.exit(1);

const deployInput = {
  id: updated.id,
  type: updated.type,
  port: updated.port,
  secret: updated.secret,
  username: updated.username,
  password: updated.password,
  auth_enabled: updated.auth_enabled,
};

let cfgBody = buildMtprotoConfig(deployInput, updated.secret, server.host);
// debug + relaxed anti-replay + dual-stack bind
cfgBody = cfgBody
  .replace(`bind-to = "147.90.15.77:${port}"`, `bind-to = "[::]:${port}"`)
  .replace("[defense.anti-replay]\nenabled = true", "[defense.anti-replay]\nenabled = false");
cfgBody = `debug = true\n${cfgBody}`;

const cfg = {
  host: server.host,
  port: server.ssh_port,
  username: server.ssh_user,
  passwordEnc: server.ssh_password_enc,
};

const dir = `/opt/tzadmin-proxy/${proxyId}`;
const svc = `tzadmin-proxy-${proxyId}`;
const mtgBin = "/opt/tzadmin-proxy/bin/mtg";

await deployTelegramProxyOnServer(server, deployInput);

// overwrite config with debug/dual-stack version
const quoted = `'${cfgBody.replace(/'/g, `'\\''`)}'`;
await sshExecCommand(cfg, `cat > ${dir}/mtg.toml << 'TZEOF'\n${cfgBody}\nTZEOF`);
await sshExecCommand(cfg, `systemctl restart ${svc}`);
await new Promise((r) => setTimeout(r, 2000));

const verify = await sshExecCommand(
  cfg,
  [
    `systemctl is-active ${svc}`,
    `ss -tlnp | grep :${port}`,
    `${mtgBin} access ${dir}/mtg.toml 2>&1`,
    `echo '--- nginx ---'`,
    `nginx -t 2>&1; ls /etc/nginx/sites-enabled/ 2>/dev/null; grep -r listen /etc/nginx/sites-enabled/ 2>/dev/null | head -20`,
    `echo '--- recent logs ---'`,
    `journalctl -u ${svc} -n 20 --no-pager`,
  ].join("; "),
);

console.log("secret:", secret);
console.log(verify.stdout);
if (verify.stderr) console.error(verify.stderr);
