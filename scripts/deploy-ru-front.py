#!/usr/bin/env python3
"""Apply VPN-only stream SNI on RU (no shop reverse-proxy). Password: RU_SSH_PASSWORD."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

HOST = os.environ.get("RU_HOST", "138.124.180.18")
USER = os.environ.get("RU_SSH_USER", "root")
PASSWORD = os.environ.get("RU_SSH_PASSWORD", "")
REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "scripts"


def connect() -> paramiko.SSHClient:
    if not PASSWORD:
        raise SystemExit("Set RU_SSH_PASSWORD")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30, allow_agent=False, look_for_keys=False)
    return c


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 300) -> tuple[int, str, str]:
    print(f"$ {cmd[:200]}{'…' if len(cmd) > 200 else ''}")
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    return code, out, err


def sftp_put(c: paramiko.SSHClient, local: Path, remote: str) -> None:
    sftp = c.open_sftp()
    sftp.put(str(local), remote)
    sftp.close()
    print(f"uploaded {local.name} -> {remote}")


def main() -> None:
    c = connect()
    try:
        run(c, "mkdir -p /root/ru-front-deploy")
        sftp_put(c, SCRIPTS / "ru-front-stream.conf.example", "/root/ru-front-deploy/ru-front-stream.conf.example")
        sftp_put(c, SCRIPTS / "setup-ru-front.sh", "/root/ru-front-deploy/setup-ru-front.sh")
        sftp_put(c, SCRIPTS / "RU-FRONT-RUNBOOK.md", "/root/ru-front-deploy/RU-FRONT-RUNBOOK.md")
        run(c, "chmod +x /root/ru-front-deploy/setup-ru-front.sh")
        code, _, _ = run(c, "cd /root/ru-front-deploy && bash setup-ru-front.sh", timeout=600)
        if code != 0:
            raise SystemExit(f"setup-ru-front failed: {code}")
        run(
            c,
            "grep -nE 'cloudflare|duckdns|10443|default' /etc/nginx/stream.d/vpn-front-sni.conf; "
            "ss -tlnp | grep -E ':443 |:8443 |:8446 |:10443 ' || true",
        )
    finally:
        c.close()


if __name__ == "__main__":
    main()
