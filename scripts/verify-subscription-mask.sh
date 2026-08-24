#!/bin/bash
set -euo pipefail
systemctl is-active vpn-admin-api
curl -s -m 5 http://127.0.0.1:4000/api/health; echo
echo "--- root ---"
curl -s -m 5 -A Mozilla http://127.0.0.1:4000/ | head -c 220; echo
TOKEN=$(python3 -c "import json; d=json.load(open('/opt/vpn-admin/data/data.json')); print(d['users'][0]['sub_token'])")
echo "token_len=${#TOKEN}"
BAD="zzzzzzzzzzzzzzzz"

echo "--- Happ /goods valid ---"
curl -sI -m 8 -A 'Happ/1.0' "http://127.0.0.1:4000/goods/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true

echo "--- Mozilla /goods valid status+expose ---"
VALID_HDR=$(curl -sI -m 8 -A 'Mozilla/5.0' -H 'Accept: text/html' "http://127.0.0.1:4000/goods/$TOKEN" | tr -d '\r')
echo "$VALID_HDR" | grep -iE 'HTTP/|content-type|access-control-expose|profile-title|subscription-userinfo' || true
echo "$VALID_HDR" | grep -qiE 'HTTP/1\.[01] 200|HTTP/2 200' || { echo FAIL_valid_not_200; exit 1; }
echo "$VALID_HDR" | grep -qiE 'profile-title|subscription-userinfo' && { echo FAIL_sub_headers_on_decoy; exit 1; } || true

echo "--- Mozilla /goods invalid status ---"
INVALID_HDR=$(curl -sI -m 8 -A 'Mozilla/5.0' -H 'Accept: text/html' "http://127.0.0.1:4000/goods/$BAD" | tr -d '\r')
echo "$INVALID_HDR" | grep -iE 'HTTP/|content-type' || true
echo "$INVALID_HDR" | grep -qiE 'HTTP/1\.[01] 200|HTTP/2 200' || { echo FAIL_invalid_not_200; exit 1; }

echo "--- body equal shape (ДомКомфорт / brand) ---"
BODY_V=$(curl -s -m 8 -A 'Mozilla/5.0' -H 'Accept: text/html' "http://127.0.0.1:4000/goods/$TOKEN")
BODY_I=$(curl -s -m 8 -A 'Mozilla/5.0' -H 'Accept: text/html' "http://127.0.0.1:4000/goods/$BAD")
echo "$BODY_V" | head -c 120; echo
if echo "$BODY_V" | grep -qiE 'vless://|subscription-userinfo|profile-title'; then
  echo FAIL_leak
  exit 1
fi
if ! echo "$BODY_V" | grep -qiE '<html'; then
  echo FAIL_not_html
  exit 1
fi
# Same status path: both HTML catalogs (oracle closed)
if ! echo "$BODY_I" | grep -qiE '<html'; then
  echo FAIL_invalid_not_html
  exit 1
fi

echo "--- GET /goods/ no redirect to token ---"
ROOT_HDR=$(curl -sI -m 8 -A 'Mozilla/5.0' "http://127.0.0.1:4000/goods/" | tr -d '\r')
echo "$ROOT_HDR" | grep -iE 'HTTP/|location|content-type' || true
echo "$ROOT_HDR" | grep -qiE '^location:' && { echo FAIL_goods_root_redirect; exit 1; } || true

echo "--- Happ /goods bad token → HTML decoy not plain not found ---"
BAD_BODY=$(curl -s -m 8 -A 'Happ/1.0' "http://127.0.0.1:4000/goods/$BAD")
echo "$BAD_BODY" | head -c 80; echo
if echo "$BAD_BODY" | grep -qiE '^not found$'; then
  echo FAIL_plain_not_found
  exit 1
fi
if ! echo "$BAD_BODY" | grep -qiE '<html'; then
  echo FAIL_happ_bad_not_html
  exit 1
fi

echo "--- FALLBACK env ---"
grep -E '^SUBSCRIPTION_FALLBACK_SINGLE_USER=' /home/vpnadm/vpn-admin-app/backend/.env 2>/dev/null || echo 'SUBSCRIPTION_FALLBACK_SINGLE_USER=(unset, default 0)'

echo OK_mask
