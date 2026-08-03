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

export async function detectFirewallKind(cfg: SshConfig): Promise<FirewallKind> {
  const ufw = await sshExecCommand(cfg, "command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | head -1 || true");
  if (/Status:/i.test(ufw.stdout)) return "ufw";

  const fw = await sshExecCommand(
    cfg,
    "command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null || true",
  );
  if (/running/i.test(fw.stdout)) return "firewalld";

  const nft = await sshExecCommand(cfg, "command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | head -1 || true");
  if (nft.stdout.trim().length > 2) return "nftables";

  const ipt = await sshExecCommand(cfg, "command -v iptables >/dev/null 2>&1 && iptables -L INPUT -n 2>/dev/null | head -3 || true");
  if (ipt.stdout.trim().length > 2) return "iptables";

  return "none";
}

function manualCommand(kind: FirewallKind, port: number, proto: "tcp" | "udp"): string | null {
  switch (kind) {
    case "ufw":
      return `sudo ufw allow ${port}/${proto}`;
    case "firewalld":
      return `sudo firewall-cmd --permanent --add-port=${port}/${proto} && sudo firewall-cmd --reload`;
    case "iptables":
      return `sudo iptables -I INPUT -p ${proto} --dport ${port} -j ACCEPT`;
    case "nftables":
      return `sudo nft add rule inet filter input ${proto} dport ${port} accept`;
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

async function tryOpenFirewallPortProto(
  cfg: SshConfig,
  port: number,
  proto: "tcp" | "udp",
): Promise<FirewallOpenResult> {
  const kind = await detectFirewallKind(cfg);
  const cloud_security_group_hint = CLOUD_HINT(port, proto);

  if (kind === "none" || kind === "unknown") {
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

  const run = await sshExecCommand(cfg, `sudo -n ${cmd.replace(/^sudo /, "")} 2>&1 || ${cmd} 2>&1`);
  const out = `${run.stdout}\n${run.stderr}`.trim();
  const ok = run.code === 0 || /skipping|already|exists|success/i.test(out);

  if (kind === "ufw") alreadyOpen = await isPortAllowedUfw(cfg, port, proto);
  if (kind === "firewalld") alreadyOpen = await isPortAllowedFirewalld(cfg, port, proto);

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
