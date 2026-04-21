#!/usr/bin/env bash
# Сборка backend+frontend без привязки к SSH-сессии (nohup).
# Запуск на VPS от root:  bash scripts/vpn-rebuild-api-nohup.sh
# Лог: /root/vpn-rebuild-api.log
set -euo pipefail

APP="${VPN_ADMIN_APP:-/home/vpnadm/vpn-admin-app}"
LOG="${VPN_ADMIN_REBUILD_LOG:-/root/vpn-rebuild-api.log}"

exec >>"$LOG" 2>&1
echo "== $(date -Is) start rebuild APP=$APP =="

cd "$APP"
git fetch origin
git reset --hard origin/main
echo "HEAD $(git rev-parse --short HEAD)"

cd "$APP/backend"
npm ci
npm run build

cd "$APP/frontend"
npm ci
npm run build

systemctl daemon-reload
systemctl enable vpn-admin-api 2>/dev/null || true
systemctl restart vpn-admin-api
sleep 2

if ! systemctl is-active --quiet vpn-admin-api; then
  echo "ERROR: vpn-admin-api is not active"
  systemctl status vpn-admin-api --no-pager || true
  exit 1
fi

curl -fsS http://127.0.0.1:4000/api/health
echo ""
echo "== $(date -Is) done OK =="
