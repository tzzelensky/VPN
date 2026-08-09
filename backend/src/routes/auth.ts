import { Router, type Request } from "express";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getEffectiveTelegramAdminIds, getPanelBotToken, getPanelSettings } from "../panelSettings.js";
import { sendTelegramMessage } from "../telegram/api.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const LOGIN_2FA_TTL_MS = 5 * 60_000;
const LOGIN_2FA_MAX_ATTEMPTS = 5;

function isLogin2faDisabledByEnv(): boolean {
  const v = (process.env.LOGIN_2FA_DISABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function isLogin2faEnabled(): boolean {
  if (isLogin2faDisabledByEnv()) return false;
  // По умолчанию выключено: включается только явным true в настройках.
  if (getPanelSettings().telegram.login2faEnabled !== true) return false;
  // Без токена бота код отправить нельзя — не блокируем вход.
  if (!getPanelBotToken()) return false;
  // Без Admin ID некуда слать код (без фолбэка на чужой Telegram ID).
  if (getEffectiveTelegramAdminIds().length === 0) return false;
  return true;
}

function resolveEnvFilePath(): string {
  const fromEnv = (process.env.DOTENV_CONFIG_PATH ?? "").trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), ".env");
}

function upsertEnvKey(filePath: string, key: string, value: string): void {
  const line = `${key}=${value}`;
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    fs.writeFileSync(filePath, `${line}\n`, { mode: 0o600 });
    return;
  }
  const re = new RegExp(`^${key}=.*$`, "m");
  const next = re.test(raw) ? raw.replace(re, line) : `${raw.replace(/\s*$/, "")}\n${line}\n`;
  fs.writeFileSync(filePath, next, { mode: 0o600 });
}

function completeLogin(req: Request): void {
  req.session.pending_login_2fa = undefined;
  req.session.user = { ok: true };
}

function build2faCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

function resolveLogin2faChatId(): number {
  const id = getEffectiveTelegramAdminIds()[0];
  if (!id) throw new Error("no_telegram_admin_id");
  return id;
}

async function sendLoginCodeToAdmin(code: string, username: string): Promise<void> {
  const body =
    `Код входа в панель:\n` +
    `${code}\n\n` +
    `Логин: ${username}\n` +
    `Срок действия: 5 минут`;
  await sendTelegramMessage(resolveLogin2faChatId(), body);
}

router.post("/login", async (req, res) => {
  const adminUser = process.env.ADMIN_USER ?? "tzadmin";
  const adminPass = process.env.ADMIN_PASSWORD ?? "8mayjkjk";
  const { username, password } = req.body as { username?: string; password?: string };
  if (username === adminUser && password === adminPass) {
    if (!isLogin2faEnabled()) {
      completeLogin(req);
      res.json({ ok: true });
      return;
    }
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

router.post("/change-password", requireAuth, (req, res) => {
  const adminPass = process.env.ADMIN_PASSWORD ?? "8mayjkjk";
  const { oldPassword, newPassword } = req.body as {
    oldPassword?: string;
    newPassword?: string;
  };
  const oldPw = String(oldPassword ?? "");
  const newPw = String(newPassword ?? "");
  if (!oldPw || oldPw !== adminPass) {
    res.status(401).json({ error: "invalid_old_password" });
    return;
  }
  if (newPw.length < 8) {
    res.status(400).json({ error: "password_too_short", min: 8 });
    return;
  }
  if (newPw === oldPw) {
    res.status(400).json({ error: "password_unchanged" });
    return;
  }
  // Не допускаем переносы строк — иначе .env сломается
  if (/[\r\n]/.test(newPw)) {
    res.status(400).json({ error: "password_invalid_chars" });
    return;
  }
  try {
    const envPath = resolveEnvFilePath();
    upsertEnvKey(envPath, "ADMIN_PASSWORD", newPw);
    process.env.ADMIN_PASSWORD = newPw;
  } catch (e) {
    res.status(500).json({
      error: "env_write_failed",
      detail: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

export default router;
