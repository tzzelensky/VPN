#!/usr/bin/env bash
# Setup / refresh RU subscription front (nginx reverse-proxy).
# Does NOT change DuckDNS. Does NOT touch abroad panel/bot/data.
#
# Usage (on RU as root):
#   DOMAIN=devspace5.duckdns.org UPSTREAM_IP=82.25.58.214 bash scripts/setup-ru-front.sh
#
# Optional: CERT_SRC_TAR=/tmp/le-certs.tgz  (fullchain+privkey+options from abroad)
#
# Cutover / rollback (DNS only — run manually in DuckDNS UI):
#   Cutover:  A record  DOMAIN  ->  RU_IP   (this host)
#   Rollback: A record  DOMAIN  ->  UPSTREAM_IP
# Keep abroad nginx/API running forever so rollback is instant.

set -euo pipefail

DOMAIN="${DOMAIN:-devspace5.duckdns.org}"
UPSTREAM_IP="${UPSTREAM_IP:-82.25.58.214}"
SITE_SRC="${SITE_SRC:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx curl ca-certificates openssl >/dev/null

mkdir -p /var/www/certbot /etc/letsencrypt/live/"$DOMAIN" /etc/letsencrypt/archive/"$DOMAIN"

# Firewall if ufw present
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

echo "== upstream health from RU =="
if ! curl -skI -m 15 -H "Host: $DOMAIN" "https://$UPSTREAM_IP/api/health" | head -n 5; then
  echo "WARN: upstream https://$UPSTREAM_IP not reachable from RU" >&2
fi

# TLS: extract provided tar (replaces any prior self-signed), else keep, else self-signed smoke
LIVE="/etc/letsencrypt/live/$DOMAIN"
if [[ -n "${CERT_SRC_TAR:-}" && -f "$CERT_SRC_TAR" ]]; then
  echo "== installing certs from $CERT_SRC_TAR =="
  rm -rf "$LIVE" "/etc/letsencrypt/archive/$DOMAIN"
  mkdir -p /etc
  tar -xzf "$CERT_SRC_TAR" -C /etc
fi

if [[ ! -f "$LIVE/fullchain.pem" || ! -f "$LIVE/privkey.pem" ]]; then
  echo "== no LE cert yet — generating self-signed for smoke (replace after cutover) =="
  mkdir -p "$LIVE"
  openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
    -keyout "$LIVE/privkey.pem" \
    -out "$LIVE/fullchain.pem" \
    -subj "/CN=$DOMAIN" >/dev/null 2>&1
fi

# ssl snippets used by many LE installs
if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
  cat >/etc/letsencrypt/options-ssl-nginx.conf <<'EOF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
EOF
fi
if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
  openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048 >/dev/null 2>&1
fi

# Render site config from example
EXAMPLE="${SITE_SRC:-$SCRIPT_DIR/ru-front-nginx.conf.example}"
if [[ ! -f "$EXAMPLE" ]]; then
  EXAMPLE="/root/ru-front-nginx.conf.example"
fi
if [[ ! -f "$EXAMPLE" ]]; then
  echo "Missing nginx example config" >&2
  exit 1
fi

# Rewrite upstream IP / domain if different from example defaults
sed -e "s/82\\.25\\.58\\.214/${UPSTREAM_IP}/g" \
    -e "s/devspace5\\.duckdns\\.org/${DOMAIN}/g" \
    "$EXAMPLE" >/etc/nginx/sites-available/vpn-front

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/vpn-front /etc/nginx/sites-enabled/vpn-front

nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx
systemctl is-active nginx

echo
echo "RU front ready (DNS unchanged)."
echo "Smoke: curl -skI -A Happ -H 'Host: $DOMAIN' https://$(hostname -I | awk '{print $1}')/api/health"
echo
echo "=== CUTOVER / ROLLBACK (DuckDNS only) ==="
echo "Cutover:  A $DOMAIN -> $(hostname -I | awk '{print $1}')"
echo "Rollback: A $DOMAIN -> $UPSTREAM_IP"
echo "Do not change PUBLIC_API_URL or client subscription links."
