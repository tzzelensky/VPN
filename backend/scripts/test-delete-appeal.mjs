import { listSupportAppeals } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";
import { readFileSync } from "node:fs";

const appeals = listSupportAppeals();
const inProg = appeals.filter((a) => a.status === "in_progress");
console.log("in_progress appeals:", inProg.map((a) => ({ id: a.id, status: a.status })));

const route = readFileSync("/home/vpnadm/vpn-admin-app/backend/dist/routes/supportAppeals.js", "utf8");
const delBlock = route.slice(route.indexOf('router.delete("/:id"'), route.indexOf('router.post("/:id/complete"'));
console.log("delete block has in_progress guard:", /cur\.status === "in_progress"/.test(delBlock));
