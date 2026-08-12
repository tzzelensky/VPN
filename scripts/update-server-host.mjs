#!/usr/bin/env node
import fs from "node:fs";

const dataPath = process.argv[2] || "/opt/vpn-admin/data/data.json";
const serverName = process.argv[3] || "";
const newHost = process.argv[4] || "";
const oldHost = process.argv[5] || "";

if (!serverName || !newHost) {
  console.error("Usage: node update-server-host.mjs <data.json> <serverName> <newHost> [oldHost]");
  process.exit(1);
}

const raw = fs.readFileSync(dataPath, "utf8");
const data = JSON.parse(raw);
const servers = Array.isArray(data.servers) ? data.servers : [];
const idx = servers.findIndex((s) => String(s?.name ?? "").trim() === serverName);
if (idx < 0) {
  console.error("Server not found:", serverName);
  process.exit(1);
}

const row = servers[idx];
const prev = String(row.host ?? "").trim();
if (oldHost && prev !== oldHost) {
  console.error(`Expected old host ${oldHost}, got ${prev}`);
  process.exit(1);
}

row.host = newHost;
fs.writeFileSync(`${dataPath}.bak-${Date.now()}`, raw, "utf8");
fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, id: row.id, name: row.name, host_before: prev, host_after: newHost }));
