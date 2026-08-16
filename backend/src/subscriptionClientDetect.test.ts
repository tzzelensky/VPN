/**
 * Запуск: npx tsx src/subscriptionClientDetect.test.ts
 */
import {
  isBrowserLikeSubscriptionRequest,
  isVpnSubscriptionClient,
  isVpnSubscriptionUserAgent,
} from "./subscriptionClientDetect.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const vpnUa = [
  "Happ/1.2.3 (Android 14; Pixel 7)",
  "v2rayN/6.0",
  "ClashMeta for Android",
  "Streisand/1.0",
  "Shadowrocket/1220 CFNetwork/1496.0.7",
  "HiddifyNext/1.0",
  "sing-box/1.8",
  "okhttp/4.12.0",
  "v2rayNG/1.8.5",
  "FoXray/1.0",
];

const browserUa = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  "curl/8.4.0",
  "",
];

for (const ua of vpnUa) {
  assert(isVpnSubscriptionUserAgent(ua), `expected VPN client: ${ua}`);
  assert(
    isVpnSubscriptionClient({ headers: { "user-agent": ua } }),
    `expected client req: ${ua}`,
  );
  assert(
    !isBrowserLikeSubscriptionRequest({ headers: { "user-agent": ua, accept: "text/html" } }),
    `Happ/WebView must not be treated as browser: ${ua}`,
  );
}

for (const ua of browserUa) {
  assert(!isVpnSubscriptionUserAgent(ua), `expected non-VPN: ${JSON.stringify(ua)}`);
  assert(
    isBrowserLikeSubscriptionRequest({
      headers: { "user-agent": ua || undefined, accept: "text/html,*/*" },
    }),
    `expected browser/probe: ${JSON.stringify(ua)}`,
  );
}

assert(
  isVpnSubscriptionClient({ headers: { "user-agent": "Mozilla/5.0", "x-client": "Happ" } }),
  "x-client Happ should count",
);

console.log("subscriptionClientDetect: ok");
