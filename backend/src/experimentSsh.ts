import {
  applyExperimentRoutingDns,
  buildExperimentInbound,
  collectOccupiedPorts,
  resolveExperimentPortStrict,
  resolvePortIfFree,
  type BuiltExperimentSecrets,
  type ExperimentInboundSpec,
} from "./experimentInbound.js";
import { experimentInboundTag, isExperimentInboundTag, MOBILE_TEST_PORT } from "./experimentTypes.js";
import {
  ensureXrayStatsPolicyApi,
  mutateXrayConfigAndRestart,
  sshExecCommand,
  sshReadRemoteFile,
  TZADMIN_XRAY_CONFIG_PATH,
  type SshConfig,
  type SshLog,
} from "./ssh.js";
import { resolveConfigPath } from "./userSync.js";
import type { ServerRow } from "./db.js";

function sshCfg(row: ServerRow): SshConfig {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

export async function resolveExperimentConfigPath(row: ServerRow, log?: SshLog): Promise<string> {
  return resolveConfigPath(row, log);
}

export async function listRemoteOccupiedPorts(row: ServerRow, configPath: string): Promise<Set<number>> {
  try {
    const raw = await sshReadRemoteFile(sshCfg(row), configPath);
    const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const inbounds = Array.isArray(parsed.inbounds) ? (parsed.inbounds as Record<string, unknown>[]) : [];
    return collectOccupiedPorts(inbounds);
  } catch {
    return new Set();
  }
}

export async function readRemoteInboundsList(row: ServerRow): Promise<Record<string, unknown>[]> {
  const path = await resolveExperimentConfigPath(row);
  const raw = await sshReadRemoteFile(sshCfg(row), path);
  const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  return Array.isArray(parsed.inbounds) ? (parsed.inbounds as Record<string, unknown>[]) : [];
}

export async function resolveExperimentPortForServer(
  row: ServerRow,
  preferred: number,
  allowNon443?: boolean,
): Promise<{ port: number; warning: string | null }> {
  const inbounds = await readRemoteInboundsList(row);
  return resolveExperimentPortStrict(inbounds, preferred, {
    experimental_only: row.experimental_only === 1,
    allow_non_443: allowNon443,
  });
}

export async function resolveFreePortForServer(row: ServerRow, preferred: number): Promise<{ port: number }> {
  const inbounds = await readRemoteInboundsList(row);
  return resolvePortIfFree(inbounds, preferred);
}

/** Удалить все EXP-inbound на порту 443 (перед новым «единственным» тестом). */
export async function removeExperimentInboundsOn443(row: ServerRow, log?: SshLog): Promise<string[]> {
  const cfg = sshCfg(row);
  const configPath = await resolveExperimentConfigPath(row, log);
  const removed: string[] = [];
  await mutateXrayConfigAndRestart(
    cfg,
    configPath,
    (config) => {
      const inbounds = Array.isArray(config.inbounds) ? (config.inbounds as Record<string, unknown>[]) : [];
      const next = inbounds.filter((ib) => {
        const tag = String(ib.tag ?? "");
        const p = Number(ib.port);
        if (p === MOBILE_TEST_PORT && isExperimentInboundTag(tag)) {
          removed.push(tag);
          return false;
        }
        return true;
      });
      config.inbounds = next;
      ensureXrayStatsPolicyApi(config);
    },
    log,
  );
  return removed;
}

function ensureApiInbound(config: Record<string, unknown>): void {
  ensureXrayStatsPolicyApi(config);
  const inbounds = Array.isArray(config.inbounds) ? (config.inbounds as Record<string, unknown>[]) : [];
  const hasApi = inbounds.some((ib) => String(ib.tag ?? "") === "api");
  if (!hasApi) {
    inbounds.unshift({
      listen: "127.0.0.1",
      port: 10085,
      protocol: "dokodemo-door",
      settings: { address: "127.0.0.1" },
      tag: "api",
    });
    config.inbounds = inbounds;
  }
  if (!config.outbounds) config.outbounds = [];
  const outs = config.outbounds as Record<string, unknown>[];
  if (!outs.some((o) => String(o.tag ?? "") === "api")) {
    outs.push({ protocol: "freedom", tag: "api" });
  }
  if (!outs.some((o) => String(o.tag ?? "") === "direct")) {
    outs.unshift({ protocol: "freedom", tag: "direct" });
  }
}

async function ensureConfigFileExists(row: ServerRow, configPath: string): Promise<void> {
  const cfg = sshCfg(row);
  const test = await sshExecCommand(cfg, `test -f ${JSON.stringify(configPath)} && echo yes || echo no`);
  if (test.stdout.includes("yes")) return;
  const minimal = JSON.stringify({
    log: { loglevel: "warning" },
    inbounds: [],
    outbounds: [{ protocol: "freedom", tag: "direct" }],
  });
  await sshExecCommand(
    cfg,
    `install -d -m 0755 $(dirname ${JSON.stringify(configPath)}) 2>/dev/null; printf %s ${JSON.stringify(minimal)} > ${JSON.stringify(configPath)}`,
  );
}

export async function deployExperimentInbound(
  row: ServerRow,
  spec: ExperimentInboundSpec,
  secrets: BuiltExperimentSecrets,
  opts: { queryStrategy: string; dnsMode: import("./experimentTypes.js").ExperimentDnsMode },
  log?: SshLog,
): Promise<{ configPath: string; port: number }> {
  const cfg = sshCfg(row);
  const configPath = await resolveExperimentConfigPath(row, log);
  await ensureConfigFileExists(row, configPath);

  let chosenPort = spec.port;
  await mutateXrayConfigAndRestart(
    cfg,
    configPath,
    (config) => {
      let inbounds = Array.isArray(config.inbounds) ? (config.inbounds as Record<string, unknown>[]) : [];
      chosenPort = spec.port;
      const tag = experimentInboundTag(spec.experimentId);
      if (inbounds.some((ib) => String(ib.tag ?? "") === tag)) {
        throw new Error(`inbound_already_exists:${tag}`);
      }
      const prodTags = new Set(["tzadmin-vless"]);
      for (const ib of inbounds) {
        const t = String(ib.tag ?? "");
        if (prodTags.has(t)) continue;
      }
      const inbound = buildExperimentInbound({ ...spec, port: chosenPort }, secrets);
      inbounds.push(inbound);
      config.inbounds = inbounds;
      ensureApiInbound(config);
      applyExperimentRoutingDns(config, tag, {
        queryStrategy: opts.queryStrategy,
        dnsMode: opts.dnsMode,
      });
      if (!config.log || typeof config.log !== "object") {
        config.log = { loglevel: spec.logLevel || "warning" };
      } else {
        (config.log as Record<string, unknown>).loglevel = spec.logLevel || "warning";
      }
    },
    log,
  );

  return { configPath, port: chosenPort };
}

export async function removeExperimentInbound(
  row: ServerRow,
  experimentId: number,
  configPathHint?: string,
  log?: SshLog,
): Promise<void> {
  const cfg = sshCfg(row);
  const configPath = configPathHint?.trim() || (await resolveExperimentConfigPath(row, log));
  const tag = experimentInboundTag(experimentId);

  await mutateXrayConfigAndRestart(
    cfg,
    configPath,
    (config) => {
      const inbounds = Array.isArray(config.inbounds) ? (config.inbounds as Record<string, unknown>[]) : [];
      const before = inbounds.length;
      const next = inbounds.filter((ib) => String(ib.tag ?? "") !== tag);
      if (next.length === before) {
        throw new Error(`inbound_not_found:${tag}`);
      }
      config.inbounds = next;
      ensureXrayStatsPolicyApi(config);
    },
    log,
  );
}

/** Проверка, что порт не занят другим inbound (кроме нашего тега). */
export async function assertPortAvailable(
  row: ServerRow,
  port: number,
  exceptExperimentId?: number,
): Promise<void> {
  const path = await resolveExperimentConfigPath(row);
  const raw = await sshReadRemoteFile(sshCfg(row), path);
  const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  const inbounds = Array.isArray(parsed.inbounds) ? (parsed.inbounds as Record<string, unknown>[]) : [];
  const exceptTag = exceptExperimentId != null ? experimentInboundTag(exceptExperimentId) : "";
  for (const ib of inbounds) {
    const p = Number(ib.port);
    const tag = String(ib.tag ?? "");
    if (p === port && tag !== exceptTag) {
      throw new Error(`port_busy:${port}:${tag}`);
    }
  }
}

export async function ensureTzadminConfigDir(row: ServerRow): Promise<void> {
  await sshExecCommand(sshCfg(row), `install -d -m 0755 /etc/tzadmin-xray 2>/dev/null || true`);
  if (!row.xray_config_path || row.xray_config_path !== TZADMIN_XRAY_CONFIG_PATH) {
    /* only suggest path; resolveConfigPath updates DB on deploy */
  }
}
