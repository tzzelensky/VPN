import { listSupportAppeals } from "/home/vpnadm/vpn-admin-app/backend/dist/db.js";

const appeals = listSupportAppeals();
console.log("DATA_PATH", process.env.DATA_PATH);
console.log(
  appeals.map((a) => ({ id: a.id, status: a.status, user: a.telegram_username || a.telegram_user_id })),
);
