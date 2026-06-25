import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };
const r = await sshExecCommand(
  cfg,
  [
    "systemctl is-active nginx",
    "systemctl is-active tzadmin-proxy-18",
    "ss -tlnp",
    "grep -h listen /etc/nginx/sites-enabled/* 2>/dev/null | head -10",
    "curl -sS -m 5 -k https://127.0.0.1/api/health 2>&1",
    "journalctl -u nginx -n 20 --no-pager",
    "nginx -T 2>&1 | grep listen | head -15",
  ].join("; echo '---'; "),
);
process.stdout.write(r.stdout || "");
