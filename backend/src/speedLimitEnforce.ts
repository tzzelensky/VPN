import { sshExecCommand, type SshConfig, type SshLog } from "./ssh.js";

function buildClearSpeedLimitTcScript(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'command -v tc >/dev/null 2>&1 || { echo "tc not installed, skip speed-limit clear"; exit 0; }',
    'IFACE=$(ip -4 route get 1.0.0.0 2>/dev/null | sed -n "s/.* dev \\([^ ]*\\).*/\\1/p" | head -1)',
    'IFACE=${IFACE:-$(ip -4 route show default 2>/dev/null | awk "{print \\$5; exit}")}',
    '[ -n "$IFACE" ] || { echo "default iface not found, skip speed-limit clear"; exit 0; }',
    'if tc qdisc show dev "$IFACE" | grep -q "qdisc htb"; then',
    '  tc qdisc del dev "$IFACE" root || true',
    '  echo "speed limit htb removed on $IFACE"',
    "else",
    '  echo "no htb qdisc on $IFACE"',
    "fi",
  ].join("\n");
}

/** Снимает HTB, который панель ставила как per-user speed limit. Идемпотентно. */
export async function clearSpeedLimitsOnServer(cfg: SshConfig, log?: SshLog): Promise<void> {
  const r = await sshExecCommand(cfg, buildClearSpeedLimitTcScript(), log);
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout || "").trim();
    log?.(`Снятие лимита скорости (tc): ${detail || `exit ${r.code}`}`);
    return;
  }
  const msg = (r.stdout || "").trim();
  if (msg) log?.(msg);
}
