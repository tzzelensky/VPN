export const TROJAN_CONFIG_DIR = "/etc/tzadmin-trojan";
export const TROJAN_CERT_PATH = `${TROJAN_CONFIG_DIR}/server.crt`;
export const TROJAN_KEY_PATH = `${TROJAN_CONFIG_DIR}/server.key`;
export const TROJAN_INBOUND_TAG = "tzadmin-trojan";
/** Публичный порт по умолчанию (если нет SNI-mux на 443). */
export const TROJAN_DEFAULT_PORT = 8446;
/** Внутренний listen, когда публичный Trojan идёт через nginx stream :443. */
export const TROJAN_LOOPBACK_PORT = 8446;
export const TROJAN_DEFAULT_SNI = "www.cloudflare.com";
