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

const CLOUD_HINT = (port: number) =>
  `Порт может быть закрыт на уровне панели хостинга/security group. Откройте TCP ${port} вручную.`;

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

function manualCommand(kind: FirewallKind, port: number): string | null {
  switch (kind) {
    case "ufw":
      return `sudo ufw allow ${port}/tcp`;
    case "firewalld":
      return `sudo firewall-cmd --permanent --add-port=${port}/tcp && sudo firewall-cmd --reload`;
    case "iptables":
      return `sudo iptables -I INPUT -p tcp --dport ${port} -j ACCEPT`;
    case "nftables":
      return `sudo nft add rule inet filter input tcp dport ${port} accept`;
    default:
      return null;
  }
}

async function isPortAllowedUfw(cfg: SshConfig, port: number): Promise<boolean> {
  const r = await sshExecCommand(cfg, `ufw status 2>/dev/null | grep -E '${port}/tcp' || true`);
  if (!r.stdout.trim()) return false;
  return /ALLOW/i.test(r.stdout);
}

async function isPortAllowedFirewalld(cfg: SshConfig, port: number): Promise<boolean> {
  const r = await sshExecCommand(
    cfg,
    `firewall-cmd --list-ports 2>/dev/null | grep -w '${port}/tcp' && echo yes || true`,
  );
  return r.stdout.includes("yes");
}

export async function tryOpenFirewallPort(cfg: SshConfig, port: number): Promise<FirewallOpenResult> {
  const kind = await detectFirewallKind(cfg);
  const cloud_security_group_hint = CLOUD_HINT(port);

  if (kind === "none" || kind === "unknown") {
    return {
      kind,
      opened: false,
      already_open: false,
      detail: "Активный firewall на сервере не обнаружен (или нет прав на чтение).",
      manual_command: manualCommand("ufw", port),
      cloud_security_group_hint,
    };
  }

  const cmd = manualCommand(kind, port);
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
  if (kind === "ufw") alreadyOpen = await isPortAllowedUfw(cfg, port);
  if (kind === "firewalld") alreadyOpen = await isPortAllowedFirewalld(cfg, port);

  if (alreadyOpen) {
    return {
      kind,
      opened: true,
      already_open: true,
      detail: `Порт ${port}/tcp уже разрешён в ${kind}.`,
      manual_command: cmd,
      cloud_security_group_hint,
    };
  }

  const run = await sshExecCommand(cfg, `sudo -n ${cmd.replace(/^sudo /, "")} 2>&1 || ${cmd} 2>&1`);
  const out = `${run.stdout}\n${run.stderr}`.trim();
  const ok = run.code === 0 || /skipping|already|exists|success/i.test(out);

  if (kind === "ufw") alreadyOpen = await isPortAllowedUfw(cfg, port);
  if (kind === "firewalld") alreadyOpen = await isPortAllowedFirewalld(cfg, port);

  const opened = ok || alreadyOpen;

  return {
    kind,
    opened,
    already_open: alreadyOpen,
    detail: opened
      ? `Правило firewall добавлено (${kind}).`
      : `Не удалось открыть порт автоматически: ${out.slice(0, 200) || "нет вывода"}`,
    manual_command: opened ? cmd : cmd,
    cloud_security_group_hint,
  };
}
