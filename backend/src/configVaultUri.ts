import { randomUUID } from "node:crypto";
import {
  isValidConfigVaultUri,
  isValidHysteriaUri,
  isValidTrojanUri,
  isValidVlessUri,
  isValidWhitelistVaultUri,
  labelFromProxyUri,
} from "./extraVless.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Идентификатор клиента в VLESS URI (UUID, числовой id, произвольная строка). */
export function isValidVlessUserId(s: string): boolean {
  const v = String(s ?? "").trim();
  if (!v || v.length > 512) return false;
  if (/\s/.test(v)) return false;
  return true;
}

/** RFC UUID (для справки / строгих случаев). */
export function isValidUuid(s: string): boolean {
  return UUID_RE.test(String(s ?? "").trim());
}

export type ParsedVlessParams = {
  address: string;
  port: number;
  uuid: string;
  network: string;
  security: string;
  flow: string;
  sni: string;
  fingerprint: string;
  publicKey: string;
  shortId: string;
  remark: string;
};

export function parseVlessUri(raw: string): ParsedVlessParams | null {
  const uri = raw.trim();
  if (!isValidVlessUri(uri)) return null;
  try {
    const u = new URL(uri);
    const uuid = decodeURIComponent(u.username || "").trim();
    const address = u.hostname.trim();
    const port = u.port ? Number(u.port) : 443;
    if (!address || !Number.isFinite(port) || port < 1 || port > 65535) return null;
    if (!isValidVlessUserId(uuid)) return null;
    const q = u.searchParams;
    const network = (q.get("type") || "tcp").trim().toLowerCase();
    const security = (q.get("security") || "none").trim().toLowerCase();
    const flow = (q.get("flow") || "").trim();
    const sni = (q.get("sni") || q.get("serverName") || "").trim();
    const fingerprint = (q.get("fp") || "").trim();
    const publicKey = (q.get("pbk") || "").trim();
    const shortId = (q.get("sid") || "").trim();
    let remark = "";
    if (u.hash.length > 1) {
      try {
        remark = decodeURIComponent(u.hash.slice(1)).trim();
      } catch {
        remark = u.hash.slice(1).trim();
      }
    }
    return {
      address,
      port: Math.floor(port),
      uuid,
      network,
      security,
      flow,
      sni,
      fingerprint,
      publicKey,
      shortId,
      remark,
    };
  } catch {
    return null;
  }
}

function maskMiddle(value: string, head = 4, tail = 0): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (v.length <= head + tail + 2) return "****";
  return `${v.slice(0, head)}****${tail > 0 ? v.slice(-tail) : ""}`;
}

/** Маскированная ссылка для UI и логов (без полного uuid и секретов в query). */
export function maskVlessUri(raw: string): string {
  return maskProxyUri(raw);
}

export function maskProxyUri(raw: string): string {
  const uri = raw.trim();
  if (!uri) return "";
  try {
    const u = new URL(uri);
    const user = decodeURIComponent(u.username || "");
    const maskedUser = maskMiddle(user, 4, 0);
    const host = u.hostname;
    const port = u.port || "443";
    const hasQuery = u.search.length > 1;
    const hash = u.hash ? u.hash : "";
    const scheme = u.protocol.replace(/:$/, "");
    return `${scheme}://${maskedUser}@${host}:${port}${hasQuery ? "?..." : ""}${hash ? hash : ""}`;
  } catch {
    const at = uri.indexOf("@");
    if (at > 8) {
      const prefix = uri.slice(0, at + 1);
      const rest = uri.slice(at);
      return `${prefix}****${rest.length > 40 ? rest.slice(0, 40) + "..." : rest}`;
    }
    return maskMiddle(uri, 12, 4);
  }
}

export function validateConfigVaultKeyInput(
  name: string,
  rawUri: string,
  existingUris: string[],
): string | null {
  const n = name.trim();
  if (!n) return "Укажите название ключа";
  const uri = rawUri.trim();
  if (!isValidConfigVaultUri(uri)) {
    return "Ссылка должна начинаться с vless://, trojan:// или hysteria2://";
  }
  const parsed = parseProxyUri(uri);
  if (!parsed) return "Некорректная ссылка (адрес, порт или авторизация)";
  const key = uri.toLowerCase();
  if (existingUris.some((x) => x.trim().toLowerCase() === key)) {
    return "Такой ключ уже есть в хранилище";
  }
  return null;
}

/** @deprecated Используйте validateConfigVaultKeyInput */
export function validateVlessKeyInput(name: string, rawUri: string, existingUris: string[]): string | null {
  return validateConfigVaultKeyInput(name, rawUri, existingUris);
}

/** Меняет фрагмент #… в vless:// или hysteria2:// (название в клиенте). */
export function setProxyUriRemark(rawUri: string, remark: string): string | null {
  const uri = rawUri.trim();
  if (!isValidWhitelistVaultUri(uri)) return null;
  const name = remark.trim().slice(0, 120);
  if (!name) return null;
  const hash = `#${encodeURIComponent(name)}`;
  const cut = uri.indexOf("#");
  const next = cut >= 0 ? uri.slice(0, cut) + hash : uri + hash;
  return parseProxyUri(next) ? next : null;
}

export function defaultNameFromUri(uri: string, fallback = "VLESS"): string {
  const parsed = parseProxyUri(uri);
  if (parsed?.remark) return parsed.remark.slice(0, 120);
  return labelFromProxyUri(uri).slice(0, 120) || fallback;
}

export function parseTrojanUri(raw: string): ParsedVlessParams | null {
  const uri = raw.trim();
  if (!isValidTrojanUri(uri)) return null;
  try {
    const u = new URL(uri);
    const password = decodeURIComponent(u.username || "").trim();
    const address = u.hostname.trim();
    const port = u.port ? Number(u.port) : 443;
    if (!address || !password || !Number.isFinite(port) || port < 1 || port > 65535) return null;
    const q = u.searchParams;
    const network = (q.get("type") || "tcp").trim().toLowerCase();
    const security = (q.get("security") || "tls").trim().toLowerCase();
    const sni = (q.get("sni") || q.get("peer") || "").trim();
    const fingerprint = (q.get("fp") || "").trim();
    let remark = "";
    if (u.hash.length > 1) {
      try {
        remark = decodeURIComponent(u.hash.slice(1)).trim();
      } catch {
        remark = u.hash.slice(1).trim();
      }
    }
    return {
      address,
      port: Math.floor(port),
      uuid: password,
      network,
      security,
      flow: "",
      sni,
      fingerprint,
      publicKey: "",
      shortId: "",
      remark,
    };
  } catch {
    return null;
  }
}

export function parseProxyUri(raw: string): ParsedVlessParams | null {
  const vless = parseVlessUri(raw);
  if (vless) return vless;
  const trojan = parseTrojanUri(raw);
  if (trojan) return trojan;
  const uri = raw.trim();
  if (!isValidHysteriaUri(uri)) return null;
  try {
    const u = new URL(uri);
    const auth = decodeURIComponent(u.username || "").trim();
    const address = u.hostname.trim();
    const port = u.port ? Number(u.port) : 443;
    if (!address || !auth || !Number.isFinite(port) || port < 1 || port > 65535) return null;
    const q = u.searchParams;
    const sni = (q.get("sni") || q.get("serverName") || "").trim();
    const fingerprint = (q.get("fp") || "").trim();
    let remark = "";
    if (u.hash.length > 1) {
      try {
        remark = decodeURIComponent(u.hash.slice(1)).trim();
      } catch {
        remark = u.hash.slice(1).trim();
      }
    }
    return {
      address,
      port: Math.floor(port),
      uuid: auth,
      network: u.protocol === "hysteria2:" ? "hysteria2" : "hysteria",
      security: "tls",
      flow: "",
      sni,
      fingerprint,
      publicKey: "",
      shortId: "",
      remark,
    };
  } catch {
    return null;
  }
}

export function newVaultKeyId(): string {
  return randomUUID();
}

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : null;
}

/** Сборка vless:// из outbound Xray/Happ (protocol vless). */
function buildVlessUriFromOutbound(
  outbound: JsonRecord,
  remarks: string,
): { uri: string; name: string } | { error: string } {
  const settings = asRecord(outbound.settings);
  const vnextArr = settings && Array.isArray(settings.vnext) ? settings.vnext : [];
  const vnext = asRecord(vnextArr[0]);
  if (!vnext) return { error: "Не найден settings.vnext[0]" };

  const address = String(vnext.address ?? "").trim();
  const port = Math.floor(Number(vnext.port) || 443);
  if (!address) return { error: "Пустой address в vnext" };
  if (port < 1 || port > 65535) return { error: "Некорректный port в vnext" };

  const usersArr = Array.isArray(vnext.users) ? vnext.users : [];
  const user0 = asRecord(usersArr[0]);
  if (!user0) return { error: "Не найден users[0] в vnext" };

  const uuid = String(user0.id ?? "").trim();
  if (!isValidVlessUserId(uuid)) return { error: "Некорректный id пользователя в vnext" };

  const flow = String(user0.flow ?? "").trim();
  const encryption = String(user0.encryption ?? "none").trim() || "none";

  const stream = asRecord(outbound.streamSettings);
  const network = String(stream?.network ?? "tcp").trim().toLowerCase() || "tcp";
  const security = String(stream?.security ?? "none").trim().toLowerCase() || "none";

  const q = new URLSearchParams();
  q.set("encryption", encryption);
  q.set("type", network);
  if (security && security !== "none") q.set("security", security);
  if (flow) q.set("flow", flow);

  if (security === "reality") {
    const rs = asRecord(stream?.realitySettings);
    const sni = String(rs?.serverName ?? rs?.servername ?? "").trim();
    const fp = String(rs?.fingerprint ?? "").trim();
    const pbk = String(rs?.publicKey ?? "").trim();
    const sid = String(rs?.shortId ?? rs?.shortid ?? "").trim();
    if (sni) q.set("sni", sni);
    if (fp) q.set("fp", fp);
    if (pbk) q.set("pbk", pbk);
    if (sid) q.set("sid", sid);
  } else if (security === "tls") {
    const tls = asRecord(stream?.tlsSettings);
    const sni = String(tls?.serverName ?? "").trim();
    if (sni) q.set("sni", sni);
  }

  if (network === "grpc") {
    const gs = asRecord(stream?.grpcSettings);
    const serviceName = String(gs?.serviceName ?? "").trim();
    if (serviceName) q.set("serviceName", serviceName);
  } else if (network === "ws") {
    const ws = asRecord(stream?.wsSettings);
    const path = String(ws?.path ?? "").trim();
    if (path) q.set("path", path);
    const headers = asRecord(ws?.headers);
    const host = String(headers?.Host ?? headers?.host ?? "").trim();
    if (host) q.set("host", host);
  } else if (network === "tcp") {
    const tcp = asRecord(stream?.tcpSettings);
    const header = asRecord(tcp?.header);
    const request = asRecord(header?.request);
    const pathArr = request && Array.isArray(request.path) ? request.path : [];
    const path = String(pathArr[0] ?? "").trim();
    if (path) q.set("path", path);
  }

  const tag = String(outbound.tag ?? "").trim();
  const hashName = remarks || tag || `${address}:${port}`;
  const hash = `#${encodeURIComponent(hashName)}`;
  const uri = `vless://${encodeURIComponent(uuid)}@${address}:${port}?${q.toString()}${hash}`;
  if (!parseVlessUri(uri)) return { error: "Не удалось собрать корректную VLESS-ссылку из JSON" };

  const name =
    (tag && remarks ? `${remarks} · ${tag}` : remarks || tag || defaultNameFromUri(uri, "Белый список")).slice(
      0,
      120,
    ) || `Белый список ${address}`;
  return { uri, name };
}

/** Сборка hysteria2:// из outbound Happ/Finalmask (protocol hysteria, version 2). */
function buildHysteria2UriFromOutbound(
  outbound: JsonRecord,
  remarks: string,
): { uri: string; name: string } | { error: string } {
  const settings = asRecord(outbound.settings);
  const address = String(settings?.address ?? "").trim();
  const port = Math.floor(Number(settings?.port) || 443);
  if (!address) return { error: "Пустой address в hysteria outbound" };
  if (port < 1 || port > 65535) return { error: "Некорректный port в hysteria outbound" };

  const stream = asRecord(outbound.streamSettings);
  const hs = asRecord(stream?.hysteriaSettings) ?? asRecord(stream?.hysteria2Settings);
  const auth = String(hs?.auth ?? settings?.auth ?? settings?.password ?? "").trim();
  if (!auth) return { error: "Не найден auth в hysteria outbound" };

  const version = Math.floor(Number(settings?.version ?? hs?.version ?? 2));
  if (version !== 2) return { error: "Поддерживается только Hysteria v2 (version: 2)" };

  const tls = asRecord(stream?.tlsSettings);
  const sni = String(tls?.serverName ?? tls?.servername ?? "").trim();
  const fp = String(tls?.fingerprint ?? "").trim();
  const insecure = tls?.allowInsecure === true ? "1" : "0";

  const q = new URLSearchParams();
  q.set("insecure", insecure);
  if (sni) q.set("sni", sni);
  if (fp) q.set("fp", fp);

  const tag = String(outbound.tag ?? "").trim();
  const hashName = (tag && remarks ? `${remarks} · ${tag}` : remarks || tag || `${address}:${port}`).slice(0, 120);
  const uri = `hysteria2://${encodeURIComponent(auth)}@${address}:${port}/?${q.toString()}#${encodeURIComponent(hashName)}`;
  if (!parseProxyUri(uri)) return { error: "Не удалось собрать корректную hysteria2-ссылку из JSON" };

  return { uri, name: hashName || `Белый список ${address}` };
}

/** Сборка trojan:// из outbound Xray/Happ (protocol trojan). */
function buildTrojanUriFromOutbound(
  outbound: JsonRecord,
  remarks: string,
): { uri: string; name: string } | { error: string } {
  const settings = asRecord(outbound.settings);
  const serversArr = settings && Array.isArray(settings.servers) ? settings.servers : [];
  const srv = asRecord(serversArr[0]);
  if (!srv) return { error: "Не найден settings.servers[0]" };

  const address = String(srv.address ?? "").trim();
  const port = Math.floor(Number(srv.port) || 443);
  const password = String(srv.password ?? "").trim();
  if (!address) return { error: "Пустой address в trojan servers" };
  if (!password) return { error: "Пустой password в trojan servers" };
  if (port < 1 || port > 65535) return { error: "Некорректный port в trojan servers" };

  const stream = asRecord(outbound.streamSettings);
  const network = String(stream?.network ?? "tcp").trim().toLowerCase() || "tcp";
  const security = String(stream?.security ?? "tls").trim().toLowerCase() || "tls";

  const q = new URLSearchParams();
  q.set("security", security);
  q.set("type", network);
  if (security === "tls") {
    const tls = asRecord(stream?.tlsSettings);
    const sni = String(tls?.serverName ?? tls?.servername ?? "").trim();
    const fp = String(tls?.fingerprint ?? "").trim();
    if (sni) q.set("sni", sni);
    if (fp) q.set("fp", fp);
    if (tls?.allowInsecure === true) q.set("allowInsecure", "1");
  } else if (network === "ws") {
    const ws = asRecord(stream?.wsSettings);
    const path = String(ws?.path ?? "").trim();
    if (path) q.set("path", path);
    const headers = asRecord(ws?.headers);
    const host = String(headers?.Host ?? headers?.host ?? "").trim();
    if (host) q.set("host", host);
  }

  const tag = String(outbound.tag ?? "").trim();
  const hashName = (tag && remarks ? `${remarks} · ${tag}` : remarks || tag || `${address}:${port}`).slice(0, 120);
  const uri = `trojan://${encodeURIComponent(password)}@${address}:${port}?${q.toString()}#${encodeURIComponent(hashName)}`;
  if (!parseTrojanUri(uri)) return { error: "Не удалось собрать корректную trojan-ссылку из JSON" };

  return { uri, name: hashName || `Ключ ${address}` };
}

/** Сборка vless://, trojan:// или hysteria2:// из JSON-конфига клиента (все proxy-outbound). */
export function buildProxyUrisFromClientJson(
  jsonText: string,
): { uris: { uri: string; name: string }[] } | { error: string } {
  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch {
    return { error: "Некорректный JSON" };
  }
  const obj = asRecord(root);
  if (!obj) return { error: "Ожидается JSON-объект" };

  const remarks = String(obj.remarks ?? "").trim();
  const outbounds = Array.isArray(obj.outbounds) ? obj.outbounds : [];
  const uris: { uri: string; name: string }[] = [];
  const protocols = new Set<string>();

  for (const item of outbounds) {
    const outbound = asRecord(item);
    if (!outbound) continue;
    const protocol = String(outbound.protocol ?? "").trim().toLowerCase();
    if (protocol !== "vless" && protocol !== "hysteria" && protocol !== "trojan") continue;
    protocols.add(protocol);

    const built =
      protocol === "vless"
        ? buildVlessUriFromOutbound(outbound, remarks)
        : protocol === "trojan"
          ? buildTrojanUriFromOutbound(outbound, remarks)
          : buildHysteria2UriFromOutbound(outbound, remarks);
    if ("error" in built) continue;
    uris.push(built);
  }

  if (uris.length === 0) {
    if (protocols.size > 0) {
      return {
        error: `Не удалось собрать ссылки из outbound (${[...protocols].join(", ")}). Проверьте address, port и auth/id.`,
      };
    }
    return {
      error: "В JSON не найден outbound с protocol: vless, trojan или hysteria",
    };
  }

  return { uris };
}

export type ConfigVaultJsonImportItem = { uri: string; name: string; active?: boolean };

/** Импорт: JSON-конфиг Xray/Happ или экспорт хранилища `{ keys: [{ name, uri }] }`. */
export function parseConfigVaultJsonImport(
  jsonText: string,
): { items: ConfigVaultJsonImportItem[] } | { error: string } {
  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch {
    return { error: "Некорректный JSON" };
  }
  const obj = asRecord(root);
  if (!obj) return { error: "Ожидается JSON-объект" };

  if (Array.isArray(obj.keys)) {
    const items: ConfigVaultJsonImportItem[] = [];
    for (const row of obj.keys) {
      const k = asRecord(row);
      if (!k) continue;
      const uri = String(k.uri ?? k.raw_uri ?? "").trim();
      if (!uri) continue;
      if (!isValidConfigVaultUri(uri)) continue;
      const name = String(k.name ?? "").trim() || defaultNameFromUri(uri, "Ключ");
      items.push({
        uri,
        name: name.slice(0, 120),
        active: !(k.active === false || k.active === 0 || k.active === "0"),
      });
    }
    if (items.length > 0) return { items };
    return { error: "В keys нет корректных ссылок (vless://, trojan://, hysteria2://)" };
  }

  const built = buildProxyUrisFromClientJson(jsonText);
  if ("error" in built) return built;
  return { items: built.uris.map((u) => ({ uri: u.uri, name: u.name })) };
}

/** Сборка vless:// из JSON-конфига Xray (первый vless/hysteria outbound). */
export function buildVlessUriFromXrayJson(jsonText: string): { uri: string; name: string } | { error: string } {
  const built = buildProxyUrisFromClientJson(jsonText);
  if ("error" in built) return built;
  return built.uris[0]!;
}

export function validateWhitelistKeyInput(
  name: string,
  rawUri: string,
  existingUris: string[],
): string | null {
  const n = name.trim();
  if (!n) return "Укажите название ключа";
  const uri = rawUri.trim();
  if (!isValidWhitelistVaultUri(uri)) {
    return "Ссылка должна начинаться с vless://, trojan:// или hysteria2://";
  }
  const parsed = parseProxyUri(uri);
  if (!parsed) return "Некорректная ссылка (адрес, порт или авторизация)";
  const key = uri.toLowerCase();
  if (existingUris.some((x) => x.trim().toLowerCase() === key)) {
    return "Такой ключ уже есть в белых списках";
  }
  return null;
}
