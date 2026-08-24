import { sshExecCommand, type SshConfig } from "./ssh.js";

export type FirewallKind = "ufw" | "firewalld" | "iptables" | "nftables" | "none" | "unknown";

export type FirewallOpenResult = {
  kind: FirewallKind;
  opened: boolean;
  already_open: boolean;
  detail: string;
  manual_command: string | null;
  cloud_security_group_hint: string | null;
};

const CLOUD_HINT = (port: number, proto: "tcp" | "udp") =>
  `Порт может быть закрыт на уровне панели хостинга/security group. Откройте ${proto.toUpperCase()} ${port} вручную.`;

/** Best-effort: sudo warns/fails when hostname is missing from /etc/hosts (common on cheap VPS). */
async function ensureHostnameResolves(cfg: SshConfig): Promise<void> {
  await sshExecCommand(
    cfg,
    `HN=$(hostname 2>/dev/null || true); ` +
      `if [ -n "$HN" ] && ! getent hosts "$HN" >/dev/null 2>&1; then ` +
      `grep -qE "^127\\.0\\.1\\.1[[:space:]]" /etc/hosts 2>/dev/null ` +
      `&& sed -i "s/^127\\.0\\.1\\.1.*/127.0.1.1\\t$HN/" /etc/hosts ` +
      `|| echo "127.0.1.1\\t$HN" >> /etc/hosts; fi`,
  );
}

export async function detectFirewallKind(cfg: SshConfig): Promise<FirewallKind> {
  // Prefer ufw whenever the binary exists — even if inactive (we can enable rules).
  const ufwBin = await sshExecCommand(cfg, "command -v ufw >/dev/null 2>&1 && echo yes || true");
  if (ufwBin.stdout.includes("yes")) {
    return "ufw";
  }

  const fw = await sshExecCommand(
    cfg,
    "command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null || true",
  );
  if (/running/i.test(fw.stdout)) return "firewalld";

  // Debian often has iptables-nft: `nft list tables` shows ip/ip6 filter, but there is no
  // `inet filter` table — raw `nft add rule inet filter …` fails. Prefer iptables then.
  const ipt = await sshExecCommand(
    cfg,
    "command -v iptables >/dev/null 2>&1 && iptables -L INPUT -n 2>/dev/null | head -3 || true",
  );
  if (ipt.stdout.trim().length > 2) return "iptables";

  const nftInet = await sshExecCommand(
    cfg,
    "command -v nft >/dev/null 2>&1 && nft list table inet filter 2>/dev/null | head -1 || true",
  );
  if (nftInet.stdout.trim().length > 2) return "nftables";

  return "none";
}

function manualCommand(kind: FirewallKind, port: number, proto: "tcp" | "udp"): string | null {
  switch (kind) {
    case "ufw":
      return `ufw allow ${port}/${proto}`;
    case "firewalld":
      return `firewall-cmd --permanent --add-port=${port}/${proto} && firewall-cmd --reload`;
    case "iptables":
      return `iptables -I INPUT -p ${proto} --dport ${port} -j ACCEPT`;
    case "nftables":
      return `nft add rule inet filter input ${proto} dport ${port} accept`;
    default:
      return null;
  }
}

async function isPortAllowedUfw(cfg: SshConfig, port: number, proto: "tcp" | "udp"): Promise<boolean> {
  const r = await sshExecCommand(cfg, `ufw status 2>/dev/null | grep -E '${port}/${proto}' || true`);
  if (!r.stdout.trim()) return false;
  return /ALLOW/i.test(r.stdout);
}

async function isPortAllowedFirewalld(cfg: SshConfig, port: number, proto: "tcp" | "udp"): Promise<boolean> {
  const r = await sshExecCommand(
    cfg,
    `firewall-cmd --list-ports 2>/dev/null | grep -w '${port}/${proto}' && echo yes || true`,
  );
  return r.stdout.includes("yes");
}

async function isInputPolicyAccept(cfg: SshConfig): Promise<boolean> {
  const r = await sshExecCommand(cfg, "iptables -L INPUT -n 2>/dev/null | head -1 || true");
  return /policy ACCEPT/i.test(r.stdout);
}

async function runFirewallCmd(cfg: SshConfig, cmd: string): Promise<{ code: number; out: string }> {
  // Root SSH sessions usually need no sudo; keep sudo -n as fallback without hanging on password.
  const run = await sshExecCommand(
    cfg,
    `if [ "$(id -u)" -eq 0 ]; then ${cmd}; else sudo -n ${cmd} 2>/dev/null || sudo ${cmd}; fi 2>&1`,
  );
  return { code: run.code ?? 1, out: `${run.stdout}\n${run.stderr}`.trim() };
}

async function tryOpenFirewallPortProto(
  cfg: SshConfig,
  port: number,
  proto: "tcp" | "udp",
): Promise<FirewallOpenResult> {
  await ensureHostnameResolves(cfg);

  const kind = await detectFirewallKind(cfg);
  const cloud_security_group_hint = CLOUD_HINT(port, proto);

  if (kind === "none" || kind === "unknown") {
    // No host firewall tooling — if INPUT is ACCEPT, port is effectively open on the VM.
    if (await isInputPolicyAccept(cfg)) {
      return {
        kind: "none",
        opened: true,
        already_open: true,
        detail: `На VM нет ufw/firewalld; iptables INPUT policy ACCEPT — порт ${port}/${proto} не фильтруется на хосте.`,
        manual_command: manualCommand("ufw", port, proto),
        cloud_security_group_hint,
      };
    }
    return {
      kind,
      opened: false,
      already_open: false,
      detail: "Активный firewall на сервере не обнаружен (или нет прав на чтение).",
      manual_command: manualCommand("ufw", port, proto),
      cloud_security_group_hint,
    };
  }

  const cmd = manualCommand(kind, port, proto);
  if (!cmd) {
    return {
      kind,
      opened: false,
      already_open: false,
      detail: "Не удалось определить команду для firewall.",
      manual_command: null,
      cloud_security_group_hint,
    };
  }

  let alreadyOpen = false;
  if (kind === "ufw") alreadyOpen = await isPortAllowedUfw(cfg, port, proto);
  if (kind === "firewalld") alreadyOpen = await isPortAllowedFirewalld(cfg, port, proto);

  if (alreadyOpen) {
    return {
      kind,
      opened: true,
      already_open: true,
      detail: `Порт ${port}/${proto} уже разрешён в ${kind}.`,
      manual_command: cmd,
      cloud_security_group_hint,
    };
  }

  let run = await runFirewallCmd(cfg, cmd);
  let out = run.out;
  let ok = run.code === 0 || /skipping|already|exists|success/i.test(out);

  // nft inet filter missing (iptables-nft hosts) → fall back to iptables
  if (!ok && kind === "nftables") {
    const fb = manualCommand("iptables", port, proto)!;
    run = await runFirewallCmd(cfg, fb);
    out = run.out;
    ok = run.code === 0 || /skipping|already|exists|success/i.test(out);
    if (ok) {
      return {
        kind: "iptables",
        opened: true,
        already_open: false,
        detail: `Правило firewall добавлено (iptables fallback, ${proto}).`,
        manual_command: fb,
        cloud_security_group_hint,
      };
    }
  }

  if (kind === "ufw") {
    // Ensure ufw is enabled after adding a rule (inactive ufw still accepts "allow").
    await runFirewallCmd(cfg, "ufw --force enable || true");
    alreadyOpen = await isPortAllowedUfw(cfg, port, proto);
  }
  if (kind === "firewalld") alreadyOpen = await isPortAllowedFirewalld(cfg, port, proto);

  // iptables ACCEPT policy: treat as open even if insert failed oddly
  if (!ok && !alreadyOpen && kind === "iptables" && (await isInputPolicyAccept(cfg))) {
    return {
      kind: "iptables",
      opened: true,
      already_open: true,
      detail: `iptables INPUT policy ACCEPT — порт ${port}/${proto} доступен на хосте.`,
      manual_command: cmd,
      cloud_security_group_hint,
    };
  }

  const opened = ok || alreadyOpen;

  return {
    kind,
    opened,
    already_open: alreadyOpen,
    detail: opened
      ? `Правило firewall добавлено (${kind}, ${proto}).`
      : `Не удалось открыть порт автоматически: ${out.slice(0, 200) || "нет вывода"}`,
    manual_command: cmd,
    cloud_security_group_hint,
  };
}

export async function tryOpenFirewallPort(cfg: SshConfig, port: number): Promise<FirewallOpenResult> {
  return tryOpenFirewallPortProto(cfg, port, "tcp");
}

export async function tryOpenFirewallUdpPort(cfg: SshConfig, port: number): Promise<FirewallOpenResult> {
  return tryOpenFirewallPortProto(cfg, port, "udp");
}
