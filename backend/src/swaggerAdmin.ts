import express, { type Request, type Response } from "express";
import swaggerUi from "swagger-ui-express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { requireSwaggerBasicAuth } from "./middleware/swaggerBasicAuth.js";

const specPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "openapi", "adminOpenApi.json");

function loadSpec(): Record<string, unknown> {
  return JSON.parse(readFileSync(specPath, "utf8")) as Record<string, unknown>;
}

export function mountAdminSwagger(app: express.Application): void {
  const base = "/panel/swagger/admin";
  const router = express.Router();
  router.use(requireSwaggerBasicAuth);
  router.get("/openapi.json", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(loadSpec());
  });
  router.use(swaggerUi.serve);
  router.get(
    "/",
    swaggerUi.setup(undefined, {
      swaggerOptions: {
        url: `${base}/openapi.json`,
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
      customSiteTitle: "VPN Admin API — Swagger",
      customCss: ".swagger-ui .topbar { display: none }",
    }),
  );
  app.use(base, router);
}
