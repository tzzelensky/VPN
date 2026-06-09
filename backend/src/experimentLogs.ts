import { maskLogLine, maskSecret, maskUuid } from "./experimentLink.js";
import { experimentInboundTag } from "./experimentTypes.js";
import { sshExecCommand, type SshConfig } from "./ssh.js";
import type { ServerRow, VpnExperimentRow } from "./db.js";

export type ExperimentDiagSnapshot = {
  status: string;
  status_key: string;
  has_incoming: boolean;
  has_accepted: boolean;
  has_received_request: boolean;
  has_handshake_fail: boolean;
  has_client_hello_fail: boolean;
  lines: string[];
  highlights: string[][];
  error_lines: string[];
  access_lines: string[];
};

const HIGHLIGHT_RULES: { kind: string; re: RegExp }[] = [
  { kind: "reality", re: /\breality\b/i },
  { kind: "handshake", re: /\bhandshake\b|client hello/i },
  { kind: "failed", re: /\bfailed\b/i },
  { kind: "timeout", re: /\btimeout\b/i },
  { kind: "eof", re: /\beof\b/i },
  { kind: "refused", re: /\brefused\b/i },
  { kind: "dns", re: /\bdns\b/i },
  { kind: "accepted", re: /\baccepted\b/i },
  { kind: "request", re: /received request/i },
];

function highlightKinds(line: string): string[] {
  const kinds: string[] = [];
  for (const r of HIGHLIGHT_RULES) {
    if (r.re.test(line)) kinds.push(r.kind);
  }
  return kinds;
}

export function deriveExperimentDiagnostics(
  snap: Omit<ExperimentDiagSnapshot, "status" | "status_key">,
  ctx?: { port_listening?: boolean },
): {
  status: string;
  status_key: string;
} {
  if (snap.has_accepted || snap.has_received_request) {
    return {
      status_key: "traffic_ok",
      status: "Есть accepted-запросы — VPN пропускает трафик",
    };
  }
  if (snap.has_received_request && !snap.has_accepted) {
    return {
      status_key: "routing_dns",
      status: "Подключение есть, но сайты не грузятся — проверить DNS/MTU/routing",
    };
  }
  if (snap.has_handshake_fail || snap.has_client_hello_fail) {
    return {
      status_key: "handshake_fail",
      status: "REALITY handshake failed / failed to read client hello",
    };
  }
  if (snap.has_incoming) {
    return {
      status_key: "reached_server",
      status: "Клиент дошел до сервера — смотрите handshake и access log",
    };
  }
  if (ctx?.port_listening) {
    return {
      status_key: "listening_no_incoming",
      status:
        "Порт слушается, но входящих подключений нет — возможно блокируется сетью/оператором или закрыт внешний firewall",
    };
  }
  return {
    status_key: "no_incoming",
    status: "Нет входящих подключений — вероятно блокируется IP/порт или порт не слушает Xray",
  };
}

async function fetchJournalLines(cfg: SshConfig, max = 1200): Promise<string[]> {
  const cmd = `journalctl -u tzadmin-xray -n ${max} --no-pager 2>/dev/null || journalctl -u xray -n ${max} --no-pager 2>/dev/null || true`;
  const r = await sshExecCommand(cfg, cmd);
  return `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => l.length > 0);
}

function filterForExperiment(lines: string[], exp: VpnExperimentRow): string[] {
  const tag = experimentInboundTag(exp.id);
  const port = String(exp.port);
  return lines.filter((l) => {
    const low = l.toLowerCase();
    return (
      l.includes(tag) ||
      l.includes(`:${port}`) ||
      low.includes(`inbound:${tag.toLowerCase()}`) ||
      (low.includes("reality") && l.includes(port)) ||
      (low.includes("proxy/vless") && (l.includes(tag) || l.includes(port)))
    );
  });
}

export async function fetchExperimentLogs(
  cfg: SshConfig,
  exp: VpnExperimentRow,
  linesCap = 200,
): Promise<ExperimentDiagSnapshot> {
  const raw = await fetchJournalLines(cfg);
  const filtered = filterForExperiment(raw, exp).slice(-linesCap);
  const masked = filtered.map((l) => maskLogLine(l));

  let has_incoming = false;
  let has_accepted = false;
  let has_received_request = false;
  let has_handshake_fail = false;
  let has_client_hello_fail = false;

  const error_lines: string[] = [];
  const access_lines: string[] = [];

  for (const l of masked) {
    const low = l.toLowerCase();
    if (/\[error\]|\[warning\]|failed|refused|timeout/i.test(l)) error_lines.push(l);
    if (/accepted|received request|connection opened|proxy\/freedom/i.test(l)) access_lines.push(l);

    if (/invalid connection|tcp:|accepted|reality:/i.test(low)) has_incoming = true;
    if (/accepted|connection opened to tcp:/i.test(low)) has_accepted = true;
    if (/received request for tcp:/i.test(low)) has_received_request = true;
    if (/handshake failed|failed to read client hello/i.test(low)) {
      has_handshake_fail = true;
      has_client_hello_fail = true;
    }
  }

  const core = {
    has_incoming,
    has_accepted,
    has_received_request,
    has_handshake_fail,
    has_client_hello_fail,
    lines: masked,
    highlights: masked.map((l) => highlightKinds(l)),
    error_lines: error_lines.slice(-30),
    access_lines: access_lines.slice(-30),
  };
  const { status, status_key } = deriveExperimentDiagnostics(core);
  return { ...core, status, status_key };
}

export async function fetchExperimentLogsWithPortContext(
  cfg: SshConfig,
  exp: VpnExperimentRow,
  portListening: boolean,
  linesCap = 200,
): Promise<ExperimentDiagSnapshot> {
  const logs = await fetchExperimentLogs(cfg, exp, linesCap);
  const { status, status_key } = deriveExperimentDiagnostics(logs, { port_listening: portListening });
  return { ...logs, status, status_key };
}

export type ExperimentDiagnosticReport = {
  generated_at: string;
  experiment_name: string;
  host: string;
  port: number;
  inbound_tag: string;
  network: string;
  security: string;
  flow: string;
  fingerprint: string;
  server_name: string;
  query_strategy: string;
  dns_mode: string;
  sniff_quic: boolean;
  mux_enabled: boolean;
  vless_uuid_masked: string;
  reality_pbk_masked: string;
  reality_sid_masked: string;
  diag_status: string;
  has_incoming: boolean;
  has_accepted: boolean;
  has_handshake_fail: boolean;
  last_error_lines: string[];
  last_access_lines: string[];
  interpretation: string[];
};

export function buildDiagnosticReport(
  exp: VpnExperimentRow,
  server: ServerRow,
  logs: ExperimentDiagSnapshot,
): ExperimentDiagnosticReport {
  const interpretation: string[] = [];
  if (logs.status_key === "no_incoming") {
    interpretation.push("Клиент не дошел до сервера: блок IP/порта оператором или порт не слушается.");
  }
  if (logs.status_key === "reached_server") {
    interpretation.push("TCP дошел — проверьте REALITY handshake и fp/SNI.");
  }
  if (logs.status_key === "handshake_fail") {
    interpretation.push("REALITY/TLS ClientHello не проходит — смените fp, SNI или попробуйте no Vision.");
  }
  if (logs.status_key === "listening_no_incoming") {
    interpretation.push("Xray слушает порт, но трафик не доходит — проверьте UFW/security group и мобильную сеть.");
  }
  if (logs.status_key === "traffic_ok") {
    interpretation.push("Туннель работает. Если сайты не открываются — проверьте DNS, MTU, routing.");
  }
  if (logs.status_key === "routing_dns") {
    interpretation.push("Есть received request — проверьте DNS, MTU и routing на клиенте.");
  }
  if (logs.has_received_request && !logs.has_accepted) {
    interpretation.push("Есть received request, но мало accepted — возможна проблема DNS/MTU/routing.");
  }

  return {
    generated_at: new Date().toISOString(),
    experiment_name: exp.name,
    host: server.host,
    port: exp.port,
    inbound_tag: exp.inbound_tag,
    network: exp.network,
    security: exp.security,
    flow: exp.flow || "none",
    fingerprint: exp.fingerprint,
    server_name: exp.server_name,
    query_strategy: exp.query_strategy,
    dns_mode: exp.dns_mode,
    sniff_quic: exp.sniff_quic === 1,
    mux_enabled: exp.mux_enabled === 1,
    vless_uuid_masked: maskUuid(exp.vless_uuid),
    reality_pbk_masked: maskSecret(exp.reality_pbk, 6),
    reality_sid_masked: maskSecret(exp.reality_sid, 3),
    diag_status: logs.status,
    has_incoming: logs.has_incoming,
    has_accepted: logs.has_accepted,
    has_handshake_fail: logs.has_handshake_fail,
    last_error_lines: logs.error_lines,
    last_access_lines: logs.access_lines,
    interpretation,
  };
}

export function formatDiagnosticReportText(r: ExperimentDiagnosticReport): string {
  const lines = [
    `=== Диагностика эксперимента: ${r.experiment_name} ===`,
    `Время: ${r.generated_at}`,
    `IP: ${r.host}`,
    `Порт: ${r.port}`,
    `Inbound: ${r.inbound_tag}`,
    `Сеть: ${r.network} / ${r.security}`,
    `Flow: ${r.flow}`,
    `Fingerprint: ${r.fingerprint}`,
    `SNI: ${r.server_name}`,
    `queryStrategy: ${r.query_strategy}`,
    `DNS mode: ${r.dns_mode}`,
    `sniffing QUIC: ${r.sniff_quic ? "on" : "off"}`,
    `mux: ${r.mux_enabled ? "on" : "off"}`,
    `UUID: ${r.vless_uuid_masked}`,
    `pbk: ${r.reality_pbk_masked}`,
    `shortId: ${r.reality_sid_masked}`,
    ``,
    `Статус: ${r.diag_status}`,
    `Входящие: ${r.has_incoming ? "да" : "нет"}`,
    `Accepted: ${r.has_accepted ? "да" : "нет"}`,
    `Handshake fail: ${r.has_handshake_fail ? "да" : "нет"}`,
    ``,
    `Интерпретация:`,
    ...r.interpretation.map((x) => `- ${x}`),
    ``,
    `--- error log (последние ${r.last_error_lines.length}) ---`,
    ...r.last_error_lines,
    ``,
    `--- access log (последние ${r.last_access_lines.length}) ---`,
    ...r.last_access_lines,
  ];
  return lines.join("\n");
}
