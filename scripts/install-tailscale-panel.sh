#!/usr/bin/env bash
# Канал A: Tailscale на панели, чтобы открывать админку без публичного IP.
# Запуск на панели (root):
#   bash scripts/install-tailscale-panel.sh
# Потом на телефоне/ПК: приложение Tailscale, тот же аккаунт, открыть http://<magicdns>:443
#   или http://100.x.y.z:443  (порт панели — nginx 443 / или :4000 если без TLS внутри tailnet)
#
# Не трогает публичный DNS подписки, VPN-ноду и firewall публичного 443.

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

systemctl enable --now tailscaled

HOSTNAME_TS="${TAILSCALE_HOSTNAME:-vpn-panel}"

# Не перехватывать DNS сервера (--accept-dns=false).
if tailscale status --json 2>/dev/null | grep -q '"BackendState": "Running"'; then
  echo "tailscale already up"
  tailscale status
  exit 0
fi

echo "Starting Tailscale. If a login URL is printed, open it once in the browser (same Tailscale account as your phone)."
set +e
tailscale up --hostname="$HOSTNAME_TS" --accept-dns=false --timeout=20s
code=$?
set -e

tailscale status || true
if [[ "$code" -ne 0 ]]; then
  echo "tailscale up exited $code — finish login, then re-run: tailscale up --hostname=$HOSTNAME_TS --accept-dns=false"
  exit 0
fi

echo "Tailscale OK. Panel: https://$(tailscale ip -4):443  (or MagicDNS name)"
echo "Do not close public :443 until you confirmed Tailscale login from your phone."
