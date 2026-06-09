import { randomUUID } from "node:crypto";

export type ExtraVlessLink = {
  id: string;
  uri: string;
  label: string;
};

export function labelFromVlessUri(uri: string): string {
  const hash = uri.indexOf("#");
  if (hash < 0) return "VLESS";
  try {
    const raw = uri.slice(hash + 1);
    return decodeURIComponent(raw).trim() || "VLESS";
  } catch {
    return uri.slice(hash + 1).trim() || "VLESS";
  }
}

export function isValidVlessUri(raw: string): boolean {
  const s = raw.trim();
  if (!/^vless:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "vless:" && Boolean(u.hostname);
  } catch {
    return false;
  }
}

export function isValidHysteriaUri(raw: string): boolean {
  const s = raw.trim();
  if (!/^hysteria2:\/\//i.test(s) && !/^hysteria:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "hysteria2:" || u.protocol === "hysteria:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

export function isValidTrojanUri(raw: string): boolean {
  const s = raw.trim();
  if (!/^trojan:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    const pass = decodeURIComponent(u.username || "").trim();
    return u.protocol === "trojan:" && Boolean(u.hostname) && Boolean(pass);
  } catch {
    return false;
  }
}

/** VLESS, Trojan или Hysteria/Hysteria2 — конфиг-хранилище и подписки. */
export function isValidConfigVaultUri(raw: string): boolean {
  return isValidVlessUri(raw) || isValidHysteriaUri(raw) || isValidTrojanUri(raw);
}

/** VLESS или Hysteria/Hysteria2 — форматы подписки для «Белых списков». */
export function isValidWhitelistVaultUri(raw: string): boolean {
  return isValidConfigVaultUri(raw);
}

export function labelFromProxyUri(uri: string): string {
  if (/^vless:\/\//i.test(uri)) return labelFromVlessUri(uri);
  if (/^trojan:\/\//i.test(uri)) {
    const hash = uri.indexOf("#");
    if (hash < 0) return "Trojan";
    try {
      const raw = uri.slice(hash + 1);
      return decodeURIComponent(raw).trim() || "Trojan";
    } catch {
      return uri.slice(hash + 1).trim() || "Trojan";
    }
  }
  const hash = uri.indexOf("#");
  if (hash < 0) return "Hysteria";
  try {
    const raw = uri.slice(hash + 1);
    return decodeURIComponent(raw).trim() || "Hysteria";
  } catch {
    return uri.slice(hash + 1).trim() || "Hysteria";
  }
}

export function normalizeExtraVlessLinks(raw: unknown): ExtraVlessLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtraVlessLink[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let uri = "";
    let id = "";
    if (typeof item === "string") {
      uri = item.trim();
      id = randomUUID();
    } else if (item && typeof item === "object") {
      const o = item as { id?: unknown; uri?: unknown };
      uri = String(o.uri ?? "").trim();
      id = String(o.id ?? "").trim() || randomUUID();
    } else {
      continue;
    }
    if (!isValidVlessUri(uri)) continue;
    const key = uri.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, uri, label: labelFromVlessUri(uri) });
  }
  return out;
}

export function coerceExtraVlessLinksInput(input: unknown): ExtraVlessLink[] | undefined {
  if (input === undefined) return undefined;
  return normalizeExtraVlessLinks(input);
}
