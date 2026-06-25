import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };
const r = await sshExecCommand(
  cfg,
  `ss -tlnp | grep -E ':443|:8443|:2443'; echo '---'; nginx -T 2>/dev/null | grep -E 'listen|server_name|stream' | head -40; echo '---'; cat /etc/nginx/nginx.conf 2>/dev/null | head -30`,
);
console.log(r.stdout);
