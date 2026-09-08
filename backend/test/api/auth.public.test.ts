import { beforeEach, describe, expect, it } from "vitest";
import { getTestApp, resetTestData } from "../helpers/app.js";
import { loginAsAdmin } from "../helpers/auth.js";

describe("auth and public", () => {
  beforeEach(() => {
    resetTestData();
  });

  it("GET /api/health is public", async () => {
    const app = getTestApp();
    const res = await (await import("supertest")).default(app).get("/api/health").expect(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects bad password", async () => {
    const app = getTestApp();
    const request = (await import("supertest")).default;
    await request(app)
      .post("/api/auth/login")
      .send({ username: "testadmin", password: "wrong" })
      .expect(401);
  });

  it("me is anonymous then ok after login; logout clears session", async () => {
    const app = getTestApp();
    const request = (await import("supertest")).default;
    const anon = await request(app).get("/api/auth/me").expect(200);
    expect(anon.body.ok).toBe(false);
    const agent = await loginAsAdmin(app);
    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.ok).toBe(true);
    await agent.post("/api/auth/logout").expect(200);
    const after = await agent.get("/api/auth/me").expect(200);
    expect(after.body.ok).toBe(false);
  });
});
