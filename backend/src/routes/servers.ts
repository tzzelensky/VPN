import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  clientUuidsForServer,
  createServer,
  deleteServer,
  getServer,
  listServersOrdered,
  updateServer,
  type ServerRow,
} from "../db.js";
import { countryFlagEmoji } from "../serverDisplay.js";
import { encryptSecret } from "../crypto.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  testSshConnection,
  detectXrayConfigPath,
  deployOrSyncVless,
  installXrayIfMissing,
  type SshLog,
} from "../ssh.js";
import { initNdjsonStream, ndjsonLine, wantsNdjsonStream } from "../streamUtil.js";

const router = Router();
router.use(requireAuth);

function serverToJson(r: ServerRow) {
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
    vless_deployed: Boolean(r.vless_deployed),
    last_ssh_ok: Boolean(r.last_ssh_ok),
    last_error: r.last_error,
    updated_at: r.updated_at,
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
    vless_deployed: 0,
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
  const b = req.body as { name?: string; country_code?: string | null };
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
  let configPath: string | null = null;
  try {
    configPath = await detectXrayConfigPath(
      {
        host: row.host,
        port: row.ssh_port,
        username: row.ssh_user,
        passwordEnc: row.ssh_password_enc,
      },
      log,
    );
  } catch {
    configPath = null;
  }
  const pathToUse = configPath ?? "/usr/local/etc/xray/config.json";
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

export default router;
