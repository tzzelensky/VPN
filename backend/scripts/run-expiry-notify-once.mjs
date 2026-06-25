import { initAutoCommunicationsStore } from "../dist/autoCommunicationsStore.js";
import { runAutoExpiryNotificationsOnce } from "../dist/telegram/expiryNotify.js";

initAutoCommunicationsStore();
await runAutoExpiryNotificationsOnce({ force: true });
console.log(JSON.stringify({ ok: true }));
