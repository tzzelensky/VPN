import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import SurveysPanel from "../components/SurveysPanel";
import AutoBroadcastsPanel from "../components/AutoBroadcastsPanel";
import TriggeredMailingsPanel from "../components/TriggeredMailingsPanel";
import PanelTabs from "../components/PanelTabs";
import BroadcastWizard from "../components/comms/BroadcastWizard";
import { usePanelSettings } from "../panelSettingsContext";
import {
  listCommunicationHistory,
  listCommunicationSegments,
  listCommunicationTargets,
  type CommunicationMessageLogDto,
  type CommunicationSegmentDto,
  type CommunicationTargetDto,
} from "../api";

type CommsTab = "broadcasts" | "surveys" | "history" | "auto" | "triggers";

function ymdInTimezone(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function defaultHistoryDateRange(timeZone: string): { from: string; to: string } {
  const to = ymdInTimezone(Date.now(), timeZone);
  const [y, m, d] = to.split("-").map((x) => Number(x));
  const prev = Date.UTC(y, m - 1, d) - 86_400_000;
  const from = ymdInTimezone(prev, timeZone);
  return { from, to };
}

export default function CommunicationsPage({ onLogout }: { onLogout: () => void }) {
  const { settings: panelSettings } = usePanelSettings();
  const panelTz = panelSettings?.ui.timezone?.trim() || "Asia/Yekaterinburg";
  const brandName = panelSettings?.panel.brandName?.trim() || "HSN VPN";

  const [commsTab, setCommsTab] = useState<CommsTab>("broadcasts");
  const [targets, setTargets] = useState<CommunicationTargetDto[]>([]);
  const [segments, setSegments] = useState<CommunicationSegmentDto[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [photoNotice, setPhotoNotice] = useState("");

  const [history, setHistory] = useState<CommunicationMessageLogDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyRecipients, setHistoryRecipients] = useState<CommunicationMessageLogDto | null>(null);
  const [historyFrom, setHistoryFrom] = useState(() => defaultHistoryDateRange(panelTz).from);
  const [historyTo, setHistoryTo] = useState(() => defaultHistoryDateRange(panelTz).to);

  const reloadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await listCommunicationHistory({
        limit: 200,
        from: historyFrom,
        to: historyTo,
      });
      setHistory(data.items);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFrom, historyTo]);

  useEffect(() => {
    const range = defaultHistoryDateRange(panelTz);
    setHistoryFrom(range.from);
    setHistoryTo(range.to);
  }, [panelTz]);

  useEffect(() => {
    void (async () => {
      try {
        const [data, segs] = await Promise.all([listCommunicationTargets(), listCommunicationSegments()]);
        setTargets(data.users);
        setSegments(segs.segments);
      } catch (e) {
        setMsg({ type: "err", text: String(e) });
      }
    })();
  }, []);

  useEffect(() => {
    if (commsTab !== "history") return;
    void reloadHistory();
  }, [commsTab, reloadHistory]);

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <h1>Коммуникации</h1>
        <p className="sub users-hero-sub">
          Рассылки и опросы в Telegram: глобально, выборочно или по сегменту.
        </p>
        <PanelTabs
          tabs={[
            { id: "broadcasts", label: "Рассылки" },
            { id: "triggers", label: "Триггерные рассылки" },
            { id: "surveys", label: "Опросы" },
            { id: "auto", label: "Авто-рассылки" },
            { id: "history", label: "История отправок" },
          ]}
          value={commsTab}
          onChange={setCommsTab}
          className="comms-main-tabs-bar"
        />
        {commsTab === "broadcasts" && msg ? (
          <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div>
        ) : null}
        {commsTab === "broadcasts" && photoNotice ? <div className="flash ok">{photoNotice}</div> : null}
      </section>

      {commsTab === "triggers" ? (
        <section className="panel comms-panel">
          <TriggeredMailingsPanel />
        </section>
      ) : null}

      {commsTab === "surveys" ? (
        <section className="panel comms-panel">
          <SurveysPanel />
        </section>
      ) : null}

      {commsTab === "auto" ? (
        <section className="panel comms-panel auto-broadcasts-wrap">
          <AutoBroadcastsPanel />
        </section>
      ) : null}

      {commsTab === "broadcasts" ? (
        <section className="panel comms-panel comms-panel--wizard">
          <BroadcastWizard
            targets={targets}
            segments={segments}
            onSegmentsChange={setSegments}
            brandName={brandName}
            onFlash={setMsg}
            onPhotoNotice={setPhotoNotice}
            onHistoryReload={reloadHistory}
          />
        </section>
      ) : null}

      {commsTab === "history" ? (
        <section className="panel comms-history-panel comms-history-panel--tab">
          <div className="comms-history-panel__head">
            <div>
              <h2 className="user-modal-section-title">История отправок</h2>
              <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                Все исходящие сообщения в Telegram: рассылки из панели и автоматические уведомления.
              </p>
            </div>
            <div className="comms-history-panel__actions">
              <div className="comms-history-filters">
                <label className="comms-history-filter">
                  <span>С</span>
                  <input
                    className="input"
                    type="date"
                    value={historyFrom}
                    max={historyTo}
                    onChange={(e) => setHistoryFrom(e.target.value)}
                  />
                </label>
                <label className="comms-history-filter">
                  <span>По</span>
                  <input
                    className="input"
                    type="date"
                    value={historyTo}
                    min={historyFrom}
                    onChange={(e) => setHistoryTo(e.target.value)}
                  />
                </label>
              </div>
              <button type="button" className="ghost" disabled={historyLoading} onClick={() => void reloadHistory()}>
                {historyLoading ? "Обновление…" : "Обновить"}
              </button>
            </div>
          </div>
          {historyLoading ? (
            <p className="sub">Загрузка истории…</p>
          ) : history.length === 0 ? (
            <p className="sub">За выбранный период записей нет.</p>
          ) : (
            <div className="comms-history-list" role="log">
              {history.map((item) => {
                const when = new Date(item.sent_at);
                const whenLabel = Number.isFinite(when.getTime())
                  ? when.toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : item.sent_at;
                const many = item.recipients.length > 3;
                return (
                  <article key={item.id} className="comms-history-item">
                    <div className="comms-history-head">
                      <time className="comms-history-time" dateTime={item.sent_at}>
                        {whenLabel}
                      </time>
                      {item.automatic ? <span className="comms-history-badge">Авто</span> : null}
                      <span className="comms-history-source">{item.source_label}</span>
                      {item.segment_name ? (
                        <span className="comms-history-segment" title={item.segment_id}>
                          · {item.segment_name}
                        </span>
                      ) : null}
                      {item.has_photo ? (
                        <span className="comms-history-photo" title="С фото">
                          фото
                        </span>
                      ) : null}
                      <span className="comms-history-stats">
                        {item.sent}/{item.attempted}
                        {item.failed > 0 ? ` · ошибок: ${item.failed}` : ""}
                      </span>
                    </div>
                    <p className="comms-history-text">{item.text}</p>
                    <div className="comms-history-recipients">
                      {item.recipients.length === 0 ? (
                        <span className="field-hint">Получатели не указаны</span>
                      ) : many ? (
                        <>
                          <span className="comms-history-recipients-summary">{item.recipients.length} получателей</span>
                          <button
                            type="button"
                            className="comms-recipients-eye"
                            title="Показать список получателей"
                            aria-label="Показать список получателей"
                            onClick={() => setHistoryRecipients(item)}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path
                                d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"
                                stroke="currentColor"
                                strokeWidth="1.6"
                              />
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                            </svg>
                          </button>
                        </>
                      ) : (
                        item.recipients.map((r) => (
                          <span key={`${item.id}-${r.user_id}-${r.user_name}`} className="comms-chip">
                            {r.user_name}
                          </span>
                        ))
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {historyRecipients ? (
        <div className="modal-backdrop" onClick={() => setHistoryRecipients(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>Получатели</h3>
            <p className="field-hint">{historyRecipients.source_label}</p>
            <div className="comms-selected-chips" style={{ marginTop: "0.75rem" }}>
              {historyRecipients.recipients.map((r) => (
                <span key={`${historyRecipients.id}-${r.user_id}-${r.user_name}`} className="comms-chip">
                  {r.user_name}
                </span>
              ))}
            </div>
            <div className="row-actions" style={{ marginTop: "1rem" }}>
              <button type="button" className="ghost" onClick={() => setHistoryRecipients(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
