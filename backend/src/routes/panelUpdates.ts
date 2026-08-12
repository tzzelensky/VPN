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
  // WorkingDirectory systemd = …/backend
  const cwd = process.cwd();
  const parent = path.dirname(cwd);
  if (fs.existsSync(path.join(parent, ".git")) || fs.existsSync(path.join(parent, "frontend"))) {
    return parent;
  }
  if (fs.existsSync(path.join(cwd, ".git"))) return cwd;
  return parent;
}

function readFrontendPanelVersion(appRoot: string): string {
  const file = path.join(appRoot, "frontend", "src", "panelVersion.ts");
  try {
    const text = fs.readFileSync(file, "utf8");
    const major = /PANEL_VERSION_MAJOR\s*=\s*(\d+)/.exec(text)?.[1];
    const minor = /PANEL_VERSION_MINOR\s*=\s*(\d+)/.exec(text)?.[1];
    if (major && minor) return `${major}.${minor}`;
  } catch {
    /* ignore */
  }
  return process.env.npm_package_version ?? "1.0.0";
}

/** Файлы, которые npm run build меняет локально и блокируют git pull на VPS. */
const UPDATE_DISCARD_PATHS = [
  "backend/src/openapi/adminOpenApi.json",
  "frontend/tsconfig.tsbuildinfo",
];

async function discardLocalChangesForUpdate(appRoot: string): Promise<void> {
  const existing = UPDATE_DISCARD_PATHS.filter((rel) => fs.existsSync(path.join(appRoot, rel)));
  if (existing.length === 0) return;
  try {
    await git(appRoot, ["restore", "--source=HEAD", "--", ...existing]);
    return;
  } catch {
    /* git restore недоступен на старых git */
  }
  for (const rel of existing) {
    try {
      await git(appRoot, ["checkout", "--", rel]);
    } catch {
      /* ignore */
    }
  }
}

async function git(appRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: appRoot,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return String(stdout ?? "").trim();
}

function hasGitRepo(appRoot: string): boolean {
  return fs.existsSync(path.join(appRoot, ".git"));
}

router.get("/check", async (_req, res) => {
  const appRoot = resolveAppRoot();
  const currentVersion = readFrontendPanelVersion(appRoot);
  if (!hasGitRepo(appRoot)) {
    res.json({
      ok: true,
      gitAvailable: false,
      updateAvailable: false,
      localSha: null,
      remoteSha: null,
      behindCount: 0,
      branch: null,
      currentVersion,
      message: "Обновление через git недоступно (каталог не является git-клоном).",
    });
    return;
  }
  try {
    const branch =
      (await git(appRoot, ["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
    await git(appRoot, ["fetch", "--prune", "origin"]);
    const localSha = await git(appRoot, ["rev-parse", "HEAD"]);
    let remoteSha = "";
    try {
      remoteSha = await git(appRoot, ["rev-parse", `origin/${branch}`]);
    } catch {
      remoteSha = await git(appRoot, ["rev-parse", "origin/main"]);
    }
    const behindRaw = await git(appRoot, [
      "rev-list",
      "--count",
      `HEAD..origin/${branch}`,
    ]).catch(async () => git(appRoot, ["rev-list", "--count", "HEAD..origin/main"]));
    const behindCount = Math.max(0, Number(behindRaw) || 0);
    res.json({
      ok: true,
      gitAvailable: true,
      updateAvailable: behindCount > 0,
      localSha: localSha.slice(0, 12),
      remoteSha: remoteSha.slice(0, 12),
      behindCount,
      branch,
      currentVersion,
      message:
        behindCount > 0
          ? `Доступно обновлений: ${behindCount}`
          : "Установлена актуальная версия.",
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      gitAvailable: true,
      updateAvailable: false,
      localSha: null,
      remoteSha: null,
      behindCount: 0,
      branch: null,
      currentVersion,
      error: "update_check_failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }
});

router.post("/apply", async (_req, res) => {
  const appRoot = resolveAppRoot();
  if (!hasGitRepo(appRoot)) {
    res.status(400).json({
      error: "git_unavailable",
      message: "Обновление через git недоступно.",
    });
    return;
  }
  try {
    const branch =
      (await git(appRoot, ["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
    await git(appRoot, ["fetch", "--prune", "origin"]);
    const behindRaw = await git(appRoot, [
      "rev-list",
      "--count",
      `HEAD..origin/${branch}`,
    ]).catch(async () => git(appRoot, ["rev-list", "--count", "HEAD..origin/main"]));
    const behindCount = Math.max(0, Number(behindRaw) || 0);
    if (behindCount <= 0) {
      res.status(400).json({ error: "already_up_to_date", message: "Обновлений нет." });
      return;
    }

    await discardLocalChangesForUpdate(appRoot);

    await git(appRoot, ["pull", "--ff-only", "origin", branch]).catch(async () =>
      git(appRoot, ["pull", "--ff-only", "origin", "main"]),
    );

    const newVersion = readFrontendPanelVersion(appRoot);
    res.json({
      ok: true,
      behindApplied: behindCount,
      currentVersion: newVersion,
      message: "Обновление скачано. Идёт сборка и перезапуск…",
      restarting: true,
    });

    void runUpdateBuildAndRestart(appRoot).catch((e) => {
      console.error("[panel-update] background apply failed:", e instanceof Error ? e.message : e);
    });
  } catch (e) {
    res.status(500).json({
      error: "update_apply_failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }
});

async function runUpdateBuildAndRestart(appRoot: string): Promise<void> {
  const runNpm = async (subdir: string) => {
    await execFileAsync(
      "bash",
      ["-lc", `cd '${appRoot}/${subdir}' && npm ci && npm run build`],
      {
        timeout: 15 * 60_000,
        maxBuffer: 16 * 1024 * 1024,
        env: process.env,
      },
    );
  };
  await runNpm("backend");
  await runNpm("frontend");
  await new Promise<void>((resolve) => {
    execFile(
      "bash",
      [
        "-lc",
        "sudo -n /bin/systemctl restart vpn-admin-api 2>/dev/null || sudo -n /usr/bin/systemctl restart vpn-admin-api 2>/dev/null || true",
      ],
      { timeout: 30_000 },
      (err) => {
        if (err) console.error("[panel-update] restart failed:", err.message);
        resolve();
      },
    );
  });
}

export default router;
