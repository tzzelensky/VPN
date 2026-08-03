import type { ServerRow } from "./db.js";
import { listServersOrdered } from "./db.js";
import { HYSTERIA2_STATS_LISTEN } from "./hysteria2Constants.js";
import { sshExecCommand, type SshLog } from "./ssh.js";
import type { UserTrafficAgg } from "./xrayStatsPull.js";

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** tx = server→client (down), rx = client→server (up). */
export async function pullHysteria2TrafficFromServer(
  row: ServerRow,
  log?: SshLog,
): Promise<{ byUuid: Map<string, UserTrafficAgg>; warn?: string }> {
  const secret = String(row.hysteria2_stats_secret ?? "").trim();
  if (!secret) {
    return { byUuid: new Map(), warn: "нет hysteria2_stats_secret" };
  }
  const cfg = {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
  const url = `http://${HYSTERIA2_STATS_LISTEN}/traffic`;
  const cmd = `curl -fsS -H ${shellQuote(`Authorization: ${secret}`)} ${shellQuote(url)} 2>/dev/null || true`;
  const r = await sshExecCommand(cfg, cmd);
  const raw = r.stdout.trim();
  if (!raw) {
    return { byUuid: new Map(), warn: "пустой ответ Traffic Stats API" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { byUuid: new Map(), warn: `не JSON от /traffic: ${raw.slice(0, 120)}` };
  }
  const byUuid = new Map<string, UserTrafficAgg>();
  if (!parsed || typeof parsed !== "object") return { byUuid };
  for (const [id, stats] of Object.entries(parsed as Record<string, unknown>)) {
    const key = String(id).trim().toLowerCase();
    if (!key || key === "__placeholder__") continue;
    const o = (stats ?? {}) as { tx?: unknown; rx?: unknown };
    const down = Math.max(0, Math.floor(Number(o.tx) || 0));
    const up = Math.max(0, Math.floor(Number(o.rx) || 0));
    byUuid.set(key, { up, down, online: 0 });
  }
  log?.(`Hysteria2 ${row.host}: ${byUuid.size} user stats`);
  return { byUuid };
}

export async function pullHysteria2TrafficFromAllServers(log?: SshLog): Promise<{
  byUuid: Map<string, UserTrafficAgg>;
  errors: string[];
  warns: string[];
}> {
  const errors: string[] = [];
  const warns: string[] = [];
  const merged = new Map<string, UserTrafficAgg>();
  const servers = listServersOrdered().filter((r) => r.hysteria2_deployed === 1);
  if (servers.length === 0) return { byUuid: merged, errors, warns };

  const results = await Promise.all(
    servers.map(async (row) => {
      try {
        const pulled = await pullHysteria2TrafficFromServer(row, log);
        return { ok: true as const, row, ...pulled };
      } catch (e) {
        return { ok: false as const, host: row.host, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  for (const result of results) {
    if (!result.ok) {
      errors.push(`hy2 ${result.host}: ${result.error}`);
      continue;
    }
    if (result.warn) warns.push(`hy2 ${result.row.host}: ${result.warn}`);
    for (const [uuid, v] of result.byUuid) {
      const cur = merged.get(uuid) ?? { up: 0, down: 0, online: 0 };
      cur.up += v.up;
      cur.down += v.down;
      cur.online += v.online;
      merged.set(uuid, cur);
    }
  }
  return { byUuid: merged, errors, warns };
}
