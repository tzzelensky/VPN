import { experimentInboundTag, isExperimentInboundTag, MOBILE_TEST_PORT } from "./experimentTypes.js";
import { sshExecCommand, sshReadRemoteFile, TZADMIN_VLESS_TAG, type SshConfig } from "./ssh.js";
import { resolveConfigPath } from "./userSync.js";
import type { ServerRow, VpnExperimentRow } from "./db.js";

export type PortPlanResult = {
  host: string;
  listen_ip: string;
  requested_port: number;
  experimental_only: boolean;
  port_443_free: boolean;
  port_443_blockers: { tag: string; port: number; protocol: string }[];
  assigned_port: number | null;
  can_use_443: boolean;
  honest_mobile_test_possible: boolean;
  warning: string | null;
  mobile_test_hint: string;
};

export type PortCheckResult = {
  ok: boolean;
  host: string;
  port: number;
  inbound_tag: string | null;
  checks: {
    name: string;
    ok: boolean;
    detail: string;
  }[];
  xray_running: boolean;
  port_listening: boolean;
  inbound_in_config: boolean;
  firewall_hint: string | null;
  diag_status: string;
  diag_status_key: string;
  diag_has_incoming: boolean;
  diag_has_accepted: boolean;
  diag_has_handshake_fail: boolean;
  cloud_security_group_hint: string | null;
};

function sshCfg(row: ServerRow): SshConfig {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

export async function readRemoteInbounds(row: ServerRow): Promise<{
  configPath: string;
  inbounds: Record<string, unknown>[];
  configValid: boolean;
}> {
  const configPath = await resolveConfigPath(row);
  try {
    const raw = await sshReadRemoteFile(sshCfg(row), configPath);
    const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const inbounds = Array.isArray(parsed.inbounds) ? (parsed.inbounds as Record<string, unknown>[]) : [];
    return { configPath, inbounds, configValid: true };
  } catch {
    return { configPath, inbounds: [], configValid: false };
  }
}

function blockersOnPort(inbounds: Record<string, unknown>[], port: number, exceptTag?: string): PortPlanResult["port_443_blockers"] {
  const out: PortPlanResult["port_443_blockers"] = [];
  for (const ib of inbounds) {
    const p = Number(ib.port);
    if (p !== port) continue;
    const tag = String(ib.tag ?? "");
    if (exceptTag && tag === exceptTag) continue;
    out.push({
      tag: tag || "(без тега)",
      port: p,
      protocol: String(ib.protocol ?? "").toLowerCase(),
    });
  }
  return out;
}

export async function buildPortPlan(
  row: ServerRow,
  requestedPort = MOBILE_TEST_PORT,
): Promise<PortPlanResult> {
  const experimentalOnly = row.experimental_only === 1;
  const { inbounds } = await readRemoteInbounds(row);
  const blockers = blockersOnPort(inbounds, MOBILE_TEST_PORT);
  const port443Free = blockers.length === 0;

  const mobileHint =
    "Честный мобильный тест — только порт 443. Если 443 занят рабочими inbound на этом IP, нужны: отдельный тестовый сервер, дополнительный IP или SNI routing / reverse proxy. Нельзя поднять второй рабочий inbound на том же IP:443 без архитектуры.";

  let warning: string | null = null;
  let assigned: number | null = null;
  let can443 = port443Free;
  let honest = port443Free && experimentalOnly;

  if (!port443Free) {
    const tags = blockers.map((b) => b.tag).join(", ");
    warning = `Порт 443 занят: ${tags}. Для честного мобильного теста освободите 443 или используйте сервер «только для экспериментов».`;
    if (experimentalOnly) {
      assigned = null;
      can443 = false;
      honest = false;
    } else if (requestedPort !== MOBILE_TEST_PORT) {
      assigned = requestedPort;
      warning =
        "Этот порт может блокироваться мобильными операторами. Для честного теста нужен 443.";
    } else {
      assigned = null;
      can443 = false;
      honest = false;
    }
  } else {
    assigned = MOBILE_TEST_PORT;
    honest = true;
    if (requestedPort !== MOBILE_TEST_PORT && !experimentalOnly) {
      warning =
        "Этот порт может блокироваться мобильными операторами. Для честного теста нужен 443.";
      assigned = requestedPort;
      honest = false;
    }
  }

  return {
    host: row.host,
    listen_ip: row.host,
    requested_port: requestedPort,
    experimental_only: experimentalOnly,
    port_443_free: port443Free,
    port_443_blockers: blockers,
    assigned_port: assigned,
    can_use_443: can443,
    honest_mobile_test_possible: honest,
    warning,
    mobile_test_hint: mobileHint,
  };
}

export async function checkExperimentPort(
  row: ServerRow,
  exp: Pick<VpnExperimentRow, "id" | "port" | "inbound_tag" | "config_path">,
): Promise<PortCheckResult> {
  const cfg = sshCfg(row);
  const port = exp.port;
  const tag = exp.inbound_tag || experimentInboundTag(exp.id);
  const checks: PortCheckResult["checks"] = [];

  const { configPath, inbounds, configValid } = await readRemoteInbounds(row);
  checks.push({
    name: "config_json",
    ok: configValid,
    detail: configValid ? `Конфиг ${configPath} читается` : "Не удалось прочитать/разобрать JSON",
  });

  const ib = inbounds.find((x) => String(x.tag ?? "") === tag);
  const inboundOk = Boolean(ib) && Number(ib?.port) === port;
  checks.push({
    name: "inbound_in_config",
    ok: inboundOk,
    detail: inboundOk ? `Inbound ${tag} на порту ${port}` : `Inbound ${tag} не найден или другой порт`,
  });

  const xrayTz = await sshExecCommand(cfg, "systemctl is-active tzadmin-xray 2>/dev/null || echo inactive");
  const xrayStd = await sshExecCommand(cfg, "systemctl is-active xray 2>/dev/null || echo inactive");
  const xrayProc = await sshExecCommand(
    cfg,
    "pgrep -x xray >/dev/null 2>&1 && echo yes || pgrep -f xray-linux-amd64 >/dev/null 2>&1 && echo yes || echo no",
  );
  const xrayRunning =
    xrayTz.stdout.trim() === "active" || xrayStd.stdout.trim() === "active" || xrayProc.stdout.includes("yes");
  checks.push({
    name: "xray_running",
    ok: xrayRunning,
    detail: xrayRunning ? "Xray/tzadmin-xray запущен" : "Процесс Xray не найден",
  });

  const ss = await sshExecCommand(cfg, `ss -lntp 2>/dev/null | grep -E ':${port}([^0-9]|$)' || true`);
  const listenLines = ss.stdout.trim().split(/\n/).filter(Boolean);
  const portListening = listenLines.some((l) => l.includes(`:${port}`));
  checks.push({
    name: "port_listening",
    ok: portListening,
    detail: portListening
      ? listenLines.slice(0, 2).join("; ") || `Порт ${port} слушается`
      : `Порт ${port} не слушается (ss)`,
  });

  const conflict = blockersOnPort(inbounds, port, tag);
  const noConflict = conflict.length === 0;
  checks.push({
    name: "inbound_no_conflict",
    ok: noConflict,
    detail: noConflict
      ? "Нет другого inbound на этом порту"
      : `Конфликт: ${conflict.map((c) => c.tag).join(", ")}`,
  });

  const prodOn443 = inbounds.some(
    (x) => Number(x.port) === port && String(x.tag ?? "") === TZADMIN_VLESS_TAG,
  );
  if (prodOn443) {
    checks.push({
      name: "prod_separation",
      ok: false,
      detail: "На 443 уже есть рабочий tzadmin-vless — честный тест на этом IP невозможен",
    });
  }

  const ufw = await sshExecCommand(cfg, `ufw status 2>/dev/null | grep -E '${port}/tcp' || true`);
  let firewallHint: string | null = null;
  if (ufw.stdout.trim()) {
    const allowed = /ALLOW/i.test(ufw.stdout);
    checks.push({
      name: "ufw",
      ok: allowed,
      detail: ufw.stdout.trim().slice(0, 120),
    });
    if (!allowed) firewallHint = "UFW может блокировать порт — выполните: sudo ufw allow " + port + "/tcp";
  }

  const fwld = await sshExecCommand(
    cfg,
    `firewall-cmd --list-ports 2>/dev/null | grep -w '${port}/tcp' && echo ok || true`,
  );
  if (fwld.stdout.includes("ok") || (await sshExecCommand(cfg, "command -v firewall-cmd >/dev/null 2>&1")).code === 0) {
    const allowed = fwld.stdout.includes("ok");
    if ((await sshExecCommand(cfg, "firewall-cmd --state 2>/dev/null")).stdout.includes("running")) {
      checks.push({
        name: "firewalld",
        ok: allowed,
        detail: allowed ? `Порт ${port}/tcp открыт` : `Порт ${port}/tcp не в firewall-cmd --list-ports`,
      });
      if (!allowed) {
        firewallHint =
          firewallHint ??
          `firewalld: sudo firewall-cmd --permanent --add-port=${port}/tcp && sudo firewall-cmd --reload`;
      }
    }
  }

  const docker = await sshExecCommand(
    cfg,
    "command -v docker >/dev/null 2>&1 && docker ps --format '{{.Ports}}' 2>/dev/null | grep -E '" +
      port +
      "' || true",
  );
  if (docker.stdout.trim()) {
    checks.push({
      name: "docker_ports",
      ok: true,
      detail: `Docker: ${docker.stdout.trim().slice(0, 100)} — убедитесь, что порт проброшен наружу`,
    });
  }

  const ok = checks.every((c) => c.ok);
  const cloudHint = `Порт может быть закрыт на уровне панели хостинга/security group. Откройте TCP ${port} вручную.`;

  return {
    ok,
    host: row.host,
    port,
    inbound_tag: tag,
    checks,
    xray_running: xrayRunning,
    port_listening: portListening,
    inbound_in_config: inboundOk,
    firewall_hint: firewallHint,
    diag_status: "",
    diag_status_key: "",
    diag_has_incoming: false,
    diag_has_accepted: false,
    diag_has_handshake_fail: false,
    cloud_security_group_hint: cloudHint,
  };
}

export function portWarningIfNot443(port: number): string | null {
  if (port === MOBILE_TEST_PORT) return null;
  return "Этот порт может блокироваться мобильными операторами. Для честного теста нужен 443.";
}
