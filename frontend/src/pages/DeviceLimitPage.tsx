import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import SettingsToggleRow from "../components/SettingsToggleRow";
import Spinner from "../components/Spinner";
import {
  addAdminDeviceSlots,
  diagnoseDeviceLimit,
  loadDeviceLimitSubscriptionsSnapshot,
  loadDeviceLimitOverview,
  loadDeviceLimitPurchases,
  loadDeviceLimitSubscriptions,
  removeAdminDevice,
  renameAdminDevice,
  resetAdminDevices,
  saveDeviceLimitSettings,
  setAllSubscriptionDeviceLimit,
  setSubscriptionDeviceLimit,
  type DeviceLimitOverviewDto,
  type DeviceLimitSettingsDto,
  type DeviceLimitSubscriptionRowDto,
  type DeviceLimitSubscriptionsSnapshotDto,
} from "../api";

type Tab = "settings" | "subscriptions" | "purchases" | "events" | "diagnose";

function fmtDate(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU");
}

function settingsEqual(a: DeviceLimitSettingsDto, b: DeviceLimitSettingsDto): boolean {
  return (
    a.enabled === b.enabled &&
    a.limit_scope === b.limit_scope &&
    a.default_slots === b.default_slots &&
    a.auto_bind === b.auto_bind &&
    a.on_limit_exceeded === b.on_limit_exceeded &&
    a.purchase_enabled === b.purchase_enabled &&
    a.purchase_price_rub === b.purchase_price_rub &&
    a.purchase_validity === b.purchase_validity &&
    a.purchase_max_extra === b.purchase_max_extra
  );
}

function validateSettings(s: DeviceLimitSettingsDto): Record<string, string> {
  const errors: Record<string, string> = {};
  if (s.default_slots < 1) errors.default_slots = "Минимум 1 устройство.";
  if (s.purchase_max_extra < 0) errors.purchase_max_extra = "Не может быть меньше 0.";
  if (s.purchase_enabled) {
    if (s.purchase_price_rub <= 0) errors.purchase_price_rub = "Укажите цену больше 0.";
  }
  if (!s.on_limit_exceeded) errors.on_limit_exceeded = "Выберите поведение при превышении лимита.";
  return errors;
}

function purchaseValidityLabel(v: DeviceLimitSettingsDto["purchase_validity"]): string {
  if (v === "subscription_end") return "До конца подписки";
  if (v === "30_days") return "30 дней";
  if (v === "forever") return "Бессрочно";
  return "Произвольный срок";
}

function eventTypeRu(t: string): string {
  const map: Record<string, string> = {
    device_registered: "Регистрация устройства",
    device_removed: "Удаление устройства",
    device_limit_reached: "Лимит достигнут",
    device_slot_purchase_created: "Создана покупка места",
    device_slot_purchase_paid: "Оплачена покупка места",
    fallback_used_without_did: "Fallback без did",
    subscription_blocked_by_device_limit: "Блокировка по лимиту",
    admin_slot_added: "Слот добавлен админом",
  };
  return map[t] ?? t;
}

function purchaseStatusRu(s: string): string {
  const map: Record<string, string> = {
    pending: "Ожидает",
    paid: "Оплачено",
    failed: "Ошибка",
    cancelled: "Отменено",
    refunded: "Возврат",
  };
  return map[s] ?? s;
}

export default function DeviceLimitPage({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("settings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkToggleBusy, setBulkToggleBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [overview, setOverview] = useState<DeviceLimitOverviewDto | null>(null);
  const [settings, setSettings] = useState<DeviceLimitSettingsDto | null>(null);
  const [savedSettings, setSavedSettings] = useState<DeviceLimitSettingsDto | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<DeviceLimitSubscriptionRowDto[]>([]);
  const [purchases, setPurchases] = useState<Awaited<ReturnType<typeof loadDeviceLimitPurchases>>["purchases"]>([]);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof loadDeviceLimitOverview>>["events"]>([]);
  const [devicesModal, setDevicesModal] = useState<DeviceLimitSubscriptionRowDto | null>(null);
  const [diagSubId, setDiagSubId] = useState("");
  const [diagDid, setDiagDid] = useState("");
  const [diagUa, setDiagUa] = useState("");
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagResult, setDiagResult] = useState<Record<string, unknown> | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<DeviceLimitSubscriptionsSnapshotDto | null>(null);
  const [purchaseUserQ, setPurchaseUserQ] = useState("");
  const [purchaseStatus, setPurchaseStatus] = useState("all");
  const [purchaseFrom, setPurchaseFrom] = useState("");
  const [purchaseTo, setPurchaseTo] = useState("");
  const [eventSubFilter, setEventSubFilter] = useState<number | null>(null);

  const dirty = settings && savedSettings ? !settingsEqual(settings, savedSettings) : false;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, subs, purch] = await Promise.all([
        loadDeviceLimitOverview(),
        loadDeviceLimitSubscriptions(),
        loadDeviceLimitPurchases(),
      ]);
      setOverview(ov);
      setSettings(ov.settings);
      setSavedSettings(ov.settings);
      setFieldErrors({});
      setEvents(ov.events ?? []);
      setRows(subs.rows);
      setPurchases(purch.purchases);
    } catch (e) {
      setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка загрузки" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter((p) => {
      if (purchaseStatus !== "all" && p.status !== purchaseStatus) return false;
      if (purchaseUserQ.trim() && !p.user_name.toLowerCase().includes(purchaseUserQ.trim().toLowerCase())) return false;
      const created = new Date(p.created_at).getTime();
      if (purchaseFrom) {
        const from = new Date(purchaseFrom).getTime();
        if (!Number.isNaN(from) && created < from) return false;
      }
      if (purchaseTo) {
        const to = new Date(purchaseTo).getTime() + 86400000;
        if (!Number.isNaN(to) && created > to) return false;
      }
      return true;
    });
  }, [purchases, purchaseStatus, purchaseUserQ, purchaseFrom, purchaseTo]);

  const filteredEvents = useMemo(() => {
    const list = events ?? [];
    if (eventSubFilter == null) return list;
    return list.filter((ev) => ev.subscription_id === eventSubFilter);
  }, [events, eventSubFilter]);

  async function onSaveSettings(e?: FormEvent) {
    e?.preventDefault();
    if (!settings) return;
    const errors = validateSettings(settings);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setToast(null);
    try {
      const r = await saveDeviceLimitSettings(settings);
      setSettings(r.settings);
      setSavedSettings(r.settings);
      setFieldErrors({});
      setToast({ type: "ok", text: "Настройки ограничения устройств сохранены" });
    } catch (err) {
      setToast({ type: "err", text: err instanceof Error ? err.message : "Ошибка сохранения" });
    } finally {
      setSaving(false);
    }
  }

  async function onToggleSubscriptionLimit(row: DeviceLimitSubscriptionRowDto, enabled: boolean) {
    try {
      const r = await setSubscriptionDeviceLimit(row.subscription_id, enabled);
      setRows((prev) => prev.map((x) => (x.subscription_id === r.row.subscription_id ? r.row : x)));
      setToast({
        type: "ok",
        text: enabled ? `Лимит включён для «${row.subscription_name}»` : `Лимит выключен для «${row.subscription_name}»`,
      });
      void refresh();
    } catch (e) {
      setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  async function onToggleAllSubscriptionsLimit(enabled: boolean) {
    if (!settings?.enabled || settings.limit_scope !== "selected") return;
    setBulkToggleBusy(true);
    try {
      const r = await setAllSubscriptionDeviceLimit(enabled);
      setRows(r.rows);
      setToast({
        type: "ok",
        text: enabled
          ? `Лимит включён для всех подписок (${r.changed})`
          : `Лимит выключен для всех подписок (${r.changed})`,
      });
      void refresh();
    } catch (e) {
      setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setBulkToggleBusy(false);
    }
  }

  async function onAddSlots(row: DeviceLimitSubscriptionRowDto) {
    const slots = window.prompt("Сколько слотов добавить?", "1");
    if (!slots) return;
    const comment = window.prompt("Комментарий (необязательно)", "") ?? "";
    try {
      await addAdminDeviceSlots(row.subscription_id, Number(slots), comment);
      setToast({ type: "ok", text: "Слоты добавлены" });
      void refresh();
    } catch (e) {
      setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  async function onResetDevices(row: DeviceLimitSubscriptionRowDto) {
    if (!window.confirm(`Сбросить все устройства подписки «${row.subscription_name}»?`)) return;
    try {
      await resetAdminDevices(row.subscription_id);
      setToast({ type: "ok", text: "Устройства сброшены" });
      void refresh();
    } catch (e) {
      setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  function openHistory(row: DeviceLimitSubscriptionRowDto) {
    setEventSubFilter(row.subscription_id);
    setTab("events");
  }

  const statCards = overview
    ? [
        { label: "С лимитом", value: overview.stats.users_with_limit, accent: "" },
        { label: "Всего устройств", value: overview.stats.total_devices, accent: "" },
        { label: "Активных", value: overview.stats.active_devices, accent: "" },
        {
          label: "Блокировок",
          value: overview.stats.blocked_attempts,
          accent: overview.stats.blocked_attempts > 0 ? "warn" : "",
        },
        { label: "Докуплено мест", value: overview.stats.purchased_extra_slots, accent: "" },
        {
          label: "Выручка",
          value: `${overview.stats.purchase_revenue_rub} ₽`,
          accent: overview.stats.purchase_revenue_rub > 0 ? "ok" : "",
        },
      ]
    : [];

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className="device-limit-page">
        <section className="panel users-hero-panel">
          <div className="users-hero-top">
            <div>
              <h1>Ограничение по устройствам</h1>
              <p className="sub users-hero-sub">
                Контроль количества устройств, которые могут использовать одну VPN-подписку.
              </p>
              {dirty && tab === "settings" ? (
                <p className="referral-unsaved-hint">Есть несохранённые изменения</p>
              ) : null}
            </div>
            <div className="users-hero-actions">
              <button type="button" className="ghost" onClick={() => void refresh()} disabled={loading || saving}>
                Обновить
              </button>
              {tab === "settings" ? (
                <button
                  type="button"
                  className="primary"
                  disabled={!settings || saving || !dirty}
                  onClick={() => void onSaveSettings()}
                >
                  {saving ? (
                    <>
                      <Spinner /> Сохранение…
                    </>
                  ) : (
                    "Сохранить"
                  )}
                </button>
              ) : null}
            </div>
          </div>
          {toast ? <div className={`flash ${toast.type === "ok" ? "ok" : "err"}`}>{toast.text}</div> : null}
        </section>

        {loading && !overview ? (
          <section className="panel">
            <Spinner /> Загрузка…
          </section>
        ) : null}

        {overview ? (
          <section className="panel referral-stats-panel">
            <div className="referral-stats-grid device-limit-stats-grid">
              {statCards.map((c) => (
                <div key={c.label} className={`referral-stat-card device-limit-stat-card${c.accent ? ` device-limit-stat-card--${c.accent}` : ""}`}>
                  <span className="referral-stat-label">{c.label}</span>
                  <strong>{c.value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="panel referral-tabs-bar device-limit-tabs-bar">
          <div className="referral-main-tabs device-limit-main-tabs" role="tablist">
            {(
              [
                ["settings", "Настройки"],
                ["subscriptions", "Подписки"],
                ["purchases", "Покупки"],
                ["events", "Журнал"],
                ["diagnose", "Диагностика"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={tab === k ? "active" : ""}
                onClick={() => {
                  setTab(k);
                  if (k !== "events") setEventSubFilter(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {tab === "settings" && settings ? (
          <section className="panel device-limit-settings-panel">
            <form onSubmit={(e) => void onSaveSettings(e)}>
              <div className="device-limit-settings-stack">
                <div className="device-limit-setting-card">
                  <h2 className="device-limit-setting-card__title">Лимит устройств</h2>
                  <div className="device-limit-info-alert">
                    Ограничение применяется по устройствам через <code>?did=</code> в ссылке подписки. IP не влияет на
                    лимит и используется только для справки.
                  </div>
                  <div className="settings-toggle-list">
                    <SettingsToggleRow
                      label="Ограничение по устройствам"
                      hint="Включает функцию лимита. Кого ограничивать — выберите ниже."
                      on={settings.enabled}
                      onToggle={() => setSettings({ ...settings, enabled: !settings.enabled })}
                    />
                    <SettingsToggleRow
                      label="Автопривязка нового устройства"
                      hint="При первом запросе подписки с новым did устройство автоматически займёт свободный слот."
                      on={settings.auto_bind}
                      onToggle={() => setSettings({ ...settings, auto_bind: !settings.auto_bind })}
                    />
                  </div>
                  <div className="form-field" style={{ marginTop: "0.75rem" }}>
                    <label>Кого ограничивать</label>
                    <select
                      className="device-limit-field-input"
                      value={settings.limit_scope}
                      disabled={!settings.enabled}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          limit_scope: e.target.value as DeviceLimitSettingsDto["limit_scope"],
                        })
                      }
                    >
                      <option value="selected">Только выбранные подписки</option>
                      <option value="all">Все подписки</option>
                    </select>
                    <p className="field-hint">
                      {settings.limit_scope === "selected"
                        ? "Включайте лимит для нужных подписок на вкладке «Подписки»."
                        : "Лимит действует для всех подписок (кроме тестовых)."}
                    </p>
                  </div>
                  <div className="device-limit-fields-grid">
                    <div className="form-field">
                      <label>Устройств по умолчанию</label>
                      <input
                        className="device-limit-field-input"
                        type="number"
                        min={1}
                        value={settings.default_slots}
                        onChange={(e) => setSettings({ ...settings, default_slots: Number(e.target.value) || 0 })}
                      />
                      {fieldErrors.default_slots ? <p className="field-hint err">{fieldErrors.default_slots}</p> : null}
                    </div>
                    <div className="form-field">
                      <label>При превышении лимита</label>
                      <select
                        className="device-limit-field-input"
                        value={settings.on_limit_exceeded}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            on_limit_exceeded: e.target.value as DeviceLimitSettingsDto["on_limit_exceeded"],
                          })
                        }
                      >
                        <option value="stub">Заглушка</option>
                        <option value="empty">Пустая подписка</option>
                        <option value="instruction">Инструкция</option>
                      </select>
                      {fieldErrors.on_limit_exceeded ? (
                        <p className="field-hint err">{fieldErrors.on_limit_exceeded}</p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="device-limit-setting-card">
                  <h2 className="device-limit-setting-card__title">Докупка устройств</h2>
                  <div className="settings-toggle-list">
                    <SettingsToggleRow
                      label="Разрешить докупку устройств"
                      hint="Пользователь сможет купить дополнительные слоты через WebApp."
                      on={settings.purchase_enabled}
                      onToggle={() => setSettings({ ...settings, purchase_enabled: !settings.purchase_enabled })}
                    />
                  </div>
                  <div className="device-limit-fields-grid">
                    <div className="form-field">
                      <label>Цена за 1 устройство, ₽</label>
                      <input
                        className="device-limit-field-input"
                        type="number"
                        min={1}
                        disabled={!settings.purchase_enabled}
                        value={settings.purchase_price_rub}
                        onChange={(e) => setSettings({ ...settings, purchase_price_rub: Number(e.target.value) || 0 })}
                      />
                      {fieldErrors.purchase_price_rub ? (
                        <p className="field-hint err">{fieldErrors.purchase_price_rub}</p>
                      ) : null}
                    </div>
                    <div className="form-field">
                      <label>Максимум доп. устройств</label>
                      <input
                        className="device-limit-field-input"
                        type="number"
                        min={0}
                        disabled={!settings.purchase_enabled}
                        value={settings.purchase_max_extra}
                        onChange={(e) => setSettings({ ...settings, purchase_max_extra: Number(e.target.value) || 0 })}
                      />
                      {fieldErrors.purchase_max_extra ? (
                        <p className="field-hint err">{fieldErrors.purchase_max_extra}</p>
                      ) : null}
                    </div>
                    <div className="form-field form-field-span-2">
                      <label>Срок действия дополнительного места</label>
                      <select
                        className="device-limit-field-input"
                        disabled={!settings.purchase_enabled}
                        value={settings.purchase_validity}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            purchase_validity: e.target.value as DeviceLimitSettingsDto["purchase_validity"],
                          })
                        }
                      >
                        <option value="subscription_end">До конца подписки</option>
                        <option value="30_days">30 дней</option>
                        <option value="forever">Бессрочно</option>
                      </select>
                      <p className="field-hint">Текущий режим: {purchaseValidityLabel(settings.purchase_validity)}</p>
                    </div>
                  </div>
                  <div className="device-limit-warn-alert">
                    Промокоды для покупки устройств не применяются.
                  </div>
                </div>
              </div>
            </form>
          </section>
        ) : null}

        {tab === "subscriptions" ? (
          <section className="panel device-limit-tab-panel">
            {settings?.limit_scope === "selected" ? (
              <div className="device-limit-filter-note">
                <span>Включите лимит для нужных подписок. При включении текущие онлайн-устройства регистрируются автоматически.</span>
                <button
                  type="button"
                  className="ghost"
                  disabled={!settings?.enabled || bulkToggleBusy}
                  onClick={() => void onToggleAllSubscriptionsLimit(true)}
                >
                  Включить все
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={!settings?.enabled || bulkToggleBusy}
                  onClick={() => void onToggleAllSubscriptionsLimit(false)}
                >
                  Выключить все
                </button>
              </div>
            ) : (
              <p className="device-limit-filter-note">
                Охват «все подписки» — лимит действует для каждой подписки. Отдельное включение не требуется.
              </p>
            )}
            <div className="card device-limit-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Лимит</th>
                    <th>Пользователь</th>
                    <th>Telegram ID</th>
                    <th>Подписка</th>
                    <th>Окончание</th>
                    <th>Используется</th>
                    <th>Лимит</th>
                    <th>Докуплено</th>
                    <th>Последнее</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.subscription_id}>
                      <td>
                        <button
                          type="button"
                          className={`toggle ${r.device_limit_enabled || settings?.limit_scope === "all" ? "on" : ""}`}
                          disabled={!settings?.enabled || settings.limit_scope === "all"}
                          aria-pressed={r.device_limit_enabled || settings?.limit_scope === "all"}
                          title={
                            settings?.limit_scope === "all"
                              ? "Лимит для всех подписок"
                              : r.device_limit_enabled
                                ? "Выключить лимит"
                                : "Включить лимит"
                          }
                          onClick={() => void onToggleSubscriptionLimit(r, !r.device_limit_enabled)}
                        />
                      </td>
                      <td>{r.user_name}</td>
                      <td>{r.tg_id || "—"}</td>
                      <td>{r.subscription_name}</td>
                      <td>{r.expiry_time ? fmtDate(r.expiry_time) : "—"}</td>
                      <td>{r.devices_used}</td>
                      <td>{r.device_limit ?? "—"}</td>
                      <td>{r.device_extra_slots}</td>
                      <td>{r.last_device_name || "—"}</td>
                      <td className="device-limit-actions-cell">
                        <button type="button" className="ghost" onClick={() => setDevicesModal(r)}>
                          Устройства
                        </button>
                        <button type="button" className="ghost" onClick={() => void onAddSlots(r)}>
                          + слот
                        </button>
                        <button type="button" className="ghost" onClick={() => void onResetDevices(r)}>
                          Сброс
                        </button>
                        <button type="button" className="ghost" onClick={() => openHistory(r)}>
                          История
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 ? (
                <p className="sub device-limit-empty">Подписок с устройствами пока нет.</p>
              ) : null}
            </div>
            <div className="device-limit-cards">
              {rows.map((r) => (
                <div key={r.subscription_id} className="device-limit-sub-card">
                  <div className="device-limit-sub-card__row">
                    <span>Лимит</span>
                    <span>
                      <button
                        type="button"
                        className={`toggle ${r.device_limit_enabled || settings?.limit_scope === "all" ? "on" : ""}`}
                        disabled={!settings?.enabled || settings?.limit_scope === "all"}
                        onClick={() => void onToggleSubscriptionLimit(r, !r.device_limit_enabled)}
                      />
                    </span>
                  </div>
                  <div className="device-limit-sub-card__row">
                    <span>Пользователь</span>
                    <span>{r.user_name}</span>
                  </div>
                  <div className="device-limit-sub-card__row">
                    <span>Подписка</span>
                    <span>{r.subscription_name}</span>
                  </div>
                  <div className="device-limit-sub-card__row">
                    <span>Устройства</span>
                    <span>
                      {r.device_limit != null
                        ? `${r.devices_used}/${r.device_limit} · докуплено ${r.device_extra_slots}`
                        : `без лимита · докуплено ${r.device_extra_slots}`}
                    </span>
                  </div>
                  <div className="device-limit-sub-card__row">
                    <span>Последнее</span>
                    <span>{r.last_device_name || "—"}</span>
                  </div>
                  <div className="device-limit-sub-card__actions device-limit-sub-card__actions--4">
                    <button type="button" className="ghost" onClick={() => setDevicesModal(r)}>
                      Устройства
                    </button>
                    <button type="button" className="ghost" onClick={() => void onAddSlots(r)}>
                      + слот
                    </button>
                    <button type="button" className="ghost" onClick={() => void onResetDevices(r)}>
                      Сброс
                    </button>
                    <button type="button" className="ghost" onClick={() => openHistory(r)}>
                      История
                    </button>
                  </div>
                </div>
              ))}
              {rows.length === 0 ? <p className="sub device-limit-empty">Подписок с устройствами пока нет.</p> : null}
            </div>
          </section>
        ) : null}

        {tab === "purchases" ? (
          <section className="panel device-limit-tab-panel">
            <div className="device-limit-filter-bar">
              <input
                type="search"
                placeholder="Пользователь"
                value={purchaseUserQ}
                onChange={(e) => setPurchaseUserQ(e.target.value)}
              />
              <select value={purchaseStatus} onChange={(e) => setPurchaseStatus(e.target.value)}>
                <option value="all">Все статусы</option>
                <option value="pending">Ожидает</option>
                <option value="paid">Оплачено</option>
                <option value="failed">Ошибка</option>
                <option value="cancelled">Отменено</option>
              </select>
              <input type="date" value={purchaseFrom} onChange={(e) => setPurchaseFrom(e.target.value)} aria-label="С даты" />
              <input type="date" value={purchaseTo} onChange={(e) => setPurchaseTo(e.target.value)} aria-label="По дату" />
            </div>
            <div className="card device-limit-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Подписка</th>
                    <th>Мест</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Создано</th>
                    <th>Оплачено</th>
                    <th>payment_id</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchases.map((p) => (
                    <tr key={p.id}>
                      <td>{p.user_name}</td>
                      <td>{p.subscription_name}</td>
                      <td>{p.slots_count}</td>
                      <td>{p.amount_total} ₽</td>
                      <td>{purchaseStatusRu(p.status)}</td>
                      <td>{fmtDate(p.created_at)}</td>
                      <td>{fmtDate(p.activated_at)}</td>
                      <td>{p.payment_id || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredPurchases.length === 0 ? (
                <p className="sub device-limit-empty">Покупок дополнительных устройств пока нет.</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "events" ? (
          <section className="panel device-limit-tab-panel">
            {eventSubFilter != null ? (
              <div className="device-limit-filter-note">
                Фильтр по подписке #{eventSubFilter}
                <button type="button" className="ghost" onClick={() => setEventSubFilter(null)}>
                  Сбросить
                </button>
              </div>
            ) : null}
            <div className="card device-limit-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Пользователь</th>
                    <th>Подписка</th>
                    <th>Устройство</th>
                    <th>Событие</th>
                    <th>Сообщение</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((ev) => (
                    <tr key={ev.id}>
                      <td>{fmtDate(ev.created_at)}</td>
                      <td>{ev.user_id || "—"}</td>
                      <td>{ev.subscription_id || "—"}</td>
                      <td>{ev.device_id || "—"}</td>
                      <td>{eventTypeRu(ev.event_type)}</td>
                      <td>{ev.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredEvents.length === 0 ? (
                <p className="sub device-limit-empty">Событий пока нет.</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "diagnose" ? (
          <section className="panel device-limit-tab-panel device-limit-diagnose-panel">
            <h2 className="device-limit-setting-card__title">Проверка устройства</h2>
            <p className="sub" style={{ marginBottom: "0.75rem" }}>
              Укажите ID подписки и device id (did) для симуляции доступа.
            </p>
            <div className="device-limit-fields-grid">
              <div className="form-field">
                <label>ID подписки / token</label>
                <input className="device-limit-field-input" value={diagSubId} onChange={(e) => setDiagSubId(e.target.value)} />
              </div>
              <div className="form-field">
                <label>Device ID (did)</label>
                <input className="device-limit-field-input" value={diagDid} onChange={(e) => setDiagDid(e.target.value)} />
              </div>
              <div className="form-field form-field-span-2">
                <label>User-Agent (необязательно)</label>
                <input className="device-limit-field-input" value={diagUa} onChange={(e) => setDiagUa(e.target.value)} />
              </div>
            </div>
            <button
              type="button"
              className="primary"
              style={{ marginTop: "0.75rem" }}
              disabled={diagBusy || !diagSubId.trim()}
              onClick={() => {
                setDiagBusy(true);
                setDiagResult(null);
                void diagnoseDeviceLimit(Number(diagSubId), diagDid, diagUa)
                  .then(setDiagResult)
                  .catch((e) => setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" }))
                  .finally(() => setDiagBusy(false));
              }}
            >
              {diagBusy ? "Проверка…" : "Проверить"}
            </button>
            {diagResult ? (
              <div className="device-limit-diagnose-result">
                {[
                  ["Найдено устройство", diagResult.device_id_masked ? "да" : "нет"],
                  ["Свободный слот", diagResult.allowed ? "есть / не требуется" : "нет"],
                  ["Подписка будет отдана", diagResult.will_serve_subscription ? "да" : "нет"],
                  ["Причина блокировки", String(diagResult.reason ?? "—")],
                  ["Лимит", `${diagResult.active_devices ?? "?"}/${diagResult.total_limit ?? "?"}`],
                  ["Глобально включено", diagResult.global_enabled ? "да" : "нет"],
                ].map(([k, v]) => (
                  <div key={String(k)} className="device-limit-diagnose-row">
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
            ) : null}

            <hr className="device-limit-diagnose-divider" />

            <h2 className="device-limit-setting-card__title" style={{ marginTop: "1.25rem" }}>
              Сводка по подключениям
            </h2>
            <p className="sub" style={{ marginBottom: "0.75rem" }}>
              Живой опрос VPN-узлов (Xray): сколько подключений у каждой подписки прямо сейчас, даже если лимит
              устройств выключен. Только сбор информации, ничего не меняет. Может занять до минуты.
            </p>
            <div className="device-limit-diagnose-actions">
              <button
                type="button"
                className="secondary"
                disabled={snapshotBusy}
                onClick={() => {
                  setSnapshotBusy(true);
                  void loadDeviceLimitSubscriptionsSnapshot()
                    .then(setSnapshot)
                    .catch((e) => setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" }))
                    .finally(() => setSnapshotBusy(false));
                }}
              >
                {snapshotBusy ? "Опрос узлов…" : "Сканировать подключения"}
              </button>
              {snapshot ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const lines = [
                      `Сводка подключений · ${fmtDate(snapshot.generated_at)}`,
                      snapshot.scan_duration_ms != null
                        ? `Длительность: ${(snapshot.scan_duration_ms / 1000).toFixed(1)} с · узлов: ${snapshot.servers_scanned ?? "?"}`
                        : "",
                      `Подписок: ${snapshot.summary.subscriptions_total} · онлайн: ${snapshot.summary.online_now} · подключений: ${snapshot.summary.total_live_connections} · зарегистрировано: ${snapshot.summary.registered_devices_total}`,
                      ...(snapshot.errors?.length ? [`Ошибки: ${snapshot.errors.join("; ")}`] : []),
                      "",
                      ...snapshot.rows.map((r) => {
                        const live =
                          r.online_ips.length > 0
                            ? r.online_ips.join(", ")
                            : r.online_connections > 0
                              ? `${r.online_connections} сесс.`
                              : "—";
                        const reg = r.registered_names?.length
                          ? r.registered_names.join(", ")
                          : r.registered_devices > 0
                            ? `${r.registered_devices} устр.`
                            : "—";
                        return `#${r.user_id} ${r.user_name} · подключено: ${r.online_connections} (${live}) · в лимите: ${reg}`;
                      }),
                    ].filter(Boolean);
                    void navigator.clipboard.writeText(lines.join("\n"));
                    setToast({ type: "ok", text: "Сводка скопирована" });
                  }}
                >
                  Скопировать отчёт
                </button>
              ) : null}
            </div>
            {snapshot ? (
              <div className="device-limit-diagnose-result" style={{ marginTop: "0.75rem" }}>
                {[
                  ["Подписок всего", String(snapshot.summary.subscriptions_total)],
                  ["Сейчас онлайн", String(snapshot.summary.online_now)],
                  ["Активных подключений", String(snapshot.summary.total_live_connections)],
                  ["Зарегистрировано (лимит)", String(snapshot.summary.registered_devices_total)],
                  ["С активным лимитом", String(snapshot.summary.limit_active)],
                  snapshot.scan_duration_ms != null
                    ? ["Время опроса", `${(snapshot.scan_duration_ms / 1000).toFixed(1)} с`]
                    : null,
                  snapshot.servers_scanned != null ? ["Узлов опрошено", String(snapshot.servers_scanned)] : null,
                  ["Собрано", fmtDate(snapshot.generated_at)],
                ]
                  .filter((x): x is [string, string] => Boolean(x))
                  .map(([k, v]) => (
                  <div key={String(k)} className="device-limit-diagnose-row">
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            {snapshot?.errors?.length ? (
              <p className="sub device-limit-snapshot-warn" style={{ marginTop: "0.5rem", color: "var(--warn)" }}>
                Ошибки опроса: {snapshot.errors.join(" · ")}
              </p>
            ) : null}
            {snapshot ? (
              <div className="table-wrap device-limit-snapshot-table-wrap" style={{ marginTop: "0.75rem" }}>
                <table className="data-table device-limit-snapshot-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Подписка</th>
                      <th>Подключено</th>
                      <th>IP / сессии</th>
                      <th>В лимите</th>
                      <th>Лимит</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.rows.map((r) => (
                      <tr
                        key={r.user_id}
                        className={r.online_connections === 0 ? "device-limit-snapshot-row--empty" : ""}
                      >
                        <td>{r.user_id}</td>
                        <td>{r.user_name}</td>
                        <td>
                          <strong>{r.online_connections}</strong>
                        </td>
                        <td className="device-limit-snapshot-names">
                          {r.online_ips.length > 0
                            ? r.online_ips.join(", ")
                            : r.online_connections > 0
                              ? `${r.online_connections} сесс.`
                              : "—"}
                        </td>
                        <td className="device-limit-snapshot-names">
                          {r.registered_names?.join(", ") || (r.registered_devices > 0 ? String(r.registered_devices) : "—")}
                        </td>
                        <td>
                          {r.limit_active
                            ? r.device_limit != null
                              ? `${r.registered_devices}/${r.device_limit}`
                              : "—"
                            : "выкл"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        {devicesModal ? (
          <div className="modal-backdrop device-limit-modal-backdrop" onClick={() => setDevicesModal(null)}>
            <div className="modal card device-limit-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{devicesModal.subscription_name}</h3>
              <p className="sub">
                {devicesModal.device_limit != null
                  ? `Лимит: ${devicesModal.devices_used}/${devicesModal.device_limit} · свободно: ${Math.max(0, devicesModal.device_limit - devicesModal.devices_used)} · докуплено: ${devicesModal.device_extra_slots}`
                  : `Лимит: без ограничений · докуплено: ${devicesModal.device_extra_slots}`}
              </p>
              <ul className="device-slot-list">
                {devicesModal.devices.map((d) => (
                  <li key={d.id} className="device-slot-card">
                    <div className="device-slot-head">
                      <span className="device-slot-icon">{d.device_icon}</span>
                      <div className="device-slot-title">
                        <b>{d.device_name}</b>
                        <div className="device-slot-meta">{d.device_id_masked ?? d.id}</div>
                      </div>
                    </div>
                    <div className="device-slot-meta">
                      Первое подключение: {fmtDate(d.first_seen_at ?? d.created_at)}
                      <br />
                      Последняя активность: {fmtDate(d.last_seen_at)}
                      {d.last_ip ? (
                        <>
                          <br />
                          IP: {d.last_ip}
                        </>
                      ) : null}
                    </div>
                    <code className="device-slot-url">{d.subscription_url}</code>
                    <div className="device-slot-actions device-slot-actions--3">
                      <button type="button" className="ghost" onClick={() => void navigator.clipboard.writeText(d.subscription_url)}>
                        Копировать
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          const name = window.prompt("Название", d.device_name);
                          if (!name) return;
                          void renameAdminDevice(devicesModal.subscription_id, d.id, name)
                            .then((r) => setDevicesModal(r.row))
                            .catch((e) => setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" }));
                        }}
                      >
                        Переименовать
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          if (!window.confirm(`Удалить ${d.device_name}?`)) return;
                          void removeAdminDevice(devicesModal.subscription_id, d.id)
                            .then((r) => setDevicesModal(r.row))
                            .catch((e) => setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" }));
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {devicesModal.devices.length === 0 ? (
                <p className="sub device-limit-empty">Устройства не привязаны.</p>
              ) : null}
              <div className="device-limit-modal__footer">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    if (!window.confirm("Сбросить все устройства этой подписки?")) return;
                    void resetAdminDevices(devicesModal.subscription_id)
                      .then((r) => setDevicesModal(r.row))
                      .catch((e) => setToast({ type: "err", text: e instanceof Error ? e.message : "Ошибка" }));
                  }}
                >
                  Сбросить устройства
                </button>
                <button type="button" className="primary" onClick={() => setDevicesModal(null)}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
