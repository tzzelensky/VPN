import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };
const r = await sshExecCommand(cfg, "wc -l /etc/nginx/nginx.conf; cat /etc/nginx/nginx.conf; grep -n include /etc/nginx/nginx.conf");
process.stdout.write(r.stdout || "");
