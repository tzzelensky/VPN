import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };
const r = await sshExecCommand(
  cfg,
  "systemctl start nginx; systemctl is-active nginx; ss -tlnp | grep -E ':443|:9443' || true",
);
process.stdout.write(r.stdout || "");
