#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const id = Number(process.argv[2] ?? 4);
const { getServer } = await import("../dist/db.js");
const { sshReadRemoteFile } = await import("../dist/ssh.js");

const row = getServer(id);
if (!row) process.exit(1);

const cfg = {
  host: row.host,
  port: row.ssh_port,
  username: row.ssh_user,
  passwordEnc: row.ssh_password_enc,
};
const raw = await sshReadRemoteFile(cfg, row.xray_config_path?.trim() || "/etc/tzadmin-xray/config.json");
const c = JSON.parse(raw.toString("utf8"));
const ib = (c.inbounds ?? []).find((x) => x.tag === "tzadmin-vless");
const clients = ib?.settings?.clients ?? [];
const userUuid = process.argv[3]?.trim().toLowerCase();
const hasUser = userUuid ? clients.some((x) => String(x.id).toLowerCase() === userUuid) : undefined;

console.log(
  JSON.stringify(
    {
      port: ib?.port,
      decryption: ib?.settings?.decryption,
      clients: clients.length,
      with_flow: clients.filter((x) => x.flow).length,
      user_present: hasUser,
      sample_client: clients[0] ? { id: clients[0].id, flow: clients[0].flow ?? null } : null,
    },
    null,
    2,
  ),
);
