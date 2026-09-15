
from __future__ import annotations

import os
import socket
import subprocess
from pathlib import Path

import pytest

DOCKER_APP_BIN = "/Applications/Docker.app/Contents/Resources/bin"
if Path(f"{DOCKER_APP_BIN}/docker").is_file():
    os.environ["PATH"] = f"{DOCKER_APP_BIN}:{os.environ.get('PATH', '')}"

DOCKER_CANDIDATES = (
    "docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
    "/usr/local/bin/docker",
)


def docker_ready() -> bool:
    for bin_path in DOCKER_CANDIDATES:
        try:
            subprocess.run(
                [bin_path, "info"],
                check=True,
                capture_output=True,
                timeout=4,
            )
            return True
        except (OSError, subprocess.SubprocessError):
            continue
    return False


def redis_ping(host: str, port: int, timeout: float = 5.0) -> str:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(b"PING\r\n")
        sock.settimeout(timeout)
        buf = b""
        while b"\r\n" not in buf:
            chunk = sock.recv(64)
            if not chunk:
                break
            buf += chunk
    return buf.decode("utf-8").strip()


@pytest.mark.skipif(not docker_ready(), reason="Docker недоступен")
def test_mapped_port_replies_pong() -> None:
    from testcontainers.core.container import DockerContainer
    from testcontainers.core.wait_strategies import LogMessageWaitStrategy

    wait = LogMessageWaitStrategy("Ready to accept connections").with_startup_timeout(60)
    with (
        DockerContainer("redis:7-alpine")
        .with_exposed_ports(6379)
        .waiting_for(wait)
    ) as container:
        host = container.get_container_host_ip()
        port = int(container.get_exposed_port(6379))
        assert redis_ping(host, port) == "+PONG"
