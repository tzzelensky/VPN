#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const id = Number(process.argv[2]);
if (!Number.isFinite(id) || id <= 0) {
  console.error("Usage: node scripts/reapply-subscription-server.mjs <serverId>");
  process.exit(1);
}

const { getServer, getServerSubscriptionSettings } = await import("../dist/db.js");
const { applySubscriptionSettingsToServer } = await import("../dist/ssh.js");
const { managedClientsForServer } = await import("../dist/userSync.js");

const row = getServer(id);
if (!row) {
  console.error(`Server ${id} not found`);
  process.exit(1);
}
if (!row.vless_deployed) {
  console.error(`Server ${id} not deployed`);
  process.exit(1);
}

const settings = getServerSubscriptionSettings(row);
const configPath = row.xray_config_path?.trim() || "/etc/tzadmin-xray/config.json";
const clients = managedClientsForServer(row.vless_uuid);

const sshCfg = {
  host: row.host,
  port: row.ssh_port,
  username: row.ssh_user,
  passwordEnc: row.ssh_password_enc,
};

console.log(`Re-applying ${row.name} (${row.host}:${settings.vless_port})…`);
const apply = await applySubscriptionSettingsToServer(sshCfg, { configPath, settings, clientEntries: clients });
console.log(JSON.stringify(apply, null, 2));
process.exit(apply.ok ? 0 : 1);
