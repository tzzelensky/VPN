#!/usr/bin/env bash
# RU node: VPN-only nginx stream SNI (no shop reverse-proxy, no domain redirect).
# Does NOT change DuckDNS. Does NOT touch the panel.
#
# Usage (on RU as root):
#   bash scripts/setup-ru-front.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx ca-certificates openssl libnginx-mod-stream >/dev/null

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

# Remove leftover shop reverse-proxy / HTTP 301 for the panel domain
rm -f /etc/nginx/sites-enabled/vpn-front
if [[ -f /etc/nginx/sites-available/vpn-front ]]; then
  mv /etc/nginx/sites-available/vpn-front "/etc/nginx/sites-available/vpn-front.bak.$(date +%Y%m%d%H%M%S)"
fi
rm -f /etc/nginx/sites-enabled/default

STREAM_MOD=""
for cand in /usr/lib/nginx/modules/ngx_stream_module.so /usr/share/nginx/modules/ngx_stream_module.so; do
  if [[ -f "$cand" ]]; then STREAM_MOD="$cand"; break; fi
done
if [[ -n "$STREAM_MOD" ]]; then
  mkdir -p /etc/nginx/modules-enabled /etc/nginx/stream.d
  printf 'load_module %s;\n' "$STREAM_MOD" >/etc/nginx/modules-enabled/50-mod-stream.conf
fi

STREAM_SRC="${SCRIPT_DIR}/ru-front-stream.conf.example"
if [[ ! -f "$STREAM_SRC" ]]; then
  STREAM_SRC="/root/ru-front-deploy/ru-front-stream.conf.example"
fi
if [[ ! -f "$STREAM_SRC" ]]; then
  echo "Missing ru-front-stream.conf.example" >&2
  exit 1
fi
cp "$STREAM_SRC" /etc/nginx/stream.d/vpn-front-sni.conf

if ! grep -qE 'include /etc/nginx/stream.d' /etc/nginx/nginx.conf; then
  cat >>/etc/nginx/nginx.conf <<'EOF'

stream {
    include /etc/nginx/stream.d/*.conf;
}
EOF
fi

nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx
systemctl is-active nginx

echo "RU VPN stream ready (no shop proxy)."
