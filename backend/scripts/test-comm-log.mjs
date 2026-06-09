import { appendCommunicationMessageLog, listCommunicationMessageLog } from "../dist/db.js";

const row = appendCommunicationMessageLog({
  automatic: true,
  source_label: "Тест записи журнала",
  text: "Тестовое сообщение для проверки истории",
  has_photo: false,
  recipients: [{ user_id: 1, user_name: "Test" }],
  sent: 1,
  attempted: 1,
  failed: 0,
});
console.log("appended", row.id);
console.log("count", listCommunicationMessageLog(5).length);
