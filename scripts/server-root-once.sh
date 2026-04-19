#!/bin/bash
# Запускать на сервере ОДИН РАЗ от root: sudo bash server-root-once.sh
# После этого: Nginx для devspace5.duckdns.org, systemd API, linger для user-сервиса не нужен.

set -euo pipefail

DOMAIN="${1:-devspace5.duckdns.org}"
APP_ROOT="${2:-/home/vpnadm/vpn-admin-app}"

if [[ $(id -u) -ne 0 ]]; then
  echo "Запустите от root: sudo bash $0"
  exit 1
fi

# API уже собран в $APP_ROOT — только права на данные и системный сервис
chown -R vpnadm:vpnadm /opt/vpn-admin
mkdir -p /opt/vpn-admin/data
chown vpnadm:www-data /opt/vpn-admin/data
chmod 750 /opt/vpn-admin/data

# Nginx (www-data) должен иметь право "пройти" по пути к статике.
# Если фронт лежит в /home/vpnadm/..., а /home/vpnadm имеет 700, будет 500 на "/".
if [[ "$APP_ROOT" == /home/vpnadm/* ]]; then
  if command -v setfacl >/dev/null 2>&1; then
    setfacl -m u:www-data:rx /home/vpnadm || true
  else
    chmod o+x /home/vpnadm
  fi
fi

cat >/etc/systemd/system/vpn-admin-api.service <<EOF
[Unit]
Description=VPN Admin API
After=network.target

[Service]
Type=simple
User=vpnadm
Group=www-data
WorkingDirectory=${APP_ROOT}/backend
EnvironmentFile=${APP_ROOT}/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/nginx/sites-available/vpn-admin <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    root ${APP_ROOT}/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
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

    location /comfort {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/vpn-admin /etc/nginx/sites-enabled/vpn-admin
nginx -t
systemctl daemon-reload
systemctl enable --now vpn-admin-api
systemctl reload nginx

echo "Готово. HTTP: http://${DOMAIN}"
echo "HTTPS: certbot --nginx -d ${DOMAIN} -m ваш@email --agree-tos -n"
