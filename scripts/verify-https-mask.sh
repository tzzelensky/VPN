#!/bin/bash
set -euo pipefail
TOKEN=$(python3 -c "import json;d=json.load(open('/opt/vpn-admin/data/data.json'));print(d['users'][0]['sub_token'])")
HOST_H='Host: devspace5.duckdns.org'
echo "=== HTTPS Happ /goods ==="
curl -skI -m 10 -A 'Happ/1.0' -H "$HOST_H" "https://127.0.0.1/goods/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
echo "=== HTTPS Mozilla /goods ==="
curl -sk -m 10 -A 'Mozilla/5.0' -H 'Accept: text/html' -H "$HOST_H" "https://127.0.0.1/goods/$TOKEN" | head -c 200; echo
echo "=== HTTPS Happ /sub ==="
curl -skI -m 10 -A 'Happ/1.0' -H "$HOST_H" "https://127.0.0.1/sub/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title' || true
echo "=== HTTPS Mozilla /sub headers ==="
curl -skI -m 10 -A 'Mozilla/5.0' -H 'Accept: text/html' -H "$HOST_H" "https://127.0.0.1/sub/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
echo "=== HTTPS / ==="
curl -sk -m 10 -A Mozilla -H "$HOST_H" https://127.0.0.1/ | head -c 200; echo
echo "=== HTTPS /login ==="
curl -skI -m 10 -A Mozilla -H "$HOST_H" https://127.0.0.1/login | tr -d '\r' | head -8
echo DONE
