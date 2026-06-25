import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };

const steps = [];
const run = async (label, cmd) => {
  const r = await sshExecCommand(cfg, cmd);
  steps.push({ label, code: r.code, out: (r.stdout || r.stderr || "").trim().slice(0, 800) });
  if (r.code !== 0) throw new Error(`${label}: ${steps.at(-1)?.out}`);
};

try {
  await run("clean-stream", `sed -i '/^stream {/,/^}$/d' /etc/nginx/nginx.conf; rm -f /etc/nginx/stream.d/tzadmin-mtproto.conf`);
  await run(
    "restore-sites",
    `for f in /etc/nginx/sites-enabled/*; do [ -f "$f" ] || continue; sed -i 's/listen 9443 ssl/listen 443 ssl/g' "$f"; sed -i 's/listen \\[::\\]:9443 ssl/listen [::]:443 ssl/g' "$f"; sed -i 's/listen 127.0.0.1:9443 ssl/listen 443 ssl/g' "$f"; sed -i 's/listen \\[::1\\]:9443 ssl/listen [::]:443 ssl/g' "$f"; done`,
  );
  await run("nginx-test", "nginx -t");
  await run("nginx-restart", "systemctl restart nginx");
  const verify = await sshExecCommand(
    cfg,
    "systemctl is-active nginx; ps aux | grep '[n]ginx'; ss -tlnp | grep -E 'nginx|:443|:80'; cat /etc/nginx/sites-enabled/default 2>/dev/null | head -40; ls -la /etc/nginx/sites-enabled/",
  );
  steps.push({ label: "verify", code: verify.code, out: (verify.stdout || verify.stderr || "").trim().slice(0, 1200) });
} catch (e) {
  console.log(JSON.stringify({ error: String(e), steps }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, panel: "https://devspace5.duckdns.org", steps }, null, 2));
