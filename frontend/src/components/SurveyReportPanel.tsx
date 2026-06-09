import { useEffect, useMemo, useRef, useState } from "react";
import type { SurveyDto, SurveyRecipientDto, SurveyReportDto } from "../api";
import { surveyExportUrl } from "../api";
import { fmtSurveyDate, surveyStatusBadge } from "./surveysUi";

export type SurveyReportTab = "stats" | "answers";

type Props = {
  survey: SurveyDto;
  report: SurveyReportDto;
  recipients: SurveyRecipientDto[];
  activeTab: SurveyReportTab;
  onTabChange: (tab: SurveyReportTab) => void;
  onClose?: () => void;
};

function sendStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Ожидает",
    sent: "Отправлено",
    delivered: "Доставлено",
    failed: "Ошибка",
    answered: "Ответил",
  };
  return map[status] ?? status;
}

function AnswersTable({
  rows,
  hasAnyRating,
  totalAnswered,
}: {
  rows: SurveyRecipientDto[];
  hasAnyRating: boolean;
  totalAnswered: number;
}) {
  if (!hasAnyRating && totalAnswered === 0) {
    return (
      <div className="survey-inline-empty">
        <p className="survey-empty-title">Пока нет ответов</p>
        <p className="survey-empty-hint">Когда клиенты ответят в Telegram, здесь появятся оценки и комментарии.</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="survey-inline-empty">
        <p className="survey-empty-title">Нет строк по фильтрам</p>
        <p className="survey-empty-hint">Измените фильтры или сбросьте поиск.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table survey-answers-table">
        <thead>
          <tr>
            <th>Клиент</th>
            <th>Telegram</th>
            <th>Телефон</th>
            <th>Статус отправки</th>
            <th>Оценка</th>
            <th>Обратная связь</th>
            <th>Дата ответа</th>
            <th>Ошибка</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.user_name}</td>
              <td>{r.telegram_username ?? "—"}</td>
              <td>{r.phone?.trim() ? r.phone : "—"}</td>
              <td>
                <span className={r.status === "failed" ? "survey-cell-warn" : ""}>{sendStatusLabel(r.status)}</span>
              </td>
              <td>{r.rating != null ? r.rating : "—"}</td>
              <td className="survey-feedback-cell">
                {r.feedback_text?.trim() ? r.feedback_text : r.rating != null ? "Комментарии пока не оставляли" : "—"}
              </td>
              <td>{fmtSurveyDate(r.rating_answered_at)}</td>
              <td className="survey-error-cell">{r.error_message?.trim() ? r.error_message : "Ошибок отправки нет"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SurveyReportPanel({ survey, report, recipients, activeTab, onTabChange, onClose }: Props) {
  const answersRef = useRef<HTMLDivElement>(null);
  const [filterRating, setFilterRating] = useState("");
  const [filterFeedbackOnly, setFilterFeedbackOnly] = useState(false);
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  useEffect(() => {
    setFilterRating("");
    setFilterFeedbackOnly(false);
    setFilterErrorsOnly(false);
    setFilterQuery("");
  }, [survey.id]);

  useEffect(() => {
    if (activeTab === "answers" && answersRef.current) {
      answersRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [activeTab, survey.id]);

  const badge = surveyStatusBadge(survey);
  const dist = report.stats.distribution;
  const totalAnswered = report.stats.answered_count ?? 0;

  const filteredRecipients = useMemo(() => {
    return recipients.filter((r) => {
      if (filterRating && String(r.rating ?? "") !== filterRating) return false;
      if (filterFeedbackOnly && !r.feedback_text?.trim()) return false;
      if (filterErrorsOnly && r.status !== "failed") return false;
      if (filterQuery.trim()) {
        const q = filterQuery.trim().toLowerCase();
        const hay = `${r.user_name} ${r.telegram_username ?? ""} ${r.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [recipients, filterRating, filterFeedbackOnly, filterErrorsOnly, filterQuery]);

  const hasAnyRating = recipients.some((r) => r.rating != null && r.rating >= 1);
  const sendErrorsCount = recipients.filter((r) => r.status === "failed").length;

  const filtersBlock = (
    <div className="survey-answers-filters">
      <input
        className="survey-answers-search"
        value={filterQuery}
        onChange={(e) => setFilterQuery(e.target.value)}
        placeholder="Поиск по имени, телефону, Telegram…"
      />
      <select value={filterRating} onChange={(e) => setFilterRating(e.target.value)} aria-label="Фильтр по оценке">
        <option value="">Все оценки</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
      </select>
      <label className="survey-filter-check">
        <input type="checkbox" checked={filterFeedbackOnly} onChange={(e) => setFilterFeedbackOnly(e.target.checked)} />
        Только с обратной связью
      </label>
      <label className="survey-filter-check">
        <input type="checkbox" checked={filterErrorsOnly} onChange={(e) => setFilterErrorsOnly(e.target.checked)} />
        Только ошибки отправки
      </label>
    </div>
  );

  return (
    <section className="survey-report-panel">
      <header className="survey-report-header">
        <p className="survey-report-kicker">Отчёт по опросу</p>
        <div className="survey-report-title-row">
          <h2 className="survey-report-title">{survey.title}</h2>
          <span className={badge.className}>{badge.label}</span>
        </div>
        <p className="sub survey-report-meta">
          Создан: {fmtSurveyDate(survey.created_at)}
          {survey.sent_at ? ` · Отправлен: ${fmtSurveyDate(survey.sent_at)}` : ""}
        </p>
      </header>

      <div className="survey-report-toolbar">
        <div className="survey-report-view-tabs" role="tablist" aria-label="Раздел отчёта">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "stats"}
            className={`survey-report-view-tab ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => onTabChange("stats")}
          >
            Статистика
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "answers"}
            className={`survey-report-view-tab ${activeTab === "answers" ? "active" : ""}`}
            onClick={() => onTabChange("answers")}
          >
            Ответы
            {totalAnswered > 0 ? <span className="survey-report-view-tab-badge">{totalAnswered}</span> : null}
          </button>
        </div>
        <div className="survey-report-toolbar-actions">
          <a className="ghost" href={surveyExportUrl(survey.id)} download>
            Экспорт
          </a>
          {onClose ? (
            <button type="button" className="ghost" onClick={onClose} title="Скрыть отчёт">
              Скрыть
            </button>
          ) : null}
        </div>
      </div>

      {(activeTab === "stats" || activeTab === "answers") && (
        <div className={`survey-report-stats-block ${activeTab === "answers" ? "survey-report-stats-block--collapsed" : ""}`}>
          <div className="survey-report-metrics">
            <div className="survey-metric">
              <span className="survey-metric-val">{report.total_recipients}</span>
              <span className="survey-metric-lbl">Получателей</span>
            </div>
            <div className="survey-metric">
              <span className="survey-metric-val">{report.send_ok}</span>
              <span className="survey-metric-lbl">Отправлено</span>
            </div>
            <div className="survey-metric">
              <span className="survey-metric-val survey-metric-val--warn">{report.send_failed}</span>
              <span className="survey-metric-lbl">Ошибок</span>
            </div>
            <div className="survey-metric">
              <span className="survey-metric-val">{report.answered}</span>
              <span className="survey-metric-lbl">Ответили</span>
            </div>
            <div className="survey-metric">
              <span className="survey-metric-val">{report.response_rate}%</span>
              <span className="survey-metric-lbl">Доля ответов</span>
            </div>
            <div className="survey-metric">
              <span className="survey-metric-val">{report.stats.average_rating ?? "—"}</span>
              <span className="survey-metric-lbl">Средняя оценка</span>
            </div>
          </div>

          {activeTab === "stats" ? (
            <>
              <h3 className="survey-report-subtitle">Распределение оценок</h3>
              {totalAnswered === 0 ? (
                <p className="survey-inline-hint">Пока нет оценок для распределения.</p>
              ) : (
                <div className="survey-dist-bars">
                  {[5, 4, 3, 2, 1].map((n) => {
                    const count = dist[n] ?? 0;
                    const pctOfAnswers = totalAnswered > 0 ? Math.round((count / totalAnswered) * 1000) / 10 : 0;
                    const barWidth = totalAnswered > 0 && count > 0 ? Math.max(4, pctOfAnswers) : 0;
                    const answerWord = count === 1 ? "ответ" : count >= 2 && count <= 4 ? "ответа" : "ответов";
                    return (
                      <div key={n} className="survey-dist-bar-row">
                        <span className="survey-dist-bar-label">{n} ★</span>
                        <div className="survey-dist-bar-track" title={`${count} из ${totalAnswered}`}>
                          <div className="survey-dist-bar-fill" style={{ width: `${barWidth}%` }} />
                        </div>
                        <span className="survey-dist-bar-meta">
                          <strong>{count}</strong> {answerWord}, {pctOfAnswers}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {sendErrorsCount === 0 && report.send_failed === 0 ? (
                <p className="survey-inline-hint survey-inline-hint--ok">Ошибок отправки нет</p>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      <div ref={answersRef} className="survey-answers-block">
        <h3 className="survey-report-subtitle">Ответы клиентов</h3>
        {filtersBlock}
        <AnswersTable rows={filteredRecipients} hasAnyRating={hasAnyRating} totalAnswered={totalAnswered} />
      </div>
    </section>
  );
}
