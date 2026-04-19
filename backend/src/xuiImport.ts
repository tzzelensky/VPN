import { coerceExpiryTimeMs, type CreateUserInput } from "./db.js";
import { defaultRealityFlow, normalizeFlow } from "./realityKeygen.js";

export type XuiImportResult = { ok: true; data: CreateUserInput } | { ok: false; error: string };

/**
 * Разбор экспорта inbound x-ui (один JSON-объект с полями settings/streamSettings строками).
 */
export function parseXuiInboundImport(raw: unknown): XuiImportResult {
  try {
    let obj: Record<string, unknown>;
    if (typeof raw === "string") {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } else if (raw && typeof raw === "object") {
      obj = raw as Record<string, unknown>;
    } else {
      return { ok: false, error: "Ожидался JSON-объект или строка." };
    }

    const settingsStr = obj.settings;
    if (typeof settingsStr !== "string") {
      return { ok: false, error: "Нет строкового поля settings (как в x-ui)." };
    }
    const settings = JSON.parse(settingsStr) as { clients?: Array<Record<string, unknown>> };
    const c = settings.clients?.[0];
    if (!c || typeof c.id !== "string") {
      return { ok: false, error: "В settings.clients[0] нет id (UUID)." };
    }

    let reality_pbk = "";
    let reality_fp = "chrome";
    let reality_sni = "";
    let reality_sid = "";
    let reality_spx = "/";

    const streamStr = obj.streamSettings;
    if (typeof streamStr === "string") {
      const ss = JSON.parse(streamStr) as {
        security?: string;
        realitySettings?: Record<string, unknown>;
      };
      if (ss.security === "reality" && ss.realitySettings) {
        const rs = ss.realitySettings;
        const st = rs.settings as Record<string, unknown> | undefined;
        reality_pbk = String(st?.publicKey ?? "");
        reality_fp = String(st?.fingerprint ?? "chrome");
        reality_sni = Array.isArray(rs.serverNames) ? String(rs.serverNames[0] ?? "") : "";
        reality_sid = Array.isArray(rs.shortIds) ? String(rs.shortIds[0] ?? "") : "";
        reality_spx = String(st?.spiderX ?? rs.spiderX ?? "/") || "/";
      }
    }

    const portRaw = obj.port;
    const remote_port =
      typeof portRaw === "number" && portRaw > 0
        ? portRaw
        : typeof portRaw === "string" && Number(portRaw) > 0
          ? Number(portRaw)
          : null;

    const remark = String(obj.remark ?? "").trim();
    const email = String(c.email ?? "").trim();
    const subId = String(c.subId ?? "").trim();
    const flow = normalizeFlow(String(c.flow ?? "")) || defaultRealityFlow();
    const totalGB = Number(c.totalGB ?? 0) || 0;
    const expiryRaw = Number(c.expiryTime ?? obj.expiryTime ?? 0) || 0;
    const expiryTime = coerceExpiryTimeMs(expiryRaw);
    const enable = c.enable === false ? 0 : 1;
    const tgId = String(c.tgId ?? "").trim();
    const comment = String(c.comment ?? "").trim();

    let traffic_up = Number(c.up ?? obj.up ?? 0) || 0;
    let traffic_down = Number(c.down ?? obj.down ?? 0) || 0;
    const stats = obj.clientStats;
    if (Array.isArray(stats) && stats[0] && typeof stats[0] === "object") {
      const s0 = stats[0] as Record<string, unknown>;
      traffic_up = Number(s0.up ?? traffic_up) || 0;
      traffic_down = Number(s0.down ?? traffic_down) || 0;
    }

    const data: CreateUserInput = {
      name: remark || email || "import",
      email: email || remark || "user",
      vless_uuid: String(c.id),
      sub_token: subId && /^[a-zA-Z0-9_-]{8,64}$/.test(subId) ? subId : undefined,
      flow,
      total_gb: totalGB,
      expiry_time: expiryTime,
      enable,
      tg_id: tgId,
      comment,
      traffic_up,
      traffic_down,
      remote_port,
      reality_pbk,
      reality_fp,
      reality_sni,
      reality_sid,
      reality_spx,
      subscription_server_count: 0,
    };

    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
