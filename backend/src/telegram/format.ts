import type { UserRow } from "../db.js";
import { userAllowedOnServers } from "../db.js";

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Текст для Telegram HTML: убирает теги редактора, переносы — через \\n (не &lt;br&gt;). */
export function plainTextForTelegramHtml(raw: string): string {
  return String(raw ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function subscriptionPublicName(u: { name?: string | null; email?: string | null }): string {
  const name = String(u.name ?? u.email ?? "").trim();
  return name || "Подписка";
}

/** «1 день», «2 дня», «5 дней» и т.д. */
export function formatDaysRu(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} дней`;
  if (mod10 === 1) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} дня`;
  return `${n} дней`;
}

export function fmtBytes(n: number): string {
  const v = Number(n) || 0;
  if (v < 1024) return `${v.toFixed(0)} B`;
  const kb = v / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function expiryLine(u: UserRow): string {
  if (!u.expiry_time) return "∞ безлимит";
  return new Date(u.expiry_time).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatStatsHtml(users: UserRow[]): string {
  if (users.length === 0) return "<b>Нет привязанной подписки.</b>\nУкажите ваш числовой Telegram ID в панели администратора.";
  const parts: string[] = [];
  for (const u of users) {
    const ok = userAllowedOnServers(u);
    const up = fmtBytes(u.traffic_up);
    const down = fmtBytes(u.traffic_down);
    const total = u.total_gb > 0 ? `${fmtBytes(u.total_gb * 1073741824)} лимит` : "∞ безлимит";
    const totUsed = fmtBytes(u.traffic_up + u.traffic_down);
    parts.push(
      [
        `📧 <b>Email / метка:</b> ${escHtml(u.email || u.name)}`,
        `🚨 <b>Активен в панели:</b> ${u.enable === 1 ? "✅ Да" : "❌ Нет"}`,
        `📡 <b>Доступ по подписке:</b> ${ok ? "✅ Да" : "❌ Нет (срок/лимит/выкл.)"}`,
        `📅 <b>Дата окончания:</b> ${escHtml(expiryLine(u))}`,
        `🔼 <b>Исходящий:</b> ↑ ${up}`,
        `🔽 <b>Входящий:</b> ↓ ${down}`,
        `📊 <b>Всего:</b> ↑↓ ${totUsed} из ${escHtml(total)}`,
        `👤 <b>Подписка:</b> ${escHtml(u.name || u.email || "—")}`,
      ].join("\n"),
    );
    if (users.length > 1) parts.push("");
  }
  parts.push(`\n📋 🔄 <b>Обновлено:</b> ${escHtml(new Date().toLocaleString("ru-RU"))}`);
  return parts.join("\n");
}
