import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };
const r = await sshExecCommand(
  cfg,
  [
    "head -20 /etc/nginx/nginx.conf",
    "ls -la /etc/nginx/sites-enabled/",
    "grep -r listen /etc/nginx/sites-enabled/ 2>/dev/null",
    "ps aux | grep nginx | grep -v grep",
    "ss -tlnp | grep -E ':80|:443'",
    "systemctl status nginx --no-pager | head -20",
  ].join("; echo ===; "),
);
process.stdout.write(r.stdout || r.stderr || "");
