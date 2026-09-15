/**
 * Учебный пример Testcontainers. Не входит в `npm test` / CI.
 *
 * Нужен Docker (Docker Desktop, Colima, или engine на CI).
 * Запуск из backend/:  npm run test:containers
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import net from "node:net";
import { GenericContainer, type StartedTestContainer } from "testcontainers";

const DOCKER_APP_BIN = "/Applications/Docker.app/Contents/Resources/bin";
if (fs.existsSync(`${DOCKER_APP_BIN}/docker`)) {
  process.env.PATH = `${DOCKER_APP_BIN}:${process.env.PATH ?? ""}`;
}

const DOCKER_CANDIDATES = [
  "docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
  "/usr/local/bin/docker",
];

async function dockerReady(): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  for (const bin of DOCKER_CANDIDATES) {
    try {
      await exec(bin, ["info"], { timeout: 4000 });
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function redisPing(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buf += chunk;
      if (buf.includes("\r\n")) {
        socket.end();
        resolve(buf.trim());
      }
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("redis ping timeout"));
    });
    socket.setTimeout(5000);
    socket.write("PING\r\n");
  });
}

const ready = await dockerReady();

describe.skipIf(!ready)("testcontainers: redis ping", () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  it("mapped port отвечает +PONG", async () => {
    const host = container.getHost();
    const port = container.getMappedPort(6379);
    const reply = await redisPing(host, port);
    expect(reply).toBe("+PONG");
  });
});
