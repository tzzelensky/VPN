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
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[*]${NC} $*"; }
ok() { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
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

if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "HTTPS нужен домен (не IP): ${DOMAIN}"
fi

mkdir -p /var/www/certbot
chmod 755 /var/www/certbot

# Убираем типичных «воров» порта 443: stream ssl_preread / mtproto / чужие SSL-сайты
clear_443_conflicts() {
  log "Чистим конфликты на :443…"
  mkdir -p /etc/nginx/stream.d
  # MTProto/stream snatchers
  rm -f /etc/nginx/stream.d/tzadmin-mtproto.conf \
        /etc/nginx/stream.d/*mtproto*.conf \
        /etc/nginx/stream.d/*443*.conf 2>/dev/null || true
  # Вырезаем stream { ... } из главного nginx.conf, если там слушают 443
  if [[ -f /etc/nginx/nginx.conf ]] && grep -qE 'listen\s+443' /etc/nginx/nginx.conf; then
    warn "В /etc/nginx/nginx.conf есть listen 443 — комментируем stream-блоки (бэкап .bak-https)"
    cp -a /etc/nginx/nginx.conf "/etc/nginx/nginx.conf.bak-https-$(date +%Y%m%d%H%M%S)"
    # Грубая, но рабочая очистка вложенного stream { }
    awk '
      BEGIN { skip=0; depth=0 }
      /^[[:space:]]*stream[[:space:]]*\{/ { skip=1; depth=1; next }
      skip {
        depth += gsub(/\{/, "{")
        depth -= gsub(/\}/, "}")
        if (depth <= 0) skip=0
        next
      }
      { print }
    ' /etc/nginx/nginx.conf > /tmp/nginx.conf.https-clean
    mv /tmp/nginx.conf.https-clean /etc/nginx/nginx.conf
  fi
  # Чужие сайты с 443 (кроме нашего)
  local f
  for f in /etc/nginx/sites-enabled/*; do
    [[ -e "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" == "$NGINX_SITE" ]] && continue
    if grep -qE 'listen\s+\[?::\]?:?443|listen\s+443' "$f" 2>/dev/null; then
      warn "Отключаем конфликтующий сайт: ${base}"
      rm -f "$f"
    fi
  done
}

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

clear_443_conflicts

# Если :443 уже держит не nginx (часто xray) — HTTPS панели не заработает.
assert_443_free_or_nginx() {
  local holders
  holders="$(ss -tlnp 2>/dev/null | grep -E ':443\b' || true)"
  if [[ -z "$holders" ]]; then
    return 0
  fi
  if echo "$holders" | grep -qi 'nginx'; then
    # nginx уже слушает — ок (перезапишем конфиг и reload)
    return 0
  fi
  echo "$holders"
  die "Порт 443 занят НЕ nginx (см. строку выше). Обычно это Xray/Reality.
Освободите 443 для панели, например:
  1) В конфиге Xray смените inbound port 443 → 8443 (или другой)
  2) systemctl restart xray   # или ваш unit (xray / tzadmin-xray)
  3) bash $0 --domain ${DOMAIN}
Либо уберите Xray с этого VPS — панель и VPN-нода лучше на разных машинах."
}

assert_443_free_or_nginx

log "Готовим HTTP для ACME (${DOMAIN})…"
cat >/etc/nginx/sites-available/${NGINX_SITE} <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
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
# Проверка, что ключ/серт читаются и пара валидна
openssl x509 -in "$CERT" -noout -subject -dates >/dev/null \
  || die "Сертификат повреждён: ${CERT}"
openssl rsa -in "$KEY" -check -noout >/dev/null 2>&1 \
  || openssl ec -in "$KEY" -check -noout >/dev/null 2>&1 \
  || die "Ключ сертификата повреждён: ${KEY}"

log "Пишем Nginx SSL…"
# Без http2 в listen — меньше сюрпризов на старых/кастомных сборках; TLS 1.2/1.3 явно.
cat >/etc/nginx/sites-available/${NGINX_SITE} <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
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
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name ${DOMAIN};

    ssl_certificate ${CERT};
    ssl_certificate_key ${KEY};
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_ciphers HIGH:!aNULL:!MD5;

$(nginx_locations)
}
EOF

nginx -t
systemctl reload nginx
# Полный restart надёжнее reload, если 443 был занят кривым listener
systemctl restart nginx

# После restart nginx обязан держать 443
holders="$(ss -tlnp 2>/dev/null | grep -E ':443\b' || true)"
if ! echo "$holders" | grep -qi 'nginx'; then
  echo "$holders"
  die "После restart nginx порт 443 всё ещё не у nginx. Освободите 443 от Xray/другого процесса и повторите."
fi

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

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi

systemctl restart vpn-admin-api || true

log "Проверяем TLS локально…"
sleep 1
if ! curl -fsS --max-time 8 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
  warn "Локальная проверка https:// не прошла. Диагностика:"
  echo "--- ss :443 ---"
  ss -tlnp | grep ':443' || true
  echo "--- nginx -T (ssl) ---"
  nginx -T 2>/dev/null | grep -E 'listen .*443|ssl_certificate|server_name' | head -40 || true
  echo "--- openssl ---"
  echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>&1 | head -30 || true
  die "HTTPS сконфигурирован, но TLS handshake не работает (ERR_SSL_VERSION_OR_CIPHER_MISMATCH). Смотрите вывод выше."
fi

ok "HTTPS готов: ${PUBLIC_BASE}"
echo "HTTPS_URL=${PUBLIC_BASE}"
