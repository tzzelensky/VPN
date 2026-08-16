#!/usr/bin/env python3
"""Deploy RU front via password SSH. Password from env RU_SSH_PASSWORD only."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

HOST = os.environ.get("RU_HOST", "93.115.203.23")
USER = os.environ.get("RU_SSH_USER", "root")
PASSWORD = os.environ.get("RU_SSH_PASSWORD", "")
DOMAIN = os.environ.get("DOMAIN", "devspace5.duckdns.org")
UPSTREAM = os.environ.get("UPSTREAM_IP", "82.25.58.214")
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
        run(c, "uname -a; cat /etc/os-release | head -5")
        run(c, "mkdir -p /root/ru-front-deploy /var/www/certbot")
        sftp_put(c, SCRIPTS / "ru-front-nginx.conf.example", "/root/ru-front-deploy/ru-front-nginx.conf.example")
        sftp_put(c, SCRIPTS / "setup-ru-front.sh", "/root/ru-front-deploy/setup-ru-front.sh")
        sftp_put(c, SCRIPTS / "RU-FRONT-RUNBOOK.md", "/root/ru-front-deploy/RU-FRONT-RUNBOOK.md")
        run(c, "chmod +x /root/ru-front-deploy/setup-ru-front.sh")

        cert_tar = os.environ.get("CERT_SRC_TAR_LOCAL", "")
        if cert_tar and Path(cert_tar).is_file():
            sftp_put(c, Path(cert_tar), "/tmp/le-certs.tgz")
            env_cert = "CERT_SRC_TAR=/tmp/le-certs.tgz"
        else:
            env_cert = ""

        code, _, _ = run(
            c,
            f"cd /root/ru-front-deploy && DOMAIN={DOMAIN} UPSTREAM_IP={UPSTREAM} SITE_SRC=/root/ru-front-deploy/ru-front-nginx.conf.example {env_cert} bash setup-ru-front.sh",
            timeout=600,
        )
        if code != 0:
            raise SystemExit(f"setup-ru-front failed: {code}")

        # upstream check already in script; extra API check via RU proxy after reload
        time.sleep(1)
        run(
            c,
            f"curl -skI -m 15 -A Happ -H 'Host: {DOMAIN}' https://127.0.0.1/api/health | tr -d '\\r' | head -15",
        )
    finally:
        c.close()


if __name__ == "__main__":
    main()
