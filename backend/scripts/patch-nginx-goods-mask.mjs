/**
 * Staging: add /goods/ and location = / to nginx via root SSH (server id 4).
 * Run on panel host: cd backend && set -a && source .env && set +a && node scripts/patch-nginx-goods-mask.mjs
 */
import { sshExecCommand } from "/home/vpnadm/vpn-admin-app/backend/dist/ssh.js";
import { getServer } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const s = getServer(4);
if (!s) throw new Error("server 4 not found");
const cfg = { host: s.host, port: s.ssh_port, username: s.ssh_user, passwordEnc: s.ssh_password_enc };

const cmd = `python3 <<'PY'
from pathlib import Path
p = Path("/etc/nginx/sites-enabled/vpn-admin")
text = p.read_text()
goods = """
    location /goods/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
"""
root_exact = """
    location = / {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
"""
changed = False
if "location /goods/" not in text:
    if "location /comfort {" not in text:
        raise SystemExit("comfort location missing")
    text = text.replace("    location /comfort {", goods + "\\n    location /comfort {", 1)
    changed = True
if "location = /" not in text:
    needle = "    location / {\\n        try_files"
    if needle not in text:
        raise SystemExit("spa location missing")
    text = text.replace(needle, root_exact + "\\n    location / {\\n        try_files", 1)
    changed = True
if not changed:
    print("nginx_already_patched")
else:
    p.write_text(text)
    print("nginx_written")
PY
nginx -t && systemctl reload nginx && echo nginx_ok
grep -n "location /goods\\|location = /\\|location /comfort\\|location /sub" /etc/nginx/sites-enabled/vpn-admin
`;

const r = await sshExecCommand(cfg, cmd);
console.log((r.stdout || r.stderr || "").trim());
if (r.code !== 0) process.exit(r.code ?? 1);
