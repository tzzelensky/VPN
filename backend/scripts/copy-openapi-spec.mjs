import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src", "openapi", "adminOpenApi.json");
const destDir = path.join(root, "dist", "openapi");
const dest = path.join(destDir, "adminOpenApi.json");
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied OpenAPI spec to ${dest}`);
