import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OpenApiOperation = {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  /** Path with `{param}` placeholders from OpenAPI */
  openApiPath: string;
  tags?: string[];
};

type OpenApiDoc = {
  paths?: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        summary?: string;
        tags?: string[];
        security?: unknown[];
      }
    >
  >;
};

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export function loadOpenApiOperations(): OpenApiOperation[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const specPath = path.join(here, "../../src/openapi/adminOpenApi.json");
  const doc = JSON.parse(fs.readFileSync(specPath, "utf8")) as OpenApiDoc;
  const out: OpenApiOperation[] = [];
  for (const [openApiPath, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods ?? {})) {
      if (!METHODS.has(method.toLowerCase())) continue;
      out.push({
        method: method.toUpperCase(),
        path: openApiPathToExpress(openApiPath),
        openApiPath,
        operationId: op.operationId,
        summary: op.summary,
        tags: op.tags,
      });
    }
  }
  return out.sort((a, b) => a.openApiPath.localeCompare(b.openApiPath) || a.method.localeCompare(b.method));
}

/** Convert `/api/users/{id}` → `/api/users/1` with safe placeholders. */
export function openApiPathToExpress(openApiPath: string, params: Record<string, string> = {}): string {
  return openApiPath.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (params[name] != null) return encodeURIComponent(params[name]);
    const n = name.toLowerCase();
    if (n.includes("id")) return "1";
    if (n.includes("token") || n.includes("secret") || n.includes("uuid")) return "test-token";
    if (n.includes("code")) return "TEST";
    return "x";
  });
}

/** Routes that do not require session auth. */
export function isPublicOperation(op: OpenApiOperation): boolean {
  const p = op.openApiPath;
  const m = op.method;
  if (p === "/api/health" && m === "GET") return true;
  if (p.startsWith("/api/public/")) return true;
  if (p === "/comfort" && m === "GET") return true;
  if (p === "/" && m === "GET") return true;
  if (p.startsWith("/api/auth/login")) return true;
  if (p === "/api/auth/webapp-admin-login" && m === "POST") return true;
  if (p === "/api/auth/webapp-admin-check" && m === "POST") return true;
  // Returns {ok:false} with 200 when anonymous
  if (p === "/api/auth/me" && m === "GET") return true;
  // destroy() succeeds even without a session
  if (p === "/api/auth/logout" && m === "POST") return true;
  // Subscription delivery is token-based, not session
  if (p.startsWith("/sub/") || p.startsWith("/goods/") || p.startsWith("/api/sub/") || p.startsWith("/api/subscription/")) {
    return true;
  }
  // Telegram webhook uses secret in path
  if (p.startsWith("/api/telegram/")) return true;
  // Swagger UI / openapi (basic auth, not session)
  if (p.startsWith("/panel/swagger/")) return true;
  return false;
}

/** Documented in OpenAPI but not mounted (or static media) — may 404 instead of 401. */
export function allowsUnauth404(op: OpenApiOperation): boolean {
  const p = op.openApiPath;
  if (p.startsWith("/api/sub-shop") || p.startsWith("/sub-shop")) return true;
  if (p.includes("/whitelist-vault/instruction/photo")) return true;
  return false;
}

/** Skip in authenticated smoke — would invalidate the shared session cookie. */
export function destroysSession(op: OpenApiOperation): boolean {
  return op.method === "POST" && op.openApiPath === "/api/auth/logout";
}

/** Mutations that need real infra — only assert auth gate / no unhandled crash. */
export function isInfraHeavyMutation(op: OpenApiOperation): boolean {
  if (op.method === "GET" || op.method === "HEAD") return false;
  const p = op.openApiPath;
  return (
    (p.includes("/servers/") &&
      (p.includes("deploy") ||
        p.includes("install") ||
        p.includes("xray") ||
        p.includes("hysteria") ||
        p.includes("ssh") ||
        p.includes("reboot") ||
        p.includes("probe") ||
        p.includes("connect-hysteria"))) ||
    p.includes("/settings/https") ||
    p.includes("/settings/updates") ||
    p.includes("/telegram-proxies")
  );
}
