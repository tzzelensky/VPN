import type { Request, Response, NextFunction } from "express";

function adminCredentials(): { user: string; pass: string } {
  return {
    user: process.env.ADMIN_USER ?? "tzadmin",
    pass: process.env.ADMIN_PASSWORD ?? "8mayjkjk",
  };
}

export function requireSwaggerBasicAuth(req: Request, res: Response, next: NextFunction): void {
  const { user: adminUser, pass: adminPass } = adminCredentials();
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin API Swagger", charset="UTF-8"');
    res.status(401).type("text/plain; charset=utf-8").send("Требуется авторизация.");
    return;
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
  const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
  if (user === adminUser && pass === adminPass) {
    next();
    return;
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="Admin API Swagger", charset="UTF-8"');
  res.status(401).type("text/plain; charset=utf-8").send("Неверный логин или пароль.");
}
