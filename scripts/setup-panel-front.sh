#!/usr/bin/env bash
# Канал B: nginx HTTPS-фронт → панель.
# Публично: shop, /goods, WebApp /mysub, админка (5 тапов). Парольный /login → 404.
#
# На новой Ubuntu/Debian VM (root):
#   export PANEL_DOMAIN=sub.example.com
#   export PANEL_ORIGIN=https://PANEL_IP
#   export CERTBOT_EMAIL=you@example.com   # опционально, для certbot
#   bash scripts/setup-panel-front.sh
#
# Перед certbot A-запись публичного DNS должна смотреть на ЭТУ VM.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${PANEL_DOMAIN:?Set PANEL_DOMAIN (public subscription hostname)}"
ORIGIN="${PANEL_ORIGIN:?Set PANEL_ORIGIN (https://panel-ip-or-host)}"
EMAIL="${CERTBOT_EMAIL:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx ca-certificates certbot python3-certbot-nginx curl

mkdir -p /var/www/certbot /etc/nginx/sites-available /etc/nginx/sites-enabled
SRC="${SCRIPT_DIR}/panel-front-nginx.conf.example"
if [[ ! -f "$SRC" ]]; then
  echo "Missing panel-front-nginx.conf.example" >&2
  exit 1
fi

TMP="$(mktemp)"
sed -e "s|DOMAIN_PLACEHOLDER|${DOMAIN}|g" -e "s|PANEL_ORIGIN_PLACEHOLDER|${ORIGIN}|g" "$SRC" >"$TMP"

SITE=/etc/nginx/sites-available/panel-front
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  # HTTP-only until cert exists: drop the HTTPS server block (marked by listen 443).
  awk '
    BEGIN { skip = 0; depth = 0 }
    /listen 443/ { skip = 1 }
    {
      if (skip) {
        for (i = 1; i <= length($0); i++) {
          c = substr($0, i, 1)
          if (c == "{") depth++
          if (c == "}") {
            depth--
            if (depth <= 0) { skip = 0; depth = 0; next }
          }
        }
        next
      }
      print
    }
  ' "$TMP" >"$SITE"
else
  cp "$TMP" "$SITE"
fi
rm -f "$TMP"

ln -sfn "$SITE" /etc/nginx/sites-enabled/panel-front
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

if [[ -n "$EMAIL" && ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "Requesting Let's Encrypt for ${DOMAIN} (public DNS A-record must already point here)."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
  # Re-apply allowlist HTTPS block (certbot may rewrite the site file).
  sed -e "s|DOMAIN_PLACEHOLDER|${DOMAIN}|g" -e "s|PANEL_ORIGIN_PLACEHOLDER|${ORIGIN}|g" "$SRC" >"$SITE"
  nginx -t
  systemctl reload nginx
fi

PUB_IP="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"

echo "panel-front nginx ready (shop/WebApp/admin via proxy; /login blocked)."
echo "Origin: ${ORIGIN}"
echo "Domain: ${DOMAIN}"
echo "This VM public IPv4 (point DNS / PANEL_FRONT_IP here): ${PUB_IP}"
echo
echo "Smoke (mask):"
echo "  curl -skI -m 15 -A Mozilla --resolve ${DOMAIN}:443:${PUB_IP} https://${DOMAIN}/login   # expect 404"
echo "  curl -sk -m 15 -A 'Happ/1.0' --resolve ${DOMAIN}:443:${PUB_IP} https://${DOMAIN}/api/health"
echo "Full checks: bash scripts/verify-https-mask.sh (on panel) or scripts/verify-front-mask.sh"
