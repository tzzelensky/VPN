#!/usr/bin/env bash
# Raise nginx upload limit (fixes 413 on panel photo uploads).
# Run on the panel host: bash scripts/raise-nginx-body-limit.sh
set -euo pipefail
SITE="${1:-/etc/nginx/sites-enabled/vpn-admin}"
if [[ ! -f "$SITE" ]]; then
  echo "site not found: $SITE" >&2
  exit 1
fi
if grep -q 'client_max_body_size' "$SITE"; then
  echo "client_max_body_size already present in $SITE"
else
  sudo python3 - <<'PY'
from pathlib import Path
p = Path("/etc/nginx/sites-enabled/vpn-admin")
text = p.read_text()
needle = "server_name"
idx = text.find(needle)
if idx < 0:
    raise SystemExit("server_name not found")
# insert after first server_name line
lines = text.splitlines(True)
out = []
inserted = False
for line in lines:
    out.append(line)
    if not inserted and "server_name" in line and line.strip().startswith("server_name"):
        out.append("    client_max_body_size 12m;\n")
        inserted = True
if not inserted:
    raise SystemExit("failed to insert")
# also ensure /api/ has it
text2 = "".join(out)
if "location /api/" in text2 and "client_max_body_size" not in text2.split("location /api/", 1)[1].split("location ", 1)[0]:
    text2 = text2.replace(
        "location /api/ {\n",
        "location /api/ {\n        client_max_body_size 12m;\n",
        1,
    )
p.write_text(text2)
print("updated", p)
PY
fi
sudo nginx -t
sudo systemctl reload nginx
echo "nginx_ok client_max_body_size=12m"
