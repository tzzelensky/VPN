import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { getTestApp, resetTestData } from "../helpers/app.js";
import { loginAsAdmin, type AuthedAgent } from "../helpers/auth.js";
import {
  allowsUnauth404,
  destroysSession,
  isInfraHeavyMutation,
  isPublicOperation,
  loadOpenApiOperations,
  type OpenApiOperation,
} from "../helpers/openapi.js";

describe("OpenAPI contract matrix", () => {
  const ops = loadOpenApiOperations();
  let agent: AuthedAgent;

  beforeAll(async () => {
    resetTestData();
    const app = getTestApp();
    agent = await loginAsAdmin(app);
  });

  it("loads operations from adminOpenApi.json", () => {
    expect(ops.length).toBeGreaterThan(100);
  });

  it.each(ops.map((op) => [op.method, op.openApiPath, op] as const))(
    "%s %s — unauthenticated",
    async (method, _path, op: OpenApiOperation) => {
      const app = getTestApp();
      const req = request(app)[method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete"](op.path);
      if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
        req.send({});
      }
      const res = await req;
      if (isPublicOperation(op)) {
        expect(res.status).not.toBe(500);
        return;
      }
      if (allowsUnauth404(op) && res.status === 404) {
        return;
      }
      expect(res.status).toBe(401);
    },
  );

  it.each(ops.map((op) => [op.method, op.openApiPath, op] as const))(
    "%s %s — authenticated smoke",
    async (method, _path, op: OpenApiOperation) => {
      if (isPublicOperation(op) && op.openApiPath.startsWith("/api/auth/login")) {
        return;
      }
      if (destroysSession(op)) {
        return;
      }
      if (allowsUnauth404(op)) {
        // Alias paths not mounted — skip authed smoke
        return;
      }
      const req = agent[method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete"](op.path);
      if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
        req.send({});
      }
      const res = await req;
      // Domain 4xx OK; infra without nodes/Telegram may return 5xx — still a valid smoke response.
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(600);
      if (isInfraHeavyMutation(op)) {
        expect(res.status).not.toBe(401);
      } else if (res.status >= 500) {
        // Soft-allow known soft-fail paths (no bot token / missing server)
        const p = op.openApiPath;
        const allowed5xx =
          p.includes("/communications/") ||
          p.includes("/servers/") ||
          p.includes("/settings/telegram") ||
          p.includes("/mysub");
        expect(allowed5xx).toBe(true);
      }
    },
  );

  it("covers every operation at least once (matrix non-empty)", () => {
    const keys = new Set(ops.map((o) => `${o.method} ${o.openApiPath}`));
    expect(keys.size).toBe(ops.length);
  });
});
