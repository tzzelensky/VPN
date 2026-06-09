import { randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import {
  clearActive443ForServer,
  createVpnExperimentRow,
  deleteVpnExperimentRow,
  getServer,
  getVpnExperiment,
  getVpnExperimentBySubToken,
  listVpnExperiments,
  listVpnExperimentsForServer,
  updateVpnExperimentRow,
  type ServerRow,
  type VpnExperimentRow,
} from "./db.js";
import { buildExperimentSecrets } from "./experimentInbound.js";
import {
  buildExperimentSubscriptionPayload,
  buildExperimentVlessUri,
  maskSecret,
  maskUuid,
  publicExperimentSubUrl,
} from "./experimentLink.js";
import {
  buildDiagnosticReport,
  fetchExperimentLogs,
  formatDiagnosticReportText,
} from "./experimentLogs.js";
import { buildExp16ClientJsonForServer } from "./experimentClientJson.js";
import { tryOpenFirewallPort, type FirewallOpenResult } from "./experimentFirewall.js";
import { buildPortPlan, checkExperimentPort, type PortCheckResult, type PortPlanResult } from "./experimentPortCheck.js";
import {
  DEPRECATED_WS_REALITY_NOTE,
  EXP16_WORKING_PORT,
  experimentInboundTag,
  isExp16Preset,
  mergePresetOptions,
  MOBILE_TEST_PORT,
  portWarningExp16,
  presetById,
  type ExperimentCreateOptions,
  type ExperimentPresetId,
} from "./experimentTypes.js";
import {
  deployExperimentInbound,
  removeExperimentInbound,
  removeExperimentInboundsOn443,
  resolveExperimentPortForServer,
  resolveFreePortForServer,
} from "./experimentSsh.js";
import { fetchExperimentLogsWithPortContext } from "./experimentLogs.js";
import type { SshConfig } from "./ssh.js";

function sshCfg(row: ServerRow): SshConfig {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

function randomExpSubToken(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[buf[i]! % alphabet.length]!;
  return out;
}

export type ExperimentPublicDto = {
  id: number;
  name: string;
  server_id: number;
  server_name: string;
  host: string;
  preset_id: string;
  port: number;
  network: string;
  security: string;
  flow: string;
  fingerprint: string;
  server_name_sni: string;
  inbound_tag: string;
  vless_uuid_masked: string;
  reality_pbk_masked: string;
  reality_sid_masked: string;
  sub_url: string;
  vless_uri: string;
  status: string;
  deploy_error: string | null;
  diag_status: string;
  diag_has_accepted: boolean;
  diag_has_handshake_fail: boolean;
  user_note: string;
  query_strategy: string;
  sniff_quic: boolean;
  dns_mode: string;
  mux_enabled: boolean;
  port_warning: string | null;
  active_on_443: boolean;
  experimental_only_server: boolean;
  created_at: string;
  updated_at: string;
  deploy_post_check?: PortCheckResult | null;
  firewall_open?: FirewallOpenResult | null;
};

export function experimentToPublicDto(exp: VpnExperimentRow, server: ServerRow): ExperimentPublicDto {
  let uri = "";
  try {
    uri = exp.status === "deployed" ? buildExperimentVlessUri(server.host, exp) : "";
  } catch {
    uri = "";
  }
  return {
    id: exp.id,
    name: exp.name,
    server_id: exp.server_id,
    server_name: server.name || server.host,
    host: server.host,
    preset_id: exp.preset_id,
    port: exp.port,
    network: exp.network,
    security: exp.security,
    flow: exp.flow,
    fingerprint: exp.fingerprint,
    server_name_sni: exp.server_name,
    inbound_tag: exp.inbound_tag,
    vless_uuid_masked: maskUuid(exp.vless_uuid),
    reality_pbk_masked: maskSecret(exp.reality_pbk, 6),
    reality_sid_masked: maskSecret(exp.reality_sid, 3),
    sub_url: publicExperimentSubUrl(exp.sub_token),
    vless_uri: uri,
    status: exp.status,
    deploy_error: exp.deploy_error,
    diag_status: exp.diag_status,
    diag_has_accepted: exp.diag_has_accepted === 1,
    diag_has_handshake_fail: exp.diag_has_handshake_fail === 1,
    user_note: exp.user_note,
    query_strategy: exp.query_strategy,
    sniff_quic: exp.sniff_quic === 1,
    dns_mode: exp.dns_mode,
    mux_enabled: exp.mux_enabled === 1,
    port_warning: exp.port_warning,
    active_on_443: exp.active_on_443 === 1,
    experimental_only_server: server.experimental_only === 1,
    created_at: exp.created_at,
    updated_at: exp.updated_at,
  };
}

function tlsDomainFromEnv(): string | null {
  const d = (process.env.EXPERIMENT_TLS_DOMAIN ?? "").trim();
  return d || null;
}

function validatePresetDeployable(merged: ExperimentCreateOptions): ExperimentCreateOptions {
  const preset = presetById(String(merged.preset_id ?? ""));
  let out = merged;
  if (preset?.category === "tls_cert_required") {
    if (!tlsDomainFromEnv()) {
      throw new Error(
        "Для TLS fallback задайте EXPERIMENT_TLS_DOMAIN и сертификат на сервере (Preset D/E). WS+REALITY не поддерживается.",
      );
    }
    if (!out.server_name?.trim()) {
      out = { ...out, server_name: tlsDomainFromEnv()! };
    }
  }
  if (merged.network === "ws" && merged.security === "reality") {
    throw new Error(DEPRECATED_WS_REALITY_NOTE);
  }
  if (out.preset_id === "trojan_tls") {
    throw new Error("Trojan inbound пока не разворачивается автоматически — используйте Preset A/B/C (REALITY).");
  }
  return out;
}

export async function getExperimentPortPlan(serverId: number, requestedPort = MOBILE_TEST_PORT): Promise<PortPlanResult> {
  const server = getServer(serverId);
  if (!server) throw new Error("server_not_found");
  return buildPortPlan(server, requestedPort);
}

export async function checkServerPortForExperiment(id: number): Promise<PortCheckResult> {
  const exp = getVpnExperiment(id);
  if (!exp) throw new Error("not_found");
  const server = getServer(exp.server_id);
  if (!server) throw new Error("server_not_found");
  const base = await checkExperimentPort(server, exp);
  const logs = await fetchExperimentLogsWithPortContext(sshCfg(server), exp, base.port_listening);
  return {
    ...base,
    diag_status: logs.status,
    diag_status_key: logs.status_key,
    diag_has_incoming: logs.has_incoming,
    diag_has_accepted: logs.has_accepted,
    diag_has_handshake_fail: logs.has_handshake_fail,
  };
}

export function getExperimentClientJson(id: number): Record<string, unknown> {
  const exp = getVpnExperiment(id);
  if (!exp) throw new Error("not_found");
  const server = getServer(exp.server_id);
  if (!server) throw new Error("server_not_found");
  return buildExp16ClientJsonForServer(server, exp);
}

export async function getExperimentDiagnosticReport(id: number): Promise<{ text: string; report: ReturnType<typeof buildDiagnosticReport> }> {
  const exp = getVpnExperiment(id);
  if (!exp) throw new Error("not_found");
  const server = getServer(exp.server_id);
  if (!server) throw new Error("server_not_found");
  const logs = await fetchExperimentLogs(sshCfg(server), exp);
  const report = buildDiagnosticReport(exp, server, logs);
  return { text: formatDiagnosticReportText(report), report };
}

export function listExperimentsPublic(): ExperimentPublicDto[] {
  const out: ExperimentPublicDto[] = [];
  for (const exp of listVpnExperiments()) {
    const server = getServer(exp.server_id);
    if (!server) continue;
    out.push(experimentToPublicDto(exp, server));
  }
  return out;
}

export async function createExperiment(
  opts: ExperimentCreateOptions,
): Promise<
  ExperimentPublicDto & {
    port_warning?: string | null;
    deploy_post_check?: PortCheckResult | null;
    firewall_open?: FirewallOpenResult | null;
  }
> {
  const server = getServer(opts.server_id);
  if (!server) throw new Error("server_not_found");

  const merged = validatePresetDeployable(mergePresetOptions(opts));
  const exp16 = isExp16Preset(String(merged.preset_id ?? ""));

  const preferredPort = merged.port ?? (exp16 ? EXP16_WORKING_PORT : MOBILE_TEST_PORT);
  let port: number;
  let portWarning: string | null = null;

  if (exp16) {
    ({ port } = await resolveFreePortForServer(server, preferredPort));
    portWarning = portWarningExp16(port);
  } else {
    const resolved = await resolveExperimentPortForServer(server, preferredPort, merged.force_non_443);
    port = resolved.port;
    portWarning = resolved.warning;
    if (port !== MOBILE_TEST_PORT && !merged.force_non_443) {
      throw new Error("port_443_required_for_mobile_test");
    }
  }

  const replace443 =
    !exp16 &&
    (merged.replace_443_slot === true || (server.experimental_only === 1 && port === MOBILE_TEST_PORT));

  if (replace443) {
    await removeExperimentInboundsOn443(server);
    for (const old of listVpnExperimentsForServer(server.id)) {
      if (old.status === "deployed") {
        try {
          await removeExperimentInbound(server, old.id, old.config_path || undefined);
        } catch {
          /* ignore */
        }
      }
      updateVpnExperimentRow(old.id, { active_on_443: 0, status: old.status === "deployed" ? "failed" : old.status, deploy_error: "Заменён новым тестом на 443" });
    }
    clearActive443ForServer(server.id);
  }

  const secrets = buildExperimentSecrets();
  const vlessUuid = uuidv4();
  const subToken = randomExpSubToken();

  const defaultName = exp16 ? "EXP-16 mobile working clone" : merged.name;
  const pending = createVpnExperimentRow({
    name: defaultName.startsWith("EXP-") ? defaultName : `EXP-${defaultName}`,
    server_id: server.id,
    preset_id: String(merged.preset_id ?? "custom"),
    vless_uuid: vlessUuid,
    sub_token: subToken,
    inbound_tag: "",
    port,
    config_path: "",
    network: merged.network ?? "tcp",
    security: merged.security ?? "reality",
    flow: merged.flow ?? "",
    fingerprint: merged.fingerprint ?? "chrome",
    server_name: merged.server_name ?? "www.microsoft.com",
    reality_pbk: secrets.publicKey,
    reality_sid: secrets.shortId,
    reality_private_key: secrets.privateKey,
    reality_spx: "/",
    ws_path: secrets.wsPath,
    grpc_service: secrets.grpcService,
    query_strategy: merged.query_strategy ?? "UseIPv4",
    sniff_quic: merged.sniff_quic ? 1 : 0,
    dns_mode: merged.dns_mode ?? "default",
    mux_enabled: merged.mux_enabled ? 1 : 0,
    xudp_enabled: merged.xudp_enabled ? 1 : 0,
    mtu: merged.mtu ?? null,
    log_level: merged.log_level ?? "warning",
    status: "pending",
    deploy_error: null,
    diag_status: "",
    diag_has_accepted: 0,
    diag_has_handshake_fail: 0,
    diag_last_check_at: null,
    user_note: "",
    active_on_443: port === MOBILE_TEST_PORT && replace443 ? 1 : 0,
    port_warning: portWarning,
  });

  const tag = experimentInboundTag(pending.id);
  updateVpnExperimentRow(pending.id, { inbound_tag: tag });

  try {
    const { configPath, port: actualPort } = await deployExperimentInbound(
      server,
      {
        experimentId: pending.id,
        vlessUuid,
        port,
        network: pending.network,
        security: pending.security,
        flow: pending.flow,
        fingerprint: pending.fingerprint,
        serverName: pending.server_name,
        sniffQuic: pending.sniff_quic === 1,
        dnsMode: pending.dns_mode,
        muxEnabled: pending.mux_enabled === 1,
        logLevel: pending.log_level,
      },
      secrets,
      { queryStrategy: pending.query_strategy, dnsMode: pending.dns_mode },
    );
    const updated = updateVpnExperimentRow(pending.id, {
      status: "deployed",
      config_path: configPath,
      port: actualPort,
      deploy_error: null,
      inbound_tag: tag,
      active_on_443: actualPort === MOBILE_TEST_PORT && replace443 ? 1 : 0,
    });
    if (actualPort === MOBILE_TEST_PORT && replace443) {
      clearActive443ForServer(server.id, pending.id);
    }
    const row = updated ?? getVpnExperiment(pending.id)!;

    let firewall_open: FirewallOpenResult | null = null;
    let deploy_post_check: PortCheckResult | null = null;
    try {
      firewall_open = await tryOpenFirewallPort(sshCfg(server), actualPort);
    } catch {
      firewall_open = null;
    }
    try {
      deploy_post_check = await checkServerPortForExperiment(pending.id);
      updateVpnExperimentRow(pending.id, {
        diag_status: deploy_post_check.diag_status,
        diag_has_accepted: deploy_post_check.diag_has_accepted ? 1 : 0,
        diag_has_handshake_fail: deploy_post_check.diag_has_handshake_fail ? 1 : 0,
        diag_last_check_at: new Date().toISOString(),
      });
    } catch {
      deploy_post_check = null;
    }

    const finalRow = getVpnExperiment(pending.id)!;
    return {
      ...experimentToPublicDto(finalRow, server),
      port_warning: portWarning,
      firewall_open,
      deploy_post_check,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateVpnExperimentRow(pending.id, { status: "failed", deploy_error: msg });
    throw new Error(msg);
  }
}

export async function deleteExperiment(id: number): Promise<void> {
  const exp = getVpnExperiment(id);
  if (!exp) throw new Error("not_found");
  const server = getServer(exp.server_id);
  if (server && exp.status === "deployed") {
    try {
      await removeExperimentInbound(server, exp.id, exp.config_path || undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("inbound_not_found")) throw e;
    }
  }
  deleteVpnExperimentRow(id);
}

export async function runExperimentDiagnostics(id: number): Promise<{
  experiment: ExperimentPublicDto;
  logs: Awaited<ReturnType<typeof fetchExperimentLogs>>;
  port_check?: Awaited<ReturnType<typeof checkExperimentPort>>;
}> {
  const exp = getVpnExperiment(id);
  if (!exp) throw new Error("not_found");
  const server = getServer(exp.server_id);
  if (!server) throw new Error("server_not_found");
  const logs = await fetchExperimentLogs(sshCfg(server), exp);
  let port_check;
  if (exp.status === "deployed") {
    try {
      port_check = await checkExperimentPort(server, exp);
    } catch {
      port_check = undefined;
    }
  }
  const updated = updateVpnExperimentRow(id, {
    diag_status: logs.status,
    diag_has_accepted: logs.has_accepted ? 1 : 0,
    diag_has_handshake_fail: logs.has_handshake_fail ? 1 : 0,
    diag_last_check_at: new Date().toISOString(),
  });
  return {
    experiment: experimentToPublicDto(updated ?? exp, server),
    logs,
    port_check,
  };
}

export function patchExperimentNote(id: number, user_note: "" | "works" | "fail" | "partial"): ExperimentPublicDto {
  const exp = getVpnExperiment(id);
  if (!exp) throw new Error("not_found");
  const server = getServer(exp.server_id);
  if (!server) throw new Error("server_not_found");
  const updated = updateVpnExperimentRow(id, { user_note });
  return experimentToPublicDto(updated ?? exp, server);
}

/** Один активный тест на 443: переключение пресета (A/B/C). */
export async function activateMobilePreset(
  serverId: number,
  presetId: ExperimentPresetId,
): Promise<ExperimentPublicDto> {
  const preset = presetById(presetId);
  return createExperiment({
    name: preset?.label ?? `EXP-${presetId}`,
    server_id: serverId,
    preset_id: presetId,
    port: MOBILE_TEST_PORT,
    replace_443_slot: true,
  });
}

export function getExperimentSubscriptionPayload(subToken: string): string {
  const exp = getVpnExperimentBySubToken(subToken);
  if (!exp || exp.status !== "deployed") {
    return buildExperimentSubscriptionPayload(
      `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&security=none&type=tcp#${encodeURIComponent("EXP-not-ready")}`,
    );
  }
  const server = getServer(exp.server_id);
  if (!server) {
    return buildExperimentSubscriptionPayload(
      `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&security=none&type=tcp#${encodeURIComponent("EXP-no-server")}`,
    );
  }
  try {
    const uri = buildExperimentVlessUri(server.host, exp);
    return buildExperimentSubscriptionPayload(uri);
  } catch {
    return buildExperimentSubscriptionPayload(
      `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?encryption=none&security=none&type=tcp#${encodeURIComponent("EXP-invalid")}`,
    );
  }
}

export { EXPERIMENT_PRESETS } from "./experimentTypes.js";
export type { ExperimentPresetId };
