import { randomBytes } from "node:crypto";

export const EXPERIMENT_INBOUND_PREFIX = "EXP-";
export const MOBILE_TEST_PORT = 443;
/** Порт проверенного рабочего шаблона EXP-16. */
export const EXP16_WORKING_PORT = 444;
export const MOBILE_SNI_PRESETS = ["www.microsoft.com", "www.apple.com", "www.cloudflare.com"] as const;

export type ExperimentPresetId =
  | "exp16_mobile_working"
  | "mobile_reality_tcp_vision"
  | "mobile_reality_tcp_no_vision"
  | "mobile_reality_grpc"
  | "tls_ws_fallback"
  | "trojan_tls"
  | "custom";

export function isExp16Preset(presetId: string | undefined): boolean {
  return presetId === "exp16_mobile_working";
}

export function portWarningExp16(port: number): string | null {
  if (port === EXP16_WORKING_PORT) return null;
  return "Рабочий шаблон был проверен на порту 444. При смене порта результат может отличаться.";
}

export type ExperimentNetwork = "tcp" | "ws" | "grpc";
export type ExperimentSecurity = "reality" | "tls" | "none";
export type ExperimentDnsMode = "default" | "proxy" | "no_direct_dns";
export type ExperimentUserNote = "" | "works" | "fail" | "partial";
export type PresetCategory = "reality_mobile" | "tls_cert_required" | "deprecated";

export type ExperimentCreateOptions = {
  name: string;
  server_id: number;
  preset_id?: ExperimentPresetId | string;
  port?: number;
  network?: ExperimentNetwork;
  security?: ExperimentSecurity;
  flow?: string;
  fingerprint?: string;
  server_name?: string;
  query_strategy?: "UseIP" | "UseIPv4";
  sniff_quic?: boolean;
  dns_mode?: ExperimentDnsMode;
  mux_enabled?: boolean;
  xudp_enabled?: boolean;
  mtu?: number | null;
  log_level?: string;
  /** Разрешить порт ≠ 443 (с предупреждением в ответе). */
  force_non_443?: boolean;
  /** Снять другие EXP-inbound на 443 перед созданием (experimental-only сервер). */
  replace_443_slot?: boolean;
};

export type ExperimentPresetDef = {
  id: ExperimentPresetId;
  label: string;
  description: string;
  category: PresetCategory;
  deprecated?: boolean;
  deprecated_reason?: string;
  defaults: Omit<ExperimentCreateOptions, "name" | "server_id"> & { preset_id: ExperimentPresetId };
};

export const EXPERIMENT_PRESETS: ExperimentPresetDef[] = [
  {
    id: "exp16_mobile_working",
    label: "EXP-16 mobile working clone",
    description:
      "Создает экспериментальную подписку по шаблону рабочего конфига: VLESS TCP REALITY Vision, port 444, fingerprint firefox, SNI www.apple.com, QUIC off, mux off.",
    category: "reality_mobile",
    defaults: {
      preset_id: "exp16_mobile_working",
      port: EXP16_WORKING_PORT,
      network: "tcp",
      security: "reality",
      flow: "xtls-rprx-vision",
      fingerprint: "firefox",
      server_name: "www.apple.com",
      query_strategy: "UseIPv4",
      sniff_quic: false,
      dns_mode: "no_direct_dns",
      mux_enabled: false,
      xudp_enabled: false,
      log_level: "warning",
    },
  },
  {
    id: "mobile_reality_tcp_vision",
    label: "Preset A — Mobile Reality TCP Vision",
    description: "VLESS + TCP + REALITY + Vision, порт 443, firefox, UseIPv4",
    category: "reality_mobile",
    defaults: {
      preset_id: "mobile_reality_tcp_vision",
      port: 443,
      network: "tcp",
      security: "reality",
      flow: "xtls-rprx-vision",
      fingerprint: "firefox",
      server_name: "www.apple.com",
      query_strategy: "UseIPv4",
      sniff_quic: false,
      dns_mode: "no_direct_dns",
      mux_enabled: false,
      xudp_enabled: false,
      log_level: "warning",
    },
  },
  {
    id: "mobile_reality_tcp_no_vision",
    label: "Preset B — Mobile Reality TCP no Vision",
    description: "REALITY без Vision — проверка блокировки Vision на мобильной сети",
    category: "reality_mobile",
    defaults: {
      preset_id: "mobile_reality_tcp_no_vision",
      port: 443,
      network: "tcp",
      security: "reality",
      flow: "",
      fingerprint: "safari",
      server_name: "www.microsoft.com",
      query_strategy: "UseIPv4",
      sniff_quic: false,
      dns_mode: "no_direct_dns",
      mux_enabled: false,
      xudp_enabled: false,
      log_level: "warning",
    },
  },
  {
    id: "mobile_reality_grpc",
    label: "Preset C — Mobile Reality gRPC",
    description: "VLESS + gRPC + REALITY на 443",
    category: "reality_mobile",
    defaults: {
      preset_id: "mobile_reality_grpc",
      port: 443,
      network: "grpc",
      security: "reality",
      flow: "",
      fingerprint: "firefox",
      server_name: "www.microsoft.com",
      query_strategy: "UseIPv4",
      sniff_quic: false,
      dns_mode: "no_direct_dns",
      mux_enabled: false,
      xudp_enabled: false,
      log_level: "warning",
    },
  },
  {
    id: "tls_ws_fallback",
    label: "Preset D — TLS WebSocket fallback",
    description: "VLESS + WS + TLS — нужен домен и валидный сертификат на сервере",
    category: "tls_cert_required",
    defaults: {
      preset_id: "tls_ws_fallback",
      port: 443,
      network: "ws",
      security: "tls",
      flow: "",
      fingerprint: "chrome",
      server_name: "",
      query_strategy: "UseIPv4",
      sniff_quic: false,
      dns_mode: "no_direct_dns",
      mux_enabled: false,
      xudp_enabled: false,
      log_level: "warning",
    },
  },
  {
    id: "trojan_tls",
    label: "Preset E — Trojan TLS",
    description: "Trojan + TCP + TLS — нужен домен и сертификат (не VLESS)",
    category: "tls_cert_required",
    defaults: {
      preset_id: "trojan_tls",
      port: 443,
      network: "tcp",
      security: "tls",
      flow: "",
      fingerprint: "chrome",
      server_name: "",
      query_strategy: "UseIPv4",
      sniff_quic: false,
      dns_mode: "default",
      mux_enabled: false,
      xudp_enabled: false,
      log_level: "warning",
    },
  },
];

/** Устаревший WS+REALITY — только для отображения предупреждения. */
export const DEPRECATED_WS_REALITY_NOTE =
  "WS + REALITY некорректен для fallback. Используйте Preset D: VLESS + WS + TLS с доменом и сертификатом.";

export function experimentInboundTag(id: number): string {
  return `${EXPERIMENT_INBOUND_PREFIX}${id}`;
}

export function isExperimentInboundTag(tag: string): boolean {
  return tag.startsWith(EXPERIMENT_INBOUND_PREFIX);
}

export function randomExpPath(): string {
  return `/exp-${randomBytes(4).toString("hex")}`;
}

export function randomGrpcService(): string {
  return `expgrpc${randomBytes(3).toString("hex")}`;
}

export function mergePresetOptions(input: ExperimentCreateOptions): ExperimentCreateOptions {
  const preset =
    input.preset_id && input.preset_id !== "custom"
      ? EXPERIMENT_PRESETS.find((p) => p.id === input.preset_id)
      : undefined;
  const d = preset?.defaults;
  return {
    name: input.name.trim() || preset?.label || "EXP-тест",
    server_id: input.server_id,
    preset_id: input.preset_id ?? preset?.id ?? "custom",
    port: input.port ?? d?.port ?? MOBILE_TEST_PORT,
    network: input.network ?? d?.network ?? "tcp",
    security: input.security ?? d?.security ?? "reality",
    flow: input.flow !== undefined ? input.flow : (d?.flow ?? "xtls-rprx-vision"),
    fingerprint: input.fingerprint ?? d?.fingerprint ?? "chrome",
    server_name: input.server_name ?? d?.server_name ?? "www.microsoft.com",
    query_strategy: input.query_strategy ?? d?.query_strategy ?? "UseIPv4",
    sniff_quic: input.sniff_quic ?? d?.sniff_quic ?? false,
    dns_mode: input.dns_mode ?? d?.dns_mode ?? "default",
    mux_enabled: input.mux_enabled ?? d?.mux_enabled ?? false,
    xudp_enabled: input.xudp_enabled ?? d?.xudp_enabled ?? false,
    mtu: input.mtu !== undefined ? input.mtu : (d?.mtu ?? null),
    log_level: input.log_level ?? d?.log_level ?? "warning",
    force_non_443: input.force_non_443,
    replace_443_slot: input.replace_443_slot,
  };
}

export function presetById(id: string): ExperimentPresetDef | undefined {
  return EXPERIMENT_PRESETS.find((p) => p.id === id);
}
