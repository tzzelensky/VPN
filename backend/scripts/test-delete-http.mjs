/**
 * Test DELETE /api/support-appeals/:id against local API (run on server).
 */
import { listSupportAppeals } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("/home/vpnadm/vpn-admin-app/backend/.env", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const appeals = listSupportAppeals();
const target = appeals.find((a) => a.status === "in_progress") ?? appeals[0];
if (!target) {
  console.log("no appeals to test");
  process.exit(0);
}

const loginRes = await fetch("http://127.0.0.1:4000/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: env.ADMIN_USER || "tzadmin", password: env.ADMIN_PASSWORD || "" }),
});
const cookies = loginRes.headers.getSetCookie?.() ?? [];
const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
const loginBody = await loginRes.json();
console.log("login:", loginRes.status, loginBody);

if (!cookie && loginBody.need_2fa) {
  console.log("skip: 2fa required");
  process.exit(0);
}

const delRes = await fetch(`http://127.0.0.1:4000/api/support-appeals/${encodeURIComponent(target.id)}`, {
  method: "DELETE",
  headers: cookie ? { Cookie: cookie } : {},
});
const delBody = await delRes.text();
console.log("delete appeal", target.id, "status", target.status, "->", delRes.status, delBody);
