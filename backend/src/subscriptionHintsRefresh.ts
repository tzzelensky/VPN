import { listDeployedServers, updateServer, type ServerRow } from "./db.js";
import { detectXrayConfigPath, sshExecCommand, sshReadRemoteFile, type SshConfig, type SshLog } from "./ssh.js";
import {
  ensureRealityPublicKeyOnHintsFromConfig,
  extractRealityPrivateKeyFromConfig,
  extractVlessLinkHintsFromConfig,
} from "./vlessLinkHints.js";

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

async function deriveRealityPublicKeyFromPrivateOnServer(
  cfg: SshConfig,
  privateKey: string,
  log?: SshLog,
): Promise<string> {
  const qpk = privateKey.replace(/'/g, `'\\''`);
  const script =
    `PATH=/usr/local/bin:/usr/bin:/usr/local/x-ui/bin:$PATH; ` +
    `X=/usr/local/x-ui/bin/xray-linux-amd64; ` +
    `[ ! -x "$X" ] && X=/usr/local/bin/xray; ` +
    `[ ! -x "$X" ] && X=/usr/bin/xray; ` +
    `[ ! -x "$X" ] && X=$(command -v xray 2>/dev/null || true); ` +
    `[ -z "$X" ] && exit 0; ` +
    `"$X" x25519 -i '${qpk}' 2>&1 || true`;
  const r = await sshExecCommand(cfg, `bash -lc ${JSON.stringify(script)}`, log);
  const text = `${r.stdout}\n${r.stderr}`;
  const patterns = [
    /Public key:\s*([A-Za-z0-9_-]{20,})/i,
    /PublicKey:\s*([A-Za-z0-9_-]{20,})/i,
    /^([A-Za-z0-9_-]{40,80})$/m,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  log?.(`x25519: не удалось разобрать public key (фрагмент): ${text.slice(0, 200)}`);
  return "";
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
  const hints = extractVlessLinkHintsFromConfig(parsed, row.vless_port);
  if ((hints.sub_security ?? "").toLowerCase() === "reality" && !hints.sub_reality_pbk) {
    const priv = extractRealityPrivateKeyFromConfig(parsed, row.vless_port);
    if (priv) {
      const pbk = await deriveRealityPublicKeyFromPrivateOnServer(cfg, priv, log);
      if (pbk) hints.sub_reality_pbk = pbk;
    }
    ensureRealityPublicKeyOnHintsFromConfig(parsed, hints, row.vless_port);
  }
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

  const targets = listDeployedServers().filter((s) => !hasUsableHints(s));
  if (targets.length === 0) {
    lastRefreshAttemptMs = now;
    return;
  }

  /** Reality без pbk — клиенты получают security=none; такие запросы нельзя откладывать на 45s. */
  const realityMissingPbk = targets.some(
    (s) =>
      String(s.sub_security ?? "").trim().toLowerCase() === "reality" &&
      !String(s.sub_reality_pbk ?? "").trim(),
  );
  if (!realityMissingPbk && now - lastRefreshAttemptMs < REFRESH_MIN_MS) return;

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

