import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };

async function run(cmd) {
  const r = await sshExecCommand(cfg, cmd);
  console.log("CMD:", cmd.slice(0, 80));
  console.log(r.stdout || r.stderr || `(code ${r.code})`);
  console.log("---");
}

await run("cd /home/vpnadm/vpn-admin-app/backend/dist && tar -xzf /home/vpnadm/deploy-backend.tgz");
await run("pgrep -af node || true");
await run("pkill -9 -f node/dist/index.js || true");
await run("sleep 1 && pgrep -af node || echo no-node");
await run(
  "bash -lc 'cd /home/vpnadm/vpn-admin-app/backend && nohup /usr/bin/node dist/index.js >> /home/vpnadm/vpn-admin-api.log 2>&1 &'",
);
await run("sleep 2 && pgrep -af 'node dist/index.js' || true");
await run("curl -sS -m 5 http://127.0.0.1:4000/api/health || echo health-fail");
