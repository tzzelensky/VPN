import fs from "node:fs";

const dataPath = process.env.DATA_PATH || "/opt/vpn-admin/data/data.json";
const storePath = process.env.DEVICE_LIMIT_STORE_PATH || "/opt/vpn-admin/data/device_limit_store.json";

console.log("dataPath", dataPath);
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

let store = {};
try {
  store = JSON.parse(fs.readFileSync(storePath, "utf8"));
} catch (e) {
  console.log("store err", e.message, storePath);
}

console.log("recent_sub_hits:", JSON.stringify(store.recent_sub_hits ?? {}, null, 2));

const withSlots = data.users.filter((x) => Array.isArray(x.device_slots) && x.device_slots.length);
console.log("users with slots:", withSlots.length);
for (const u of withSlots) {
  console.log(
    "user",
    u.id,
    u.name,
    "limit",
    u.device_limit_enabled,
    JSON.stringify(
      u.device_slots.map((s) => ({
        active: s.active,
        name: s.device_name,
        ua: (s.user_agent || "").slice(0, 200),
        ip: s.last_ip,
        id: (s.id || "").slice(0, 36),
      })),
    ),
  );
}
