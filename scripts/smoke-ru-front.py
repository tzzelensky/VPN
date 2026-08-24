#!/usr/bin/env python3
"""Smoke RU VPN SNI (no shop/API on this host)."""
from __future__ import annotations

import os
import sys

import paramiko

RU = os.environ.get("RU_HOST", "").strip()
PASSWORD = os.environ.get("RU_SSH_PASSWORD", "")


def main() -> None:
    if not RU:
        raise SystemExit("Set RU_HOST")
    if not PASSWORD:
        raise SystemExit("Set RU_SSH_PASSWORD")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(RU, username="root", password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)
    cmd = r"""
set -e
echo '=== stream map ==='
cat /etc/nginx/stream.d/vpn-front-sni.conf
echo '=== listen ==='
ss -tlnp | grep -E ':443 |:8443 |:8446 |:10443 |:80 ' || true
test ! -e /etc/nginx/sites-enabled/vpn-front && echo shop_vhost_absent
grep -q duckdns /etc/nginx/stream.d/vpn-front-sni.conf && { echo FAIL_duckdns_in_sni; exit 1; } || echo sni_no_domain
echo '=== tls cloudflare (trojan) ==='
timeout 8 openssl s_client -connect 127.0.0.1:443 -servername www.cloudflare.com </dev/null 2>/dev/null | openssl x509 -noout -subject | head -1
echo '=== tls microsoft (vless) ==='
timeout 8 openssl s_client -connect 127.0.0.1:443 -servername www.microsoft.com </dev/null 2>/dev/null | openssl x509 -noout -subject | head -1
"""
    _, o, e = c.exec_command(cmd, timeout=40)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    code = o.channel.recv_exit_status()
    sys.stdout.write(out)
    if err.strip():
        sys.stderr.write(err)
    c.close()
    if code != 0:
        raise SystemExit(code)
    print("SMOKE_OK")


if __name__ == "__main__":
    main()
