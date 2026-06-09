import type { ServerRow, UserRow } from "./db.js";
import type { ServerSubscriptionSettings } from "./serverSubscriptionSettings.js";
import {
  resolveSubscriptionAddress,
  resolveSubscriptionRemarks,
  resolveSubscriptionEncryption,
  resolveSubscriptionFlow,
} from "./serverSubscriptionSettings.js";
import { buildClientStreamSettings, buildServerDnsBlock } from "./subscriptionXrayShared.js";

/** Полный клиентский JSON подписки для одного сервера (Happ / v2rayN). */
export function buildServerSubscriptionClientJson(
  server: ServerRow,
  user: Pick<UserRow, "vless_uuid" | "name" | "flow">,
  settings: ServerSubscriptionSettings,
): Record<string, unknown> {
  const address = resolveSubscriptionAddress(server, settings);
  const remarks = resolveSubscriptionRemarks(server, settings, user);
  const flow = resolveSubscriptionFlow(settings);
  const encryption = resolveSubscriptionEncryption(settings);
  const userEntry: Record<string, unknown> = {
    id: user.vless_uuid,
    encryption,
    level: 8,
    security: "auto",
  };
  if (flow) userEntry.flow = flow;

  const dnsBlock = buildServerDnsBlock(settings);

  return {
    remarks,
    log: { loglevel: "warning" },
    dns: dnsBlock,
    inbounds: [
      {
        tag: "socks",
        listen: "127.0.0.1",
        port: 10808,
        protocol: "socks",
        settings: { auth: "noauth", udp: true, userLevel: 8 },
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] },
      },
      {
        tag: "http",
        listen: "127.0.0.1",
        port: 10809,
        protocol: "http",
        settings: { userLevel: 8 },
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] },
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
              address,
              port: settings.vless_port,
              users: [userEntry],
            },
          ],
        },
        streamSettings: buildClientStreamSettings(settings),
        mux: {
          enabled: settings.mux.enabled,
          concurrency: settings.mux.concurrency,
          xudpConcurrency: settings.mux.xudp_concurrency,
          xudpProxyUDP443: settings.mux.xudp_proxy_udp443,
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

export function buildSubscriptionPreviewSummary(
  server: ServerRow,
  user: Pick<UserRow, "vless_uuid" | "name" | "flow">,
  settings: ServerSubscriptionSettings,
): Record<string, unknown> {
  return {
    address: resolveSubscriptionAddress(server, settings),
    port: settings.vless_port,
    encryption: resolveSubscriptionEncryption(settings),
    authMode: settings.vless?.auth_mode || null,
    flow: resolveSubscriptionFlow(settings) || null,
    fingerprint: settings.reality.fingerprint,
    publicKey: settings.reality.public_key,
    serverName: settings.reality.server_name,
    shortId: settings.reality.short_id,
    spiderX: settings.reality.spider_x,
    network: settings.network,
    security: settings.security,
    allowInsecure: settings.reality.allow_insecure,
    show: settings.reality.show,
    mux: settings.mux,
    dns: { queryStrategy: settings.dns.query_strategy, servers: settings.dns.servers },
    sniffing: settings.sniffing,
    remarks: resolveSubscriptionRemarks(server, settings, user),
    user_uuid: user.vless_uuid,
    server_push: ["inbound", "dns", "sniffing", "clients"],
    client_only: ["mux", "remarks", "address", "local inbounds", "routing"],
  };
}
