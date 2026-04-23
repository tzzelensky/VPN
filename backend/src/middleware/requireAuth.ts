import type { Request, Response, NextFunction } from "express";

export type SessionUser = { ok: true };
export type PendingLogin2FA = {
  username: string;
  code: string;
  expires_at: number;
  attempts_left: number;
};

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    pending_login_2fa?: PendingLogin2FA;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.user?.ok) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}
