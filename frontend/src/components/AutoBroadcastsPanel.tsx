import { useEffect, useState } from "react";
import Spinner from "./Spinner";
import {
  loadAutoCommunicationsConfig,
  runExpiryAutoBroadcastsNow,
  saveAutoCommunicationsConfig,
  type AutoCommunicationsConfigDto,
} from "../api";
import { setExpiryDaysBefore } from "../expiryNotify";

const TRAFFIC_PLACEHOLDERS = "{subscription}, {remaining_gb}, {threshold_gb}";
const EXPIRY_PLACEHOLDERS = "{subscription}, {days_phrase}, {days_before}";

function Toggle({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <div className="form-field shop-toggle-row">
      <span>{label}</span>
      <button
        type="button"
        className={`toggle ${on ? "on" : ""}`}
        aria-pressed={on}
        disabled={disabled}
        onClick={onClick}
      />
    </div>
  );
}

export default function AutoBroadcastsPanel() {
  const [cfg, setCfg] = useState<AutoCommunicationsConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningExpiry, setRunningExpiry] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await loadAutoCommunicationsConfig();
        setCfg(data);
        setExpiryDaysBefore(data.expiry.days_before);
      } catch (e) {
        setMsg({ type: "err", text: String(e) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onSave(next: AutoCommunicationsConfigDto) {
    setSaving(true);
    setMsg(null);
    try {
      const saved = await saveAutoCommunicationsConfig(next);
      setCfg(saved);
      setExpiryDaysBefore(saved.expiry.days_before);
      setMsg({ type: "ok", text: "Настройки авто-рассылок сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  function patchTraffic(patch: Partial<AutoCommunicationsConfigDto["traffic"]>) {
    if (!cfg) return;
    void onSave({ ...cfg, traffic: { ...cfg.traffic, ...patch } });
  }

  function patchExpiry(patch: Partial<AutoCommunicationsConfigDto["expiry"]>) {
    if (!cfg) return;
    void onSave({ ...cfg, expiry: { ...cfg.expiry, ...patch } });
  }

  function patchDraft(patch: Partial<AutoCommunicationsConfigDto>) {
    if (!cfg) return;
    setCfg({ ...cfg, ...patch, traffic: { ...cfg.traffic, ...(patch.traffic ?? {}) }, expiry: { ...cfg.expiry, ...(patch.expiry ?? {}) } });
  }

  if (loading) {
    return (
      <div className="auto-broadcasts-loading">
        <Spinner />
        <p className="sub">Загрузка настроек…</p>
      </div>
    );
  }

  if (!cfg) {
    return <p className="sub">Не удалось загрузить настройки авто-рассылок.</p>;
  }

  return (
    <div className="auto-broadcasts-panel">
      {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}

      <section className="auto-broadcasts-section">
        <div className="auto-broadcasts-section-head">
          <div>
            <h2 className="user-modal-section-title">Трафик</h2>
            <p className="field-hint">
              Автоматические напоминания при низком остатке и при полном исчерпании лимита. Каждому клиенту — не чаще одного
              сообщения на этап, пока остаток не восстановится.
            </p>
          </div>
          <span className={`daily-gift-badge ${cfg.traffic.enabled ? "daily-gift-badge--ok" : "daily-gift-badge--muted"}`}>
            {cfg.traffic.enabled ? "Включено" : "Выключено"}
          </span>
        </div>

        <Toggle
          label="Авто-уведомления о трафике"
          on={cfg.traffic.enabled}
          disabled={saving}
          onClick={() => patchTraffic({ enabled: !cfg.traffic.enabled })}
        />

        <div className="auto-broadcasts-grid">
          <label className="form-field">
            <span>Порог «мало трафика», ГБ</span>
            <input
              type="number"
              min={1}
              max={500}
              value={cfg.traffic.low_gb_threshold}
              disabled={saving}
              onChange={(e) => patchDraft({ traffic: { ...cfg.traffic, low_gb_threshold: Number(e.target.value) || 30 } })}
            />
          </label>
          <label className="form-field">
            <span>Интервал проверки, мин</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={cfg.traffic.interval_minutes}
              disabled={saving}
              onChange={(e) => patchDraft({ traffic: { ...cfg.traffic, interval_minutes: Number(e.target.value) || 10 } })}
            />
          </label>
        </div>

        <Toggle
          label="Не слать тестовым подпискам"
          on={cfg.traffic.skip_test_subscriptions}
          disabled={saving}
          onClick={() => patchTraffic({ skip_test_subscriptions: !cfg.traffic.skip_test_subscriptions })}
        />

        <label className="form-field">
          <span>Сообщение «мало трафика» (HTML)</span>
          <span className="field-hint">Подстановки: {TRAFFIC_PLACEHOLDERS}</span>
          <textarea
            className="comms-textarea auto-broadcasts-textarea"
            rows={6}
            value={cfg.traffic.low_message}
            disabled={saving}
            onChange={(e) => patchDraft({ traffic: { ...cfg.traffic, low_message: e.target.value } })}
          />
        </label>

        <label className="form-field">
          <span>Сообщение «трафик закончился» (HTML)</span>
          <span className="field-hint">Подстановки: {TRAFFIC_PLACEHOLDERS}</span>
          <textarea
            className="comms-textarea auto-broadcasts-textarea"
            rows={5}
            value={cfg.traffic.empty_message}
            disabled={saving}
            onChange={(e) => patchDraft({ traffic: { ...cfg.traffic, empty_message: e.target.value } })}
          />
        </label>

        <div className="auto-broadcasts-grid">
          <label className="form-field">
            <span>Метка в истории (мало трафика)</span>
            <input
              type="text"
              value={cfg.traffic.source_label_low}
              disabled={saving}
              onChange={(e) => patchDraft({ traffic: { ...cfg.traffic, source_label_low: e.target.value } })}
            />
          </label>
          <label className="form-field">
            <span>Метка в истории (трафик закончился)</span>
            <input
              type="text"
              value={cfg.traffic.source_label_empty}
              disabled={saving}
              onChange={(e) => patchDraft({ traffic: { ...cfg.traffic, source_label_empty: e.target.value } })}
            />
          </label>
        </div>
      </section>

      <section className="auto-broadcasts-section">
        <div className="auto-broadcasts-section-head">
          <div>
            <h2 className="user-modal-section-title">Срок подписки</h2>
            <p className="field-hint">
              Напоминание перед окончанием и уведомление после истечения — <b>каждый день в одно время</b> (по часовому
              поясу панели, по умолчанию Екатеринбург). Кнопка «Оплата подписки» добавляется автоматически.
            </p>
          </div>
          <span className={`daily-gift-badge ${cfg.expiry.enabled ? "daily-gift-badge--ok" : "daily-gift-badge--muted"}`}>
            {cfg.expiry.enabled ? "Включено" : "Выключено"}
          </span>
        </div>

        <Toggle
          label="Авто-уведомления о сроке"
          on={cfg.expiry.enabled}
          disabled={saving}
          onClick={() => patchExpiry({ enabled: !cfg.expiry.enabled })}
        />

        <div className="auto-broadcasts-grid">
          <label className="form-field">
            <span>Напоминать за, суток</span>
            <input
              type="number"
              min={1}
              max={30}
              value={cfg.expiry.days_before}
              disabled={saving}
              onChange={(e) => patchDraft({ expiry: { ...cfg.expiry, days_before: Number(e.target.value) || 3 } })}
            />
          </label>
          <label className="form-field">
            <span>Время отправки, ч</span>
            <input
              type="number"
              min={0}
              max={23}
              value={cfg.expiry.notify_hour}
              disabled={saving}
              onChange={(e) => patchDraft({ expiry: { ...cfg.expiry, notify_hour: Number(e.target.value) || 12 } })}
            />
          </label>
          <label className="form-field">
            <span>Время отправки, мин</span>
            <input
              type="number"
              min={0}
              max={59}
              value={cfg.expiry.notify_minute}
              disabled={saving}
              onChange={(e) => patchDraft({ expiry: { ...cfg.expiry, notify_minute: Number(e.target.value) || 0 } })}
            />
          </label>
        </div>

        <button
          type="button"
          className="ghost"
          disabled={runningExpiry || saving}
          onClick={() => {
            setRunningExpiry(true);
            setMsg(null);
            void runExpiryAutoBroadcastsNow()
              .then(() => setMsg({ type: "ok", text: "Рассылка о сроке запущена (вне расписания)." }))
              .catch((e) => setMsg({ type: "err", text: String(e) }))
              .finally(() => setRunningExpiry(false));
          }}
        >
          {runningExpiry ? "Отправка…" : "Отправить напоминания о сроке сейчас"}
        </button>

        <Toggle
          label="Не слать тестовым подпискам"
          on={cfg.expiry.skip_test_subscriptions}
          disabled={saving}
          onClick={() => patchExpiry({ skip_test_subscriptions: !cfg.expiry.skip_test_subscriptions })}
        />

        <label className="form-field">
          <span>Сообщение «заканчивается сегодня» (HTML)</span>
          <span className="field-hint">Подстановки: {EXPIRY_PLACEHOLDERS}</span>
          <textarea
            className="comms-textarea auto-broadcasts-textarea"
            rows={4}
            value={cfg.expiry.warn_same_day_message}
            disabled={saving}
            onChange={(e) => patchDraft({ expiry: { ...cfg.expiry, warn_same_day_message: e.target.value } })}
          />
        </label>

        <label className="form-field">
          <span>Сообщение «заканчивается через N дней» (HTML)</span>
          <span className="field-hint">Подстановки: {EXPIRY_PLACEHOLDERS}. В тексте используйте {"{days_phrase}"}.</span>
          <textarea
            className="comms-textarea auto-broadcasts-textarea"
            rows={4}
            value={cfg.expiry.warn_days_message}
            disabled={saving}
            onChange={(e) => patchDraft({ expiry: { ...cfg.expiry, warn_days_message: e.target.value } })}
          />
        </label>

        <label className="form-field">
          <span>Сообщение «подписка истекла» (HTML)</span>
          <span className="field-hint">Подстановки: {EXPIRY_PLACEHOLDERS}</span>
          <textarea
            className="comms-textarea auto-broadcasts-textarea"
            rows={4}
            value={cfg.expiry.expired_message}
            disabled={saving}
            onChange={(e) => patchDraft({ expiry: { ...cfg.expiry, expired_message: e.target.value } })}
          />
        </label>

        <div className="auto-broadcasts-grid">
          <label className="form-field">
            <span>Метка в истории (напоминание)</span>
            <input
              type="text"
              value={cfg.expiry.source_label_warn}
              disabled={saving}
              onChange={(e) => patchDraft({ expiry: { ...cfg.expiry, source_label_warn: e.target.value } })}
            />
          </label>
          <label className="form-field">
            <span>Метка в истории (истекла)</span>
            <input
              type="text"
              value={cfg.expiry.source_label_expired}
              disabled={saving}
              onChange={(e) => patchDraft({ expiry: { ...cfg.expiry, source_label_expired: e.target.value } })}
            />
          </label>
        </div>
      </section>

      <div className="auto-broadcasts-actions">
        <button type="button" className="primary" disabled={saving} onClick={() => void onSave(cfg)}>
          {saving ? "Сохранение…" : "Сохранить изменения"}
        </button>
        <p className="field-hint">
          Напоминания о сроке отправляются ежедневно в заданное время (часовой пояс из настроек панели). Для трафика
          интервал проверки по-прежнему задаётся в блоке выше.
        </p>
      </div>
    </div>
  );
}
