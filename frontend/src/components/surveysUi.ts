import type { SurveyDto } from "../api";

export type SurveyListTab = "drafts" | "sent" | "archived";

export function surveyListTab(s: SurveyDto): SurveyListTab {
  if (s.status === "draft") return "drafts";
  if (s.status === "archived") return "archived";
  return "sent";
}

export type SurveyBadge = { label: string; className: string };

export function surveyStatusBadge(s: SurveyDto): SurveyBadge {
  const answered = s.stats?.answered_count ?? s.answered_count ?? 0;
  if (s.status === "archived") return { label: "Архив", className: "survey-badge archived" };
  if (s.status === "draft") return { label: "Черновик", className: "survey-badge draft" };
  if (s.status === "sending") return { label: "Отправляется", className: "survey-badge sending" };
  if (answered > 0) return { label: "Есть ответы", className: "survey-badge completed" };
  if (s.status === "partially_failed") return { label: "Частично не отправлен", className: "survey-badge warn" };
  if (s.status === "failed") return { label: "Ошибка", className: "survey-badge failed" };
  if (s.status === "completed") return { label: "Есть ответы", className: "survey-badge completed" };
  if (s.status === "sent") return { label: "Отправлен", className: "survey-badge sent" };
  return { label: s.status, className: "survey-badge sent" };
}

export function fmtSurveyDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parseApiError(e: unknown): string {
  const raw = String(e).replace(/^Error:\s*/, "");
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* plain */
  }
  return raw;
}
