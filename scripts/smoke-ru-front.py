#!/usr/bin/env python3
"""Smoke RU front: Happ vs Mozilla for /sub and /goods (no DNS change)."""
from __future__ import annotations

import os
import sys

import paramiko

RU = os.environ.get("RU_HOST", "93.115.203.23")
ABROAD = os.environ.get("UPSTREAM_IP", "82.25.58.214")
DOMAIN = os.environ.get("DOMAIN", "devspace5.duckdns.org")
PASSWORD = os.environ.get("RU_SSH_PASSWORD", "")


def ssh(host: str, user: str, cmd: str, *, password: str | None = None) -> str:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs = {"hostname": host, "username": user, "timeout": 30}
    if password is not None:
        kwargs.update(password=password, allow_agent=False, look_for_keys=False)
    c.connect(**kwargs)
    try:
        _, stdout, stderr = c.exec_command(cmd, timeout=120)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        if code != 0:
            raise RuntimeError(f"{host} exit {code}: {err or out}")
        return out
    finally:
        c.close()


def main() -> None:
    if not PASSWORD:
        raise SystemExit("Set RU_SSH_PASSWORD")

    token = ssh(
        ABROAD,
        "vpnadm",
        "python3 -c \"import json;d=json.load(open('/opt/vpn-admin/data/data.json'));print(d['users'][0]['sub_token'])\"",
    ).strip()
    print(f"token_len={len(token)}")

    remote = f"""
set -eu
DOMAIN='{DOMAIN}'
TOKEN='{token}'
echo '=== cert ==='
openssl x509 -in /etc/letsencrypt/live/$DOMAIN/fullchain.pem -noout -subject -issuer
for path in /sub/$TOKEN /goods/$TOKEN; do
  echo "=== Happ $path ==="
  curl -skI -m 15 -A 'Happ/1.0' -H "Host: $DOMAIN" "https://127.0.0.1$path" | tr -d '\\r' | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
  BODY_H=$(curl -sk -m 15 -A 'Happ/1.0' -H "Host: $DOMAIN" "https://127.0.0.1$path")
  echo "body0=${{BODY_H:0:80}}"
  case "$BODY_H" in
    *'<html'*|*'<!DOCTYPE'*) echo FAIL_happ_html; exit 1 ;;
  esac
  echo "=== Mozilla $path ==="
  HDRS=$(curl -skI -m 15 -A 'Mozilla/5.0' -H 'Accept: text/html' -H "Host: $DOMAIN" "https://127.0.0.1$path" | tr -d '\\r')
  echo "$HDRS" | grep -iE 'HTTP/|content-type|profile-title|subscription-userinfo' || true
  echo "$HDRS" | grep -qi 'subscription-userinfo' && {{ echo FAIL_vpn_hdr; exit 1; }} || true
  echo "$HDRS" | grep -qi 'profile-title' && {{ echo FAIL_vpn_hdr; exit 1; }} || true
  BODY=$(curl -sk -m 15 -A 'Mozilla/5.0' -H 'Accept: text/html' -H "Host: $DOMAIN" "https://127.0.0.1$path")
  echo "${{BODY:0:120}}"
  echo "$BODY" | grep -qiE 'vless://' && {{ echo FAIL_leak; exit 1; }} || true
  echo "$BODY" | grep -qi '<html' || {{ echo FAIL_no_html; exit 1; }}
  echo OK_no_leak
done
echo SMOKE_OK
"""
    print(ssh(RU, "root", remote, password=PASSWORD))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"SMOKE_FAIL: {e}", file=sys.stderr)
        sys.exit(1)
