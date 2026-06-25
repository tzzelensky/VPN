import { randomBytes } from "node:crypto";
import type { ServerRow } from "./db.js";
import { tryOpenFirewallPort } from "./experimentFirewall.js";
import { sshExecCommand, type SshConfig } from "./ssh.js";
import {
  TELEGRAM_PROXY_3PROXY_BIN,
  TELEGRAM_PROXY_BIN_DIR,
  TELEGRAM_PROXY_MTG_BIN,
  TELEGRAM_PROXY_MTPROXY_BIN,
  telegramProxyConfigDir,
  telegramProxyServiceName,
  type TelegramProxyRow,
  type TelegramProxyType,
} from "./telegramProxiesTypes.js";

export function sshCfgFromServer(row: ServerRow): SshConfig {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

const MTG_FAKETLS_FIRST_BYTE = 0xee;
const MTG_SECRET_KEY_BYTES = 16;
/** Пул SNI для FakeTLS (случайный «отпечаток» вместо устаревшего dd/randomized). */
const MTG_FRONTING_HOST_POOL = ["google.com"] as const;

/** Домен для FakeTLS в secret (mtg v2: ee + key + hostname). Всегда из пула CDN — не hostname сервера. */
export function mtgFrontingHostname(_serverHost?: string): string {
  return pickRandomMtprotoFrontingHost();
}

export function pickRandomMtprotoFrontingHost(): string {
  return MTG_FRONTING_HOST_POOL[randomBytes(1)[0]! % MTG_FRONTING_HOST_POOL.length]!;
}

export function mtprotoSecretFrontingHost(secret: string): string | null {
  const decoded = decodeMtprotoSecretBytes(secret);
  if (!decoded || decoded.length < 1 + MTG_SECRET_KEY_BYTES + 1) return null;
  const host = decoded.subarray(1 + MTG_SECRET_KEY_BYTES).toString("utf8").trim();
  return host || null;
}

/** Telegram-клиенты чаще принимают base64url secret в ссылках (как `mtg generate-secret`). */
export function mtprotoSecretBase64Url(secret: string): string | null {
  const decoded = decodeMtprotoSecretBytes(secret);
  if (!decoded) return null;
  return decoded.toString("base64url");
}

/** Secret для tg:// / t.me ссылок: hex ee… (base64 ломает часть клиентов). */
export function mtprotoSecretForTelegramLink(secret: string): string {
  const raw = secret.trim();
  if (/^[0-9a-fA-F]+$/.test(raw)) return raw.toLowerCase();
  const decoded = decodeMtprotoSecretBytes(raw);
  if (!decoded) return raw;
  return decoded.toString("hex");
}

function decodeMtprotoSecretBytes(secret: string): Buffer | null {
  const s = secret.trim();
  if (!s) return null;
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    try {
      return Buffer.from(s, "hex");
    } catch {
      return null;
    }
  }
  try {
    return Buffer.from(s, "base64url");
  } catch {
    return null;
  }
}

export function isValidMtprotoSecret(secret: string): boolean {
  const decoded = decodeMtprotoSecretBytes(secret);
  if (!decoded || decoded.length < 1 + MTG_SECRET_KEY_BYTES + 1) return false;
  if (decoded[0] !== MTG_FAKETLS_FIRST_BYTE) return false;
  const hostname = decoded.subarray(1 + MTG_SECRET_KEY_BYTES).toString("utf8").trim();
  return hostname.length > 0;
}

/** mtg v2: hex secret = ee + 16-byte key + hostname (FakeTLS). SNI — случайный из пула. */
export function generateMtprotoSecret(): string {
  const host = pickRandomMtprotoFrontingHost();
  const key = randomBytes(MTG_SECRET_KEY_BYTES).toString("hex");
  const hostHex = Buffer.from(host, "utf8").toString("hex");
  return `ee${key}${hostHex}`;
}

/** dd-secret (Obfuscated2) — лучше совместим с Telegram Desktop 6.3+. */
export function generateMtprotoDdSecret(): string {
  return `dd${randomBytes(MTG_SECRET_KEY_BYTES).toString("hex")}`;
}

export function parseMtprotoDdSecret(secret: string): string | null {
  const raw = secret.trim().toLowerCase();
  if (!raw.startsWith("dd") || raw.length !== 34) return null;
  const base = raw.slice(2);
  if (!/^[0-9a-f]{32}$/.test(base)) return null;
  return base;
}

export function isMtprotoDdSecret(secret: string): boolean {
  return parseMtprotoDdSecret(secret) != null;
}

/** Разбор ee-secret для официального mtproto-proxy (-S + -D). */
export function parseMtprotoEeSecret(secret: string): { baseSecret: string; domain: string } | null {
  const decoded = decodeMtprotoSecretBytes(secret);
  if (!decoded || decoded.length < 1 + MTG_SECRET_KEY_BYTES + 1 || decoded[0] !== MTG_FAKETLS_FIRST_BYTE) {
    return null;
  }
  const baseSecret = decoded.subarray(1, 1 + MTG_SECRET_KEY_BYTES).toString("hex");
  const domain = decoded.subarray(1 + MTG_SECRET_KEY_BYTES).toString("utf8").trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return { baseSecret, domain };
}

export function generateProxyCredentials(): { username: string; password: string } {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = randomBytes(12);
  let user = "tg";
  let pass = "";
  for (let i = 0; i < 8; i++) user += alphabet[buf[i]! % alphabet.length];
  for (let i = 0; i < 16; i++) pass += alphabet[randomBytes(1)[0]! % alphabet.length];
  return { username: user, password: pass };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function checkRemotePortInUse(cfg: SshConfig, port: number): Promise<boolean> {
  const q = String(port);
  const r = await sshExecCommand(
    cfg,
    `ss -tlnp 2>/dev/null | awk '{print $4}' | grep -E ':${q}$' || netstat -tlnp 2>/dev/null | grep ':${q} ' || true`,
  );
  return (r.stdout + r.stderr).trim().length > 0;
}

export function isVpnPortConflict(server: ServerRow, port: number): boolean {
  const vpnPort = Math.floor(Number(server.vless_port) || 0);
  const subPort = Math.floor(Number(server.sub_port) || 0);
  return (vpnPort > 0 && vpnPort === port) || (subPort > 0 && subPort === port);
}

export type DeployProxyInput = {
  id: number;
  type: TelegramProxyType;
  port: number;
  secret: string;
  username: string;
  password: string;
  auth_enabled: boolean;
};

const MTG_VERSION = "2.2.8";

function mtgLinuxArch(unameM: string): string | null {
  const u = unameM.trim().toLowerCase();
  if (u === "x86_64" || u === "amd64") return "amd64";
  if (u === "aarch64" || u === "arm64") return "arm64";
  if (u === "armv7l" || u === "armv7" || u.startsWith("armv7")) return "armv7";
  if (u === "armv6l" || u === "armv6" || u.startsWith("armv6")) return "armv6";
  if (u === "i386" || u === "i686") return "386";
  return null;
}

function mtgReleaseUrl(arch: string): string {
  return `https://github.com/9seconds/mtg/releases/download/v${MTG_VERSION}/mtg-${MTG_VERSION}-linux-${arch}.tar.gz`;
}

function mtgExpectedBinaryName(arch: string): string {
  return `mtg-${MTG_VERSION}-linux-${arch}`;
}

async function ensureProxyRoot(cfg: SshConfig): Promise<void> {
  await sshExecCommand(
    cfg,
    `mkdir -p ${shellQuote(TELEGRAM_PROXY_BIN_DIR)} /opt/tzadmin-proxy && chmod 755 /opt/tzadmin-proxy ${shellQuote(TELEGRAM_PROXY_BIN_DIR)}`,
  );
}

function execDetail(r: { code: number | null; stdout: string; stderr: string }, fallback: string): string {
  const parts = [r.stderr.trim(), r.stdout.trim()].filter(Boolean);
  if (parts.length) return parts.join(" | ").slice(0, 500);
  return `${fallback} (exit ${r.code ?? "?"})`;
}

async function sshMust(
  cfg: SshConfig,
  cmd: string,
  label: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const r = await sshExecCommand(cfg, cmd);
  if (r.code !== 0) {
    throw new Error(`${label}: ${execDetail(r, "команда не выполнена")}`);
  }
  return r;
}

async function isMtgBinaryHealthy(cfg: SshConfig): Promise<boolean> {
  const bin = shellQuote(TELEGRAM_PROXY_MTG_BIN);
  const r = await sshExecCommand(
    cfg,
    `test -x ${bin} && (file -b ${bin} 2>/dev/null | grep -qi elf || test "$(head -c 1 ${bin} | od -An -tu1 | tr -d ' \\n')" = "127")`,
  );
  return r.code === 0;
}

async function isMtgVersionCurrent(cfg: SshConfig): Promise<boolean> {
  const bin = shellQuote(TELEGRAM_PROXY_MTG_BIN);
  const r = await sshExecCommand(cfg, `${bin} --version 2>/dev/null || ${bin} version 2>/dev/null || true`);
  const out = `${r.stdout}\n${r.stderr}`.trim();
  return out.includes(MTG_VERSION);
}

async function installMtgIfNeeded(cfg: SshConfig): Promise<string> {
  if ((await isMtgBinaryHealthy(cfg)) && (await isMtgVersionCurrent(cfg))) return TELEGRAM_PROXY_MTG_BIN;

  const bin = shellQuote(TELEGRAM_PROXY_MTG_BIN);
  const binDir = shellQuote(TELEGRAM_PROXY_BIN_DIR);
  await sshExecCommand(cfg, `rm -f ${bin}`);

  const archProbe = await sshExecCommand(cfg, "uname -m");
  const mtgArch = mtgLinuxArch(archProbe.stdout || "");
  if (!mtgArch) {
    throw new Error(`Архитектура сервера (${(archProbe.stdout || "").trim() || "?"}) не поддерживается для mtg`);
  }

  const url = mtgReleaseUrl(mtgArch);
  const expectedName = mtgExpectedBinaryName(mtgArch);
  const tmp = "/tmp/tzadmin-mtg-install";
  const tmpQ = shellQuote(tmp);
  const tgz = shellQuote(`${tmp}/m.tgz`);
  const src = shellQuote(`${tmp}/${expectedName}`);
  const urlQ = shellQuote(url);

  await sshMust(cfg, `mkdir -p ${binDir}`, "mtg: mkdir bin");
  await sshExecCommand(cfg, `rm -rf ${tmpQ}`);
  await sshMust(cfg, `mkdir -p ${tmpQ}`, "mtg: mkdir tmp");

  const dl = await sshExecCommand(
    cfg,
    `curl -fsSL ${urlQ} -o ${tgz} 2>&1 || wget -qO ${tgz} ${urlQ} 2>&1`,
  );
  if (dl.code !== 0) {
    throw new Error(`Не удалось скачать mtg (${mtgArch}): ${execDetail(dl, "curl/wget failed")}`);
  }

  await sshMust(cfg, `tar xzf ${tgz} -C ${tmpQ}`, "mtg: tar extract");

  const folderMtg = shellQuote(`${tmp}/${expectedName}/mtg`);
  const folderNamed = shellQuote(`${tmp}/${expectedName}/${expectedName}`);
  const installed = await sshExecCommand(
    cfg,
    `SRC=""; if [ -f ${folderMtg} ]; then SRC=${folderMtg}; elif [ -f ${folderNamed} ]; then SRC=${folderNamed}; elif [ -f ${src} ]; then SRC=${src}; else SRC=$(find ${tmpQ} -maxdepth 2 -type f ! -name '*.tgz' ! -name '*.tar.gz' ! -name '*.txt' ! -name 'LICENSE' ! -name 'README*' ! -name 'SECURITY*' 2>/dev/null | head -1); fi; test -n "$SRC" && test -f "$SRC" && install -m 755 "$SRC" ${bin}`,
  );
  if (installed.code !== 0) {
    const ls = await sshExecCommand(cfg, `find ${tmpQ} -maxdepth 2 -ls 2>&1`);
    throw new Error(
      `Не удалось установить mtg (${mtgArch}): ${execDetail(installed, "install failed")}; tree: ${ls.stdout.trim().slice(0, 300)}`,
    );
  }

  await sshExecCommand(cfg, `rm -rf ${tmpQ}`);

  if (!(await isMtgBinaryHealthy(cfg))) {
    const probe = await sshExecCommand(cfg, `file -b ${bin} 2>&1; ls -la ${bin} 2>&1`);
    throw new Error(`mtg установлен, но бинарник невалиден: ${execDetail(probe, "probe failed")}`);
  }
  return TELEGRAM_PROXY_MTG_BIN;
}

const MTPROXY_VERSION = "3.5.5";

function mtproxyLinuxArch(unameM: string): string | null {
  const u = unameM.trim().toLowerCase();
  if (u === "x86_64" || u === "amd64") return "amd64";
  if (u === "aarch64" || u === "arm64") return "arm64";
  return null;
}

function mtproxyReleaseUrl(arch: string): string {
  return `https://github.com/GetPageSpeed/MTProxy/releases/download/v${MTPROXY_VERSION}/mtproto-proxy-linux-${arch}`;
}

async function isMtproxyBinaryHealthy(cfg: SshConfig): Promise<boolean> {
  const bin = shellQuote(TELEGRAM_PROXY_MTPROXY_BIN);
  const r = await sshExecCommand(cfg, `test -x ${bin} && ${bin} --help 2>&1 | head -1`);
  return r.code === 0 && (r.stdout + r.stderr).trim().length > 0;
}

/** Официальный MTProxy (GetPageSpeed) — совместим с Telegram Desktop 6.3+ FakeTLS. */
export async function installMtproxyIfNeeded(cfg: SshConfig): Promise<string> {
  if (await isMtproxyBinaryHealthy(cfg)) return TELEGRAM_PROXY_MTPROXY_BIN;

  const archProbe = await sshExecCommand(cfg, "uname -m");
  const arch = mtproxyLinuxArch(archProbe.stdout || "");
  if (!arch) {
    throw new Error(`Архитектура сервера (${(archProbe.stdout || "").trim() || "?"}) не поддерживается для mtproto-proxy`);
  }

  const bin = shellQuote(TELEGRAM_PROXY_MTPROXY_BIN);
  const binDir = shellQuote(TELEGRAM_PROXY_BIN_DIR);
  const url = shellQuote(mtproxyReleaseUrl(arch));
  await sshMust(cfg, `mkdir -p ${binDir}`, "mtproto-proxy: mkdir bin");
  const dl = await sshExecCommand(cfg, `curl -fsSL ${url} -o ${bin} 2>&1 || wget -qO ${bin} ${url} 2>&1`);
  if (dl.code !== 0) {
    throw new Error(`Не удалось скачать mtproto-proxy: ${execDetail(dl, "curl/wget failed")}`);
  }
  await sshMust(cfg, `chmod 755 ${bin}`, "mtproto-proxy: chmod");
  if (!(await isMtproxyBinaryHealthy(cfg))) {
    throw new Error("mtproto-proxy установлен, но бинарник не отвечает на --help");
  }
  return TELEGRAM_PROXY_MTPROXY_BIN;
}

const THREEPROXY_VERSION = "0.9.5";

function threeProxyDebArch(unameM: string): string | null {
  const u = unameM.trim().toLowerCase();
  if (u === "x86_64" || u === "amd64") return "x86_64";
  if (u === "aarch64" || u === "arm64") return "aarch64";
  if (u === "armv7l" || u === "armv7" || u.startsWith("armv7")) return "arm";
  if (u.startsWith("arm")) return "arm";
  return null;
}

function threeProxyDebUrl(arch: string): string {
  return `https://github.com/3proxy/3proxy/releases/download/${THREEPROXY_VERSION}/3proxy-${THREEPROXY_VERSION}.${arch}.deb`;
}

async function find3proxyBinaryPath(cfg: SshConfig): Promise<string | null> {
  const r = await sshExecCommand(
    cfg,
    `command -v 3proxy 2>/dev/null || (test -x /usr/bin/3proxy && echo /usr/bin/3proxy) || (test -x /usr/local/bin/3proxy && echo /usr/local/bin/3proxy) || true`,
  );
  const path3p = r.stdout.trim().split("\n").pop()?.trim();
  return path3p && path3p.startsWith("/") ? path3p : null;
}

async function install3proxyIfNeeded(cfg: SshConfig): Promise<string> {
  const bin = shellQuote(TELEGRAM_PROXY_3PROXY_BIN);
  const binDir = shellQuote(TELEGRAM_PROXY_BIN_DIR);
  const check = await sshExecCommand(cfg, `test -x ${bin} && echo ok || true`);
  if (check.stdout.includes("ok")) return TELEGRAM_PROXY_3PROXY_BIN;

  await sshMust(cfg, `mkdir -p ${binDir}`, "3proxy: mkdir bin");

  let path3p = await find3proxyBinaryPath(cfg);
  if (!path3p) {
    await sshExecCommand(
      cfg,
      `DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq 3proxy 2>/dev/null || true`,
    );
    path3p = await find3proxyBinaryPath(cfg);
  }

  const archProbe = await sshExecCommand(cfg, "uname -m");
  const debArch = threeProxyDebArch(archProbe.stdout || "");
  const tmp = "/tmp/tzadmin-3proxy-install";
  const tmpQ = shellQuote(tmp);

  if (!path3p && debArch) {
    const deb = shellQuote(`${tmp}/3proxy.deb`);
    const urlQ = shellQuote(threeProxyDebUrl(debArch));
    await sshExecCommand(cfg, `rm -rf ${tmpQ}`);
    await sshMust(cfg, `mkdir -p ${tmpQ}`, "3proxy: mkdir tmp");
    const dl = await sshExecCommand(
      cfg,
      `curl -fsSL ${urlQ} -o ${deb} 2>&1 || wget -qO ${deb} ${urlQ} 2>&1`,
    );
    if (dl.code === 0) {
      await sshExecCommand(
        cfg,
        `DEBIAN_FRONTEND=noninteractive dpkg -i ${deb} 2>/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -f -y -qq 2>/dev/null || true`,
      );
      path3p = await find3proxyBinaryPath(cfg);
    }
    await sshExecCommand(cfg, `rm -rf ${tmpQ}`);
  }

  if (!path3p) {
    const tgz = shellQuote(`${tmp}/3p.tgz`);
    const srcDir = shellQuote(`${tmp}/3proxy-${THREEPROXY_VERSION}`);
    await sshExecCommand(cfg, `rm -rf ${tmpQ}`);
    await sshMust(cfg, `mkdir -p ${tmpQ}`, "3proxy: mkdir tmp");
    await sshExecCommand(
      cfg,
      `DEBIAN_FRONTEND=noninteractive apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential make gcc 2>/dev/null || yum install -y gcc make 2>/dev/null || true`,
    );
    await sshMust(
      cfg,
      `curl -fsSL ${shellQuote(`https://github.com/3proxy/3proxy/archive/refs/tags/${THREEPROXY_VERSION}.tar.gz`)} -o ${tgz} || wget -qO ${tgz} ${shellQuote(`https://github.com/3proxy/3proxy/archive/refs/tags/${THREEPROXY_VERSION}.tar.gz`)}`,
      "3proxy: download sources",
    );
    await sshMust(cfg, `tar xzf ${tgz} -C ${tmpQ}`, "3proxy: tar extract");
    await sshMust(cfg, `make -f Makefile.Linux -C ${srcDir}`, "3proxy: build");
    await sshMust(
      cfg,
      `install -m 755 ${shellQuote(`${tmp}/3proxy-${THREEPROXY_VERSION}/bin/3proxy`)} ${bin}`,
      "3proxy: install binary",
    );
    await sshExecCommand(cfg, `rm -rf ${tmpQ}`);
    return TELEGRAM_PROXY_3PROXY_BIN;
  }

  await sshMust(cfg, `install -m 755 ${shellQuote(path3p)} ${bin}`, "3proxy: install from package");
  return TELEGRAM_PROXY_3PROXY_BIN;
}

function escapeTomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** mtg v2 config: FakeTLS (ee), IPv4, UDP DNS, без blocklist. */
export function buildMtprotoConfig(proxy: DeployProxyInput, secret: string, publicHost?: string): string {
  const host = String(publicHost ?? "").trim();
  const isPublicIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const lines = [
    `secret = ${escapeTomlString(secret.trim())}`,
    // Dual-stack listen (mtg 2.2.x); 0.0.0.0-only ломает часть клиентов.
    `bind-to = ${escapeTomlString(`0.0.0.0:${proxy.port}`)}`,
    `prefer-ip = "only-ipv4"`,
    `allow-fallback-on-unknown-dc = true`,
    `tolerate-time-skewness = "60s"`,
    `auto-update = true`,
  ];
  if (isPublicIp) {
    lines.push(`public-ipv4 = ${escapeTomlString(host)}`);
  }
  lines.push(
    "",
    "[domain-fronting]",
    "port = 443",
    "",
    "[network]",
    `dns = "8.8.8.8"`,
    "",
    "[network.timeout]",
    `tcp = "10s"`,
    `http = "10s"`,
    `idle = "2m"`,
    `handshake = "15s"`,
    "",
    "[defense.blocklist]",
    "enabled = false",
    "",
    "[defense.allowlist]",
    "enabled = false",
    "",
    "[defense.anti-replay]",
    "enabled = false",
    "",
    "[stats.prometheus]",
    "enabled = false",
    "",
  );
  return lines.join("\n");
}

function mtproxyStatsPort(proxyId: number): number {
  return 28000 + (proxyId % 2000);
}

async function ensureMtproxyTelegramConfigs(cfg: SshConfig, dir: string): Promise<void> {
  const dirQ = shellQuote(dir);
  const secretPath = shellQuote(`${dir}/proxy-secret`);
  const multiPath = shellQuote(`${dir}/proxy-multi.conf`);
  await sshExecCommand(cfg, `mkdir -p ${dirQ}`);
  const secretUrl = shellQuote("https://core.telegram.org/getProxySecret");
  const multiUrl = shellQuote("https://core.telegram.org/getProxyConfig");
  const dlSecret = await sshExecCommand(
    cfg,
    `curl -fsSL --connect-timeout 15 --max-time 45 ${secretUrl} -o ${secretPath} 2>&1 || wget -qO ${secretPath} ${secretUrl} 2>&1`,
  );
  if (dlSecret.code !== 0) {
    throw new Error(`Не удалось скачать proxy-secret: ${execDetail(dlSecret, "download failed")}`);
  }
  const dlMulti = await sshExecCommand(
    cfg,
    `curl -fsSL --connect-timeout 15 --max-time 45 ${multiUrl} -o ${multiPath} 2>&1 || wget -qO ${multiPath} ${multiUrl} 2>&1`,
  );
  if (dlMulti.code !== 0) {
    throw new Error(`Не удалось скачать proxy-multi.conf: ${execDetail(dlMulti, "download failed")}`);
  }
}

function buildMtgUnit(proxy: DeployProxyInput, mtgBin: string): string {
  const dir = telegramProxyConfigDir(proxy.id);
  return `[Unit]
Description=TZAdmin Telegram MTProto proxy ${proxy.id} (mtg)
After=network.target

[Service]
Type=simple
WorkingDirectory=${dir}
ExecStart=${mtgBin} run ${dir}/mtg.toml
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tzadmin-mtg-${proxy.id}

[Install]
WantedBy=multi-user.target
`;
}

function buildMtproxyUnit(
  proxy: DeployProxyInput,
  mtproxyBin: string,
  baseSecret: string,
  opts?: { domain?: string },
): string {
  const dir = telegramProxyConfigDir(proxy.id);
  const statsPort = mtproxyStatsPort(proxy.id);
  const port = Math.floor(Number(proxy.port));
  const secretFile = `${dir}/proxy-secret`;
  const multiFile = `${dir}/proxy-multi.conf`;
  const domain = String(opts?.domain ?? "").trim();
  const tlsPart = domain ? ` -D ${domain}` : "";
  return `[Unit]
Description=TZAdmin Telegram MTProto proxy ${proxy.id}
After=network.target

[Service]
Type=simple
WorkingDirectory=${dir}
ExecStart=${mtproxyBin} -u nobody -p ${statsPort} -H ${port} -S ${baseSecret}${tlsPart} --http-stats --aes-pwd ${secretFile} ${multiFile}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tzadmin-mtproxy-${proxy.id}

[Install]
WantedBy=multi-user.target
`;
}

export type MtprotoServiceInspection = {
  service_active: boolean;
  listener_ok: boolean;
  listener_detail: string;
  legacy_unit: boolean;
  journal: string;
  warnings: string[];
  errors: string[];
};

export async function inspectMtprotoService(
  cfg: SshConfig,
  proxyId: number,
  port: number,
): Promise<MtprotoServiceInspection> {
  const svc = telegramProxyServiceName(proxyId);
  const warnings: string[] = [];
  const errors: string[] = [];

  const active = await sshExecCommand(cfg, `systemctl is-active ${svc} 2>/dev/null || true`);
  const service_active = active.stdout.trim() === "active";
  if (!service_active) {
    errors.push(`Сервис ${svc} не active (${active.stdout.trim() || "?"})`);
  }

  const unit = await sshExecCommand(cfg, `systemctl cat ${svc} 2>/dev/null || true`);
  const legacy_unit = unit.stdout.includes("simple-run") || unit.stdout.includes(" mtg ");
  if (legacy_unit) {
    warnings.push("Устаревший unit (mtg) — пересохраните/переразверните прокси");
  }

  const portQ = String(port);
  const listener = await sshExecCommand(
    cfg,
    `ss -tlnp 2>/dev/null | grep -E ':${portQ} ' || netstat -tlnp 2>/dev/null | grep ':${portQ} ' || true`,
  );
  const line = listener.stdout.trim().split("\n").find((l) => l.includes(`:${portQ}`)) ?? "";
  let listener_ok = false;
  if (service_active && line && /mtproto-proxy|mtg/i.test(line)) {
    listener_ok = true;
  } else if (service_active && line) {
    errors.push(`Порт ${port} занят не MTProxy: ${line.slice(0, 160)}`);
  } else if (service_active) {
    errors.push(`Порт ${port} не слушается`);
  }

  const journal = await sshExecCommand(cfg, `journalctl -u ${svc} -n 30 --no-pager 2>/dev/null || true`);
  const journalText = journal.stdout.trim();
  if (/cannot resolve dns|cannot dial to the fronting domain|incorrect secret|fatal|panic/i.test(journalText)) {
    errors.push("В логах MTProxy есть критические ошибки (DNS/FakeTLS/secret)");
  } else if (/error|warn|failed/i.test(journalText)) {
    warnings.push("В логах MTProxy есть предупреждения/ошибки");
  }

  return {
    service_active,
    listener_ok,
    listener_detail: line,
    legacy_unit,
    journal: journalText,
    warnings,
    errors,
  };
}

export async function fetchTelegramProxyServiceLogs(
  cfg: SshConfig,
  proxyId: number,
  lines = 80,
): Promise<string> {
  const svc = telegramProxyServiceName(proxyId);
  const n = Math.min(300, Math.max(10, Math.floor(lines)));
  const r = await sshExecCommand(cfg, `journalctl -u ${svc} -n ${n} --no-pager 2>/dev/null || true`);
  const text = (r.stdout || r.stderr || "").trim();
  return text || "Лог пуст или journalctl недоступен";
}

function build3proxyConfig(proxy: DeployProxyInput): string {
  const lines = ["daemon", "nserver 8.8.8.8", "nscache 65536", "timeouts 1 5 30 60 180 1800 15 60", "log"];
  if (proxy.auth_enabled && proxy.username && proxy.password) {
    lines.push("auth strong");
    lines.push(`users ${proxy.username}:CL:${proxy.password}`);
    lines.push("allow *");
  } else {
    lines.push("auth none");
    lines.push("allow *");
  }
  if (proxy.type === "socks5") {
    lines.push(`socks -p${proxy.port}`);
  } else {
    lines.push(`proxy -p${proxy.port}`);
  }
  return lines.join("\n") + "\n";
}

function build3proxyUnit(proxy: DeployProxyInput, proxyBin: string): string {
  const dir = telegramProxyConfigDir(proxy.id);
  return `[Unit]
Description=TZAdmin Telegram ${proxy.type} proxy ${proxy.id}
After=network.target

[Service]
Type=forking
WorkingDirectory=${dir}
ExecStart=${proxyBin} ${dir}/3proxy.cfg
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

export async function deployTelegramProxyOnServer(
  server: ServerRow,
  proxy: DeployProxyInput,
): Promise<{ firewall: string | null }> {
  const cfg = sshCfgFromServer(server);
  await ensureProxyRoot(cfg);
  const dir = telegramProxyConfigDir(proxy.id);
  const svc = telegramProxyServiceName(proxy.id);
  await sshExecCommand(cfg, `mkdir -p ${shellQuote(dir)}`);

  if (proxy.type === "mtproto") {
    const secret = proxy.secret.trim();
    if (!secret) throw new Error("Для MTProto нужен secret");
    const ddBase = parseMtprotoDdSecret(secret);
    const eeParsed = parseMtprotoEeSecret(secret);
    if (!ddBase && !eeParsed) {
      throw new Error("Secret MTProto: нужен ee (FakeTLS) или dd (Desktop 6.3+)");
    }
    if (ddBase) {
      const mtproxyBin = await installMtproxyIfNeeded(cfg);
      await ensureMtproxyTelegramConfigs(cfg, dir);
      const unit = buildMtproxyUnit(proxy, mtproxyBin, ddBase);
      await sshExecCommand(
        cfg,
        `cat > ${shellQuote(`/etc/systemd/system/${svc}.service`)} << 'TZEOF'\n${unit}\nTZEOF`,
      );
    } else {
      const mtgBin = await installMtgIfNeeded(cfg);
      const cfgBody = buildMtprotoConfig(proxy, secret, server.host);
      await sshExecCommand(cfg, `cat > ${shellQuote(`${dir}/mtg.toml`)} << 'TZEOF'\n${cfgBody}\nTZEOF`);
      const unit = buildMtgUnit(proxy, mtgBin);
      await sshExecCommand(
        cfg,
        `cat > ${shellQuote(`/etc/systemd/system/${svc}.service`)} << 'TZEOF'\n${unit}\nTZEOF`,
      );
    }
  } else {
    const proxyBin = await install3proxyIfNeeded(cfg);
    const cfgBody = build3proxyConfig(proxy);
    await sshExecCommand(cfg, `cat > ${shellQuote(`${dir}/3proxy.cfg`)} << 'TZEOF'\n${cfgBody}\nTZEOF`);
    const unit = build3proxyUnit(proxy, proxyBin);
    await sshExecCommand(
      cfg,
      `cat > ${shellQuote(`/etc/systemd/system/${svc}.service`)} << 'TZEOF'\n${unit}\nTZEOF`,
    );
  }

  await sshExecCommand(cfg, `systemctl daemon-reload && systemctl enable ${svc} && systemctl restart ${svc}`);
  const active = await sshExecCommand(cfg, `systemctl is-active ${svc} || true`);
  if (!active.stdout.includes("active")) {
    const log = await sshExecCommand(cfg, `journalctl -u ${svc} -n 20 --no-pager 2>/dev/null || true`);
    throw new Error(`Сервис прокси не запустился: ${(log.stdout || active.stderr).trim().slice(0, 400)}`);
  }

  let firewallHint: string | null = null;
  try {
    const fw = await tryOpenFirewallPort(cfg, proxy.port);
    if (fw.opened) firewallHint = fw.detail ?? "Порт открыт в firewall";
    else if (fw.detail) firewallHint = fw.detail;
  } catch {
    // ignore firewall errors
  }

  return { firewall: firewallHint };
}

export async function stopAndRemoveTelegramProxyOnServer(
  server: ServerRow,
  proxy: Pick<TelegramProxyRow, "id" | "config_path">,
): Promise<void> {
  const cfg = sshCfgFromServer(server);
  const svc = telegramProxyServiceName(proxy.id);
  const dir = proxy.config_path || telegramProxyConfigDir(proxy.id);
  await sshExecCommand(
    cfg,
    `systemctl stop ${svc} 2>/dev/null || true; systemctl disable ${svc} 2>/dev/null || true; rm -f /etc/systemd/system/${svc}.service; systemctl daemon-reload || true; rm -rf ${shellQuote(dir)}`,
  );
}

export async function restartTelegramProxyOnServer(server: ServerRow, proxyId: number): Promise<void> {
  const cfg = sshCfgFromServer(server);
  const svc = telegramProxyServiceName(proxyId);
  const r = await sshExecCommand(cfg, `systemctl restart ${svc}`);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || "restart failed").trim());
}

export async function purgeAllTelegramProxiesOnServer(server: ServerRow, proxyIds: number[]): Promise<string[]> {
  const errors: string[] = [];
  for (const id of proxyIds) {
    try {
      await stopAndRemoveTelegramProxyOnServer(server, { id, config_path: telegramProxyConfigDir(id) });
    } catch (e) {
      errors.push(`#${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors;
}
