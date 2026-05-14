import { parseXrayApiServerForStatsQuery } from "./xrayStatsPull.js";
import { sshExecCommand, type SshConfig, type SshLog } from "./ssh.js";

export type SpeedLimitRule = { email: string; mbps: number };

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function xrayBinaryDetectScript(): string {
  return [
    'X=""',
    '[ -x /usr/local/bin/xray ] && X=/usr/local/bin/xray',
    '[ -z "$X" ] && [ -x /usr/bin/xray ] && X=/usr/bin/xray',
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray-linux-amd64 ] && X=/usr/local/x-ui/bin/xray-linux-amd64',
    '[ -z "$X" ] && [ -x /usr/local/x-ui/bin/xray ] && X=/usr/local/x-ui/bin/xray',
    '[ -n "$X" ] || { echo "xray binary not found for speed limit" >&2; exit 127; }',
  ].join("; ");
}

/** HTB + statsonlineiplist: лимит по IP активных сессий (Xray не применяет uplinkSpeed/downlinkSpeed). */
export function buildSpeedLimitTcScript(apiServer: string, rules: SpeedLimitRule[]): string {
  const api = shellQuote(apiServer);
  const rulesJson = shellQuote(JSON.stringify(rules));
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    xrayBinaryDetectScript(),
    `API=${api}`,
    `RULES_JSON=${rulesJson}`,
    'command -v tc >/dev/null 2>&1 || { echo "tc not installed, skip speed limit"; exit 0; }',
  'command -v jq >/dev/null 2>&1 || { echo "jq not installed, skip speed limit"; exit 0; }',
    'IFACE=$(ip -4 route get 1.0.0.0 2>/dev/null | sed -n "s/.* dev \\([^ ]*\\).*/\\1/p" | head -1)',
    'IFACE=${IFACE:-$(ip -4 route show default 2>/dev/null | awk "{print \\$5; exit}")}',
    '[ -n "$IFACE" ] || { echo "default iface not found, skip speed limit"; exit 0; }',
    'if ! tc qdisc show dev "$IFACE" | grep -q "qdisc htb"; then',
    '  tc qdisc replace dev "$IFACE" root handle 1: htb default 99',
    '  tc class replace dev "$IFACE" parent 1: classid 1:99 htb rate 10gbit ceil 10gbit',
    "fi",
    'for p in $(seq 40 199); do',
    '  while tc filter del dev "$IFACE" parent 1: prio "$p" 2>/dev/null; do :; done',
    "done",
    'for minor in $(tc class show dev "$IFACE" 2>/dev/null | awk "/class htb 1:1[0-9]{3}/ {print \\$2}" | cut -d: -f2); do',
    '  tc class del dev "$IFACE" classid "1:${minor}" 2>/dev/null || true',
    "done",
    'while IFS= read -r row; do',
    '  [ -n "$row" ] || continue',
    '  email=$(jq -r ".email" <<<"$row")',
    '  mbps=$(jq -r ".mbps" <<<"$row")',
    '  [ -n "$email" ] || continue',
    '  [ "$mbps" -gt 0 ] 2>/dev/null || continue',
    '  json=$("$X" api statsonlineiplist --server="$API" --email="$email" 2>/dev/null || true)',
    '  [ -n "$json" ] || continue',
    '  while IFS= read -r ip; do',
    '    [ -n "$ip" ] || continue',
    '    minor=$((1000 + $(printf "%s" "$ip" | cksum | cut -d" " -f1) % 8000))',
    '    tc class replace dev "$IFACE" parent 1: classid "1:${minor}" htb rate "${mbps}mbit" ceil "${mbps}mbit" burst 64k',
    '    tc filter replace dev "$IFACE" parent 1: protocol ip prio 40 handle "0x${minor}" u32 match ip dst "$ip/32" flowid "1:${minor}"',
    '    tc filter replace dev "$IFACE" parent 1: protocol ip prio 41 handle "0x${minor}1" u32 match ip src "$ip/32" flowid "1:${minor}"',
    '  done < <(jq -r ".ips | keys[]?" <<<"$json")',
    "done < <(jq -c '.[]' <<<\"$RULES_JSON\")",
    'echo "speed limits applied on $IFACE"',
  ].join("\n");
}

export async function enforceSpeedLimitsOnServer(
  cfg: SshConfig,
  config: Record<string, unknown>,
  rules: SpeedLimitRule[],
  log?: SshLog,
): Promise<void> {
  const active = rules
    .map((r) => ({ email: String(r.email ?? "").trim(), mbps: Math.floor(Number(r.mbps) || 0) }))
    .filter((r) => r.email && r.mbps > 0);
  if (active.length === 0) return;
  const apiServer = parseXrayApiServerForStatsQuery(config);
  if (!apiServer) {
    log?.("Лимит скорости: API Xray недоступен, пропуск tc.");
    return;
  }
  const script = buildSpeedLimitTcScript(apiServer, active);
  const r = await sshExecCommand(cfg, script, log);
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout || "").trim();
    log?.(`Лимит скорости (tc): ${detail || `exit ${r.code}`}`);
    return;
  }
  const msg = (r.stdout || "").trim();
  if (msg) log?.(msg);
}
