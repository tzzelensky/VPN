import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getTestApp, resetTestData } from "../helpers/app.js";
import { loginAsAdmin } from "../helpers/auth.js";
import { abortablePost, doubleSubmit } from "../helpers/slowClient.js";
import { listUsers } from "../../src/db.ts";
import { resetUserSyncMocks } from "../helpers/stubs.js";

describe("users slow network / flaky client", () => {
  beforeEach(() => {
    resetTestData();
    resetUserSyncMocks();
  });

  it("client abort during create leaves at most one user for that UUID on retry", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const uuid = randomUUID();

    const first = await abortablePost(agent, "/api/users", { name: "AbortMe", vless_uuid: uuid }, 1);
    // Either aborted or completed — store must be consistent
    const countAfterAbort = listUsers().filter((u) => u.vless_uuid === uuid).length;
    expect(countAfterAbort).toBeLessThanOrEqual(1);

    if (first === "aborted" && countAfterAbort === 0) {
      await agent.post("/api/users").send({ name: "AbortMe", vless_uuid: uuid }).expect(200);
    } else if (countAfterAbort === 1) {
      await agent.post("/api/users").send({ name: "AbortMe", vless_uuid: uuid }).expect(409);
    }

    expect(listUsers().filter((u) => u.vless_uuid === uuid)).toHaveLength(1);
  });

  it("retry after perceived timeout with same UUID does not duplicate", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const uuid = randomUUID();
    await agent.post("/api/users").send({ name: "Retry", vless_uuid: uuid }).expect(200);
    // Client thinks it timed out and retries
    await agent.post("/api/users").send({ name: "Retry", vless_uuid: uuid }).expect(409);
    expect(listUsers().filter((u) => u.vless_uuid === uuid)).toHaveLength(1);
  });

  it("retry with a new UUID creates a second user", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const u1 = randomUUID();
    const u2 = randomUUID();
    await agent.post("/api/users").send({ name: "A", vless_uuid: u1 }).expect(200);
    await agent.post("/api/users").send({ name: "B", vless_uuid: u2 }).expect(200);
    expect(listUsers().filter((u) => u.vless_uuid === u1 || u.vless_uuid === u2)).toHaveLength(2);
  });

  it("parallel DELETE of same id: one ok, rest 404; store consistent", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const created = await agent.post("/api/users").send({ name: "RaceDel" }).expect(200);
    const id = created.body.user.id as number;
    const results = await Promise.all([
      agent.delete(`/api/users/${id}`),
      agent.delete(`/api/users/${id}`),
      agent.delete(`/api/users/${id}`),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 404).length).toBeGreaterThanOrEqual(1);
    expect(listUsers().some((u) => u.id === id)).toBe(false);
  });

  it("double-submit create with same UUID yields one user", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const uuid = randomUUID();
    const [a, b] = await doubleSubmit(agent, "post", "/api/users", { name: "Dup", vless_uuid: uuid });
    expect([a, b].sort()).toEqual([200, 409]);
    expect(listUsers().filter((u) => u.vless_uuid === uuid)).toHaveLength(1);
  });

  it("login cookie remains valid after a slow follow-up", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    await new Promise((r) => setTimeout(r, 50));
    await agent.get("/api/auth/me").expect(200);
    await agent.get("/api/users").expect(200);
  });
});
