import { randomBytes } from "node:crypto";
import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { getTelegramProxy, updateTelegramProxyRow } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";
import { mtprotoSecretForTelegramLink } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxyDeploy.js";

const proxyId = Number(process.argv[2] || 18);
const publicPort = 443;
const listenPort = 8443;

const row = getTelegramProxy(proxyId);
const server = getServer(row?.server_id ?? 0);
if (!row || !server || row.deleted_at) {
  console.error("proxy/server missing");
  process.exit(1);
}

const baseHex = randomBytes(16).toString("hex");
const secret = `dd${baseHex}`;
const updated = updateTelegramProxyRow(proxyId, { secret, port: publicPort, status: "unknown", last_error: null });
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
  if (r.code !== 0) throw new Error(`write ${path}: ${r.stderr || r.stdout}`);
}

const pyConfig = [
  `PORT = ${listenPort}`,
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

const nginxStream = [
  "map $ssl_preread_server_name $tzadmin_443_upstream {",
  "    devspace5.duckdns.org 127.0.0.1:9443;",
  `    default               127.0.0.1:${listenPort};`,
  "}",
  "server {",
  "    listen 443;",
  "    listen [::]:443;",
  "    ssl_preread on;",
  "    proxy_connect_timeout 10s;",
  "    proxy_timeout 3h;",
  "    proxy_pass $tzadmin_443_upstream;",
  "}",
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
const run = async (label, cmd, optional = false) => {
  const r = await sshExecCommand(cfg, cmd);
  steps.push({ label, code: r.code, out: (r.stdout || r.stderr || "").trim().slice(0, 600) });
  if (r.code !== 0 && !optional) throw new Error(`${label} failed: ${steps.at(-1)?.out}`);
};

try {
  await run("stream-pkg", `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libnginx-mod-stream 2>&1 | tail -3`);
  await run("stop-proxy", `systemctl stop ${svc} 2>/dev/null || true`);
  await run("mkdir", `mkdir -p ${abDir} /etc/nginx/stream.d`);
  await run(
    "download",
    `test -f ${abDir}/mtprotoproxy.py || curl -fsSL https://raw.githubusercontent.com/alexbers/mtprotoproxy/master/mtprotoproxy.py -o ${abDir}/mtprotoproxy.py`,
  );
  await writeRemote(`${abDir}/config.py`, pyConfig);
  await writeRemote("/etc/nginx/stream.d/tzadmin-mtproto.conf", nginxStream);
  await writeRemote(`/etc/systemd/system/${svc}.service`, unit);
  await run(
    "nginx-fix",
    `sed -i '/^stream { include \\/etc\\/nginx\\/stream.d\\/\\*.conf; }$/d' /etc/nginx/nginx.conf; grep -q 'stream.d' /etc/nginx/nginx.conf || sed -i '/^http {/i stream { include /etc/nginx/stream.d/*.conf; }\\n' /etc/nginx/nginx.conf`,
  );
  await run(
    "nginx-ssl-move",
    `for f in /etc/nginx/sites-enabled/*; do [ -f "$f" ] && sed -i 's/listen 443 ssl/listen 127.0.0.1:9443 ssl/g' "$f" && sed -i 's/listen \\[::\\]:443 ssl/listen [::1]:9443 ssl/g' "$f"; done; true`,
  );
  await run("nginx-test", `nginx -t`);
  await run("nginx-reload", `systemctl reload nginx || systemctl restart nginx`);
  await run("start-proxy", `systemctl daemon-reload && systemctl enable ${svc} && systemctl restart ${svc}`);
  await run(
    "status",
    `sleep 2; systemctl is-active ${svc}; systemctl is-active nginx; ss -tlnp | grep -E ':443|:${listenPort}|:9443' || true; journalctl -u ${svc} -n 5 --no-pager`,
  );
} catch (e) {
  console.log(JSON.stringify({ error: String(e), steps, secret }, null, 2));
  process.exit(1);
}

const link = `https://t.me/proxy?server=${encodeURIComponent(updated.host)}&port=${publicPort}&secret=${encodeURIComponent(mtprotoSecretForTelegramLink(secret))}`;
console.log(JSON.stringify({ proxyId, port: publicPort, listenPort, secret, engine: "alexbers", tme_link: link, steps }, null, 2));
