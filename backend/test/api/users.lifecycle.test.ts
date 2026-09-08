import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getTestApp, resetTestData } from "../helpers/app.js";
import { loginAsAdmin } from "../helpers/auth.js";
import { resetUserSyncMocks, userSyncMocks } from "../helpers/stubs.js";
import { createUser, listUsers, updateUserRow } from "../../src/db.ts";

describe("users lifecycle", () => {
  beforeEach(() => {
    resetTestData();
    resetUserSyncMocks();
  });

  it("creates a minimal user and lists it (not test subscription)", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const res = await agent.post("/api/users").send({ name: "Alice" }).expect(200);
    expect(res.body.user).toBeTruthy();
    expect(res.body.user.name).toBe("Alice");
    expect(res.body.user.is_test_subscription).not.toBe(1);
    expect(userSyncMocks().push).toHaveBeenCalled();

    const list = await agent.get("/api/users").expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.some((u: { id: number }) => u.id === res.body.user.id)).toBe(true);
  });

  it("rejects duplicate UUID with 409", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const uuid = randomUUID();
    await agent.post("/api/users").send({ name: "One", vless_uuid: uuid }).expect(200);
    const dup = await agent.post("/api/users").send({ name: "Two", vless_uuid: uuid }).expect(409);
    expect(String(dup.body.error ?? "")).toMatch(/UUID/i);
  });

  it("does not keep two users with the same sub_token", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const token = "shared-sub-token-xyz";
    const a = await agent.post("/api/users").send({ name: "A", sub_token: token }).expect(200);
    const b = await agent.post("/api/users").send({ name: "B", sub_token: token }).expect(200);
    expect(a.body.user.sub_token).toBeTruthy();
    expect(b.body.user.sub_token).toBeTruthy();
    expect(a.body.user.sub_token).not.toBe(b.body.user.sub_token);
  });

  it("deletes an existing user and calls removeUserUuidFromAllServers", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const created = await agent.post("/api/users").send({ name: "ToDelete" }).expect(200);
    const id = created.body.user.id as number;
    const uuid = created.body.user.vless_uuid as string;
    await agent.delete(`/api/users/${id}`).expect(200);
    expect(userSyncMocks().remove).toHaveBeenCalled();
    expect(userSyncMocks().remove.mock.calls.some((c) => c[0] === uuid)).toBe(true);

    const list = await agent.get("/api/users").expect(200);
    expect(list.body.some((u: { id: number }) => u.id === id)).toBe(false);
  });

  it("returns 404 for delete of missing user", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    await agent.delete("/api/users/999999").expect(404);
  });

  it("double-delete: second call is 404", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const created = await agent.post("/api/users").send({ name: "Once" }).expect(200);
    const id = created.body.user.id as number;
    await agent.delete(`/api/users/${id}`).expect(200);
    await agent.delete(`/api/users/${id}`).expect(404);
  });

  it("concurrent create with same UUID: one success, one 409", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const uuid = randomUUID();
    const [s1, s2] = await Promise.all([
      agent.post("/api/users").send({ name: "C1", vless_uuid: uuid }),
      agent.post("/api/users").send({ name: "C2", vless_uuid: uuid }),
    ]);
    const statuses = [s1.status, s2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const withUuid = listUsers().filter((u) => u.vless_uuid === uuid);
    expect(withUuid).toHaveLength(1);
  });

  it("bulk-delete-inactive removes only expired users", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const active = createUser({ name: "Active", expiry_time: Date.now() + 86400_000 });
    const expired = createUser({ name: "Expired", expiry_time: Date.now() - 86400_000 });
    // ensure enable flags
    updateUserRow(active.id, { enable: 1 });
    updateUserRow(expired.id, { enable: 1 });

    const res = await agent
      .post("/api/users/bulk-delete-inactive")
      .send({ user_ids: [active.id, expired.id] })
      .expect(200);
    expect(res.body.ok).toBe(true);
    const ids = new Set(listUsers().map((u) => u.id));
    expect(ids.has(active.id)).toBe(true);
    expect(ids.has(expired.id)).toBe(false);
  });

  it("test-subscriptions delete rejects non-test user id", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const normal = await agent.post("/api/users").send({ name: "Normal" }).expect(200);
    await agent.delete(`/api/subscription-shop/test-subscriptions/${normal.body.user.id}`).expect(404);

    const list = await agent.get("/api/subscription-shop/test-subscriptions").expect(200);
    expect(Array.isArray(list.body.entries)).toBe(true);
  });

  it("lists and deletes a test subscription user", async () => {
    const app = getTestApp();
    const agent = await loginAsAdmin(app);
    const testUser = createUser({
      name: "TestSub",
      is_test_subscription: 1,
      enable: 1,
      expiry_time: Date.now() + 3600_000,
    });
    const listed = await agent.get("/api/subscription-shop/test-subscriptions").expect(200);
    expect(listed.body.entries.some((e: { id: number }) => e.id === testUser.id)).toBe(true);
    const entry = listed.body.entries.find((e: { id: number }) => e.id === testUser.id) as {
      status?: string;
      active?: boolean;
      enable?: number;
      expiry_time?: number;
    };
    expect(entry).toBeTruthy();
    expect(entry.enable === 1 || entry.active === true || entry.status === "active").toBe(true);

    await agent.delete(`/api/subscription-shop/test-subscriptions/${testUser.id}`).expect(200);
    expect(listUsers().some((u) => u.id === testUser.id)).toBe(false);
  });
});
