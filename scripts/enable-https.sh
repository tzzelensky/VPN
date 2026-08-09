#!/usr/bin/env bash
# Включение HTTPS (Let's Encrypt) для уже установленной панели.
# Запуск от root (или через sudo -n от vpnadm):
#   bash /opt/vpn-admin/scripts/enable-https.sh --domain vpn.example.com
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/vpn-admin}"
APP_USER="${APP_USER:-vpnadm}"
DOMAIN=""
NGINX_SITE="vpn-admin"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[*]${NC} $*"; }
ok() { echo -e "${GREEN}[ok]${NC} $*"; }
die() { echo -e "${RED}[ошибка]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain|-d)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --app-root)
      APP_ROOT="${2:-}"
      shift 2
      ;;
    --app-user)
      APP_USER="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 --domain example.com [--app-root /opt/vpn-admin]"
      exit 0
      ;;
    *)
      die "Неизвестный аргумент: $1"
      ;;
  esac
done

DOMAIN="$(echo "${DOMAIN:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
[[ -n "$DOMAIN" ]] || die "Укажите --domain"
[[ "$(id -u)" -eq 0 ]] || die "Нужен root (sudo)"
[[ -d "$APP_ROOT/frontend/dist" ]] || die "Не найден frontend: ${APP_ROOT}/frontend/dist"
command -v certbot >/dev/null 2>&1 || die "certbot не установлен"
command -v nginx >/dev/null 2>&1 || die "nginx не установлен"

# Не IP-only
if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "HTTPS нужен домен (не IP): ${DOMAIN}"
fi

mkdir -p /var/www/certbot
chmod 755 /var/www/certbot

nginx_locations() {
  cat <<EOF
    root ${APP_ROOT}/frontend/dist;
    index index.html;
    client_max_body_size 12m;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        client_max_body_size 12m;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /sub/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /exp-sub/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api/exp-sub/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /comfort {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
EOF
}

log "Готовим HTTP для ACME (${DOMAIN})…"
cat >/etc/nginx/sites-available/${NGINX_SITE} <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

$(nginx_locations)
}
EOF
ln -sfn /etc/nginx/sites-available/${NGINX_SITE} /etc/nginx/sites-enabled/${NGINX_SITE}
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "Запрашиваем сертификат Let's Encrypt…"
certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
  --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring \
  || die "Certbot не выдал сертификат. Проверьте: A-запись домена = IP VPS, порт 80 открыт."

CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
[[ -f "$CERT" && -f "$KEY" ]] || die "Файлы сертификата не найдены"

log "Пишем Nginx SSL…"
cat >/etc/nginx/sites-available/${NGINX_SITE} <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate ${CERT};
    ssl_certificate_key ${KEY};
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

$(nginx_locations)
}
EOF

nginx -t
systemctl reload nginx

PUBLIC_BASE="https://${DOMAIN}"
ENV_FILE="${APP_ROOT}/backend/.env"
if [[ -f "$ENV_FILE" ]]; then
  upsert() {
    local key="$1" value="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
      echo "${key}=${value}" >>"$ENV_FILE"
    fi
  }
  upsert "PUBLIC_API_URL" "$PUBLIC_BASE"
  upsert "FRONTEND_ORIGIN" "$PUBLIC_BASE"
  upsert "COOKIE_SECURE" "auto"
  chown "${APP_USER}:${APP_USER}" "$ENV_FILE" 2>/dev/null || true
  chmod 600 "$ENV_FILE" 2>/dev/null || true
fi

# UFW best-effort
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi

systemctl restart vpn-admin-api || true

ok "HTTPS готов: ${PUBLIC_BASE}"
echo "HTTPS_URL=${PUBLIC_BASE}"
