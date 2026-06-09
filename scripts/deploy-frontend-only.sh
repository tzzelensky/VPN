#!/bin/bash
set -e
FRONT=/home/vpnadm/vpn-admin-app/frontend/dist
rm -rf "$FRONT/assets/index-"*.js "$FRONT/assets/index-"*.css 2>/dev/null || true
cd "$FRONT"
tar -xzf /home/vpnadm/deploy-frontend.tgz
echo "index.html bundle:"
grep -o 'index-[^"]*\.js' "$FRONT/index.html" | head -1
grep -q 'Рулетка' "$FRONT"/assets/index-*.js && echo roulette_ui=ok || echo roulette_ui=missing
