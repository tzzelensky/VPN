import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import PanelTabs from "./PanelTabs";
import { usePanelSettings } from "../panelSettingsContext";
import {
  loadTriggerMailings,
  saveTriggerMailings,
  sendTriggerMailingTest,
  sendTriggerManualCampaign,
  listTriggerMailingsHistory,
  type TriggerAudience,
  type TriggerButtonDto,
  type TriggerCampaignDto,
  type TriggerMailingHistoryEntryDto,
  type TriggerMailingsStateDto,
  type TriggerMessageStepDto,
  type TriggerStepStatsDto,
} from "../api";

const CALLBACK_PRESETS: Array<{ id: string; label: string }> = [
  { id: "pay", label: "Оплата / тарифы" },
  { id: "sub", label: "Моя подписка" },
  { id: "home", label: "Главное меню" },
  { id: "buygb", label: "Докупить ГБ" },
  { id: "ref", label: "Реферальная программа" },
];

const AUDIENCE_OPTIONS: Array<{ id: TriggerAudience; label: string }> = [
  { id: "all", label: "Все" },
  { id: "active", label: "Активные" },
  { id: "expired", label: "Истёкшая подписка" },
  { id: "new", label: "Новые" },
  { id: "paid", label: "Оплатившие" },
  { id: "unpaid", label: "Не оплатившие" },
];

function scheduleLabel(step: TriggerMessageStepDto): string {
  switch (step.schedule_kind) {
    case "immediate":
      return "Сразу";
    case "delay_minutes":
      return step.schedule_value >= 60 ? `+${Math.round(step.schedule_value / 60)} ч` : `+${step.schedule_value} мин`;
    case "days_before_expiry":
      return step.schedule_value === 0 ? "В день окончания" : `За ${step.schedule_value} дн. до окончания`;
    case "days_after_expiry":
      return `+${step.schedule_value} дн. после окончания`;
    case "days_inactive":
      return `${step.schedule_value} дн. без активности`;
    default:
      return "";
  }
}

function calcConversion(stats: TriggerStepStatsDto): string {
  if (stats.delivered <= 0) return "—";
  return `${((stats.payments / stats.delivered) * 100).toFixed(1)}%`;
}

function calcCtr(stats: TriggerStepStatsDto): string {
  if (stats.delivered <= 0) return "—";
  return `${((stats.clicks / stats.delivered) * 100).toFixed(1)}%`;
}

function avgPaymentDelay(stats: TriggerStepStatsDto): string {
  if (stats.payment_delay_count <= 0) return "—";
  const h = stats.payment_delay_ms_sum / stats.payment_delay_count / 3600000;
  return h < 1 ? `${Math.round(h * 60)} мин` : `${h.toFixed(1)} ч`;
}

function wrapTextareaSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  wrap: [string, string],
): { next: string; selStart: number; selEnd: number } {
  const [open, close] = wrap;
  if (selectionStart !== selectionEnd) {
    const before = value.slice(0, selectionStart);
    const selected = value.slice(selectionStart, selectionEnd);
    const after = value.slice(selectionEnd);
    if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
      const inner = selected.slice(open.length, selected.length - close.length);
      const next = before + inner + after;
      return { next, selStart: selectionStart, selEnd: selectionEnd - open.length - close.length };
    }
    const next = before + open + selected + close + after;
    return { next, selStart: selectionStart + open.length, selEnd: selectionEnd + open.length };
  }
  const next = value.slice(0, selectionStart) + open + close + value.slice(selectionEnd);
  const pos = selectionStart + open.length;
  return { next, selStart: pos, selEnd: pos };
}

function isBoldShortcut(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyB" || e.key === "b" || e.key === "B");
}

function ymdInTimezone(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ts),
  );
}

function defaultHistoryDateRange(timeZone: string): { from: string; to: string } {
  const to = ymdInTimezone(Date.now(), timeZone);
  const [y, m, d] = to.split("-").map((x) => Number(x));
  const prev = Date.UTC(y, m - 1, d) - 86_400_000;
  const from = ymdInTimezone(prev, timeZone);
  return { from, to };
}

function formatHistoryWhen(sentAt: string): string {
  const when = new Date(sentAt);
  return Number.isFinite(when.getTime())
    ? when.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : sentAt;
}

function TriggerMessageTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingSel.current;
    const ta = taRef.current;
    if (!pending || !ta) return;
    pendingSel.current = null;
    ta.focus();
    ta.setSelectionRange(pending.start, pending.end);
  }, [value]);

  function applyBold() {
    const ta = taRef.current;
    if (!ta) return;
    const { next, selStart, selEnd } = wrapTextareaSelection(value, ta.selectionStart, ta.selectionEnd, ["<b>", "</b>"]);
    pendingSel.current = { start: selStart, end: selEnd };
    onChange(next);
  }

  return (
    <label className="trigger-field">
      <span>Текст сообщения</span>
      <div className="trigger-text-toolbar">
        <button type="button" className="ghost trigger-bold-btn" title="Жирный (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={applyBold}>
          <strong>B</strong>
        </button>
        <span className="field-hint">Выделите текст и нажмите Ctrl+B или кнопку B.</span>
      </div>
      <textarea
        ref={taRef}
        rows={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!isBoldShortcut(e)) return;
          e.preventDefault();
          e.stopPropagation();
          applyBold();
        }}
      />
    </label>
  );
}

export default function TriggeredMailingsPanel() {
  const { settings: panelSettings } = usePanelSettings();
  const panelTz = panelSettings?.ui.timezone?.trim() || "Asia/Yekaterinburg";
  const [state, setState] = useState<TriggerMailingsStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [campaignId, setCampaignId] = useState<string>("");
  const [stepId, setStepId] = useState<string>("");
  const [mainView, setMainView] = useState<"chains" | "history">("chains");
  const [panelTab, setPanelTab] = useState<"settings" | "stats" | "test">("settings");
  const [testUserId, setTestUserId] = useState("");
  const [manualAudience, setManualAudience] = useState<TriggerAudience>("all");
  const [photoFileName, setPhotoFileName] = useState("");
  const [savedGloballyEnabled, setSavedGloballyEnabled] = useState(true);
  const [history, setHistory] = useState<TriggerMailingHistoryEntryDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFrom, setHistoryFrom] = useState(() => defaultHistoryDateRange(panelTz).from);
  const [historyTo, setHistoryTo] = useState(() => defaultHistoryDateRange(panelTz).to);
  const [historyCampaignId, setHistoryCampaignId] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadTriggerMailings();
      setState(data);
      setSavedGloballyEnabled(data.config.globally_enabled !== false);
      if (!campaignId && data.config.campaigns.length) {
        setCampaignId(data.config.campaigns[0]!.id);
        setStepId(data.config.campaigns[0]!.steps[0]?.id ?? "");
      }
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reloadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await listTriggerMailingsHistory({
        from: historyFrom,
        to: historyTo,
        campaign_id: historyCampaignId || undefined,
      });
      setHistory(data.items);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFrom, historyTo, historyCampaignId]);

  useEffect(() => {
    const range = defaultHistoryDateRange(panelTz);
    setHistoryFrom(range.from);
    setHistoryTo(range.to);
  }, [panelTz]);

  useEffect(() => {
    if (mainView !== "history") return;
    void reloadHistory();
  }, [mainView, reloadHistory]);

  const campaign = useMemo(
    () => state?.config.campaigns.find((c) => c.id === campaignId),
    [state, campaignId],
  );
  const step = useMemo(() => campaign?.steps.find((s) => s.id === stepId), [campaign, stepId]);

  useEffect(() => {
    setPhotoFileName(step?.image_data_url ? "Изображение загружено" : "");
  }, [step?.id, step?.image_data_url]);

  function updateConfig(patch: Partial<TriggerMailingsStateDto["config"]>) {
    if (!state) return;
    setState({ ...state, config: { ...state.config, ...patch } });
  }

  function updateCampaign(patch: Partial<TriggerCampaignDto>) {
    if (!state || !campaign) return;
    const campaigns = state.config.campaigns.map((c) => (c.id === campaign.id ? { ...c, ...patch } : c));
    setState({ ...state, config: { ...state.config, campaigns } });
  }

  function updateStep(patch: Partial<TriggerMessageStepDto>) {
    if (!state || !campaign || !step) return;
    const steps = campaign.steps.map((s) => (s.id === step.id ? { ...s, ...patch } : s));
    updateCampaign({ steps });
  }

  function updateButton(idx: number, patch: Partial<TriggerButtonDto>) {
    if (!step) return;
    const buttons = step.buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    updateStep({ buttons });
  }

  function addButton() {
    if (!step) return;
    updateStep({ buttons: [...step.buttons, { text: "Кнопка", kind: "callback", callback: "pay" }] });
  }

  function removeButton(idx: number) {
    if (!step) return;
    updateStep({ buttons: step.buttons.filter((_, i) => i !== idx) });
  }

  async function onSave() {
    if (!state) return;
    setBusy(true);
    setMsg(null);
    try {
      const saved = await saveTriggerMailings(state.config);
      setState({ config: saved.config, stats: saved.stats });
      setSavedGloballyEnabled(saved.config.globally_enabled !== false);
      setMsg({ type: "ok", text: "Сохранено" });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onTestSend() {
    if (!campaign || !step) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendTriggerMailingTest({
        campaign_id: campaign.id,
        step_id: step.id,
        user_id: testUserId ? Number(testUserId) : undefined,
      });
      setMsg(r.ok ? { type: "ok", text: "Тестовое сообщение отправлено" } : { type: "err", text: r.error ?? "Ошибка отправки" });
      if (r.ok && mainView === "history") void reloadHistory();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onManualSend() {
    if (!campaign) return;
    if (!window.confirm(`Отправить «${campaign.title}» выбранной аудитории?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendTriggerManualCampaign(campaign.id, manualAudience);
      setMsg({
        type: r.errors.length ? "err" : "ok",
        text: `Отправлено: ${r.sent}${r.errors.length ? `, ошибок: ${r.errors.length}` : ""}`,
      });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !state) {
    return <div className="auto-broadcasts-loading"><span className="spinner" /> Загрузка…</div>;
  }
  if (!state) return null;

  const isManual = campaign?.id === "news" || campaign?.id === "promotions";
  const globallyOn = state.config.globally_enabled !== false;
  const globalToggleDirty = globallyOn !== savedGloballyEnabled;

  async function onSaveGlobalToggle() {
    await onSave();
  }

  return (
    <div className="trigger-mailings-wrap">
      {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}

      <section className={`panel trigger-mailings-global-bar${globallyOn ? "" : " trigger-mailings-global-bar--off"}`}>
        <div className="trigger-global-bar-layout">
          <div className="trigger-global-bar-text">
            <strong className="trigger-global-title">Триггерные рассылки</strong>
            <p className="field-hint" style={{ marginTop: "0.25rem" }}>
              {globallyOn
                ? "Автоматические сообщения по триггерам активны в боте."
                : "Все триггерные рассылки отключены — сообщения не отправляются."}
            </p>
          </div>
          <div className="trigger-global-bar-side">
            <button
              type="button"
              className={`toggle ${globallyOn ? "on" : ""}`}
              title={globallyOn ? "Триггерные рассылки включены" : "Триггерные рассылки выключены"}
              aria-pressed={globallyOn}
              onClick={() => updateConfig({ globally_enabled: !globallyOn })}
            />
            {globalToggleDirty ? (
              <button type="button" className="primary trigger-global-save" disabled={busy} onClick={() => void onSaveGlobalToggle()}>
                {busy ? "Сохранение…" : "Сохранить"}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <PanelTabs
        tabs={[
          { id: "chains", label: "Цепочки" },
          { id: "history", label: "История отправок" },
        ]}
        value={mainView}
        onChange={setMainView}
      />

      {mainView === "history" ? (
        <section className="panel comms-history-panel comms-history-panel--tab">
          <div className="comms-history-panel__head">
            <div>
              <h2 className="user-modal-section-title">История триггерных рассылок</h2>
              <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                Отправленные сообщения по всем триггерным цепочкам, включая тестовые.
              </p>
            </div>
            <div className="comms-history-panel__actions">
              <div className="comms-history-filters">
                <label className="comms-history-filter">
                  <span>Цепочка</span>
                  <select
                    className="input"
                    value={historyCampaignId}
                    onChange={(e) => setHistoryCampaignId(e.target.value)}
                  >
                    <option value="">Все</option>
                    {state.config.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
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
              {history.map((item) => (
                <article key={item.id} className="comms-history-item">
                  <div className="comms-history-head">
                    <time className="comms-history-time" dateTime={item.sent_at}>
                      {formatHistoryWhen(item.sent_at)}
                    </time>
                    {item.is_test ? <span className="comms-history-badge">Тест</span> : null}
                    {!item.delivered ? <span className="comms-history-badge">Не доставлено</span> : null}
                    <span className="comms-history-source">
                      {item.campaign_title} · {item.step_name}
                    </span>
                    {item.has_image ? <span className="comms-history-photo" title="С фото">фото</span> : null}
                    <span className="comms-history-stats">{item.user_name}</span>
                  </div>
                  <p className="comms-history-text">{item.text_preview}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
      <div className={`trigger-mailings-layout${globallyOn ? "" : " trigger-mailings-layout--muted"}`}>
        <aside className="trigger-mailings-list">
          <h3 className="referral-section-title">Цепочки</h3>
          {state.config.campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`trigger-campaign-btn${c.id === campaignId ? " active" : ""}`}
              onClick={() => {
                setCampaignId(c.id);
                setStepId(c.steps[0]?.id ?? "");
                setPanelTab("settings");
              }}
            >
              <span className="trigger-campaign-btn-title">{c.title}</span>
              <span className={`trigger-campaign-status${c.enabled ? " on" : ""}`}>{c.enabled ? "Вкл" : "Выкл"}</span>
            </button>
          ))}
        </aside>

        <div className="trigger-mailings-main">
          {campaign ? (
            <>
              <div className="trigger-mailings-head">
                <div>
                  <h2>{campaign.title}</h2>
                  <p className="sub">{campaign.description}</p>
                </div>
                <div className="shop-toggle-row trigger-campaign-toggle">
                  <span className="trigger-campaign-toggle-label">{campaign.enabled ? "Включено" : "Выключено"}</span>
                  <button
                    type="button"
                    className={`toggle ${campaign.enabled ? "on" : ""}`}
                    title={campaign.enabled ? "Цепочка включена" : "Цепочка выключена"}
                    aria-pressed={campaign.enabled}
                    onClick={() => updateCampaign({ enabled: !campaign.enabled })}
                  />
                </div>
              </div>

              <PanelTabs
                tabs={[
                  { id: "settings", label: "Настройки" },
                  { id: "stats", label: "Статистика" },
                  { id: "test", label: "Тест" },
                ]}
                value={panelTab}
                onChange={setPanelTab}
              />

              {panelTab === "settings" ? (
                <div className="trigger-mailings-editor">
                  <div className="trigger-steps-row">
                    {campaign.steps.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`trigger-step-pill${s.id === stepId ? " active" : ""}`}
                        onClick={() => setStepId(s.id)}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>

                  {step ? (
                    <>
                      <div className="trigger-step-toggle">
                        <span>Шаг активен</span>
                        <button
                          type="button"
                          className={`toggle ${step.enabled ? "on" : ""}`}
                          title={step.enabled ? "Шаг включён" : "Шаг выключен"}
                          aria-pressed={step.enabled}
                          onClick={() => updateStep({ enabled: !step.enabled })}
                        />
                      </div>
                      <div className="trigger-field">
                        <span>Задержка / расписание</span>
                        <strong>{scheduleLabel(step)}</strong>
                        {step.schedule_kind === "delay_minutes" ? (
                          <input
                            type="number"
                            min={0}
                            value={step.schedule_value}
                            onChange={(e) => updateStep({ schedule_value: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                          />
                        ) : null}
                      </div>
                      <TriggerMessageTextarea value={step.text_html} onChange={(next) => updateStep({ text_html: next })} />
                      <div className="form-field">
                        <label>Изображение</label>
                        <div className="comms-file-row">
                          <label className={`ghost comms-file-btn${busy ? " disabled" : ""}`}>
                            <input
                              type="file"
                              accept="image/*"
                              disabled={busy}
                              className="comms-file-input"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                setPhotoFileName(f.name);
                                const r = await new Promise<string>((resolve, reject) => {
                                  const fr = new FileReader();
                                  fr.onload = () => resolve(String(fr.result ?? ""));
                                  fr.onerror = () => reject(new Error("read failed"));
                                  fr.readAsDataURL(f);
                                });
                                updateStep({ image_data_url: r });
                              }}
                            />
                            Выбор файла
                          </label>
                          <span className="comms-file-name">{photoFileName || "Не выбран ни один файл"}</span>
                        </div>
                        {step.image_data_url ? (
                          <button type="button" className="ghost" onClick={() => {
                            updateStep({ image_data_url: undefined });
                            setPhotoFileName("");
                          }}>
                            Убрать фото
                          </button>
                        ) : null}
                      </div>

                      <div className="trigger-buttons-block">
                        <div className="trigger-buttons-head">
                          <strong>Кнопки</strong>
                          <button type="button" className="ghost" onClick={addButton}>
                            + Кнопка
                          </button>
                        </div>
                        {step.buttons.map((b, i) => (
                          <div key={i} className="trigger-button-row">
                            <input value={b.text} onChange={(e) => updateButton(i, { text: e.target.value })} placeholder="Текст" />
                            <select
                              value={b.kind}
                              onChange={(e) => updateButton(i, { kind: e.target.value as "callback" | "url" })}
                            >
                              <option value="callback">Callback</option>
                              <option value="url">URL</option>
                            </select>
                            {b.kind === "url" ? (
                              <input value={b.url ?? ""} onChange={(e) => updateButton(i, { url: e.target.value })} placeholder="https://" />
                            ) : (
                              <select value={b.callback ?? "pay"} onChange={(e) => updateButton(i, { callback: e.target.value })}>
                                {CALLBACK_PRESETS.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button type="button" className="ghost" onClick={() => removeButton(i)}>
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>

                      <section className="trigger-preview panel">
                        <h4>Предпросмотр</h4>
                        <div className="trigger-preview-body" dangerouslySetInnerHTML={{ __html: step.text_html.replace(/\n/g, "<br/>") }} />
                        {step.buttons.length ? (
                          <div className="trigger-preview-buttons">
                            {step.buttons.map((b, i) => (
                              <span key={i} className="trigger-preview-btn">
                                {b.text}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </section>

                      {isManual ? (
                        <section className="trigger-manual-send panel">
                          <h4>Массовая отправка</h4>
                          <select value={manualAudience} onChange={(e) => setManualAudience(e.target.value as TriggerAudience)}>
                            {AUDIENCE_OPTIONS.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <button type="button" className="primary" disabled={busy} onClick={() => void onManualSend()}>
                            Отправить сейчас
                          </button>
                        </section>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              {panelTab === "stats" ? (
                <div className="trigger-stats-grid">
                  {(campaign.steps.length ? campaign.steps : [{ id: "_", name: "—" } as TriggerMessageStepDto]).map((s) => {
                    const st = state.stats[campaign.id]?.[s.id] ?? {
                      triggered: 0,
                      sent: 0,
                      delivered: 0,
                      clicks: 0,
                      payments: 0,
                      revenue_rub: 0,
                      payment_delay_ms_sum: 0,
                      payment_delay_count: 0,
                    };
                    return (
                      <article key={s.id} className="trigger-stat-card">
                        <h4>{s.name}</h4>
                        <dl>
                          <div><dt>В триггере</dt><dd>{st.triggered}</dd></div>
                          <div><dt>Отправлено</dt><dd>{st.sent}</dd></div>
                          <div><dt>Доставлено</dt><dd>{st.delivered}</dd></div>
                          <div><dt>Клики</dt><dd>{st.clicks}</dd></div>
                          <div><dt>CTR</dt><dd>{calcCtr(st)}</dd></div>
                          <div><dt>Оплат</dt><dd>{st.payments}</dd></div>
                          <div><dt>Конверсия</dt><dd>{calcConversion(st)}</dd></div>
                          <div><dt>Выручка</dt><dd>{st.revenue_rub} ₽</dd></div>
                          <div><dt>Ср. время до оплаты</dt><dd>{avgPaymentDelay(st)}</dd></div>
                        </dl>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {panelTab === "test" && step ? (
                <div className="trigger-test-panel">
                  <label className="trigger-field">
                    <span>ID пользователя в панели (tg_id подставится автоматически)</span>
                    <input value={testUserId} onChange={(e) => setTestUserId(e.target.value)} placeholder="123" />
                  </label>
                  <button type="button" className="primary" disabled={busy} onClick={() => void onTestSend()}>
                    Отправить тест «{step.name}»
                  </button>
                </div>
              ) : null}

              <div className="trigger-mailings-actions">
                <button type="button" className="primary" disabled={busy} onClick={() => void onSave()}>
                  Сохранить
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      )}
    </div>
  );
}
