#!/usr/bin/env bash
# Установка панели HSN VPN Admin на чистый Ubuntu 22.04/24.04 или Debian 12.
# Запуск от root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/install.sh)
#   bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/install.sh) -- vpn.example.com
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tzzelensky/VPN.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_ROOT="${APP_ROOT:-/opt/vpn-admin}"
DATA_DIR="${DATA_DIR:-/opt/vpn-admin/data}"
APP_USER="${APP_USER:-vpnadm}"
ADMIN_USER_DEFAULT="admin"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log() { echo -e "${CYAN}[*]${NC} $*"; }
ok() { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die() { echo -e "${RED}[ошибка]${NC} $*" >&2; exit 1; }

# После uninstall cwd часто остаётся в удалённом /opt/vpn-admin — git/npm тогда падают с uv_cwd.
ensure_safe_cwd() {
  if ! pwd >/dev/null 2>&1 || [[ ! -d "$(pwd 2>/dev/null || echo /)" ]]; then
    cd / || true
  fi
  # На всякий случай всегда уходим из каталога установки
  case "$(pwd 2>/dev/null || echo)" in
    "${APP_ROOT}"|"${APP_ROOT}"/*|"/opt/vpn-admin"|"/opt/vpn-admin"/*)
      cd / || true
      ;;
  esac
}

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "Запустите скрипт от root: sudo bash $0   или   bash <(curl ...) от root"
  fi
}

# Не трогаем рабочую панель (код в /home/vpnadm/vpn-admin-app). One-liner только для чистых VPS.
refuse_managed_staging_panel() {
  if [[ "${ALLOW_EXISTING_PANEL:-0}" == "1" ]]; then
    warn "ALLOW_EXISTING_PANEL=1 — защита staging-раскладки отключена."
    return 0
  fi
  local wd=""
  wd="$(systemctl show -p WorkingDirectory --value vpn-admin-api 2>/dev/null || true)"
  if [[ "$wd" == /home/*/vpn-admin-app/backend || "$wd" == /home/*/vpn-admin-app ]]; then
    die "Обнаружена рабочая панель (${wd}). Не ставьте one-liner поверх неё. Используйте чистый VPS. Обход: ALLOW_EXISTING_PANEL=1"
  fi
  if [[ -d /home/${APP_USER}/vpn-admin-app/backend && -d /opt/vpn-admin/data ]]; then
    if systemctl is-active --quiet vpn-admin-api 2>/dev/null; then
      die "Уже есть панель /home/${APP_USER}/vpn-admin-app + /opt/vpn-admin/data. One-liner сюда нельзя. Обход: ALLOW_EXISTING_PANEL=1"
    fi
  fi
}

detect_os() {
  if [[ ! -f /etc/os-release ]]; then
    die "Не удалось определить ОС. Нужен Ubuntu 22.04/24.04 или Debian 12."
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  local id_like="${ID_LIKE:-}"
  case "${ID:-}" in
    ubuntu)
      case "${VERSION_ID:-}" in
        22.04|24.04) ok "ОС: ${PRETTY_NAME}" ;;
        *)
          warn "Официально поддерживаются Ubuntu 22.04/24.04. У вас: ${PRETTY_NAME}. Продолжаем."
          ;;
      esac
      ;;
    debian)
      case "${VERSION_ID:-}" in
        12|13) ok "ОС: ${PRETTY_NAME}" ;;
        11)
          warn "Debian 11 не в основном списке поддержки, но установка обычно проходит. Продолжаем."
          ;;
        *)
          warn "Ожидался Debian 12+. У вас: ${PRETTY_NAME}. Продолжаем на свой страх и риск."
          ;;
      esac
      ;;
    *)
      # Некоторые образы ставят ID=linuxmint и т.п. с ID_LIKE=debian/ubuntu
      if [[ " ${id_like} " == *" debian "* ]] || [[ " ${id_like} " == *" ubuntu "* ]]; then
        warn "Дистрибутив ${PRETTY_NAME} (на базе Debian/Ubuntu). Продолжаем."
      else
        die "Скрипт рассчитан на Ubuntu или Debian. Сейчас: ${PRETTY_NAME:-unknown}"
      fi
      ;;
  esac
}

rand_hex() {
  openssl rand -hex "${1:-24}"
}

rand_password() {
  # Без неоднозначных символов — удобно копировать
  openssl rand -base64 18 | tr -d '=+/' | cut -c1-20
}

server_public_ip() {
  local ip=""
  ip="$(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  echo "$ip"
}

parse_args() {
  DOMAIN_ARG=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --)
        shift
        DOMAIN_ARG="${1:-}"
        break
        ;;
      -h|--help)
        cat <<EOF
Установка панели управления VPN (HSN).

Использование:
  $0 [домен]
  $0 -- vpn.example.com

Переменные окружения (опционально):
  REPO_URL=https://github.com/tzzelensky/VPN.git
  REPO_BRANCH=main
  APP_ROOT=/opt/vpn-admin
  ADMIN_PASSWORD=...   # иначе сгенерируется
  SKIP_CERTBOT=1       # не пытаться получить HTTPS
  SKIP_UFW=1           # не настраивать firewall
EOF
        exit 0
        ;;
      -*)
        die "Неизвестный аргумент: $1 (см. --help)"
        ;;
      *)
        DOMAIN_ARG="$1"
        shift
        break
        ;;
    esac
    shift || true
  done
}

ask_domain() {
  local ip
  ip="$(server_public_ip)"
  echo
  echo -e "${BOLD}Домен для панели${NC}"
  echo "  Пример: vpn.example.com"
  echo "  A-запись домена должна указывать на IP этого VPS: ${ip:-неизвестен}"
  echo "  Если домена нет — нажмите Enter: панель откроется по http://IP (без HTTPS)."
  echo
  if [[ -n "${DOMAIN_ARG}" ]]; then
    DOMAIN="$DOMAIN_ARG"
    log "Домен из аргумента: ${DOMAIN}"
  else
    read -r -p "Домен (или Enter = только IP): " DOMAIN
  fi
  DOMAIN="$(echo "${DOMAIN:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  PUBLIC_IP="${ip}"
  WANT_HTTPS=0
  if [[ -z "$DOMAIN" ]]; then
    USE_HTTPS=0
    if [[ -z "$PUBLIC_IP" ]]; then
      die "Не удалось определить IP сервера. Укажите домен явно."
    fi
    PUBLIC_BASE="http://${PUBLIC_IP}"
    SERVER_NAME="_"
    ok "Режим без домена: ${PUBLIC_BASE}"
  else
    # До certbot — HTTP. HTTPS и COOKIE_SECURE включаем только после успешного сертификата.
    USE_HTTPS=0
    PUBLIC_BASE="http://${DOMAIN}"
    SERVER_NAME="$DOMAIN"
    WANT_HTTPS=1
    ok "Домен: ${DOMAIN} → сначала ${PUBLIC_BASE} (HTTPS после certbot)"
  fi
}

confirm_install() {
  echo
  echo -e "${BOLD}Будет установлено:${NC}"
  echo "  Каталог:     ${APP_ROOT}"
  echo "  Данные:      ${DATA_DIR}"
  echo "  Пользователь:${APP_USER}"
  echo "  URL:         ${PUBLIC_BASE}"
  echo "  Репозиторий: ${REPO_URL} (${REPO_BRANCH})"
  echo
  read -r -p "Продолжить? [Y/n] " ans
  ans="${ans:-Y}"
  case "$ans" in
    Y|y|yes|YES) ;;
    *) die "Отменено пользователем." ;;
  esac
}

install_packages() {
  log "Обновление пакетов и установка зависимостей…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y \
    ca-certificates curl git openssl ufw nginx rsync \
    certbot python3-certbot-nginx \
    acl

  if ! command -v node >/dev/null 2>&1 || ! node -v 2>/dev/null | grep -qE '^v20\.'; then
    log "Установка Node.js 20 LTS…"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  ok "Node $(node -v), npm $(cd / && npm -v)"
}

ensure_user() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    log "Создаём пользователя ${APP_USER}…"
    adduser --disabled-password --gecos "" "$APP_USER"
  fi
  usermod -aG www-data "$APP_USER" || true
  # sudo — чтобы vpnadm мог при необходимости помогать с сервисом
  if getent group sudo >/dev/null 2>&1; then
    usermod -aG sudo "$APP_USER" || true
  fi
  ok "Пользователь ${APP_USER} готов"
}

setup_dirs_and_repo() {
  log "Каталоги и код…"
  mkdir -p "$APP_ROOT" "$DATA_DIR"
  chown -R "${APP_USER}:www-data" "$APP_ROOT"
  chmod 750 "$APP_ROOT" "$DATA_DIR"

  if [[ -d "${APP_ROOT}/.git" ]]; then
    log "Репозиторий уже есть — обновляем ${REPO_BRANCH}…"
    sudo -u "$APP_USER" git -C "$APP_ROOT" fetch --depth 1 origin "$REPO_BRANCH"
    sudo -u "$APP_USER" git -C "$APP_ROOT" checkout "$REPO_BRANCH"
    sudo -u "$APP_USER" git -C "$APP_ROOT" reset --hard "origin/${REPO_BRANCH}"
  else
    TMP="$(mktemp -d)"
    git clone --depth 1 -b "$REPO_BRANCH" "$REPO_URL" "${TMP}/src"
    # Не затираем data/ и существующий .env
    rsync -a \
      --exclude 'data/' \
      --exclude 'backend/.env' \
      --exclude 'backend/node_modules/' \
      --exclude 'frontend/node_modules/' \
      --exclude 'backend/dist/' \
      --exclude 'frontend/dist/' \
      "${TMP}/src/" "${APP_ROOT}/"
    rm -rf "$TMP"
    chown -R "${APP_USER}:www-data" "$APP_ROOT"
  fi

  mkdir -p "$DATA_DIR"
  chown "${APP_USER}:www-data" "$DATA_DIR"
  chmod 750 "$DATA_DIR"

  [[ -f "${APP_ROOT}/backend/package.json" ]] || die "После клонирования нет ${APP_ROOT}/backend — проверьте REPO_URL"
  ok "Код в ${APP_ROOT}"
}

write_env() {
  local env_file="${APP_ROOT}/backend/.env"
  local session_secret app_secret admin_password

  session_secret="$(rand_hex 32)"
  app_secret="$(rand_hex 32)"
  admin_password="${ADMIN_PASSWORD:-$(rand_password)}"
  ADMIN_PASSWORD_PRINT="$admin_password"

  if [[ -f "$env_file" ]]; then
    warn "Файл ${env_file} уже есть — сохраняем его (секреты не перезаписываем)."
    # Обновим только URL/DATA/COOKIE если нужно
    upsert_env() {
      local key="$1" value="$2"
      if grep -q "^${key}=" "$env_file"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
      else
        echo "${key}=${value}" >>"$env_file"
      fi
    }
    upsert_env "PORT" "4000"
    upsert_env "DATA_PATH" "${DATA_DIR}/data.json"
    upsert_env "PUBLIC_API_URL" "$PUBLIC_BASE"
    upsert_env "FRONTEND_ORIGIN" "$PUBLIC_BASE"
    # Secure-cookie только когда HTTPS реально работает (после certbot)
    if [[ "$USE_HTTPS" -eq 1 ]]; then
      upsert_env "COOKIE_SECURE" "auto"
    else
      upsert_env "COOKIE_SECURE" "0"
    fi
    # Пробуем вытащить текущий пароль для финального сообщения
    ADMIN_PASSWORD_PRINT="$(grep -E '^ADMIN_PASSWORD=' "$env_file" | head -1 | cut -d= -f2- || true)"
    ADMIN_USER_PRINT="$(grep -E '^ADMIN_USER=' "$env_file" | head -1 | cut -d= -f2- || echo "$ADMIN_USER_DEFAULT")"
  else
    ADMIN_USER_PRINT="$ADMIN_USER_DEFAULT"
    local cookie_secure="0"
    if [[ "$USE_HTTPS" -eq 1 ]]; then
      cookie_secure="auto"
    fi
    cat >"$env_file" <<EOF
PORT=4000
DATA_PATH=${DATA_DIR}/data.json
PUBLIC_API_URL=${PUBLIC_BASE}
FRONTEND_ORIGIN=${PUBLIC_BASE}
SESSION_SECRET=${session_secret}
APP_SECRET=${app_secret}
ADMIN_USER=${ADMIN_USER_DEFAULT}
ADMIN_PASSWORD=${admin_password}
COOKIE_SECURE=${cookie_secure}
EOF
  fi

  chown "${APP_USER}:${APP_USER}" "$env_file"
  chmod 600 "$env_file"
  ok "Настроен backend/.env"
}

build_app() {
  log "Сборка backend (это может занять несколько минут)…"
  sudo -u "$APP_USER" bash -lc "cd '${APP_ROOT}/backend' && npm ci && npm run build"
  [[ -f "${APP_ROOT}/backend/dist/index.js" ]] || die "Сборка backend не удалась"

  log "Сборка frontend…"
  sudo -u "$APP_USER" bash -lc "cd '${APP_ROOT}/frontend' && npm ci && npm run build"
  [[ -f "${APP_ROOT}/frontend/dist/index.html" ]] || die "Сборка frontend не удалась"
  ok "Сборка готова"
}

write_systemd() {
  log "systemd-сервис vpn-admin-api…"
  cat >/etc/systemd/system/vpn-admin-api.service <<EOF
[Unit]
Description=HSN VPN Admin Panel (API)
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=www-data
WorkingDirectory=${APP_ROOT}/backend
EnvironmentFile=${APP_ROOT}/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable vpn-admin-api
  systemctl restart vpn-admin-api
  # Self-update из панели: vpnadm может перезапустить только этот сервис
  cat >/etc/sudoers.d/vpn-admin-panel <<EOF
${APP_USER} ALL=(root) NOPASSWD: /bin/systemctl restart vpn-admin-api, /bin/systemctl reload vpn-admin-api, /bin/systemctl status vpn-admin-api, /usr/bin/systemctl restart vpn-admin-api, /usr/bin/systemctl reload vpn-admin-api, /usr/bin/systemctl status vpn-admin-api
EOF
  chmod 440 /etc/sudoers.d/vpn-admin-panel
  ok "Сервис vpn-admin-api запущен"
}

nginx_location_blocks() {
  # Общие location'ы для HTTP и HTTPS server
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

write_nginx() {
  log "Nginx…"
  rm -f /etc/nginx/sites-enabled/default
  mkdir -p /var/www/certbot

  # Чистый HTTP (HTTPS допишем после certbot своим конфигом — без сломанного TLS на :443)
  cat >/etc/nginx/sites-available/vpn-admin <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

$(nginx_location_blocks)
}
EOF

  ln -sfn /etc/nginx/sites-available/vpn-admin /etc/nginx/sites-enabled/vpn-admin
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
  ok "Nginx настроен (HTTP)"
}

write_nginx_ssl() {
  local domain="$1"
  local cert="/etc/letsencrypt/live/${domain}/fullchain.pem"
  local key="/etc/letsencrypt/live/${domain}/privkey.pem"
  [[ -f "$cert" && -f "$key" ]] || die "Нет сертификата: ${cert}"

  cat >/etc/nginx/sites-available/vpn-admin <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

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
    server_name ${domain};

    ssl_certificate ${cert};
    ssl_certificate_key ${key};
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;

$(nginx_location_blocks)
}
EOF

  nginx -t
  systemctl reload nginx
}

enable_https_env() {
  local domain="$1"
  local env_file="${APP_ROOT}/backend/.env"
  PUBLIC_BASE="https://${domain}"
  USE_HTTPS=1
  if [[ -f "$env_file" ]]; then
    if grep -q '^PUBLIC_API_URL=' "$env_file"; then
      sed -i "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=${PUBLIC_BASE}|" "$env_file"
    else
      echo "PUBLIC_API_URL=${PUBLIC_BASE}" >>"$env_file"
    fi
    if grep -q '^FRONTEND_ORIGIN=' "$env_file"; then
      sed -i "s|^FRONTEND_ORIGIN=.*|FRONTEND_ORIGIN=${PUBLIC_BASE}|" "$env_file"
    else
      echo "FRONTEND_ORIGIN=${PUBLIC_BASE}" >>"$env_file"
    fi
    if grep -q '^COOKIE_SECURE=' "$env_file"; then
      sed -i 's|^COOKIE_SECURE=.*|COOKIE_SECURE=auto|' "$env_file"
    else
      echo "COOKIE_SECURE=auto" >>"$env_file"
    fi
  fi
  systemctl restart vpn-admin-api
}

setup_ufw() {
  if [[ "${SKIP_UFW:-0}" == "1" ]]; then
    warn "UFW пропущен (SKIP_UFW=1)"
    return
  fi
  log "Firewall (UFW)…"
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  if ufw status 2>/dev/null | grep -qi "Status: inactive"; then
    ufw --force enable
  fi
  ok "UFW: SSH, 80, 443"
}

try_certbot() {
  if [[ "${SKIP_CERTBOT:-0}" == "1" ]]; then
    warn "Certbot пропущен (SKIP_CERTBOT=1)"
    return
  fi
  if [[ "${WANT_HTTPS:-0}" -ne 1 || -z "${DOMAIN:-}" ]]; then
    warn "HTTPS пропущен (нет домена). Позже: укажите домен и выполните certbot."
    return
  fi

  log "Получаем HTTPS-сертификат для ${DOMAIN}…"
  mkdir -p /var/www/certbot

  # webroot — предсказуемее, чем certbot --nginx (тот часто ломает конфиг после uninstall)
  if ! certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
      --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring; then
    warn "Certbot не смог выдать сертификат (часто DNS ещё не указывает на этот IP или порт 80 закрыт)."
    warn "Когда A-запись домена = IP сервера, выполните:"
    echo "  certbot certonly --webroot -w /var/www/certbot -d ${DOMAIN} --agree-tos -m you@example.com"
    echo "  # затем обновите панель / переустановите, либо напишите SSL-server вручную"
    return
  fi

  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    warn "Certbot отработал, но файл сертификата не найден."
    return
  fi

  write_nginx_ssl "$DOMAIN"
  enable_https_env "$DOMAIN"

  sleep 1
  if curl -fsS --max-time 8 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
    ok "HTTPS готов: https://${DOMAIN}"
  else
    warn "Сертификат установлен, но https://${DOMAIN}/api/health пока не ответил — проверьте DNS/firewall."
    ok "Конфиг SSL записан: https://${DOMAIN}"
  fi
}

health_check() {
  log "Проверка API…"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 3 http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
      ok "API отвечает: http://127.0.0.1:4000/api/health"
      return 0
    fi
    sleep 1
  done
  warn "API пока не отвечает. Смотрите: journalctl -u vpn-admin-api -n 50 --no-pager"
  systemctl --no-pager --full status vpn-admin-api || true
}

print_summary() {
  echo
  echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  Установка завершена${NC}"
  echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
  echo
  echo -e "  Откройте в браузере:  ${BOLD}${PUBLIC_BASE}${NC}"
  echo -e "  Логин:                ${BOLD}${ADMIN_USER_PRINT:-$ADMIN_USER_DEFAULT}${NC}"
  echo -e "  Пароль:               ${BOLD}${ADMIN_PASSWORD_PRINT:-см. backend/.env}${NC}"
  echo
  echo "  Сохраните пароль. Он лежит в: ${APP_ROOT}/backend/.env"
  echo
  echo "  Полезные команды:"
  echo "    systemctl status vpn-admin-api"
  echo "    journalctl -u vpn-admin-api -f"
  echo "    cd ${APP_ROOT} && sudo -u ${APP_USER} git pull && …  # см. README"
  echo
  echo "  Дальше в панели: добавьте VPN-сервер по SSH → установите Xray."
  echo
}

main() {
  ensure_safe_cwd
  parse_args "$@"
  need_root
  refuse_managed_staging_panel
  detect_os
  ask_domain
  confirm_install
  ensure_safe_cwd
  install_packages
  ensure_user
  setup_dirs_and_repo
  write_env
  build_app
  write_systemd
  write_nginx
  setup_ufw
  try_certbot
  health_check
  print_summary
}

main "$@"
