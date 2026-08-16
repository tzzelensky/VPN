#!/bin/bash
set -euo pipefail
systemctl is-active vpn-admin-api
curl -s -m 5 http://127.0.0.1:4000/api/health; echo
echo "--- root ---"
curl -s -m 5 -A Mozilla http://127.0.0.1:4000/ | head -c 220; echo
TOKEN=$(python3 -c "import json; d=json.load(open('/opt/vpn-admin/data/data.json')); print(d['users'][0]['sub_token'])")
echo "token_len=${#TOKEN}"
echo "--- Happ /sub ---"
curl -sI -m 8 -A 'Happ/1.0' "http://127.0.0.1:4000/sub/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
echo "--- Mozilla /sub ---"
curl -sI -m 8 -A 'Mozilla/5.0' -H 'Accept: text/html' "http://127.0.0.1:4000/sub/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
echo "--- Happ /goods ---"
curl -sI -m 8 -A 'Happ/1.0' "http://127.0.0.1:4000/goods/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
echo "--- Mozilla /goods body ---"
curl -s -m 8 -A 'Mozilla/5.0' -H 'Accept: text/html' "http://127.0.0.1:4000/goods/$TOKEN" | head -c 220; echo
echo "--- Mozilla /sub no vpn headers in body ---"
BODY=$(curl -s -m 8 -A 'Mozilla/5.0' -H 'Accept: text/html' "http://127.0.0.1:4000/sub/$TOKEN")
echo "$BODY" | head -c 120; echo
if echo "$BODY" | grep -qiE 'vless://|subscription-userinfo|profile-title'; then
  echo FAIL_leak
  exit 1
fi
echo OK_no_leak
