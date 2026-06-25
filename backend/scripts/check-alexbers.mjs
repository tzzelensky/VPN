import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };
const r = await sshExecCommand(
  cfg,
  [
    "cat /opt/tzadmin-proxy/alexbers/config.py",
    "systemctl is-active tzadmin-proxy-18",
    "journalctl -u tzadmin-proxy-18 -n 20 --no-pager",
    "ss -tn state established '( sport = :8443 )' 2>/dev/null | head -15",
  ].join("; echo '---'; "),
);
process.stdout.write(r.stdout || "");
