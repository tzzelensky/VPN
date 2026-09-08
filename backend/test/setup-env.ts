import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vpn-api-test-"));

process.env.DATA_PATH = path.join(dir, "data.json");
process.env.PANEL_SETTINGS_PATH = path.join(dir, "panel_settings.json");
process.env.PANEL_SECRETS_PATH = path.join(dir, "panel_secrets.json");
process.env.ADMIN_USER = "testadmin";
process.env.ADMIN_PASSWORD = "test-password-123";
process.env.SESSION_SECRET = "test-session-secret-for-api-suite";
process.env.APP_SECRET = "test-app-secret-for-api-suite";
process.env.COOKIE_SECURE = "0";
process.env.LOGIN_2FA_DISABLED = "1";
process.env.FRONTEND_ORIGIN = "http://127.0.0.1:5173";
process.env.PORT = "0";
// Ensure no Telegram loops / webhook
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_WEBHOOK_SECRET;
delete process.env.TELEGRAM_POLLING;

fs.mkdirSync(dir, { recursive: true });
// data.json created by initDb()/resetStoreForTests via emptyStore()

(globalThis as { __VPN_TEST_DIR?: string }).__VPN_TEST_DIR = dir;
