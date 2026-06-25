import { getTelegramProxy } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";

for (const id of [12, 18]) {
  const r = getTelegramProxy(id);
  if (!r || r.deleted_at) continue;
  console.log(JSON.stringify({ id: r.id, type: r.type, host: r.host, port: r.port, status: r.status, secret: r.secret?.slice(0, 34) }));
}
