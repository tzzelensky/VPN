import type { Request, Response, NextFunction } from "express";

export type SessionUser = { ok: true };

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.user?.ok) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}
