import { Client } from "ssh2";
import { decryptSecret } from "../crypto.js";
import { listServersOrdered, type ServerRow } from "../db.js";

/** Узел панели, через который ходим в Gemini (IP Google видит его, а не панель). */
export const GEMINI_SSH_HOP_HOST = (process.env.GEMINI_SSH_HOST ?? "193.247.81.251").trim();

const REQUEST_TIMEOUT_MS = 55_000;

const REMOTE_PY = [
  "import sys,urllib.request,urllib.error",
  "url=sys.argv[1]",
  "timeout=int(sys.argv[2]) if len(sys.argv)>2 else 50",
  "raw=sys.stdin.buffer.read()",
  "i=raw.find(b'\\n')",
  "key=raw[:i].decode()",
  "body=raw[i+1:]",
  "req=urllib.request.Request(url,data=body,method='POST',headers={'Content-Type':'application/json','x-goog-api-key':key})",
  "try:",
  " r=urllib.request.urlopen(req,timeout=timeout); status=r.status; data=r.read()",
  "except urllib.error.HTTPError as e:",
  " status=e.code; data=e.read()",
  "except Exception as e:",
  " sys.stderr.write(str(e)); sys.exit(1)",
  "sys.stdout.buffer.write(('HTTPSTATUS:%d\\n'%status).encode()); sys.stdout.buffer.write(data)",
].join("\n");

let hopClient: Client | null = null;
let hopOpening: Promise<Client> | null = null;

function hopServer(): ServerRow {
  const row = listServersOrdered().find((s) => s.host.trim() === GEMINI_SSH_HOP_HOST);
  if (!row) {
    throw new Error("gemini_ssh_hop_not_found");
  }
  return row;
}

function sshCfg(row: ServerRow) {
  return {
    host: row.host.trim(),
    port: row.ssh_port > 0 ? row.ssh_port : 22,
    username: row.ssh_user.trim() || "root",
    password: decryptSecret(row.ssh_password_enc),
  };
}

function dropHop(): void {
  const cur = hopClient;
  hopClient = null;
  try {
    cur?.end();
  } catch {
    /* ignore */
  }
}

function openHop(): Promise<Client> {
  const row = hopServer();
  const cfg = sshCfg(row);
  const conn = new Client();
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      if (hopClient === conn) hopClient = null;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      reject(e);
    };
    conn
      .on("ready", () => {
        hopClient = conn;
        conn.on("close", () => {
          if (hopClient === conn) hopClient = null;
        });
        conn.on("error", () => {
          if (hopClient === conn) hopClient = null;
        });
        if (!settled) {
          settled = true;
          console.info(`[gemini] SSH hop ready ${cfg.username}@${cfg.host}:${cfg.port}`);
          resolve(conn);
        }
      })
      .on("error", (e) => fail(e instanceof Error ? e : new Error(String(e))))
      .connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: cfg.password,
        readyTimeout: 20_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 4,
      });
  });
}

async function getHop(): Promise<Client> {
  if (hopClient) return hopClient;
  if (!hopOpening) {
    hopOpening = openHop().finally(() => {
      hopOpening = null;
    });
  }
  return hopOpening;
}

function headerValue(raw: RequestInit["headers"], name: string): string {
  if (!raw) return "";
  const want = name.toLowerCase();
  const entries =
    raw instanceof Headers
      ? [...raw.entries()]
      : Array.isArray(raw)
        ? raw
        : Object.entries(raw as Record<string, string>);
  for (const [k, v] of entries) {
    if (String(k).toLowerCase() === want) return String(v ?? "");
  }
  return "";
}

function execStdin(
  conn: Client,
  cmd: string,
  stdin: Buffer,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("gemini_ssh_hop_timeout"));
    }, timeoutMs);
    conn.exec(cmd, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      const chunks: Buffer[] = [];
      let stderr = "";
      stream.on("data", (d: Buffer) => chunks.push(d));
      stream.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      stream.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({ code, stdout: Buffer.concat(chunks), stderr });
      });
      stream.on("error", (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });
      stream.end(stdin);
    });
  });
}

function parseHopStdout(stdout: Buffer): { status: number; body: Buffer } {
  const nl = stdout.indexOf(0x0a);
  if (nl < 0) {
    throw new Error(stdout.toString("utf8").trim().slice(0, 240) || "gemini_ssh_hop_bad_response");
  }
  const first = stdout.subarray(0, nl).toString("utf8").trim();
  const m = /^HTTPSTATUS:(\d+)$/.exec(first);
  if (!m) {
    throw new Error((first || "gemini_ssh_hop_bad_response").slice(0, 240));
  }
  return { status: Number(m[1]), body: stdout.subarray(nl + 1) };
}

async function fetchViaHop(conn: Client, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const apiKey = headerValue(init.headers, "x-goog-api-key");
  if (!apiKey) throw new Error("gemini_not_configured");
  const body =
    typeof init.body === "string" ? Buffer.from(init.body, "utf8") : Buffer.from(String(init.body ?? ""), "utf8");
  const stdin = Buffer.concat([Buffer.from(`${apiKey}\n`, "utf8"), body]);
  const b64 = Buffer.from(REMOTE_PY, "utf8").toString("base64");
  const pyTimeout = Math.max(20, Math.floor(timeoutMs / 1000) - 5);
  const cmd = `python3 -c 'exec(__import__("base64").b64decode("${b64}").decode())' ${JSON.stringify(url)} ${pyTimeout}`;
  const { code, stdout, stderr } = await execStdin(conn, cmd, stdin, timeoutMs);
  if (!stdout.length) {
    throw new Error((stderr || `ssh_exec_exit_${code ?? "null"}`).slice(0, 240));
  }
  const { status, body: resBody } = parseHopStdout(stdout);
  if (!status) {
    throw new Error((stderr || stdout.toString("utf8")).trim().slice(0, 240) || "gemini_ssh_hop_bad_response");
  }
  return new Response(new Uint8Array(resBody), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function geminiFetchViaSshHop(
  url: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  const waitMs = timeoutMs ?? REQUEST_TIMEOUT_MS;
  const tryOnce = async (): Promise<Response> => fetchViaHop(await getHop(), url, init, waitMs);
  try {
    return await tryOnce();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "gemini_ssh_hop_not_found" || msg === "gemini_not_configured") throw e;
    dropHop();
    return await tryOnce();
  }
}
