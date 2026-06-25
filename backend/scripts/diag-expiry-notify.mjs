import fs from "node:fs";

const dataPath = process.argv[2] || "/opt/vpn-admin/data/data.json";
const d = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const now = Date.now();
const DAY = 86_400_000;
const users = (d.users || []).filter(
  (u) => u.enable !== 0 && u.expiry_time > now && u.expiry_time - now <= 3 * DAY,
);
console.log("in_window", users.length);
for (const u of users) {
  const left = Math.ceil((u.expiry_time - now) / DAY);
  console.log(
    u.id,
    u.name,
    "days",
    left,
    "state",
    u.expiry_notify_state || "",
    "sent_day",
    u.expiry_warn_sent_day || "",
    "tg",
    u.tg_id || "",
  );
}
