export const XRAY_LOG_LEVELS = ["none", "error", "warning", "info", "debug"] as const;
export type XrayLogLevel = (typeof XRAY_LOG_LEVELS)[number];

export const TZADMIN_LOG_DIR = "/var/log/tzadmin-xray";
export const TZADMIN_DEFAULT_ACCESS_LOG = `${TZADMIN_LOG_DIR}/access.log`;
export const TZADMIN_DEFAULT_ERROR_LOG = `${TZADMIN_LOG_DIR}/error.log`;

export const MAX_LOG_TAIL_LINES = 500;
export const DEFAULT_LOG_TAIL_LINES = 300;
export const MAX_LOG_FILE_BYTES = 2 * 1024 * 1024;

export type LogFileStatus =
  | "ok"
  | "empty"
  | "not_found"
  | "no_path"
  | "too_large"
  | "permission_denied"
  | "unreadable";

export type ParsedXrayLogConfig = {
  loglevel: XrayLogLevel;
  accessPath: string | null;
  errorPath: string | null;
  dnsLog: boolean;
};

export function isXrayLogLevel(v: string): v is XrayLogLevel {
  return (XRAY_LOG_LEVELS as readonly string[]).includes(v);
}

export function parseXrayLogConfig(config: Record<string, unknown>): ParsedXrayLogConfig {
  const log = config.log;
  const block =
    log && typeof log === "object" && !Array.isArray(log) ? (log as Record<string, unknown>) : {};
  const rawLevel = String(block.loglevel ?? "warning").trim().toLowerCase();
  const loglevel = isXrayLogLevel(rawLevel) ? rawLevel : "warning";
  const access = String(block.access ?? "").trim() || null;
  const error = String(block.error ?? "").trim() || null;
  const dnsLog = block.dnsLog === true || block.dnsLog === 1 || block.dnsLog === "true";
  return { loglevel, accessPath: access, errorPath: error, dnsLog };
}

export function applyXrayLogConfig(
  config: Record<string, unknown>,
  opts: { loglevel: XrayLogLevel; ensureFilePaths?: boolean },
): ParsedXrayLogConfig {
  const prev = parseXrayLogConfig(config);
  const block: Record<string, unknown> = {
    ...(config.log && typeof config.log === "object" && !Array.isArray(config.log)
      ? (config.log as Record<string, unknown>)
      : {}),
    loglevel: opts.loglevel,
    dnsLog: prev.dnsLog,
  };
  if (opts.ensureFilePaths && opts.loglevel !== "none") {
    if (!String(block.access ?? "").trim()) block.access = TZADMIN_DEFAULT_ACCESS_LOG;
    if (!String(block.error ?? "").trim()) block.error = TZADMIN_DEFAULT_ERROR_LOG;
  }
  config.log = block;
  return parseXrayLogConfig(config);
}

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const KEY_FIELD_RE =
  /("(?:privateKey|publicKey|shortIds?|password|id|uuid|masterKey|encryption)"\s*:\s*")([^"]{8,})(")/gi;
const BARE_KEY_RE = /\b(privateKey|publicKey|shortId|shortIds)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{8,}["']?/gi;

export function maskSensitiveLogText(text: string): string {
  let out = text;
  out = out.replace(UUID_RE, "********-****-****-****-************");
  out = out.replace(KEY_FIELD_RE, '$1[masked]$3');
  out = out.replace(BARE_KEY_RE, (m) => m.split(/[:=]/)[0] + ': [masked]');
  return out;
}

export type LogHighlightKind =
  | "error"
  | "failed"
  | "timeout"
  | "handshake"
  | "tls"
  | "reality"
  | "dns"
  | "refused"
  | "eof";

const HIGHLIGHT_RULES: { kind: LogHighlightKind; re: RegExp }[] = [
  { kind: "error", re: /\berror\b/i },
  { kind: "failed", re: /\bfailed\b/i },
  { kind: "timeout", re: /\btimeout\b/i },
  { kind: "handshake", re: /\bhandshake\b/i },
  { kind: "tls", re: /\btls\b/i },
  { kind: "reality", re: /\breality\b/i },
  { kind: "dns", re: /\bdns\b/i },
  { kind: "refused", re: /\brefused\b/i },
  { kind: "eof", re: /\beof\b/i },
];

export function highlightKindsForLine(line: string): LogHighlightKind[] {
  const kinds: LogHighlightKind[] = [];
  for (const rule of HIGHLIGHT_RULES) {
    if (rule.re.test(line)) kinds.push(rule.kind);
  }
  return kinds;
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
