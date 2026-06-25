import { sshExecCommand } from "../dist/ssh.js";
import { getServer } from "../dist/db.js";

const s = getServer(4);
if (!s) throw new Error("server 4 not found");
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };

const marker = "location /panel/swagger/";
const block = `
    location /panel/swagger/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
`;

const site = "/etc/nginx/sites-enabled/vpn-admin";
const cmd = `
if grep -q '${marker}' ${site}; then
  echo 'swagger location already present'
else
  sed -i '/location \\/api\\//i\\${block.replace(/\n/g, "\\n")}' ${site}
  nginx -t && systemctl reload nginx && echo nginx_ok
fi
`;

const r = await sshExecCommand(cfg, cmd);
console.log(r.stdout || r.stderr);
if (r.code !== 0) process.exit(r.code ?? 1);
