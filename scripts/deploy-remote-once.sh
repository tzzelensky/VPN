#!/bin/bash
set -e
cd /home/vpnadm/vpn-admin-app/backend/dist
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
test -f /home/vpnadm/vpn-admin-app/backend/dist/routes/rouletteGame.js && echo roulette_route=ok
ls /home/vpnadm/vpn-admin-app/frontend/dist/assets/index-*.js | tail -1
