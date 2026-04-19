#!/bin/bash
set -euo pipefail

REPO_DIR="${1:-/home/vpnadm/vpn-admin-app}"
ENV_FILE="$REPO_DIR/backend/.env"

if [[ ! -d "$REPO_DIR" ]]; then
  echo "Нет каталога $REPO_DIR"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Нет файла $ENV_FILE"
  exit 1
fi

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >>"$ENV_FILE"
  fi
}

upsert_env "FRONTEND_ORIGIN" "https://devspace5.duckdns.org"
upsert_env "PUBLIC_API_URL" "https://devspace5.duckdns.org"
upsert_env "DATA_PATH" "/opt/vpn-admin/data/data.json"
upsert_env "COOKIE_SECURE" "1"

cd "$REPO_DIR/backend"
rm -rf node_modules
npm ci
npm run build

cd "$REPO_DIR/frontend"
rm -rf node_modules
npm ci
npm run build

pkill -f "node dist/index.js" 2>/dev/null || true
cd "$REPO_DIR/backend"
nohup /usr/bin/node dist/index.js >>/home/vpnadm/vpn-admin-api.log 2>&1 &
sleep 2
curl -sS http://127.0.0.1:4000/api/health
echo
echo "API запущен временно через nohup."
