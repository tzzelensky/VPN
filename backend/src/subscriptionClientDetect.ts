/**
 * Определение VPN-клиента по UA / заголовкам.
 * Белый список: только известные клиенты получают payload подписки;
 * браузер и голые probe — HTML-витрину без VPN-заголовков.
 */

const VPN_CLIENT_UA_RE =
  /\b(happ|incy|v2rayn|v2rayng|v2raytun|v2raybox|v2ray|clash|clashmeta|mihomo|streisand|shadowrocket|hiddify(?:next)?|sing-?box|sfa|nekoray|foxray|xray(?:-core)?|okhttp|surge|quantumult|loon|stash|egern|npv(?:tunnel)?|hsn)\b/i;

const VPN_CLIENT_HEADER_RE = /\b(happ|incy|v2ray|clash|hiddify|sing-?box|shadowrocket|streisand)\b/i;

export function isVpnSubscriptionUserAgent(ua: string | undefined | null): boolean {
  const s = String(ua ?? "").trim();
  if (!s) return false;
  return VPN_CLIENT_UA_RE.test(s);
}

export function isVpnSubscriptionClient(req: {
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  const hdr = req.headers ?? {};
  const pick = (name: string): string => {
    const v = hdr[name.toLowerCase()] ?? hdr[name];
    if (Array.isArray(v)) return String(v[0] ?? "").trim();
    return String(v ?? "").trim();
  };

  const ua = pick("user-agent");
  if (isVpnSubscriptionUserAgent(ua)) return true;

  const xClient = pick("x-client") || pick("x-happ-client") || pick("x-subscription-client");
  if (xClient && VPN_CLIENT_HEADER_RE.test(xClient)) return true;

  // Часть клиентов шлёт Accept: text/plain или application/json без «браузерного» UA-маркера —
  // уже пойманы whitelist'ом выше. Остальное считаем probe/браузером.
  return false;
}

export function isBrowserLikeSubscriptionRequest(req: {
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  if (isVpnSubscriptionClient(req)) return false;
  const hdr = req.headers ?? {};
  const accept = String(hdr.accept ?? hdr.Accept ?? "").toLowerCase();
  const ua = String(hdr["user-agent"] ?? hdr["User-Agent"] ?? "").toLowerCase();
  if (accept.includes("text/html")) return true;
  if (/\b(mozilla|chrome|safari|firefox|edg\/|opr\/|msie|trident)\b/.test(ua)) return true;
  return true; // голый curl/probe без клиентского UA
}
