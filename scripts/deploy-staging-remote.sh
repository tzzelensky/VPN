#!/bin/bash
set -e
cd /home/vpnadm/vpn-admin-app/backend
tar -xzf /home/vpnadm/deploy-backend.tgz
cd /home/vpnadm/vpn-admin-app/frontend
tar -xzf /home/vpnadm/deploy-frontend.tgz
PID=$(ps aux | grep '[/]usr/bin/node dist/index.js' | awk '{print $2}' | head -1)
if [ -n "$PID" ]; then kill -9 "$PID"; fi
sleep 2
cd /home/vpnadm/vpn-admin-app/backend
nohup /usr/bin/node dist/index.js >> /home/vpnadm/vpn-admin-api.log 2>&1 &
sleep 3
curl -s -m 8 http://127.0.0.1:4000/api/health
echo
test -f /home/vpnadm/vpn-admin-app/backend/dist/routes/whitelistVault.js && echo whitelist_route=ok
test -f /home/vpnadm/vpn-admin-app/frontend/dist/assets/index-BpENFSoZ.js && echo frontend_bundle=ok || ls /home/vpnadm/vpn-admin-app/frontend/dist/assets/*.js | tail -1
grep -q whitelistVault /home/vpnadm/vpn-admin-app/backend/dist/index.js && echo index_import=ok
tail -5 /home/vpnadm/vpn-admin-api.log
