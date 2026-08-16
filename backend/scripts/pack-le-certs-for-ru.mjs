/**
 * Pack Let's Encrypt certs for RU front copy.
 * Run on abroad: cd backend && set -a && source .env && set +a && node scripts/pack-le-certs-for-ru.mjs
 */
import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const DOMAIN = process.env.DOMAIN || "devspace5.duckdns.org";
const OUT = "/home/vpnadm/le-certs-for-ru.tgz";

const s = getServer(4);
if (!s) throw new Error("server 4 not found");
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };

const cmd = `
set -e
DOMAIN='${DOMAIN}'
OUT='${OUT}'
test -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem
tar -C /etc -czf "$OUT" \\
  letsencrypt/live/$DOMAIN \\
  letsencrypt/archive/$DOMAIN \\
  letsencrypt/options-ssl-nginx.conf \\
  letsencrypt/ssl-dhparams.pem \\
  $(test -f /etc/letsencrypt/renewal/$DOMAIN.conf && echo letsencrypt/renewal/$DOMAIN.conf || true)
chown vpnadm:vpnadm "$OUT"
chmod 600 "$OUT"
ls -la "$OUT"
tar -tzf "$OUT" | head -30
`;

const r = await sshExecCommand(cfg, cmd);
console.log((r.stdout || r.stderr || "").trim());
if (r.code !== 0) process.exit(r.code ?? 1);
