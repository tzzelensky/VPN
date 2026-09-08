import request from "supertest";
import type { Express } from "express";

export type AuthedAgent = ReturnType<typeof request.agent>;

export async function loginAsAdmin(app: Express): Promise<AuthedAgent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/login")
    .send({
      username: process.env.ADMIN_USER ?? "testadmin",
      password: process.env.ADMIN_PASSWORD ?? "test-password-123",
    })
    .expect(200);
  if (res.body?.need_2fa) {
    throw new Error("login unexpectedly requires 2FA in tests — set LOGIN_2FA_DISABLED=1");
  }
  if (!res.body?.ok) {
    throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  }
  return agent;
}
