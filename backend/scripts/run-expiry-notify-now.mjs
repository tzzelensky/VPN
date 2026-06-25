import { initDb } from "../dist/db.js";
import { initPanelSettings } from "../dist/panelSettings.js";
import { initAutoCommunicationsStore } from "../dist/autoCommunicationsStore.js";
import { runAutoExpiryNotificationsOnce } from "../dist/telegram/expiryNotify.js";

initDb();
initPanelSettings();
initAutoCommunicationsStore();

await runAutoExpiryNotificationsOnce({ force: true });
console.log("expiry_notify_force_ok");
