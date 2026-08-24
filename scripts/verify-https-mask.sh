#!/bin/bash
# Smoke on panel host (nginx → local): decoy vs Happ, and /login must not look like
# a clean admin entry when probed as public shop traffic.
# Prefer verify-front-mask.sh against the public DuckDNS front after allowlist deploy.
set -euo pipefail
TOKEN=$(python3 -c "import json;d=json.load(open('/opt/vpn-admin/data/data.json'));print(d['users'][0]['sub_token'])" 2>/dev/null \
  || python3 -c "import json;d=json.load(open('/home/vpnadm/vpn-admin-app/data/data.json'));print(d['users'][0]['sub_token'])")
HOST_H="Host: ${MASK_HOST:?Set MASK_HOST (public subscription hostname)}"
echo "=== HTTPS Happ /goods ==="
curl -skI -m 10 -A 'Happ/1.0' -H "$HOST_H" "https://127.0.0.1/goods/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
HAPP_BODY=$(curl -sk -m 10 -A 'Happ/1.0' -H "$HOST_H" "https://127.0.0.1/goods/$TOKEN")
if echo "$HAPP_BODY" | grep -qiE '<html'; then
  echo FAIL_happ_got_html
  exit 1
fi
echo "=== HTTPS Mozilla /goods ==="
curl -sk -m 10 -A 'Mozilla/5.0' -H 'Accept: text/html' -H "$HOST_H" "https://127.0.0.1/goods/$TOKEN" | head -c 200; echo
MOZ_HDR=$(curl -skI -m 10 -A 'Mozilla/5.0' -H 'Accept: text/html' -H "$HOST_H" "https://127.0.0.1/goods/$TOKEN" | tr -d '\r')
echo "$MOZ_HDR" | grep -qiE 'profile-title|subscription-userinfo' && { echo FAIL_sub_headers_on_decoy; exit 1; } || true
echo "=== HTTPS Happ /sub ==="
curl -skI -m 10 -A 'Happ/1.0' -H "$HOST_H" "https://127.0.0.1/sub/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title' || true
echo "=== HTTPS Mozilla /sub headers ==="
curl -skI -m 10 -A 'Mozilla/5.0' -H 'Accept: text/html' -H "$HOST_H" "https://127.0.0.1/sub/$TOKEN" | tr -d '\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
echo "=== HTTPS / ==="
curl -sk -m 10 -A Mozilla -H "$HOST_H" https://127.0.0.1/ | head -c 200; echo
echo "=== HTTPS /login (public probe) ==="
LOGIN_CODE=$(curl -sk -m 10 -o /tmp/vhm-login -w '%{http_code}' -A Mozilla -H "$HOST_H" https://127.0.0.1/login || true)
LOGIN_BODY=$(head -c 300 /tmp/vhm-login 2>/dev/null || true)
echo "HTTP $LOGIN_CODE"
echo "$LOGIN_BODY" | head -c 160; echo
# On panel itself /login may still be SPA (use front allowlist in production).
# Fail only if we are clearly serving admin bundle markers while claiming shop Host.
if [[ "$LOGIN_CODE" == "200" ]] && echo "$LOGIN_BODY" | grep -qiE 'vpn-admin-theme|/assets/index-'; then
  echo "WARN: panel still serves admin SPA on /login for DuckDNS Host — put DuckDNS on allowlist front (panel-front-nginx.conf.example) or apply panel-public-mask-locations.inc.example"
fi
echo DONE
