export const HYSTERIA2_CONFIG_DIR = "/etc/tzadmin-hysteria2";
export const HYSTERIA2_CONFIG_PATH = `${HYSTERIA2_CONFIG_DIR}/config.yaml`;
export const HYSTERIA2_CERT_PATH = `${HYSTERIA2_CONFIG_DIR}/server.crt`;
export const HYSTERIA2_KEY_PATH = `${HYSTERIA2_CONFIG_DIR}/server.key`;
export const HYSTERIA2_BIN_PATH = "/usr/local/bin/hysteria";
export const HYSTERIA2_SERVICE_NAME = "tzadmin-hysteria2";
export const HYSTERIA2_DEFAULT_PORT = 36712;
export const HYSTERIA2_STATS_LISTEN = "127.0.0.1:18080";
export const HYSTERIA2_DEFAULT_SNI = "www.cloudflare.com";

/** Релиз binary (linux amd64). При необходимости обновить pin. */
export const HYSTERIA2_RELEASE_URL =
  "https://github.com/apernet/hysteria/releases/download/app/v2.6.1/hysteria-linux-amd64";
