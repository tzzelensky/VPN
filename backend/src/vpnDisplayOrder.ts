/** Ключи порядка отображения VPN: vless:1 | hy2:1 | vault:5 | whitelist:3 */

export type VpnDisplayKind = "vless" | "hy2" | "vault" | "whitelist";

export type VpnDisplayEntryRef = {
  kind: VpnDisplayKind;
  id: number;
  key: string;
};

const KIND_RE = /^(vless|hy2|vault|whitelist):(\d+)$/;

export function makeVpnEntryKey(kind: VpnDisplayKind, id: number): string {
  return `${kind}:${Math.floor(id)}`;
}

export function parseVpnEntryKey(raw: unknown): VpnDisplayEntryRef | null {
  const m = KIND_RE.exec(String(raw ?? "").trim());
  if (!m) return null;
  const id = Math.floor(Number(m[2]));
  if (!Number.isFinite(id) || id <= 0) return null;
  const kind = m[1] as VpnDisplayKind;
  return { kind, id, key: makeVpnEntryKey(kind, id) };
}

export function normalizeVpnEntryOrder(order: unknown, availableKeys: string[]): string[] {
  const valid = new Set(availableKeys);
  const seen = new Set<string>();
  const out: string[] = [];
  if (Array.isArray(order)) {
    for (const item of order) {
      const parsed = parseVpnEntryKey(item);
      if (!parsed || !valid.has(parsed.key) || seen.has(parsed.key)) continue;
      seen.add(parsed.key);
      out.push(parsed.key);
    }
  }
  for (const key of availableKeys) {
    if (seen.has(key)) continue;
    out.push(key);
  }
  return out;
}

/** Из legacy serverOrder → entry keys (только vless; hy2/vault/wl допишет normalize по available). */
export function entryOrderFromServerOrder(serverOrder: unknown): string[] {
  if (!Array.isArray(serverOrder)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of serverOrder) {
    const id = Math.floor(Number(x));
    if (!Number.isFinite(id) || id <= 0) continue;
    const key = makeVpnEntryKey("vless", id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function vlessIdsFromEntryOrder(entryOrder: string[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of entryOrder) {
    const p = parseVpnEntryKey(raw);
    if (!p || p.kind !== "vless" || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p.id);
  }
  return out;
}
