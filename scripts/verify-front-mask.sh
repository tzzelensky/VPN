#!/usr/bin/env bash
# Smoke: публичный HTTP-фронт (allowlist) не отдаёт админку; Happ получает payload.
#
# Env:
#   MASK_BASE   required, e.g. https://sub.example.com
#   MASK_HOST   optional Host header override
#   MASK_RESOLVE optional "host:443:ip" for curl --resolve
#   MASK_TOKEN  optional sub_token; if empty, only /login + /api/health checks run
#
# Exit 0 = OK.

set -euo pipefail

BASE="${MASK_BASE:?Set MASK_BASE (e.g. https://sub.example.com)}"
HOST_HDR="${MASK_HOST:-}"
RESOLVE="${MASK_RESOLVE:-}"
TOKEN="${MASK_TOKEN:-}"

CURL=(curl -sk -m 15)
[[ -n "$RESOLVE" ]] && CURL+=(--resolve "$RESOLVE")
[[ -n "$HOST_HDR" ]] && CURL+=(-H "Host: $HOST_HDR")

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "=== Mozilla /login (must not be admin SPA) ==="
LOGIN_CODE="$("${CURL[@]}" -o /tmp/mask-login-body -w '%{http_code}' -A 'Mozilla/5.0' -H 'Accept: text/html' "$BASE/login" || true)"
LOGIN_BODY="$(head -c 400 /tmp/mask-login-body 2>/dev/null || true)"
echo "HTTP $LOGIN_CODE"
echo "$LOGIN_BODY" | head -c 160; echo
# Allowlist front → 404; decoy/panel misconfig → must not look like React admin login
if [[ "$LOGIN_CODE" == "200" ]]; then
  if echo "$LOGIN_BODY" | grep -qiE 'vpn-admin|root"|/assets/index-|Войти в панель|sessionExpired'; then
    fail "login looks like admin SPA"
  fi
  if echo "$LOGIN_BODY" | grep -qiE '<html' && ! echo "$LOGIN_BODY" | grep -qiE 'ДомКомфорт|decoy|comfort'; then
    # 200 HTML that is not decoy is suspicious
    fail "login 200 HTML is not decoy shop"
  fi
fi
# Preferred: 404 from allowlist front
if [[ "$LOGIN_CODE" != "404" && "$LOGIN_CODE" != "200" ]]; then
  echo "WARN: unexpected /login status $LOGIN_CODE (want 404 on front allowlist)"
fi

echo "=== Mozilla /servers (admin SPA allowed for WebApp 5-tap; /login stays 404) ==="
SRV_CODE="$("${CURL[@]}" -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' "$BASE/servers" || true)"
echo "HTTP $SRV_CODE"
# After denylist front, /servers is proxied (200 SPA). Fail only on gateway errors.
[[ "$SRV_CODE" == "502" || "$SRV_CODE" == "503" || "$SRV_CODE" == "000" ]] && fail "/servers bad gateway ($SRV_CODE)"

echo "=== Telegram WebApp /mysub (must be SPA, not 404) ==="
MYSUB_CODE="$("${CURL[@]}" -o /tmp/mask-mysub-body -w '%{http_code}' -A 'Mozilla/5.0' -H 'Accept: text/html' "$BASE/mysub" || true)"
echo "HTTP $MYSUB_CODE"
[[ "$MYSUB_CODE" == "200" ]] || fail "/mysub expected 200, got $MYSUB_CODE"
head -c 200 /tmp/mask-mysub-body 2>/dev/null | grep -qiE '<html|script|/assets/' || fail "/mysub body not SPA HTML"

echo "=== WebApp admin gate API (must not be 404) ==="
GATE_CODE="$("${CURL[@]}" -o /dev/null -w '%{http_code}' -A 'Mozilla/5.0' -X POST -H 'Content-Type: application/json' -d '{"init_data":""}' "$BASE/api/auth/webapp-admin-check" || true)"
echo "HTTP $GATE_CODE"
[[ "$GATE_CODE" == "404" ]] && fail "webapp-admin-check blocked by front (404)"

echo "=== Happ /api/health ==="
HEALTH="$("${CURL[@]}" -A 'Happ/1.0' "$BASE/api/health" || true)"
echo "$HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || fail "health not ok"

if [[ -n "$TOKEN" ]]; then
  echo "=== Happ /goods/token (payload, not HTML) ==="
  GOODS_HDR="$("${CURL[@]}" -I -A 'Happ/1.0' "$BASE/goods/$TOKEN" | tr -d '\r')"
  echo "$GOODS_HDR" | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
  echo "$GOODS_HDR" | grep -qiE 'HTTP/1\.[01] 200|HTTP/2 200' || fail "Happ /goods not 200"
  BODY="$("${CURL[@]}" -A 'Happ/1.0' "$BASE/goods/$TOKEN")"
  if echo "$BODY" | grep -qiE '<html'; then
    fail "Happ /goods returned HTML decoy"
  fi
  if ! echo "$BODY" | grep -qiE 'vless://|trojan://|hysteria2://|hy2://|^[A-Za-z0-9+/]+=*$'; then
    # Happ JSON or base64 URI list
    if ! echo "$BODY" | grep -qiE '"server"|"outbounds"|subscription'; then
      fail "Happ /goods body not recognized as subscription payload"
    fi
  fi

  echo "=== Mozilla /goods/token (decoy HTML, no sub headers) ==="
  M_HDR="$("${CURL[@]}" -I -A 'Mozilla/5.0' -H 'Accept: text/html' "$BASE/goods/$TOKEN" | tr -d '\r')"
  echo "$M_HDR" | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
  echo "$M_HDR" | grep -qiE 'profile-title|subscription-userinfo' && fail "sub headers on Mozilla decoy"
  M_BODY="$("${CURL[@]}" -A 'Mozilla/5.0' -H 'Accept: text/html' "$BASE/goods/$TOKEN")"
  echo "$M_BODY" | grep -qiE '<html' || fail "Mozilla /goods not HTML"
  echo "$M_BODY" | grep -qiE 'vless://' && fail "vless leak on Mozilla /goods"
fi

echo "OK_front_mask"
