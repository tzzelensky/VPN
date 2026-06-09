import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  addServerToAllSubscriptions,
  clientUuidsForServer,
  createServer,
  deleteServer,
  getServer,
  getServerSubscriptionSettings,
  listUsers,
  listServersOrdered,
  getServerSubscriptionCoverage,
  updateServer,
  type ServerRow,
} from "../db.js";
import { pushClientListToAllDeployedServers } from "../userSync.js";
import { countryFlagEmoji } from "../serverDisplay.js";
import { encryptSecret } from "../crypto.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  testSshConnection,
  deployOrSyncVless,
  installXrayIfMissing,
  applySubscriptionSettingsToServer,
  generateRemoteVlessAuthPair,
  sshReadRemoteFile,
  withSsh,
  TZADMIN_XRAY_CONFIG_PATH,
  type SshLog,
} from "../ssh.js";
import { managedClientsForServer, resolveConfigPath } from "../userSync.js";
import { clearXrayLogFiles, fetchXrayLogsSnapshot, setXrayLogLevel } from "../xrayLogsService.js";
import { isXrayLogLevel } from "../xrayLogUtil.js";
import { initNdjsonStream, ndjsonLine, wantsNdjsonStream } from "../streamUtil.js";
import {
  defaultSubscriptionSettings,
  generateRealityShortId,
  generateRealitySpiderX,
  normalizeSubscriptionSettings,
  subscriptionSettingsFromLegacyServer,
  subscriptionSettingsFromRemoteConfig,
  subscriptionSettingsToApi,
  syncSubscriptionVlessFields,
  validateSubscriptionSettings,
  type ServerSubscriptionSettings,
} from "../serverSubscriptionSettings.js";
import { generateX25519RealityKeyPair } from "../realityKeygen.js";
import { type VlessAuthGenMode } from "../vlessAuthKeygen.js";
import {
  buildServerSubscriptionClientJson,
  buildSubscriptionPreviewSummary,
} from "../serverClientJson.js";
import {
  buildSubscriptionOutcomeLines,
  buildSubscriptionSettingsChecklist,
} from "../serverSubscriptionCheck.js";
import { buildVlessUriFromSubscriptionSettings } from "../vlessLink.js";

const router = Router();
router.use(requireAuth);

function sshCfg(row: ServerRow) {
  return {
    host: row.host,
    port: row.ssh_port,
    username: row.ssh_user,
    passwordEnc: row.ssh_password_enc,
  };
}

function serverToJson(r: ServerRow) {
  const cov = getServerSubscriptionCoverage(r.id);
  return {
    id: r.id,
    name: r.name,
    country_code: r.country_code,
    country_flag: countryFlagEmoji(r.country_code),
    host: r.host,
    ssh_port: r.ssh_port,
    ssh_user: r.ssh_user,
    vless_port: r.vless_port,
    vless_uuid: r.vless_uuid,
    xray_config_path: r.xray_config_path,
    sub_port: r.sub_port,
    sub_network: r.sub_network,
    sub_security: r.sub_security,
    sub_type: r.sub_type,
    sub_host: r.sub_host,
    sub_path: r.sub_path,
    sub_sni: r.sub_sni,
    sub_fp: r.sub_fp,
    sub_alpn: r.sub_alpn,
    sub_allow_insecure: r.sub_allow_insecure,
    sub_reality_pbk: r.sub_reality_pbk,
    sub_reality_sid: r.sub_reality_sid,
    sub_reality_spx: r.sub_reality_spx,
    subscription_settings: subscriptionSettingsToApi(getServerSubscriptionSettings(r)),
    subscription_settings_custom: Boolean(r.subscription_settings_custom),
    vless_deployed: Boolean(r.vless_deployed),
    experimental_only: Boolean(r.experimental_only),
    last_ssh_ok: Boolean(r.last_ssh_ok),
    last_error: r.last_error,
    updated_at: r.updated_at,
    in_all_subscriptions: cov.in_all_subscriptions,
    subscription_users_total: cov.users_total,
    subscription_users_missing: cov.users_missing,
  };
}

router.get("/", (_req, res) => {
  res.json(listServersOrdered().map(serverToJson));
});

router.post("/", (req, res) => {
  const { name, host, ssh_user, ssh_password, ssh_port, vless_port, country_code } = req.body as {
    name?: string;
    host?: string;
    ssh_user?: string;
    ssh_password?: string;
    ssh_port?: number;
    vless_port?: number;
    country_code?: string;
  };
  if (!host || !ssh_user || !ssh_password) {
    res.status(400).json({ error: "host_ssh_user_password_required" });
    return;
  }
  const enc = encryptSecret(ssh_password);
  const sp = Number(ssh_port) > 0 ? Number(ssh_port) : 22;
  const vp = Number(vless_port) > 0 ? Number(vless_port) : 8443;
  const nm = (name && String(name).trim()) || host;
  const cc = String(country_code ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
  const id = createServer({
    name: nm,
    country_code: cc.length === 2 ? cc : "",
    host,
    ssh_port: sp,
    ssh_user,
    ssh_password_enc: enc,
    vless_port: vp,
    vless_uuid: null,
    xray_config_path: null,
    sub_port: vp,
    sub_network: "",
    sub_security: "",
    sub_type: "",
    sub_host: "",
    sub_path: "",
    sub_sni: "",
    sub_fp: "",
    sub_alpn: "",
    sub_allow_insecure: 0,
    sub_reality_pbk: "",
    sub_reality_sid: "",
    sub_reality_spx: "",
    subscription_settings: null,
    subscription_settings_custom: 0,
    vless_deployed: 0,
    experimental_only: 0,
    last_ssh_ok: 0,
    last_error: null,
  });
  res.json({ id });
});

router.patch("/:id(\\d+)", (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const b = req.body as { name?: string; country_code?: string | null; experimental_only?: boolean };
  const patch: Partial<ServerRow> = {};
  if (b.name !== undefined) {
    const nm = String(b.name).trim();
    patch.name = nm || row.host;
  }
  if (b.country_code !== undefined) {
    const cc = String(b.country_code ?? "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 2);
    patch.country_code = cc.length === 2 ? cc : "";
  }
  if (b.experimental_only !== undefined) {
    patch.experimental_only = b.experimental_only ? 1 : 0;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no_fields" });
    return;
  }
  updateServer(id, patch);
  const next = getServer(id);
  res.json({ server: next ? serverToJson(next) : null });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  deleteServer(id);
  res.json({ ok: true });
});

router.post("/:id(\\d+)/add-to-all-subscriptions", async (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const { updated_users } = addServerToAllSubscriptions(id);
    await pushClientListToAllDeployedServers();
    const next = getServer(id);
    res.json({
      ok: true,
      updated_users,
      server: next ? serverToJson(next) : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg === "server_not_deployed" ? 400 : 500;
    res.status(code).json({ error: msg });
  }
});

function mkLog(stream: boolean, res: import("express").Response): SshLog | undefined {
  if (!stream) return undefined;
  return (msg: string) => ndjsonLine(res, { type: "log", msg, t: Date.now() });
}

router.post("/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  const stream = wantsNdjsonStream(req);
  if (stream) initNdjsonStream(res);
  const log = mkLog(stream, res);

  const row = getServer(id);
  if (!row) {
    if (stream) {
      ndjsonLine(res, { type: "error", message: "not_found" });
      return res.end();
    }
    return res.status(404).json({ error: "not_found" });
  }

  try {
    const r = await testSshConnection(
      {
        host: row.host,
        port: row.ssh_port,
        username: row.ssh_user,
        passwordEnc: row.ssh_password_enc,
      },
      log,
    );
    updateServer(id, {
      last_ssh_ok: r.ok ? 1 : 0,
      last_error: r.ok ? null : r.detail,
    });
    if (stream) {
      ndjsonLine(res, { type: "done", ...r });
      return res.end();
    }
    res.json(r);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (stream) {
      ndjsonLine(res, { type: "error", message });
      return res.end();
    }
    res.status(500).json({ error: message });
  }
});

router.post("/:id/install-xray", async (req, res) => {
  const id = Number(req.params.id);
  const stream = wantsNdjsonStream(req);
  if (stream) initNdjsonStream(res);
  const log = mkLog(stream, res);

  const row = getServer(id);
  if (!row) {
    if (stream) {
      ndjsonLine(res, { type: "error", message: "not_found" });
      return res.end();
    }
    return res.status(404).json({ error: "not_found" });
  }

  try {
    const r = await installXrayIfMissing(
      {
        host: row.host,
        port: row.ssh_port,
        username: row.ssh_user,
        passwordEnc: row.ssh_password_enc,
      },
      log,
    );
    if (stream) {
      ndjsonLine(res, { type: "done", ...r });
      return res.end();
    }
    res.json(r);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (stream) {
      ndjsonLine(res, { type: "error", message });
      return res.end();
    }
    res.status(500).json({ error: message });
  }
});

router.post("/:id/deploy-vless", async (req, res) => {
  const id = Number(req.params.id);
  const stream = wantsNdjsonStream(req);
  if (stream) initNdjsonStream(res);
  const log = mkLog(stream, res);

  const row = getServer(id);
  if (!row) {
    if (stream) {
      ndjsonLine(res, { type: "error", message: "not_found" });
      return res.end();
    }
    return res.status(404).json({ error: "not_found" });
  }

  const uuid = row.vless_uuid ?? uuidv4();
  const pathToUse = TZADMIN_XRAY_CONFIG_PATH;
  const clientUuids = clientUuidsForServer(uuid);

  try {
    const dep = await deployOrSyncVless(
      {
        host: row.host,
        port: row.ssh_port,
        username: row.ssh_user,
        passwordEnc: row.ssh_password_enc,
      },
      {
        clientUuids,
        vlessPort: row.vless_port,
        configPath: pathToUse,
      },
      log,
    );

    if (!dep.ok) {
      updateServer(id, { last_error: dep.detail });
      if (stream) {
        ndjsonLine(res, { type: "done", ok: false, detail: dep.detail });
        return res.end();
      }
      return res.status(400).json(dep);
    }

    updateServer(id, {
      vless_uuid: uuid,
      vless_deployed: 1,
      last_ssh_ok: 1,
      last_error: null,
      xray_config_path: pathToUse,
      ...(dep.hints
        ? {
            sub_network: dep.hints.sub_network,
            sub_port: dep.hints.sub_port || row.vless_port,
            sub_security: dep.hints.sub_security,
            sub_type: dep.hints.sub_type,
            sub_host: dep.hints.sub_host,
            sub_path: dep.hints.sub_path,
            sub_sni: dep.hints.sub_sni,
            sub_fp: dep.hints.sub_fp,
            sub_alpn: dep.hints.sub_alpn,
            sub_allow_insecure: dep.hints.sub_allow_insecure,
            sub_reality_pbk: dep.hints.sub_reality_pbk,
            sub_reality_sid: dep.hints.sub_reality_sid,
            sub_reality_spx: dep.hints.sub_reality_spx,
          }
        : {}),
    });

    const afterHints = getServer(id);
    if (afterHints && !afterHints.subscription_settings_custom) {
      updateServer(id, {
        subscription_settings: subscriptionSettingsFromLegacyServer(afterHints),
      });
    }

    const payload = {
      ok: true,
      uuid,
      configPath: pathToUse,
      detail: dep.detail,
      hints: dep.hints,
    };
    if (stream) {
      ndjsonLine(res, { type: "done", ...payload });
      return res.end();
    }
    res.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (stream) {
      ndjsonLine(res, { type: "error", message });
      return res.end();
    }
    res.status(500).json({ error: message });
  }
});

router.get("/:id(\\d+)/xray-logs", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    const lines = Math.min(500, Math.max(50, Number(req.query.lines) || 300));
    const snapshot = await fetchXrayLogsSnapshot(id, { lines });
    res.json(snapshot);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

router.patch("/:id(\\d+)/xray-logs/loglevel", async (req, res) => {
  const id = Number(req.params.id);
  const level = String((req.body as { loglevel?: unknown })?.loglevel ?? "").trim().toLowerCase();
  if (!Number.isFinite(id) || id <= 0 || !isXrayLogLevel(level)) {
    res.status(400).json({ error: "bad_payload" });
    return;
  }
  try {
    const snapshot = await setXrayLogLevel(id, level);
    res.json(snapshot);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

router.get("/:id(\\d+)/subscription-settings", (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({
    settings: subscriptionSettingsToApi(getServerSubscriptionSettings(row)),
    custom: Boolean(row.subscription_settings_custom),
    server: serverToJson(row),
  });
});

router.patch("/:id(\\d+)/subscription-settings", async (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const body = (req.body ?? {}) as { settings?: unknown };
    const settings = normalizeSubscriptionSettings(body.settings, row);
    const synced = syncSubscriptionVlessFields(settings);
    const errors = validateSubscriptionSettings(synced);
    if (errors.length > 0) {
      res.status(400).json({ error: "validation_failed", errors });
      return;
    }
    updateServer(id, {
      subscription_settings: synced,
      subscription_settings_custom: 1,
      sub_port: synced.vless_port,
      sub_network: synced.network,
      sub_security: synced.security,
      sub_sni: synced.reality.server_name,
      sub_fp: synced.reality.fingerprint,
      sub_reality_pbk: synced.reality.public_key,
      sub_reality_sid: synced.reality.short_id,
      sub_reality_spx: synced.reality.spider_x,
      sub_allow_insecure: synced.reality.allow_insecure ? 1 : 0,
    });

    let serverApply: {
      ok: boolean;
      detail: string;
      applied_port?: number;
      pushed?: string[];
      firewall?: { opened: boolean; detail: string; manual_command?: string | null; cloud_security_group_hint?: string | null };
    } = {
      ok: false,
      detail: "Сервер не развёрнут — настройки сохранены только в панели. Нажмите «Развернуть VLESS».",
    };

    const current = getServer(id)!;
    if (current.vless_deployed) {
      const configPath = current.xray_config_path?.trim() || TZADMIN_XRAY_CONFIG_PATH;
      const clients = managedClientsForServer(current.vless_uuid);
      const apply = await applySubscriptionSettingsToServer(
        sshCfg(current),
        { configPath, settings: synced, clientEntries: clients },
      );
      serverApply = {
        ok: apply.ok,
        detail: apply.detail,
        applied_port: apply.appliedPort,
        pushed: apply.pushed,
        firewall: apply.firewall
          ? {
              opened: apply.firewall.opened,
              detail: apply.firewall.detail,
              manual_command: apply.firewall.manual_command,
              cloud_security_group_hint: apply.firewall.cloud_security_group_hint,
            }
          : undefined,
      };
      if (apply.ok) {
        const appliedPort = apply.appliedPort ?? synced.vless_port;
        const appliedSettings = syncSubscriptionVlessFields({
          ...synced,
          vless_port: appliedPort,
          reality: {
            ...synced.reality,
            public_key: apply.publicKey || synced.reality.public_key,
            private_key: apply.privateKey || synced.reality.private_key,
          },
        });
        updateServer(id, {
          vless_port: appliedPort,
          sub_port: appliedPort,
          sub_reality_pbk: appliedSettings.reality.public_key,
          subscription_settings: appliedSettings,
          xray_config_path: configPath,
        });
      }
    }

    const next = getServer(id);
    res.json({
      ok: true,
      settings: subscriptionSettingsToApi(getServerSubscriptionSettings(next!)),
      server: next ? serverToJson(next) : null,
      server_apply: serverApply,
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/:id(\\d+)/subscription-settings/reset", (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const settings = row.vless_deployed
    ? subscriptionSettingsFromLegacyServer(row)
    : defaultSubscriptionSettings(row);
  updateServer(id, {
    subscription_settings: settings,
    subscription_settings_custom: 0,
  });
  const next = getServer(id);
  res.json({
    ok: true,
    settings: subscriptionSettingsToApi(getServerSubscriptionSettings(next!)),
    server: next ? serverToJson(next) : null,
  });
});

router.post("/:id(\\d+)/subscription-settings/sync-from-server", async (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  try {
    let settings = subscriptionSettingsFromLegacyServer(row);
    if (row.vless_deployed) {
      const configPath = await resolveConfigPath(row);
      const raw = await sshReadRemoteFile(sshCfg(row), configPath);
      const config = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      settings = subscriptionSettingsFromRemoteConfig(row, config, row.vless_port);
    }
    updateServer(id, {
      subscription_settings: settings,
      subscription_settings_custom: 0,
      sub_port: settings.vless_port,
      sub_network: settings.network,
      sub_security: settings.security,
      sub_sni: settings.reality.server_name,
      sub_fp: settings.reality.fingerprint,
      sub_reality_pbk: settings.reality.public_key,
      sub_reality_sid: settings.reality.short_id,
      sub_reality_spx: settings.reality.spider_x,
      sub_allow_insecure: settings.reality.allow_insecure ? 1 : 0,
    });
    const next = getServer(id);
    res.json({
      ok: true,
      settings: subscriptionSettingsToApi(getServerSubscriptionSettings(next!)),
      server: next ? serverToJson(next) : null,
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/:id(\\d+)/subscription-settings/preview", (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const b = (req.body ?? {}) as { settings?: unknown; user_id?: unknown };
  const rawSettings = b.settings
    ? normalizeSubscriptionSettings(b.settings, row)
    : getServerSubscriptionSettings(row);
  const settings = syncSubscriptionVlessFields(rawSettings);
  const errors = validateSubscriptionSettings(settings);
  if (errors.length > 0) {
    res.status(400).json({ error: "validation_failed", errors });
    return;
  }
  const userId = Math.floor(Number(b.user_id));
  let user = listUsers().find((u) => u.id === userId);
  if (!user) user = listUsers()[0];
  if (!user) {
    res.status(400).json({ error: "no_users_for_preview" });
    return;
  }
  const json = buildServerSubscriptionClientJson(row, user, settings);
  const summary = buildSubscriptionPreviewSummary(row, user, settings);
  const vless_uri = buildVlessUriFromSubscriptionSettings(row, user, settings);
  const checklist = buildSubscriptionSettingsChecklist(row, settings);
  const outcome = buildSubscriptionOutcomeLines(row, settings, user.name);
  res.json({ summary, json, vless_uri, checklist, outcome });
});

router.post("/:id(\\d+)/subscription-settings/check", (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const b = (req.body ?? {}) as { settings?: unknown };
  const rawSettings = b.settings
    ? normalizeSubscriptionSettings(b.settings, row)
    : getServerSubscriptionSettings(row);
  const settings = syncSubscriptionVlessFields(rawSettings);
  const validation_errors = validateSubscriptionSettings(settings);
  const checklist = buildSubscriptionSettingsChecklist(row, settings);
  const outcome = buildSubscriptionOutcomeLines(row, settings);
  res.json({
    ok: validation_errors.length === 0 && !checklist.some((x) => x.level === "err"),
    checklist,
    outcome,
    validation_errors,
  });
});

router.post("/:id(\\d+)/subscription-settings/generators/vless-auth", async (req, res) => {
  const id = Number(req.params.id);
  const row = getServer(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const modeRaw = String((req.body as { mode?: unknown })?.mode ?? "x25519").trim().toLowerCase();
  const mode: VlessAuthGenMode = modeRaw === "ml-kem-768" || modeRaw === "mlkem768" ? "ml-kem-768" : "x25519";
  try {
    const pair = await withSsh(sshCfg(row), (conn) => generateRemoteVlessAuthPair(conn, mode));
    res.json(pair);
  } catch (e) {
    res.status(502).json({ error: "vlessenc_failed", message: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/subscription-settings/generators/vless-auth", (req, res) => {
  const modeRaw = String((req.body as { mode?: unknown })?.mode ?? "x25519").trim().toLowerCase();
  const mode: VlessAuthGenMode = modeRaw === "ml-kem-768" || modeRaw === "mlkem768" ? "ml-kem-768" : "x25519";
  res.status(400).json({
    error: "server_id_required",
    message: "Укажите id сервера: POST /api/servers/:id/subscription-settings/generators/vless-auth",
  });
});

router.get("/subscription-settings/generators", (_req, res) => {
  const keys = generateX25519RealityKeyPair();
  res.json({
    short_id: generateRealityShortId(),
    spider_x: generateRealitySpiderX(),
    public_key: keys.publicKey,
    private_key: keys.privateKey,
  });
});

router.post("/:id(\\d+)/xray-logs/clear", async (req, res) => {
  const id = Number(req.params.id);
  const raw = (req.body as { targets?: unknown })?.targets;
  const targets = Array.isArray(raw)
    ? raw.filter((t): t is "access" | "error" => t === "access" || t === "error")
    : (["access", "error"] as const);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "bad_id" });
    return;
  }
  try {
    const result = await clearXrayLogFiles(id, [...targets]);
    const snapshot = await fetchXrayLogsSnapshot(id);
    res.json({ ...result, snapshot });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

export default router;
