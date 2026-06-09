import type { ServerRow, VpnExperimentRow } from "./db.js";
import { experimentFpForClient } from "./experimentLink.js";

/** Клиентский JSON в стиле рабочего EXP-16 (Happ / v2rayN). */
export function buildExp16ClientJson(host: string, exp: VpnExperimentRow, remarks?: string): Record<string, unknown> {
  const fp = experimentFpForClient(exp.fingerprint);
  const sni = (exp.server_name ?? "www.apple.com").trim();
  const flow = (exp.flow ?? "xtls-rprx-vision").trim() || "xtls-rprx-vision";

  return {
    remarks: remarks ?? exp.name ?? "EXP-16",
    log: { loglevel: exp.log_level || "warning" },
    dns: {
      hosts: { "domain:googleapis.cn": "googleapis.com" },
      queryStrategy: exp.query_strategy || "UseIPv4",
      servers: [
        "1.1.1.1",
        { address: "1.1.1.1", port: 53, domains: [] as string[] },
        { address: "8.8.8.8", port: 53, domains: [] as string[] },
      ],
    },
    inbounds: [
      {
        tag: "socks",
        listen: "127.0.0.1",
        port: 10808,
        protocol: "socks",
        settings: { auth: "noauth", udp: true, userLevel: 8 },
        sniffing: {
          enabled: true,
          destOverride: exp.sniff_quic === 1 ? ["http", "tls", "quic"] : ["http", "tls"],
        },
      },
      {
        tag: "http",
        listen: "127.0.0.1",
        port: 10809,
        protocol: "http",
        settings: { userLevel: 8 },
        sniffing: {
          enabled: true,
          destOverride: exp.sniff_quic === 1 ? ["http", "tls", "quic"] : ["http", "tls"],
        },
      },
      {
        tag: "metrics_in",
        listen: "127.0.0.1",
        port: 11111,
        protocol: "dokodemo-door",
        settings: { address: "127.0.0.1" },
      },
    ],
    outbounds: [
      {
        tag: "proxy",
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: host,
              port: exp.port,
              users: [
                {
                  id: exp.vless_uuid,
                  encryption: "none",
                  flow,
                  level: 8,
                  security: "auto",
                },
              ],
            },
          ],
        },
        streamSettings: {
          network: "tcp",
          security: "reality",
          realitySettings: {
            show: false,
            fingerprint: fp,
            serverName: sni,
            publicKey: exp.reality_pbk,
            shortId: exp.reality_sid,
            spiderX: (exp.reality_spx ?? "/").trim() || "/",
            allowInsecure: false,
          },
          tcpSettings: { header: { type: "none" } },
        },
        mux: {
          enabled: false,
          concurrency: -1,
          xudpConcurrency: 8,
          xudpProxyUDP443: "",
        },
      },
      {
        tag: "direct",
        protocol: "freedom",
        settings: { domainStrategy: "UseIP" },
      },
      {
        tag: "block",
        protocol: "blackhole",
        settings: { response: { type: "http" } },
      },
    ],
    routing: {
      domainStrategy: "IPIfNonMatch",
      rules: [
        { inboundTag: ["metrics_in"], outboundTag: "metrics_out" },
        { inboundTag: ["socks"], outboundTag: "proxy", port: "53" },
        { ip: ["1.1.1.1"], outboundTag: "proxy", port: "53" },
        { ip: ["8.8.8.8"], outboundTag: "direct", port: "53" },
      ],
    },
    policy: {
      levels: {
        "0": { statsUserDownlink: true, statsUserUplink: true },
        "8": { handshake: 4, connIdle: 300, uplinkOnly: 1, downlinkOnly: 1 },
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true,
      },
    },
    metrics: { tag: "metrics_out" },
    stats: {},
  };
}

export function buildExp16ClientJsonForServer(server: ServerRow, exp: VpnExperimentRow): Record<string, unknown> {
  if (exp.status !== "deployed") {
    throw new Error("experiment_not_deployed");
  }
  return buildExp16ClientJson(server.host, exp);
}
