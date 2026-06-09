import type { ServerRow } from "./db.js";
import type { ServerSubscriptionSettings } from "./serverSubscriptionSettings.js";
import {
  SUBSCRIPTION_FINGERPRINTS,
  resolveInboundDecryption,
  resolveSubscriptionAddress,
  resolveSubscriptionEncryption,
  resolveSubscriptionFlow,
  resolveSubscriptionRemarks,
  subscriptionUsesPqClientEncryption,
  validateSubscriptionSettings,
  type SubscriptionFingerprint,
} from "./serverSubscriptionSettings.js";

export type SubscriptionCheckLevel = "ok" | "warn" | "err";

export type SubscriptionCheckItem = {
  level: SubscriptionCheckLevel;
  text: string;
  field?: string;
};

function authModeLabel(mode: string): string {
  if (mode === "x25519") return "X25519";
  if (mode === "ml-kem-768") return "ML-KEM-768";
  return "none";
}

/** Чеклист «Проверить настройки» — те же правила, что и перед сохранением + предупреждения. */
export function buildSubscriptionSettingsChecklist(
  server: ServerRow,
  settings: ServerSubscriptionSettings,
): SubscriptionCheckItem[] {
  const items: SubscriptionCheckItem[] = [];
  const encryption = resolveSubscriptionEncryption(settings);
  const authMode = settings.vless?.auth_mode ?? "";

  if (Number.isFinite(settings.vless_port) && settings.vless_port >= 1 && settings.vless_port <= 65535) {
    items.push({ level: "ok", text: `Порт валиден (${settings.vless_port})` });
  } else {
    items.push({ level: "err", text: "Порт должен быть от 1 до 65535", field: "vless_port" });
  }

  if (SUBSCRIPTION_FINGERPRINTS.includes(settings.reality.fingerprint as SubscriptionFingerprint)) {
    items.push({ level: "ok", text: `Fingerprint: ${settings.reality.fingerprint}` });
  } else {
    items.push({ level: "err", text: "Недопустимый fingerprint", field: "reality.fingerprint" });
  }

  if (settings.security === "reality") {
    if (settings.reality.public_key.trim()) {
      items.push({ level: "ok", text: "REALITY publicKey указан" });
    } else {
      items.push({ level: "err", text: "REALITY publicKey не указан", field: "reality.public_key" });
    }
    if (settings.reality.server_name.trim()) {
      items.push({ level: "ok", text: `SNI: ${settings.reality.server_name}` });
    } else {
      items.push({ level: "err", text: "REALITY SNI не указан", field: "reality.server_name" });
    }
    if (settings.reality.short_id.trim()) {
      items.push({ level: "ok", text: `shortId: ${settings.reality.short_id}` });
    } else {
      items.push({ level: "err", text: "REALITY shortId не указан", field: "reality.short_id" });
    }
  }

  const spx = settings.reality.spider_x.trim() || "/";
  if (spx.startsWith("/")) {
    items.push({ level: "ok", text: `spiderX: ${spx}` });
  } else {
    items.push({ level: "err", text: "spiderX должен начинаться с /", field: "reality.spider_x" });
  }

  if (subscriptionUsesPqClientEncryption(settings)) {
    const dec = resolveInboundDecryption(settings);
    items.push({ level: "ok", text: `PQ encryption (клиент): ${encryption.slice(0, 48)}…` });
    items.push({
      level: "warn",
      text: `На inbound будет decryption: ${dec.slice(0, 48)}… — нажмите «Сохранить и применить на сервере»`,
    });
  } else if ((authMode === "x25519" || authMode === "ml-kem-768") && encryption === "none") {
    items.push({
      level: "err",
      text: "Для выбранной аутентификации укажите encryption или сбросьте authMode («Очистить»)",
      field: "vless.encrypt_value",
    });
  } else {
    items.push({ level: "ok", text: `Encryption: ${encryption}` });
  }

  const resolvedFlow = resolveSubscriptionFlow(settings);
  if (subscriptionUsesPqClientEncryption(settings)) {
    if (resolvedFlow) {
      items.push({ level: "err", text: "При PQ-шифровании flow должен быть пустым", field: "flow" });
    } else {
      items.push({ level: "ok", text: "Flow: не используется (PQ)" });
    }
  } else if (settings.security === "reality" && settings.network === "tcp") {
    if (!resolvedFlow) {
      items.push({
        level: "err",
        text: "REALITY+TCP: на сервере используется flow xtls-rprx-vision — укажите его в блоке «Поток»",
        field: "flow",
      });
    } else if (resolvedFlow === "xtls-rprx-vision") {
      items.push({ level: "ok", text: "Flow xtls-rprx-vision (как на inbound)" });
    } else {
      items.push({ level: "warn", text: `Flow ${resolvedFlow} может не совпадать с inbound` });
    }
  } else if (resolvedFlow) {
    items.push({ level: "ok", text: `Flow: ${resolvedFlow}` });
  } else {
    items.push({ level: "ok", text: "Flow: не задан" });
  }

  if (settings.reality.allow_insecure) {
    items.push({ level: "warn", text: "allowInsecure=true не рекомендуется для боевого конфига" });
  } else {
    items.push({ level: "ok", text: "allowInsecure: false" });
  }

  if (settings.reality.show) {
    items.push({ level: "warn", text: "show=true не рекомендуется для боевого конфига" });
  } else {
    items.push({ level: "ok", text: "show: false" });
  }

  const panelPort = Number(server.vless_port) || 0;
  if (panelPort > 0 && settings.vless_port !== panelPort) {
    items.push({
      level: "warn",
      text: `Порт подписки (${settings.vless_port}) отличается от vless_port сервера (${panelPort})`,
      field: "vless_port",
    });
  }

  items.push({
    level: "warn",
    text:
      "Проверьте, что inbound Xray на сервере использует те же REALITY/X25519-настройки (port, pbk, shortId, SNI, encryption). Иначе клиент может не подключиться.",
  });

  for (const e of validateSubscriptionSettings(settings)) {
    const exists = items.some((x) => x.field === e.field && x.level === "err");
    if (!exists) items.push({ level: "err", text: e.message, field: e.field });
  }

  return items;
}

/** Человекочитаемый блок «В итоговую подписку попадёт». */
export function buildSubscriptionOutcomeLines(
  server: ServerRow,
  settings: ServerSubscriptionSettings,
  userName?: string,
): string[] {
  const encryption = resolveSubscriptionEncryption(settings);
  const flow = resolveSubscriptionFlow(settings);
  const authMode = settings.vless?.auth_mode ?? "";
  return [
    `Address: ${resolveSubscriptionAddress(server, settings)}`,
    `Порт: ${settings.vless_port}`,
    `uTLS: ${settings.reality.fingerprint}`,
    `Flow: ${flow || "none"}`,
    `Encryption: ${encryption}`,
    `authMode: ${authMode || "none"}`,
    `SNI: ${settings.reality.server_name}`,
    `shortId: ${settings.reality.short_id || "—"}`,
    `spiderX: ${settings.reality.spider_x || "/"}`,
    `allowInsecure: ${settings.reality.allow_insecure}`,
    `show: ${settings.reality.show}`,
    `network: ${settings.network}`,
    `security: ${settings.security}`,
    `MUX enabled: ${settings.mux.enabled}`,
    `dns.queryStrategy: ${settings.dns.query_strategy}`,
    `remarks: ${resolveSubscriptionRemarks(server, settings, userName ? { name: userName } : undefined)}`,
  ];
}
