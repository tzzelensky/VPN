#!/usr/bin/env bash
# Запуск на VPS от root (после ssh root@IP):  bash -s < deploy-prod-from-root.sh
# или:  bash scripts/deploy-prod-from-root.sh
set -euo pipefail

APP="${VPN_ADMIN_APP:-}"
if [[ -z "$APP" ]]; then
  for d in /home/vpnadm/vpn-admin-app /opt/vpn-admin; do
    if [[ -f "$d/backend/package.json" ]]; then APP="$d"; break; fi
  done
fi
if [[ -z "$APP" ]]; then
  echo "Не найден проект: ожидался каталог с backend/package.json в"
  echo "  /home/vpnadm/vpn-admin-app или /opt/vpn-admin"
  echo "Задайте путь: VPN_ADMIN_APP=/path/to/repo bash $0"
  exit 1
fi

echo "== APP=$APP =="

if [[ -d "$APP/.git" ]]; then
  git -C "$APP" fetch origin
  git -C "$APP" reset --hard origin/main
  echo "HEAD: $(git -C "$APP" rev-parse --short HEAD)"
fi

run_as() {
  local u="$1"
  shift
  if id "$u" &>/dev/null; then
    sudo -u "$u" -H bash -lc "$*"
  else
    bash -lc "$*"
  fi
}

run_as vpnadm "set -e; cd \"$APP/backend\"; npm ci; npm run build"
run_as vpnadm "set -e; cd \"$APP/frontend\"; npm ci; npm run build"

if id vpnadm &>/dev/null; then
  chown -R vpnadm:vpnadm "$APP/backend/dist" "$APP/frontend/dist" 2>/dev/null || true
fi

systemctl daemon-reload 2>/dev/null || true
systemctl restart vpn-admin-api
sleep 2
systemctl is-active vpn-admin-api
curl -fsS http://127.0.0.1:4000/api/health
echo ""
echo "== готово =="
