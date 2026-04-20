import { listDeployedServers, updateServer, type ServerRow } from "./db.js";
import { detectXrayConfigPath, sshReadRemoteFile, type SshConfig, type SshLog } from "./ssh.js";
import { extractVlessLinkHintsFromConfig } from "./vlessLinkHints.js";

const REFRESH_MIN_MS = 45_000;
let lastRefreshAttemptMs = 0;
let inflight: Promise<void> | null = null;

function sshCfg(row: ServerRow): SshConfig {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

function hasUsableHints(row: ServerRow): boolean {
  const sec = String(row.sub_security ?? "").trim().toLowerCase();
  if (!sec) return false;
  if (sec === "reality") {
    return Boolean(String(row.sub_reality_pbk ?? "").trim() && String(row.sub_sni ?? "").trim());
  }
  if (sec === "tls") {
    return Boolean(String(row.sub_sni ?? "").trim());
  }
  return true;
}

function hasAnyExtractedHints(h: ReturnType<typeof extractVlessLinkHintsFromConfig>): boolean {
  return Boolean(
    (h.sub_security ?? "").trim() ||
      (h.sub_reality_pbk ?? "").trim() ||
      (h.sub_sni ?? "").trim() ||
      (h.sub_network ?? "").trim(),
  );
}

async function refreshOneServerHints(row: ServerRow, log?: SshLog): Promise<void> {
  let path = row.xray_config_path ?? "";
  const cfg = sshCfg(row);

  if (!path) {
    path = (await detectXrayConfigPath(cfg, log)) ?? "";
  }

  let raw: Buffer | null = null;
  if (path) {
    try {
      raw = await sshReadRemoteFile(cfg, path, log);
    } catch {
      raw = null;
    }
  }

  if (!raw) {
    const detected = (await detectXrayConfigPath(cfg, log)) ?? "";
    if (!detected) return;
    path = detected;
    try {
      raw = await sshReadRemoteFile(cfg, detected, log);
    } catch {
      raw = null;
    }
  }

  if (!raw) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  const hints = extractVlessLinkHintsFromConfig(parsed);
  if (!hasAnyExtractedHints(hints)) return;

  updateServer(row.id, {
    xray_config_path: path || row.xray_config_path,
    sub_network: hints.sub_network,
    sub_security: hints.sub_security,
    sub_type: hints.sub_type,
    sub_host: hints.sub_host,
    sub_path: hints.sub_path,
    sub_sni: hints.sub_sni,
    sub_fp: hints.sub_fp,
    sub_alpn: hints.sub_alpn,
    sub_allow_insecure: hints.sub_allow_insecure,
    sub_reality_pbk: hints.sub_reality_pbk,
    sub_reality_sid: hints.sub_reality_sid,
    sub_reality_spx: hints.sub_reality_spx,
  });
}

/**
 * Автоподтяжка streamSettings-хинтов для подписок.
 * Если sub_* пустые, читаем config xray по SSH и сохраняем подсказки в БД.
 */
export async function refreshMissingSubscriptionHintsIfDue(log?: SshLog): Promise<void> {
  const now = Date.now();
  if (inflight) {
    await inflight.catch(() => {});
    return;
  }
  if (now - lastRefreshAttemptMs < REFRESH_MIN_MS) return;

  const targets = listDeployedServers().filter((s) => !hasUsableHints(s));
  if (targets.length === 0) {
    lastRefreshAttemptMs = now;
    return;
  }

  const job = (async () => {
    for (const row of targets) {
      try {
        await refreshOneServerHints(row, log);
      } catch {
        // ignore per-node failures; keep subscription response available
      }
    }
    lastRefreshAttemptMs = Date.now();
  })();

  inflight = job;
  try {
    await job;
  } finally {
    if (inflight === job) inflight = null;
  }
}

