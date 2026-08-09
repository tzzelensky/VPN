import { Router } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { requireAuth } from "../middleware/requireAuth.js";

const execFileAsync = promisify(execFile);
const router = Router();
router.use(requireAuth);

function resolveAppRoot(): string {
  const fromEnv = (process.env.APP_ROOT ?? "").trim();
  if (fromEnv) return fromEnv;
  const cwd = process.cwd();
  const parent = path.dirname(cwd);
  if (fs.existsSync(path.join(parent, "frontend")) || fs.existsSync(path.join(parent, "scripts"))) {
    return parent;
  }
  return parent;
}

function domainFromUrl(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s.includes("://") ? s : `http://${s}`);
    return u.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function resolveDomain(reqHost?: string, bodyDomain?: string): string {
  const fromBody = domainFromUrl(String(bodyDomain ?? ""));
  if (fromBody) return fromBody;
  const fromEnv =
    domainFromUrl(process.env.FRONTEND_ORIGIN ?? "") ||
    domainFromUrl(process.env.PUBLIC_API_URL ?? "");
  if (fromEnv) return fromEnv;
  const host = String(reqHost ?? "")
    .split(":")[0]
    ?.trim()
    .toLowerCase();
  if (host && host !== "localhost" && host !== "127.0.0.1") return host;
  return "";
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function certExists(domain: string): boolean {
  if (!domain) return false;
  return fs.existsSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`);
}

function httpsConfiguredInEnv(): boolean {
  const fo = (process.env.FRONTEND_ORIGIN ?? "").trim().toLowerCase();
  const pu = (process.env.PUBLIC_API_URL ?? "").trim().toLowerCase();
  return fo.startsWith("https://") || pu.startsWith("https://");
}

router.get("/status", (req, res) => {
  const domain = resolveDomain(req.get("x-forwarded-host") ?? req.get("host") ?? undefined);
  const cert = certExists(domain);
  const envHttps = httpsConfiguredInEnv();
  const proto = String(req.get("x-forwarded-proto") ?? req.protocol ?? "").toLowerCase();
  const requestHttps = proto === "https" || req.secure === true;
  // Считаем «включённым» только если запрос уже идёт по HTTPS (или есть и серт, и env).
  const httpsEnabled = requestHttps || (cert && envHttps);
  // Кнопку показываем, пока пользователь открыл панель по HTTP — можно подключить/починить.
  const canEnable = Boolean(domain) && !isIpLiteral(domain) && !requestHttps;

  res.json({
    ok: true,
    domain: domain || null,
    httpsEnabled,
    certExists: cert,
    envHttps,
    requestHttps,
    canEnable,
    httpsUrl: domain ? `https://${domain}` : null,
    httpUrl: domain ? `http://${domain}` : null,
    message: httpsEnabled
      ? "HTTPS уже активен (или сертификат установлен)."
      : canEnable
        ? `Можно подключить HTTPS для ${domain}.`
        : domain
          ? "Для HTTPS нужен домен (не IP)."
          : "Не удалось определить домен панели.",
  });
});

router.post("/enable", async (req, res) => {
  const domain = resolveDomain(
    req.get("x-forwarded-host") ?? req.get("host") ?? undefined,
    (req.body as { domain?: string } | undefined)?.domain,
  );
  if (!domain) {
    res.status(400).json({ error: "domain_required", message: "Не указан домен." });
    return;
  }
  if (isIpLiteral(domain)) {
    res.status(400).json({
      error: "domain_is_ip",
      message: "HTTPS работает только с доменом, не с IP.",
    });
    return;
  }

  const appRoot = resolveAppRoot();
  const scriptPath = path.join(appRoot, "scripts", "enable-https.sh");
  if (!fs.existsSync(scriptPath)) {
    res.status(500).json({
      error: "script_missing",
      message: `Не найден ${scriptPath}. Обновите панель (git pull) и повторите.`,
    });
    return;
  }

  try {
    fs.chmodSync(scriptPath, 0o755);
  } catch {
    /* ignore */
  }

  const run = async (cmd: string, args: string[]) => {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 8 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    });
    return `${stdout ?? ""}${stderr ?? ""}`.trim();
  };

  try {
    let out = "";
    try {
      out = await run("sudo", [
        "-n",
        scriptPath,
        "--domain",
        domain,
        "--app-root",
        appRoot,
      ]);
    } catch (e1) {
      try {
        out = await run(scriptPath, ["--domain", domain, "--app-root", appRoot]);
      } catch (e2) {
        const detail =
          (e1 instanceof Error ? e1.message : String(e1)) +
          " | " +
          (e2 instanceof Error ? e2.message : String(e2));
        res.status(500).json({
          error: "https_enable_failed",
          message:
            "Не удалось включить HTTPS. Нужен sudo без пароля на scripts/enable-https.sh (ставится install.sh) и открытый порт 80.",
          detail: detail.slice(0, 2000),
        });
        return;
      }
    }

    const httpsUrl = `https://${domain}`;
    // Обновим process.env для текущего процесса до рестарта (на всякий)
    process.env.FRONTEND_ORIGIN = httpsUrl;
    process.env.PUBLIC_API_URL = httpsUrl;
    process.env.COOKIE_SECURE = "auto";

    res.json({
      ok: true,
      domain,
      httpsUrl,
      message: `HTTPS подключён: ${httpsUrl}`,
      log: out.slice(-4000),
      restarting: true,
    });
  } catch (e) {
    res.status(500).json({
      error: "https_enable_failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }
});

export default router;
