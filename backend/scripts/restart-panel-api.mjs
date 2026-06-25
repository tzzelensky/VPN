/**
 * Deploy backend dist and restart API via root SSH (kills rogue processes on :4000, systemctl).
 * Run on server: cd backend && set -a && source .env && set +a && node scripts/restart-panel-api.mjs
 */
import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };

const steps = [];
async function run(label, cmd) {
  const r = await sshExecCommand(cfg, cmd);
  steps.push({ label, code: r.code, out: (r.stdout || r.stderr || "").trim().slice(0, 500) });
  return r;
}

await run("kill", "pkill -9 -f '/usr/bin/node dist/index.js' || true; fuser -k 4000/tcp 2>/dev/null || true; sleep 2");
await run("extract", "rm -rf /home/vpnadm/vpn-admin-app/backend/dist/dist 2>/dev/null || true; tar -xzf /home/vpnadm/deploy-backend.tgz -C /home/vpnadm/vpn-admin-app/backend/dist --no-same-owner --no-same-permissions 2>/dev/null || tar -xzf /home/vpnadm/deploy-backend.tgz -C /home/vpnadm/vpn-admin-app/backend/dist");
await run("verify", "grep -q web_app_new_design /home/vpnadm/vpn-admin-app/backend/dist/routes/mySub.js && echo backend_ok || (echo backend_stale; exit 1)");
await run("restart", "systemctl restart vpn-admin-api && sleep 3 && systemctl is-active vpn-admin-api");
const health = await run("health", "curl -sS -m 5 http://127.0.0.1:4000/api/health");
const proc = await run("proc", "pgrep -af 'dist/index.js' || echo none");
const guard = await run(
  "guard",
  "node -e \"const fs=require('fs');const t=fs.readFileSync('/home/vpnadm/vpn-admin-app/backend/dist/routes/supportAppeals.js','utf8');const b=t.slice(t.indexOf('router.delete'),t.indexOf('router.post'));console.log(/cur\\\\.status === \\\\\\\"in_progress\\\\\\\"/.test(b)?'BAD':'OK');\"",
);

const ok = health.stdout?.includes("ok") && guard.stdout?.includes("OK") && proc.stdout?.includes("dist/index.js");
console.log(JSON.stringify({ ok, steps }, null, 2));
process.exit(ok ? 0 : 1);
