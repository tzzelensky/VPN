import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { getTelegramProxy, updateTelegramProxyRow } from "/home/vpnadm/vpn-admin-app/backend/dist/telegramProxiesDb.js";

const proxyId = Number(process.argv[2] || 18);
const mtprotoPort = Number(process.argv[3] || 8443);

const row = getTelegramProxy(proxyId);
const server = getServer(row?.server_id ?? 0);
if (!server) process.exit(1);

const cfg = {
  host: server.host,
  port: server.ssh_port,
  username: server.ssh_user,
  passwordEnc: server.ssh_password_enc,
};

const abDir = "/opt/tzadmin-proxy/alexbers";
const svc = `tzadmin-proxy-${proxyId}`;
const secret = row?.secret?.trim() ?? "";
const baseHex = secret.startsWith("dd") && secret.length === 34 ? secret.slice(2) : null;

const steps = [];
const run = async (label, cmd) => {
  const r = await sshExecCommand(cfg, cmd);
  steps.push({ label, code: r.code, out: (r.stdout || r.stderr || "").trim().slice(0, 700) });
  if (r.code !== 0) throw new Error(`${label}: ${steps.at(-1)?.out}`);
};

async function writeRemote(path, body) {
  const b64 = Buffer.from(body, "utf8").toString("base64");
  const r = await sshExecCommand(cfg, `echo ${b64} | base64 -d > ${path}`);
  if (r.code !== 0) throw new Error(`write ${path}`);
}

try {
  await run(
    "nginx-restore",
    `sed -i '/^stream {/,/^}$/d' /etc/nginx/nginx.conf; for f in /etc/nginx/sites-enabled/*; do [ -f "$f" ] || continue; sed -i 's/listen 9443 ssl/listen 443 ssl/g' "$f"; sed -i 's/listen \\[::\\]:9443 ssl/listen [::]:443 ssl/g' "$f"; sed -i 's/listen 127.0.0.1:9443 ssl/listen 443 ssl/g' "$f"; sed -i 's/listen \\[::1\\]:9443 ssl/listen [::]:443 ssl/g' "$f"; done; rm -f /etc/nginx/stream.d/tzadmin-mtproto.conf`,
  );
  await run("nginx-test", "nginx -t");
  await run("stop-proxy", `systemctl stop ${svc} 2>/dev/null || true`);
  await run("nginx-start", "systemctl enable nginx; systemctl restart nginx");
  await run(
    "nginx-status",
    "systemctl is-active nginx; systemctl status nginx --no-pager | head -15; ss -tlnp | grep nginx || true; ss -tlnp | grep ':443 ' || true; ss -tlnp | grep ':80 ' || true",
  );

  if (baseHex && row && !row.deleted_at) {
    const pyConfig = [
      `PORT = ${mtprotoPort}`,
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
    await writeRemote(`${abDir}/config.py`, pyConfig);
    updateTelegramProxyRow(proxyId, { port: mtprotoPort });
    await run("start-proxy", `systemctl restart ${svc} 2>/dev/null || true`);
    await run("proxy-status", `systemctl is-active ${svc} 2>/dev/null || echo inactive; ss -tlnp | grep :${mtprotoPort} || true`);
  }
} catch (e) {
  console.log(JSON.stringify({ error: String(e), steps }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      panel: "https://devspace5.duckdns.org",
      mtproto_port: baseHex ? mtprotoPort : null,
      steps,
    },
    null,
    2,
  ),
);
