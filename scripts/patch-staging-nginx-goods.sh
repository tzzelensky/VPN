#!/bin/bash
set -euo pipefail
python3 <<'PY'
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
if "location /goods/" not in text:
    text = text.replace("    location /comfort {", goods + "\n    location /comfort {", 1)
if "location = /" not in text:
    text = text.replace("    location / {\n        try_files", root_exact + "\n    location / {\n        try_files", 1)
Path("/tmp/vpn-admin.nginx.new").write_text(text)
print("wrote /tmp/vpn-admin.nginx.new")
PY
sudo cp /tmp/vpn-admin.nginx.new /etc/nginx/sites-enabled/vpn-admin
sudo nginx -t
sudo systemctl reload nginx
echo nginx_ok
grep -n "location /goods\|location = /\|location /comfort\|location /sub" /etc/nginx/sites-enabled/vpn-admin
