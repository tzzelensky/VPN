import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultAutoCommunicationsConfig,
  normalizeAutoCommunicationsConfig,
  type AutoCommunicationsConfig,
} from "./autoCommunicationsTypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.DATA_PATH ?? path.join(__dirname, "..", "data.json");

function storePath(): string {
  return (
    process.env.AUTO_COMMUNICATIONS_STORE_PATH ??
    path.join(path.dirname(dataPath), "auto_communications_store.json")
  );
}

let cache: AutoCommunicationsConfig = defaultAutoCommunicationsConfig();

function readFile(): AutoCommunicationsConfig {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    return normalizeAutoCommunicationsConfig(JSON.parse(raw));
  } catch {
    return defaultAutoCommunicationsConfig();
  }
}

function writeFile(cfg: AutoCommunicationsConfig): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), "utf8");
}

export function initAutoCommunicationsStore(): void {
  cache = readFile();
}

export function getAutoCommunicationsConfig(): AutoCommunicationsConfig {
  return cache;
}

export function setAutoCommunicationsConfig(patch: Partial<AutoCommunicationsConfig>): AutoCommunicationsConfig {
  const prev = getAutoCommunicationsConfig();
  const next = normalizeAutoCommunicationsConfig({
    ...prev,
    ...patch,
    traffic: patch.traffic ? { ...prev.traffic, ...patch.traffic } : prev.traffic,
    expiry: patch.expiry ? { ...prev.expiry, ...patch.expiry } : prev.expiry,
    updated_at: new Date().toISOString(),
  });
  cache = next;
  writeFile(next);
  return next;
}
