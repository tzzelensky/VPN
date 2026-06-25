import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };

const nginxConf = `user www-data;
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log;
include /etc/nginx/modules-enabled/*.conf;

events {
\tworker_connections 768;
}

http {
\tsendfile on;
\ttcp_nopush on;
\ttypes_hash_max_size 2048;
\tinclude /etc/nginx/mime.types;
\tdefault_type application/octet-stream;
\tssl_protocols TLSv1.2 TLSv1.3;
\tssl_prefer_server_ciphers on;
\taccess_log /var/log/nginx/access.log;
\terror_log /var/log/nginx/error.log;
\tgzip on;
\tinclude /etc/nginx/conf.d/*.conf;
\tinclude /etc/nginx/sites-enabled/*;
}
`;

async function writeRemote(path, body) {
  const b64 = Buffer.from(body, "utf8").toString("base64");
  const r = await sshExecCommand(cfg, `echo ${b64} | base64 -d > ${path}`);
  if (r.code !== 0) throw new Error(`write ${path}`);
}

await writeRemote("/etc/nginx/nginx.conf", nginxConf);
const r = await sshExecCommand(
  cfg,
  "nginx -t; systemctl restart nginx; sleep 1; systemctl is-active nginx; ss -tlnp | grep nginx; curl -sS -m 5 -k https://127.0.0.1/api/health",
);
console.log(r.stdout || r.stderr);
