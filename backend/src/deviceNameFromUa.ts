export type ParsedDeviceInfo = {
  device_name: string;
  device_type: "android" | "iphone" | "ipad" | "windows" | "mac" | "linux" | "unknown";
};

function titleCaseWords(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function sanitizeToken(raw: string): string {
  return raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Имя пригодно для показа пользователю (не заглушка). */
export function isUsefulDeviceName(nameRaw: string | undefined | null): boolean {
  const name = String(nameRaw ?? "").trim();
  if (!name) return false;
  if (/^Устройство(?:\s+\d+)?$/i.test(name)) return false;
  if (/^Устройство\s*·\s*(?:\d{1,3}\.){3}\d{1,3}$/i.test(name)) return false;
  return true;
}

function parseHappParenthetical(ua: string): ParsedDeviceInfo | null {
  const m = ua.match(/\bHapp\/[\d.]+\s*\(([^)]+)\)/i);
  if (!m?.[1]) return null;
  const inner = m[1];
  const vpnClient = "Happ";

  const android = inner.match(/Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build|\))/i);
  if (android?.[1]) {
    const model = sanitizeToken(android[1]);
    return {
      device_name: model ? `${model} · ${vpnClient}` : `Android · ${vpnClient}`,
      device_type: "android",
    };
  }
  if (/Android/i.test(inner)) {
    return { device_name: `Android · ${vpnClient}`, device_type: "android" };
  }
  if (/iPhone/i.test(inner)) {
    return { device_name: `iPhone · ${vpnClient}`, device_type: "iphone" };
  }
  if (/iPad/i.test(inner)) {
    return { device_name: `iPad · ${vpnClient}`, device_type: "ipad" };
  }
  if (/Windows/i.test(inner)) {
    return { device_name: `Windows · ${vpnClient}`, device_type: "windows" };
  }
  if (/Mac OS X|Macintosh/i.test(inner)) {
    return { device_name: `macOS · ${vpnClient}`, device_type: "mac" };
  }
  if (/Linux/i.test(inner)) {
    return { device_name: `Linux · ${vpnClient}`, device_type: "linux" };
  }
  return { device_name: vpnClient, device_type: "unknown" };
}

function parseVpnClientName(ua: string): string {
  const match =
    ua.match(/\b(HSN\s*VPN|Happ|Nekoray|Hiddify(?:Next)?|v2rayN|v2rayNG|Shadowrocket|Streisand|FoXray|Mihomo|Clash(?:\s*Meta)?|Sing-Box|Xray(?:-core)?|SFA)\b/i) ??
    ua.match(/\b([A-Za-z][A-Za-z0-9._-]{2,24}\s*VPN)\b/i);
  if (!match?.[1]) return "";
  return sanitizeToken(match[1]);
}

/**
 * Стабильный ключ устройства из UA (без версии Happ/Android — они меняются при каждом запросе).
 * Используется для fp:… и дедупликации слотов.
 */
export function stableUserAgentFingerprintKey(uaRaw: string): string {
  const ua = String(uaRaw ?? "").trim();
  if (!ua) return "";
  const parsed = parseDeviceFromUserAgent(ua);
  const client = parseVpnClientName(ua) || "client";
  if (parsed.device_type !== "unknown" && isUsefulDeviceName(parsed.device_name)) {
    return `${parsed.device_type}|${parsed.device_name}|${client}`.toLowerCase();
  }
  return ua
    .replace(/\bHapp\/[\d.]+/gi, "Happ/x")
    .replace(/\bAndroid\s+[\d.]+/gi, "Android x")
    .replace(/\biOS\s+[\d._]+/gi, "iOS x")
    .toLowerCase();
}

/** Доп. подсказки из заголовков клиента (Happ и др.). */
export function parseDeviceFromRequest(req: {
  headers?: Record<string, string | string[] | undefined>;
}): ParsedDeviceInfo {
  const hdr = req.headers ?? {};
  const pick = (name: string): string => {
    const v = hdr[name.toLowerCase()] ?? hdr[name];
    if (Array.isArray(v)) return String(v[0] ?? "").trim();
    return String(v ?? "").trim();
  };
  const modelHint = pick("x-device-model") || pick("x-device-name") || pick("x-happ-device");
  if (modelHint && isUsefulDeviceName(modelHint)) {
    const ua = String(hdr["user-agent"] ?? "").trim();
    const client = parseVpnClientName(ua);
    return {
      device_name: client ? `${sanitizeToken(modelHint)} · ${client}` : sanitizeToken(modelHint),
      device_type: parseDeviceFromUserAgent(ua).device_type,
    };
  }
  return parseDeviceFromUserAgent(String(hdr["user-agent"] ?? "").trim());
}

export function parseDeviceFromUserAgent(uaRaw: string | undefined | null): ParsedDeviceInfo {
  const ua = String(uaRaw ?? "").trim();
  if (!ua) return { device_name: "Устройство", device_type: "unknown" };

  const happ = parseHappParenthetical(ua);
  if (happ) return happ;

  const vpnClient = parseVpnClientName(ua);

  const androidModel = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/i);
  if (androidModel?.[1]) {
    const model = sanitizeToken(androidModel[1]);
    if (/pixel/i.test(model)) {
      return { device_name: `${titleCaseWords(model)}${vpnClient ? ` · ${vpnClient}` : ""}`, device_type: "android" };
    }
    return { device_name: `${model}${vpnClient ? ` · ${vpnClient}` : ""}`, device_type: "android" };
  }
  if (/Android/i.test(ua)) {
    return { device_name: vpnClient ? `Android · ${vpnClient}` : "Android", device_type: "android" };
  }

  const iphone = ua.match(/iPhone(?: OS [\d_]+)?/i);
  if (iphone) return { device_name: vpnClient ? `iPhone · ${vpnClient}` : "iPhone", device_type: "iphone" };
  if (/iPad/i.test(ua)) return { device_name: vpnClient ? `iPad · ${vpnClient}` : "iPad", device_type: "ipad" };

  if (/Windows NT/i.test(ua)) {
    const name = /Win64|x64|WOW64/i.test(ua) ? "Windows x64" : "Windows";
    return { device_name: vpnClient ? `${name} · ${vpnClient}` : name, device_type: "windows" };
  }
  if (/Macintosh|Mac OS X/i.test(ua)) {
    return { device_name: vpnClient ? `macOS · ${vpnClient}` : "macOS", device_type: "mac" };
  }
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    return { device_name: vpnClient ? `Linux · ${vpnClient}` : "Linux", device_type: "linux" };
  }

  if (/\b(iOS|CFNetwork|Darwin)\b/i.test(ua)) {
    return { device_name: vpnClient ? `iOS · ${vpnClient}` : "iOS", device_type: "iphone" };
  }
  if (/\b(Windows|WinHTTP)\b/i.test(ua)) {
    return { device_name: vpnClient ? `Windows · ${vpnClient}` : "Windows", device_type: "windows" };
  }
  if (/\b(Mac|OSX|macOS)\b/i.test(ua)) {
    return { device_name: vpnClient ? `macOS · ${vpnClient}` : "macOS", device_type: "mac" };
  }
  if (/\b(Linux|X11|Ubuntu|Debian|Fedora)\b/i.test(ua)) {
    return { device_name: vpnClient ? `Linux · ${vpnClient}` : "Linux", device_type: "linux" };
  }
  if (vpnClient) return { device_name: vpnClient, device_type: "unknown" };

  return { device_name: "Устройство", device_type: "unknown" };
}

export function deviceTypeIcon(type: string): string {
  switch (type) {
    case "android":
    case "iphone":
    case "ipad":
      return "📱";
    case "windows":
    case "mac":
    case "linux":
      return "💻";
    default:
      return "🔑";
  }
}

export function maskDeviceId(id: string): string {
  const s = String(id ?? "").trim();
  if (s.length <= 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
