/**
 * Run on server: uses panel SSH credentials (root) to kill rogue API on :4000 and restart systemd unit.
 * Usage: cd /home/vpnadm/vpn-admin-app/backend && set -a && source .env && set +a && node scripts/force-restart-api-root.mjs
 */
import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };

async function run(label, cmd) {
  const r = await sshExecCommand(cfg, cmd);
  const out = (r.stdout || r.stderr || "").trim();
  console.log(`[${label}] code=${r.code}`);
  if (out) console.log(out.slice(0, 800));
  return r;
}

await run("extract", "cd /home/vpnadm/vpn-admin-app/backend/dist && tar -xzf /home/vpnadm/deploy-backend.tgz 2>/dev/null || true");
await run("kill", "pkill -9 -f '/usr/bin/node dist/index.js' || true; sleep 2; fuser -k 4000/tcp 2>/dev/null || true; sleep 1");
await run("proc_before", "pgrep -af 'dist/index.js' || echo none");
await run("restart", "systemctl restart vpn-admin-api && sleep 3 && systemctl is-active vpn-admin-api");
await run("proc_after", "pgrep -af 'dist/index.js' || echo none");
await run("health", "curl -sS -m 5 http://127.0.0.1:4000/api/health");
await run(
  "guard",
  "node -e \"const fs=require('fs');const t=fs.readFileSync('/home/vpnadm/vpn-admin-app/backend/dist/routes/supportAppeals.js','utf8');const b=t.slice(t.indexOf('router.delete'),t.indexOf('router.post'));console.log(/cur\\\\.status === \\\\\\\"in_progress\\\\\\\"/.test(b)?'DELETE_GUARD_BAD':'DELETE_GUARD_OK');\"",
);
