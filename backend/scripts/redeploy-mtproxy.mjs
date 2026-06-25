import { deployTelegramProxyOnServer } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxyDeploy.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { getTelegramProxy } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";

const proxyId = Number(process.argv[2] || 18);
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

const deploy = await deployTelegramProxyOnServer(server, {
  id: row.id,
  type: row.type,
  port: row.port,
  secret: row.secret,
  username: row.username,
  password: row.password,
  auth_enabled: row.auth_enabled,
});
console.log(JSON.stringify({ proxyId, port: row.port, secret: row.secret, deploy }, null, 2));
