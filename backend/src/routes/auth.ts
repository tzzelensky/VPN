import { Router } from "express";
import { randomInt } from "node:crypto";
import { sendTelegramMessage } from "../telegram/api.js";

const router = Router();
const LOGIN_2FA_CHAT_ID = 404740026;
const LOGIN_2FA_TTL_MS = 5 * 60_000;
const LOGIN_2FA_MAX_ATTEMPTS = 5;

function build2faCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

async function sendLoginCodeToAdmin(code: string, username: string): Promise<void> {
  const body =
    `Код входа в панель:\n` +
    `${code}\n\n` +
    `Логин: ${username}\n` +
    `Срок действия: 5 минут`;
  await sendTelegramMessage(LOGIN_2FA_CHAT_ID, body);
}

router.post("/login", async (req, res) => {
  const adminUser = process.env.ADMIN_USER ?? "tzadmin";
  const adminPass = process.env.ADMIN_PASSWORD ?? "8mayjkjk";
  const { username, password } = req.body as { username?: string; password?: string };
  if (username === adminUser && password === adminPass) {
    const code = build2faCode();
    try {
      await sendLoginCodeToAdmin(code, adminUser);
    } catch (e) {
      res.status(503).json({ error: "2fa_delivery_failed", detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    req.session.user = undefined;
    req.session.pending_login_2fa = {
      username: adminUser,
      code,
      expires_at: Date.now() + LOGIN_2FA_TTL_MS,
      attempts_left: LOGIN_2FA_MAX_ATTEMPTS,
    };
    res.json({ ok: false, requires_code: true });
    return;
  }
  req.session.pending_login_2fa = undefined;
  res.status(401).json({ error: "invalid_credentials" });
});

router.post("/login/verify", (req, res) => {
  const { code } = req.body as { code?: string };
  const pending = req.session.pending_login_2fa;
  if (!pending) {
    res.status(400).json({ error: "no_pending_2fa" });
    return;
  }
  if (Date.now() > pending.expires_at) {
    req.session.pending_login_2fa = undefined;
    res.status(401).json({ error: "2fa_code_expired" });
    return;
  }
  const got = String(code ?? "").trim();
  if (got !== pending.code) {
    const attemptsLeft = Math.max(0, Number(pending.attempts_left || 0) - 1);
    if (attemptsLeft <= 0) {
      req.session.pending_login_2fa = undefined;
      res.status(401).json({ error: "2fa_code_invalid", attempts_left: 0 });
      return;
    }
    req.session.pending_login_2fa = { ...pending, attempts_left: attemptsLeft };
    res.status(401).json({ error: "2fa_code_invalid", attempts_left: attemptsLeft });
    return;
  }
  req.session.pending_login_2fa = undefined;
  req.session.user = { ok: true };
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/me", (req, res) => {
  res.json({ ok: Boolean(req.session.user?.ok) });
});

export default router;
