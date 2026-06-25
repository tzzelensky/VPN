import { randomBytes } from "node:crypto";
import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { getTelegramProxy, updateTelegramProxyRow } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";
import { mtprotoSecretForTelegramLink } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxyDeploy.js";

const proxyId = Number(process.argv[2] || 18);
const port = Number(process.argv[3] || 8443);

const row = getTelegramProxy(proxyId);
const server = getServer(row?.server_id ?? 0);
if (!row || !server || row.deleted_at) {
  console.error("proxy/server missing");
  process.exit(1);
}

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
  if (r.code !== 0) throw new Error(`write ${path}: ${r.stderr || r.stdout}`);
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
  steps.push({ label, code: r.code, out: (r.stdout || r.stderr || "").trim().slice(0, 500) });
  if (r.code !== 0) throw new Error(`${label} failed: ${steps.at(-1)?.out}`);
};

try {
  await run("stop", `systemctl stop ${svc} 2>/dev/null || true`);
  await run("mkdir", `mkdir -p ${abDir}`);
  await run(
    "download",
    `test -f ${abDir}/mtprotoproxy.py || curl -fsSL https://raw.githubusercontent.com/alexbers/mtprotoproxy/master/mtprotoproxy.py -o ${abDir}/mtprotoproxy.py`,
  );
  await run("python", `apt-get install -y -qq python3 2>/dev/null || true`);
  await writeRemote(`${abDir}/config.py`, pyConfig);
  await writeRemote(`/etc/systemd/system/${svc}.service`, unit);
  await run("start", `systemctl daemon-reload && systemctl enable ${svc} && systemctl restart ${svc}`);
  await run("status", `sleep 2; systemctl is-active ${svc}; ss -tlnp | grep :${port} || true; journalctl -u ${svc} -n 8 --no-pager`);
} catch (e) {
  console.log(JSON.stringify({ error: String(e), steps, secret }, null, 2));
  process.exit(1);
}

const link = `https://t.me/proxy?server=${encodeURIComponent(updated.host)}&port=${port}&secret=${encodeURIComponent(mtprotoSecretForTelegramLink(secret))}`;
console.log(JSON.stringify({ proxyId, port, secret, engine: "alexbers", tme_link: link, steps }, null, 2));
