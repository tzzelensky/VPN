import { randomBytes } from "node:crypto";
import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { getTelegramProxy, updateTelegramProxyRow } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";
import { mtprotoSecretForTelegramLink } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxyDeploy.js";

const proxyId = Number(process.argv[2] || 18);
const port = 443;

const row = getTelegramProxy(proxyId);
const server = getServer(row?.server_id ?? 0);
if (!row || !server || row.deleted_at) process.exit(1);

const baseHex = randomBytes(16).toString("hex");
const secret = `dd${baseHex}`;
const updated = updateTelegramProxyRow(proxyId, { secret, port, status: "unknown", last_error: null });
if (!updated) process.exit(1);

const cfg = {
  host: server.host,
  port: server.ssh_port,
  username: server.ssh_user,
  passwordEnc: server.ssh_password_enc,
};

const abDir = "/opt/tzadmin-proxy/alexbers";
const svc = `tzadmin-proxy-${proxyId}`;

async function writeRemote(path, body) {
  const b64 = Buffer.from(body, "utf8").toString("base64");
  const r = await sshExecCommand(cfg, `echo ${b64} | base64 -d > ${path}`);
  if (r.code !== 0) throw new Error(`write ${path}`);
}

const pyConfig = [
  `PORT = ${port}`,
  "USERS = {",
  `    "tg${proxyId}": "${baseHex}"`,
  "}",
  "MODES = {",
  '    "classic": False,',
  '    "secure": True,',
  '    "tls": False',
  "}",
  'TLS_DOMAIN = "www.cloudflare.com"',
  "PREFER_IPV6 = False",
  "",
].join("\n");

const unit = [
  "[Unit]",
  `Description=TZAdmin alexbers MTProto proxy ${proxyId}`,
  "After=network.target",
  "",
  "[Service]",
  "Type=simple",
  `WorkingDirectory=${abDir}`,
  `ExecStart=/usr/bin/python3 ${abDir}/mtprotoproxy.py`,
  "Restart=on-failure",
  "RestartSec=5",
  "StandardOutput=journal",
  "StandardError=journal",
  "",
  "[Install]",
  "WantedBy=multi-user.target",
  "",
].join("\n");

const steps = [];
const run = async (label, cmd) => {
  const r = await sshExecCommand(cfg, cmd);
  steps.push({ label, code: r.code, out: (r.stdout || r.stderr || "").trim().slice(0, 700) });
  if (r.code !== 0) throw new Error(`${label}: ${steps.at(-1)?.out}`);
};

try {
  await run("nginx-clean", `sed -i '/^stream {/,/^}$/d' /etc/nginx/nginx.conf`);
  await run(
    "nginx-panel-port",
    `for f in /etc/nginx/sites-enabled/*; do [ -f "$f" ] || continue; sed -i 's/listen 127.0.0.1:9443 ssl/listen 9443 ssl/g' "$f"; sed -i 's/listen \\[::1\\]:9443 ssl/listen [::]:9443 ssl/g' "$f"; sed -i 's/listen 443 ssl/listen 9443 ssl/g' "$f"; sed -i 's/listen \\[::\\]:443 ssl/listen [::]:9443 ssl/g' "$f"; done; true`,
  );
  await run("nginx-test", `nginx -t`);
  await run("nginx-reload", `systemctl reload nginx || systemctl restart nginx`);
  await run("stop-proxy", `systemctl stop ${svc} 2>/dev/null || true`);
  await writeRemote(`${abDir}/config.py`, pyConfig);
  await writeRemote(`/etc/systemd/system/${svc}.service`, unit);
  await run("start", `systemctl daemon-reload && systemctl restart ${svc}`);
  await run(
    "status",
    `sleep 2; systemctl is-active ${svc}; ss -tlnp | grep -E ':443|:9443' || true; journalctl -u ${svc} -n 4 --no-pager`,
  );
} catch (e) {
  console.log(JSON.stringify({ error: String(e), steps, secret }, null, 2));
  process.exit(1);
}

const link = `https://t.me/proxy?server=${encodeURIComponent(updated.host)}&port=${port}&secret=${encodeURIComponent(mtprotoSecretForTelegramLink(secret))}`;
console.log(JSON.stringify({ proxyId, port, secret, engine: "alexbers", panel_https: "https://devspace5.duckdns.org:9443", tme_link: link, steps }, null, 2));
