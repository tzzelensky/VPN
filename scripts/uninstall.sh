#!/usr/bin/env bash
# Полное удаление панели HSN VPN Admin с сервера.
# Запуск от root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/uninstall.sh)
#   bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/uninstall.sh) -- --force
set -euo pipefail

APP_ROOT_DEFAULT="/opt/vpn-admin"
APP_USER="${APP_USER:-vpnadm}"
SERVICE_NAME="vpn-admin-api"
NGINX_SITE="vpn-admin"
FORCE=0

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

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    die "Запустите скрипт от root: sudo bash $0   или   bash <(curl ...) от root"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --)
        shift
        ;;
      -y|--yes|--force)
        FORCE=1
        shift
        ;;
      -h|--help)
        cat <<EOF
Удаление панели управления VPN (HSN).

Использование:
  $0
  $0 -- --force

Что удаляется:
  - systemd-сервис ${SERVICE_NAME}
  - сайт Nginx ${NGINX_SITE}
  - каталог приложения (/opt/vpn-admin и/или путь из unit)
  - пользователь ${APP_USER} (с домашней директорией)
  - сертификат Let's Encrypt для домена панели (best-effort)

Не удаляется: Node.js, Nginx, UFW, системные пакеты.
EOF
        exit 0
        ;;
      -*)
        die "Неизвестный аргумент: $1 (см. --help)"
        ;;
      *)
        die "Неизвестный аргумент: $1 (см. --help)"
        ;;
    esac
  done
}

confirm() {
  if [[ "$FORCE" -eq 1 ]]; then
    return 0
  fi
  echo
  echo -e "${BOLD}Будет полностью удалена панель VPN Admin.${NC}"
  echo "  • сервис ${SERVICE_NAME}"
  echo "  • nginx site ${NGINX_SITE}"
  echo "  • код и данные (/opt/vpn-admin и связанные пути)"
  echo "  • пользователь ${APP_USER}"
  echo
  read -r -p "Введите yes для подтверждения: " ans
  if [[ "${ans}" != "yes" ]]; then
    die "Отменено."
  fi
}

discover_app_roots() {
  local roots=()
  local wd envf
  if systemctl cat "${SERVICE_NAME}" &>/dev/null; then
    wd="$(systemctl show -p WorkingDirectory --value "${SERVICE_NAME}" 2>/dev/null || true)"
    envf="$(systemctl show -p EnvironmentFiles --value "${SERVICE_NAME}" 2>/dev/null || true)"
    # WorkingDirectory обычно …/backend
    if [[ -n "$wd" && "$wd" != "/" ]]; then
      roots+=("$(dirname "$wd")")
    fi
    # EnvironmentFile=-/opt/vpn-admin/backend/.env (может быть с префиксом -)
    if [[ -n "$envf" ]]; then
      envf="${envf#-}"
      envf="${envf%% *}"
      if [[ -n "$envf" && "$envf" != "/" ]]; then
        roots+=("$(dirname "$(dirname "$envf")")")
      fi
    fi
  fi
  roots+=("$APP_ROOT_DEFAULT")
  if [[ -d /home/${APP_USER}/vpn-admin-app ]]; then
    roots+=("/home/${APP_USER}/vpn-admin-app")
  fi
  # unique
  printf '%s\n' "${roots[@]}" | awk 'NF && !seen[$0]++'
}

extract_cert_names() {
  local site="/etc/nginx/sites-available/${NGINX_SITE}"
  if [[ ! -f "$site" ]]; then
    return 0
  fi
  # server_name example.com; или certbot managed
  grep -E '^\s*server_name\s+' "$site" 2>/dev/null \
    | sed -E 's/^\s*server_name\s+//; s/;//g' \
    | tr ' ' '\n' \
    | grep -vE '^(_|localhost)$' \
    | grep -v '\*' \
    || true
}

stop_service() {
  log "Остановка сервиса ${SERVICE_NAME}…"
  if systemctl list-unit-files "${SERVICE_NAME}.service" &>/dev/null \
    || [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    systemctl disable --now "${SERVICE_NAME}" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true
    ok "Сервис удалён"
  else
    warn "Сервис ${SERVICE_NAME} не найден"
  fi
  rm -f /etc/sudoers.d/vpn-admin-panel
}

remove_nginx() {
  log "Nginx site ${NGINX_SITE}…"
  rm -f "/etc/nginx/sites-enabled/${NGINX_SITE}"
  rm -f "/etc/nginx/sites-available/${NGINX_SITE}"
  if command -v nginx >/dev/null 2>&1; then
    if nginx -t 2>/dev/null; then
      systemctl reload nginx 2>/dev/null || true
    else
      warn "nginx -t не прошёл — проверьте конфиг вручную"
    fi
  fi
  ok "Сайт Nginx убран"
}

remove_certs() {
  if ! command -v certbot >/dev/null 2>&1; then
    return 0
  fi
  local names
  names="$(extract_cert_names | head -20)"
  if [[ -z "$names" ]]; then
    return 0
  fi
  log "Удаление сертификатов Let's Encrypt (best-effort)…"
  local name
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    if [[ -d "/etc/letsencrypt/live/${name}" ]]; then
      certbot delete --cert-name "$name" --non-interactive 2>/dev/null \
        && ok "Сертификат ${name} удалён" \
        || warn "Не удалось удалить сертификат ${name}"
    fi
  done <<<"$names"
}

remove_app_trees() {
  log "Удаление каталогов приложения…"
  local root
  while IFS= read -r root; do
    [[ -z "$root" || "$root" == "/" || "$root" == "/opt" || "$root" == "/home" ]] && continue
    if [[ -e "$root" ]]; then
      rm -rf "$root"
      ok "Удалено: ${root}"
    fi
  done < <(discover_app_roots)
}

remove_user() {
  if id "$APP_USER" &>/dev/null; then
    log "Удаление пользователя ${APP_USER}…"
    # Завершить процессы пользователя, если остались
    pkill -u "$APP_USER" 2>/dev/null || true
    sleep 1
    if command -v deluser >/dev/null 2>&1; then
      deluser --remove-home "$APP_USER" 2>/dev/null || deluser "$APP_USER" 2>/dev/null || true
    else
      userdel -r "$APP_USER" 2>/dev/null || userdel "$APP_USER" 2>/dev/null || true
    fi
    ok "Пользователь ${APP_USER} удалён (если существовал)"
  else
    warn "Пользователь ${APP_USER} не найден"
  fi
}

main() {
  need_root
  parse_args "$@"
  confirm

  echo
  echo -e "${BOLD}Удаление панели…${NC}"
  stop_service
  # Сертификаты до удаления nginx-конфига (нужен server_name)
  remove_certs
  remove_nginx
  remove_app_trees
  remove_user

  echo
  echo -e "${GREEN}${BOLD}Панель полностью удалена.${NC}"
  echo "  Node.js / Nginx / UFW оставлены на системе."
  echo "  Повторная установка:"
  echo "    bash <(curl -fsSL https://raw.githubusercontent.com/tzzelensky/VPN/main/scripts/install.sh)"
}

main "$@"
