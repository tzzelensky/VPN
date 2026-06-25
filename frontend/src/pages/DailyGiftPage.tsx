import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import ClientPickerModal from "../components/ClientPickerModal";
import Spinner from "../components/Spinner";
import {
  deleteDailyGiftPrize,
  deleteDailyGiftSchedule,
  loadDailyGiftAdmin,
  listCommunicationTargets,
  saveDailyGiftConfig,
  saveDailyGiftPrize,
  saveDailyGiftQueue,
  saveDailyGiftSchedule,
  resetDailyGiftUserClaim,
  sendDailyGiftReminderManual,
  type CommunicationTargetDto,
  type DailyGiftAdminDto,
  type DailyGiftPrizeDto,
  type DailyGiftPrizeType,
  type DailyGiftSelectionMode,
} from "../api";
import { usePanelSettings } from "../panelSettingsContext";
import { subscriptionLabel } from "../subscriptionLabel";

const PRIZE_TYPE_OPTIONS: { id: DailyGiftPrizeType; label: string }[] = [
  { id: "gb", label: "ГБ трафика" },
  { id: "days", label: "Дни подписки" },
  { id: "promo", label: "Промокод" },
  { id: "discount", label: "Скидка" },
];

const MODE_OPTIONS: { id: DailyGiftSelectionMode; label: string; hint: string }[] = [
  {
    id: "random",
    label: "Случайный (с весами)",
    hint: "Каждый пользователь получает свой подарок по весам. Один и тот же пользователь в один день — один и тот же подарок.",
  },
  {
    id: "scheduled",
    label: "По расписанию",
    hint: "Для каждой даты можно задать конкретный подарок.",
  },
  {
    id: "queue",
    label: "Очередь подарков",
    hint: "Подарки выдаются по очереди из выбранного списка.",
  },
];

const TYPE_BADGE: Record<DailyGiftPrizeType, string> = {
  gb: "ГБ",
  days: "Дни",
  promo: "Промокод",
  discount: "Скидка",
};

const CLAIMS_PAGE_SIZE = 25;

const DEFAULT_DESCRIPTION: Record<DailyGiftPrizeType, string> = {
  gb: "Дополнительный трафик уже начислен на ваш аккаунт.",
  days: "День подписки уже добавлен к вашему тарифу.",
  promo: "Персональный промокод со скидкой. Код генерируется автоматически при получении подарка.",
  discount: "Скидка будет доступна при следующей оплате.",
};

function emptyPrize(): Partial<DailyGiftPrizeDto> {
  return {
    title: "",
    type: "gb",
    value: "",
    description: DEFAULT_DESCRIPTION.gb,
    active: true,
    weight: 1,
    golden: false,
    valid_from: null,
    valid_until: null,
    max_total_claims: null,
    max_per_user: null,
  };
}

function valueLabel(type: DailyGiftPrizeType): string {
  if (type === "gb") return "Количество ГБ *";
  if (type === "days") return "Количество дней *";
  if (type === "promo") return "Процент скидки *";
  return "Размер скидки, % *";
}

function valuePlaceholder(type: DailyGiftPrizeType): string {
  if (type === "gb") return "Например: 3";
  if (type === "days") return "Например: 7";
  if (type === "promo") return "Например: 15";
  return "Например: 15";
}

function prizeSnapshot(p: Partial<DailyGiftPrizeDto>): string {
  return JSON.stringify({
    title: p.title ?? "",
    type: p.type ?? "gb",
    value: p.value ?? "",
    description: p.description ?? "",
    active: p.active !== false,
    weight: p.weight ?? 1,
    golden: p.golden === true,
    valid_from: p.valid_from ?? null,
    valid_until: p.valid_until ?? null,
    max_total_claims: p.max_total_claims ?? null,
    max_per_user: p.max_per_user ?? null,
  });
}

function validatePrize(p: Partial<DailyGiftPrizeDto>): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = String(p.title ?? "").trim();
  if (title.length < 2) errors.title = "Введите название подарка";
  else if (title.length > 60) errors.title = "Не более 60 символов";
  const type = p.type ?? "gb";
  const value = String(p.value ?? "").trim();
  if (!value) errors.value = "Введите значение подарка";
  else if (type === "gb" || type === "days") {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) errors.value = "Укажите число больше 0";
  } else if (type === "discount" || type === "promo") {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1 || n > 100) errors.value = "Скидка должна быть от 1 до 100%";
  }
  const weight = Math.floor(Number(p.weight ?? 0));
  if (!Number.isFinite(weight) || weight < 1) errors.weight = "Вес должен быть числом больше 0";
  else if (weight > 1000) errors.weight = "Максимум 1000";
  const desc = String(p.description ?? "");
  if (desc.length > 200) errors.description = "Не более 200 символов";
  return errors;
}

function claimStatusBadge(status: string) {
  if (status === "applied") return <span className="daily-gift-badge daily-gift-badge--ok">Успешно</span>;
  if (status === "failed") return <span className="daily-gift-badge daily-gift-badge--err">Ошибка</span>;
  if (status === "pending") return <span className="daily-gift-badge daily-gift-badge--warn">В обработке</span>;
  return <span className="daily-gift-badge daily-gift-badge--muted">{status}</span>;
}

export default function DailyGiftPage({ onLogout }: { onLogout: () => void }) {
  const panel = usePanelSettings();
  const timezone = panel.settings?.ui.timezone?.trim() || "Asia/Yekaterinburg";

  const [data, setData] = useState<DailyGiftAdminDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [editPrize, setEditPrize] = useState<Partial<DailyGiftPrizeDto> | null>(null);
  const [prizeErrors, setPrizeErrors] = useState<Record<string, string>>({});
  const [prizeSaving, setPrizeSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const prizeDirtyRef = useRef("");
  const [bannerDraft, setBannerDraft] = useState("");

  const [scheduleDay, setScheduleDay] = useState("");
  const [schedulePrizeId, setSchedulePrizeId] = useState("");

  const [claimFilterUser, setClaimFilterUser] = useState("");
  const [claimFilterType, setClaimFilterType] = useState<"" | DailyGiftPrizeType>("");
  const [claimFilterStatus, setClaimFilterStatus] = useState("");
  const [claimPage, setClaimPage] = useState(1);
  const [resetUserId, setResetUserId] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [notifyTargets, setNotifyTargets] = useState<CommunicationTargetDto[]>([]);
  const [notifySelectedIds, setNotifySelectedIds] = useState<number[]>([]);
  const [notifyPickerOpen, setNotifyPickerOpen] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const next = await loadDailyGiftAdmin();
      setData(next);
      setBannerDraft(next.config.banner_image_url ?? "");
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await listCommunicationTargets();
        setNotifyTargets(data.users);
      } catch {
        setNotifyTargets([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!editPrize) return;
    prizeDirtyRef.current = prizeSnapshot(editPrize);
    setPrizeErrors({});
    setShowAdvanced(Boolean(editPrize.valid_from || editPrize.valid_until || editPrize.max_total_claims));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestCloseModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editPrize?.id]);

  const activePrizes = useMemo(() => data?.prizes.filter((p) => p.active) ?? [], [data?.prizes]);

  const filteredClaims = useMemo(() => {
    if (!data) return [];
    return data.claims.filter((c) => {
      const userQ = claimFilterUser.trim().toLowerCase();
      if (userQ) {
        const match =
          String(c.tg_user_id).includes(userQ) ||
          (c.user_id ? String(c.user_id).includes(userQ) : false) ||
          (c.subscription_name ?? "").toLowerCase().includes(userQ);
        if (!match) return false;
      }
      if (claimFilterType && c.prize_type !== claimFilterType) return false;
      if (claimFilterStatus && c.status !== claimFilterStatus) return false;
      return true;
    });
  }, [data, claimFilterUser, claimFilterType, claimFilterStatus]);

  useEffect(() => {
    setClaimPage(1);
  }, [claimFilterUser, claimFilterType, claimFilterStatus]);

  const claimsTotalPages = Math.max(1, Math.ceil(filteredClaims.length / CLAIMS_PAGE_SIZE));
  const safeClaimPage = Math.min(claimPage, claimsTotalPages);

  const pagedClaims = useMemo(() => {
    const start = (safeClaimPage - 1) * CLAIMS_PAGE_SIZE;
    return filteredClaims.slice(start, start + CLAIMS_PAGE_SIZE);
  }, [filteredClaims, safeClaimPage]);

  const notifyReachable = useMemo(() => {
    return notifyTargets.filter((u) => Number.isFinite(Number(u.tg_id)) && Number(u.tg_id) > 0);
  }, [notifyTargets]);

  const notifyReachableById = useMemo(() => new Map(notifyReachable.map((u) => [u.id, u])), [notifyReachable]);

  const notifySelectedUsers = useMemo(
    () => notifySelectedIds.map((id) => notifyReachableById.get(id)).filter((x): x is CommunicationTargetDto => Boolean(x)),
    [notifyReachableById, notifySelectedIds],
  );

  const modeHint = MODE_OPTIONS.find((m) => m.id === data?.config.selection_mode)?.hint ?? "";

  async function onSaveConfig(patch: Partial<DailyGiftAdminDto["config"]>) {
    if (!data) return;
    setSaving(true);
    try {
      const config = await saveDailyGiftConfig({ ...data.config, ...patch });
      setData({ ...data, config });
      setMsg({ type: "ok", text: "Настройки сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  function openPrizeModal(prize?: DailyGiftPrizeDto) {
    setEditPrize(prize ? { ...prize } : emptyPrize());
    setConfirmClose(false);
  }

  function isPrizeDirty() {
    return editPrize != null && prizeSnapshot(editPrize) !== prizeDirtyRef.current;
  }

  function requestCloseModal() {
    if (isPrizeDirty()) {
      setConfirmClose(true);
      return;
    }
    setEditPrize(null);
    setConfirmClose(false);
  }

  async function onSavePrize() {
    if (!editPrize || !data) return;
    const errors = validatePrize(editPrize);
    setPrizeErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPrizeSaving(true);
    try {
      const row = await saveDailyGiftPrize({
        ...editPrize,
        title: String(editPrize.title).trim(),
        value: String(editPrize.value).trim(),
        description: String(editPrize.description ?? "").trim() || DEFAULT_DESCRIPTION[editPrize.type ?? "gb"],
      });
      const prizes = data.prizes.some((p) => p.id === row.id)
        ? data.prizes.map((p) => (p.id === row.id ? row : p))
        : [...data.prizes, row];
      setData({ ...data, prizes });
      setEditPrize(null);
      setConfirmClose(false);
      setMsg({ type: "ok", text: "Подарок сохранён." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setPrizeSaving(false);
    }
  }

  async function onTogglePrizeActive(p: DailyGiftPrizeDto) {
    if (!data) return;
    const row = await saveDailyGiftPrize({ ...p, active: !p.active });
    setData({ ...data, prizes: data.prizes.map((x) => (x.id === row.id ? row : x)) });
  }

  async function onDeletePrize(id: string) {
    if (!data || !window.confirm("Удалить подарок?")) return;
    await deleteDailyGiftPrize(id);
    setData({ ...data, prizes: data.prizes.filter((p) => p.id !== id) });
    setMsg({ type: "ok", text: "Подарок удалён." });
  }

  async function onAddSchedule() {
    if (!data || !scheduleDay || !schedulePrizeId) return;
    await saveDailyGiftSchedule(scheduleDay, schedulePrizeId);
    setData({
      ...data,
      schedules: [...data.schedules.filter((s) => s.day_key !== scheduleDay), { day_key: scheduleDay, prize_id: schedulePrizeId }],
    });
    setScheduleDay("");
    setMsg({ type: "ok", text: "Расписание обновлено." });
  }

  async function onSaveQueue() {
    if (!data) return;
    const cfg = await saveDailyGiftQueue(data.config.queue_prize_ids);
    setData({ ...data, config: cfg });
    setMsg({ type: "ok", text: "Очередь сохранена." });
  }

  async function onResetUserClaim(tgUserId: number) {
    if (!data || !Number.isFinite(tgUserId) || tgUserId <= 0) return;
    if (!window.confirm(`Сбросить таймер подарка для пользователя ${tgUserId}? Он сможет открыть подарок снова.`)) {
      return;
    }
    setResetBusy(true);
    try {
      const result = await resetDailyGiftUserClaim({ tg_user_id: tgUserId });
      setData({ ...data, claims: result.claims });
      setMsg({ type: "ok", text: `Таймер сброшен для ${tgUserId} (день ${result.day_key}).` });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setResetBusy(false);
    }
  }

  async function onResetFromForm() {
    const id = Math.floor(Number(resetUserId.trim()));
    if (!Number.isFinite(id) || id <= 0) {
      setMsg({ type: "err", text: "Укажите корректный Telegram ID пользователя." });
      return;
    }
    await onResetUserClaim(id);
  }

  async function onSendReminder() {
    const tgIds = [
      ...new Set(
        notifySelectedUsers
          .map((u) => Math.floor(Number(u.tg_id)))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
    if (tgIds.length === 0) {
      setMsg({ type: "err", text: "Выберите клиентов через кнопку «Выбор клиентов»." });
      return;
    }
    const label = tgIds.length === 1 ? "1 пользователю" : `${tgIds.length} пользователям`;
    if (!window.confirm(`Отправить напоминание «Ваш ежедневный подарок готов» ${label}?`)) {
      return;
    }
    setNotifyBusy(true);
    try {
      const result = await sendDailyGiftReminderManual({ tg_user_ids: tgIds });
      if (result.failed === 0) {
        setMsg({ type: "ok", text: `Напоминание отправлено: ${result.sent} из ${result.total}.` });
      } else {
        const failedIds = result.results.filter((r) => !r.ok).map((r) => r.tg_user_id).join(", ");
        setMsg({
          type: "err",
          text: `Отправлено ${result.sent} из ${result.total}. Ошибки: ${failedIds}`,
        });
      }
      void refresh();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setNotifyBusy(false);
    }
  }

  const previewTitle = editPrize?.title?.trim() || "Название подарка";
  const previewDesc =
    editPrize?.description?.trim() || DEFAULT_DESCRIPTION[editPrize?.type ?? "gb"];
  const previewIcon =
    editPrize?.type === "promo"
      ? "🏷️"
      : editPrize?.type === "discount"
        ? "💸"
        : editPrize?.type === "days"
          ? "📅"
          : editPrize?.type === "gb"
            ? "📶"
            : "🎁";

  return (
    <DashboardLayout onLogout={onLogout}>
      <div className="daily-gift-page">
        <header className="daily-gift-page__header">
          <div>
            <h1 className="daily-gift-page__title">Ежедневный подарок</h1>
            <p className="daily-gift-page__desc">
              Настройка подарков, режима выдачи и уведомлений для пользователей WebApp
            </p>
          </div>
        </header>

        {loading ? (
          <div className="daily-gift-page__loading">
            <Spinner /> Загрузка…
          </div>
        ) : null}

        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}

        {data ? (
          <div className="daily-gift-page__stack">
            <section className="panel daily-gift-card">
              <div className="daily-gift-card__head">
                <div>
                  <h2 className="daily-gift-card__title">Общие настройки</h2>
                  <p className="daily-gift-card__desc">Включает или отключает отображение подарка в WebApp</p>
                </div>
                <span className={`daily-gift-badge ${data.config.enabled ? "daily-gift-badge--ok" : "daily-gift-badge--muted"}`}>
                  {data.config.enabled ? "Активен" : "Выключен"}
                </span>
              </div>

              <div className="form-field shop-toggle-row daily-gift-toggle-row">
                <div>
                  <label>Ежедневный подарок</label>
                  <p className="field-hint">Пользователи увидят блок подарка на главной WebApp</p>
                </div>
                <button
                  type="button"
                  className={`toggle ${data.config.enabled ? "on" : ""}`}
                  aria-pressed={data.config.enabled}
                  disabled={saving}
                  onClick={() => void onSaveConfig({ enabled: !data.config.enabled })}
                />
              </div>

              <div className="form-field daily-gift-field-narrow">
                <label>Режим выдачи</label>
                <select
                  value={data.config.selection_mode}
                  disabled={saving}
                  onChange={(e) => void onSaveConfig({ selection_mode: e.target.value as DailyGiftSelectionMode })}
                >
                  {MODE_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="field-hint">{modeHint}</p>
              </div>

              <div className="form-field daily-gift-field-narrow">
                <label>URL баннера</label>
                <input
                  type="url"
                  placeholder="https://example.com/banner.png"
                  value={bannerDraft}
                  onChange={(e) => setBannerDraft(e.target.value)}
                  onBlur={() => void onSaveConfig({ banner_image_url: bannerDraft.trim() || null })}
                />
                <p className="field-hint">Если поле пустое, используется стандартное изображение подарка</p>
                {bannerDraft.trim() ? (
                  <div className="daily-gift-banner-preview">
                    <img src={bannerDraft.trim()} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />
                  </div>
                ) : null}
              </div>

              <div className="daily-gift-stat-grid">
                <div className="daily-gift-stat-card">
                  <span className="daily-gift-stat-card__label">Сброс подарка</span>
                  <strong>
                    {data.config.reset_hour}:{String(data.config.reset_minute).padStart(2, "0")}
                  </strong>
                </div>
                <div className="daily-gift-stat-card">
                  <span className="daily-gift-stat-card__label">Уведомления</span>
                  <strong>
                    {data.config.notify_hour}:{String(data.config.notify_minute).padStart(2, "0")}
                  </strong>
                </div>
                <div className="daily-gift-stat-card">
                  <span className="daily-gift-stat-card__label">Таймзона</span>
                  <strong>{timezone}</strong>
                </div>
                <div className="daily-gift-stat-card">
                  <span className="daily-gift-stat-card__label">С напоминаниями</span>
                  <strong>{data.reminders_count}</strong>
                </div>
              </div>
              <p className="field-hint">Пользователи, которые нажали «Напоминать о подарке» в WebApp</p>
            </section>

            <section className="panel daily-gift-card">
              <div className="daily-gift-card__head">
                <div>
                  <h2 className="daily-gift-card__title">Подарки</h2>
                  <p className="daily-gift-card__desc">Создавайте подарки, которые могут выпадать пользователям каждый день</p>
                </div>
                <button type="button" className="primary daily-gift-btn-add" onClick={() => openPrizeModal()}>
                  + Добавить подарок
                </button>
              </div>

              {data.prizes.length === 0 ? (
                <div className="daily-gift-empty">
                  <div className="daily-gift-empty__icon" aria-hidden>
                    🎁
                  </div>
                  <h3>Подарков пока нет</h3>
                  <p>Добавьте первый подарок, чтобы пользователи могли получать ежедневные бонусы.</p>
                  <button type="button" className="primary" onClick={() => openPrizeModal()}>
                    + Добавить подарок
                  </button>
                </div>
              ) : (
                <div className="daily-gift-table-wrap">
                  <table className="data-table daily-gift-table">
                    <thead>
                      <tr>
                        <th>Название</th>
                        <th>Тип</th>
                        <th>Значение</th>
                        <th>Вес</th>
                        <th>Выдано</th>
                        <th>Активен</th>
                        <th>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.prizes.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.title}
                            {p.golden ? (
                              <span className="daily-gift-golden-badge" title="Золотой подарок">
                                ✦ Золотой
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <span className={`daily-gift-type-badge daily-gift-type-badge--${p.type}`}>
                              {TYPE_BADGE[p.type]}
                            </span>
                          </td>
                          <td>{p.value}</td>
                          <td>{p.weight}</td>
                          <td>{p.claims_count}</td>
                          <td>
                            <button
                              type="button"
                              className={`toggle toggle-sm ${p.active ? "on" : ""}`}
                              aria-label={p.active ? "Выключить" : "Включить"}
                              onClick={() => void onTogglePrizeActive(p)}
                            />
                          </td>
                          <td className="daily-gift-actions">
                            <button type="button" className="ghost" onClick={() => openPrizeModal(p)}>
                              Редактировать
                            </button>
                            <button type="button" className="ghost danger" onClick={() => void onDeletePrize(p.id)}>
                              Удалить
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {data.config.selection_mode === "scheduled" ? (
              <section className="panel daily-gift-card">
                <h2 className="daily-gift-card__title">Расписание подарков</h2>
                <div className="daily-gift-schedule-form">
                  <div className="form-field">
                    <label>Дата</label>
                    <input type="date" value={scheduleDay} onChange={(e) => setScheduleDay(e.target.value)} />
                  </div>
                  <div className="form-field">
                    <label>Подарок</label>
                    <select value={schedulePrizeId} onChange={(e) => setSchedulePrizeId(e.target.value)}>
                      <option value="">—</option>
                      {activePrizes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="primary" onClick={() => void onAddSchedule()}>
                    Добавить
                  </button>
                </div>
                {data.schedules.length > 0 ? (
                  <ul className="daily-gift-schedule-list">
                    {data.schedules.map((s) => {
                      const p = data.prizes.find((x) => x.id === s.prize_id);
                      return (
                        <li key={s.day_key}>
                          <span>
                            {s.day_key} → {p?.title ?? s.prize_id}
                          </span>
                          <button
                            type="button"
                            className="ghost danger"
                            onClick={() => void deleteDailyGiftSchedule(s.day_key).then(refresh)}
                          >
                            Удалить
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {data.config.selection_mode === "queue" ? (
              <section className="panel daily-gift-card">
                <h2 className="daily-gift-card__title">Очередь подарков</h2>
                <p className="field-hint">Выберите подарки в порядке очереди</p>
                <div className="daily-gift-queue-list">
                  {data.prizes.filter((p) => p.active).map((p) => (
                    <div key={p.id} className="form-field shop-toggle-row daily-gift-queue-row">
                      <span>{p.title}</span>
                      <button
                        type="button"
                        className={`toggle toggle-sm ${data.config.queue_prize_ids.includes(p.id) ? "on" : ""}`}
                        onClick={() => {
                          const ids = data.config.queue_prize_ids.includes(p.id)
                            ? data.config.queue_prize_ids.filter((id) => id !== p.id)
                            : [...data.config.queue_prize_ids, p.id];
                          setData({ ...data, config: { ...data.config, queue_prize_ids: ids } });
                        }}
                      />
                    </div>
                  ))}
                </div>
                <button type="button" className="primary" disabled={saving} onClick={() => void onSaveQueue()}>
                  Сохранить очередь
                </button>
              </section>
            ) : null}

            <section className="panel daily-gift-card">
              <div className="daily-gift-card__head">
                <div>
                  <h2 className="daily-gift-card__title">Сброс таймера</h2>
                  <p className="daily-gift-card__desc">
                    Обнуляет выдачу за текущий день — пользователь сможет открыть подарок снова без ожидания 24 часов
                  </p>
                </div>
              </div>
              <div className="daily-gift-reset-row">
                <div className="form-field daily-gift-field-narrow daily-gift-reset-field">
                  <label>Telegram ID пользователя</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Например: 123456789"
                    value={resetUserId}
                    disabled={resetBusy}
                    onChange={(e) => setResetUserId(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <button type="button" className="primary" disabled={resetBusy || !resetUserId.trim()} onClick={() => void onResetFromForm()}>
                  {resetBusy ? "Сброс…" : "Сбросить таймер"}
                </button>
              </div>
            </section>

            <section className="panel daily-gift-card">
              <div className="daily-gift-card__head">
                <div>
                  <h2 className="daily-gift-card__title">Отправить напоминание в Telegram</h2>
                  <p className="daily-gift-card__desc">
                    Сообщение «Ваш ежедневный подарок готов 🎁» с кнопкой «Открыть приложение». Не зависит от
                    автоматической рассылки.
                  </p>
                </div>
              </div>
              <div className="form-field daily-gift-notify-pick">
                <label>Клиенты для рассылки</label>
                <div className="comms-selected-row">
                  <button
                    type="button"
                    className="ghost"
                    disabled={notifyBusy}
                    onClick={() => setNotifyPickerOpen(true)}
                  >
                    Выбор клиентов
                  </button>
                  <span className="field-hint">Выбрано: {notifySelectedUsers.length}</span>
                </div>
                {notifySelectedUsers.length > 0 ? (
                  <div className="comms-selected-chips">
                    {notifySelectedUsers.slice(0, 8).map((u) => (
                      <span key={u.id} className="comms-chip">
                        {subscriptionLabel(u)}
                      </span>
                    ))}
                    {notifySelectedUsers.length > 8 ? (
                      <span className="comms-chip">+{notifySelectedUsers.length - 8}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="daily-gift-notify-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={notifyBusy || notifySelectedUsers.length === 0}
                  onClick={() => void onSendReminder()}
                >
                  {notifyBusy ? "Отправка…" : "Отправить напоминание"}
                </button>
              </div>
            </section>

            <ClientPickerModal
              open={notifyPickerOpen}
              users={notifyReachable}
              selectedIds={notifySelectedIds}
              onClose={() => setNotifyPickerOpen(false)}
              onConfirm={setNotifySelectedIds}
            />

            <section className="panel daily-gift-card">
              <div className="daily-gift-card__head">
                <div>
                  <h2 className="daily-gift-card__title">Журнал выдач</h2>
                  <p className="daily-gift-card__desc">История открытий и начислений ежедневных подарков</p>
                </div>
              </div>

              <div className="daily-gift-filters">
                <input
                  type="search"
                  placeholder="Название подписки или TG ID"
                  value={claimFilterUser}
                  onChange={(e) => setClaimFilterUser(e.target.value)}
                />
                <select value={claimFilterType} onChange={(e) => setClaimFilterType(e.target.value as "" | DailyGiftPrizeType)}>
                  <option value="">Все типы</option>
                  {PRIZE_TYPE_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <select value={claimFilterStatus} onChange={(e) => setClaimFilterStatus(e.target.value)}>
                  <option value="">Все статусы</option>
                  <option value="applied">Успешно</option>
                  <option value="failed">Ошибка</option>
                  <option value="pending">В обработке</option>
                </select>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setClaimFilterUser("");
                    setClaimFilterType("");
                    setClaimFilterStatus("");
                    setClaimPage(1);
                  }}
                >
                  Сбросить фильтры
                </button>
              </div>

              {filteredClaims.length === 0 ? (
                <div className="daily-gift-empty daily-gift-empty--compact">
                  <h3>Выдач пока нет</h3>
                  <p>Когда пользователи начнут открывать ежедневные подарки, история появится здесь.</p>
                </div>
              ) : (
                <div className="daily-gift-table-wrap">
                  <table className="data-table daily-gift-table compact">
                    <thead>
                      <tr>
                        <th>Дата и время</th>
                        <th>Подписка</th>
                        <th>Подарок</th>
                        <th>Тип</th>
                        <th>Статус</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pagedClaims.map((c) => (
                        <tr key={c.id}>
                          <td>{new Date(c.opened_at).toLocaleString("ru-RU")}</td>
                          <td>
                            {c.subscription_name ? (
                              <span className="mono">{c.subscription_name}</span>
                            ) : c.user_id ? (
                              <span title={`Подписка ID ${c.user_id}`}>ID {c.user_id}</span>
                            ) : (
                              <span title={`Telegram ID ${c.tg_user_id}`}>ID {c.tg_user_id}</span>
                            )}
                          </td>
                          <td>{c.prize_title}</td>
                          <td>
                            <span className={`daily-gift-type-badge daily-gift-type-badge--${c.prize_type}`}>
                              {TYPE_BADGE[c.prize_type as DailyGiftPrizeType] ?? c.prize_type}
                            </span>
                          </td>
                          <td>{claimStatusBadge(c.status)}</td>
                          <td className="daily-gift-actions">
                            <button
                              type="button"
                              className="ghost daily-gift-reset-btn"
                              disabled={resetBusy}
                              title="Сбросить таймер для этого пользователя за текущий день"
                              onClick={() => void onResetUserClaim(c.tg_user_id)}
                            >
                              Сбросить
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {claimsTotalPages > 1 ? (
                    <div className="daily-gift-claim-pagination" aria-label="Страницы журнала выдач">
                      <button
                        type="button"
                        className="ghost"
                        disabled={safeClaimPage <= 1}
                        onClick={() => setClaimPage((p) => Math.max(1, p - 1))}
                      >
                        Назад
                      </button>
                      <span className="daily-gift-claim-pagination__info">
                        Страница {safeClaimPage} из {claimsTotalPages}
                        <span className="daily-gift-claim-pagination__count">
                          {" "}
                          ({filteredClaims.length} записей)
                        </span>
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={safeClaimPage >= claimsTotalPages}
                        onClick={() => setClaimPage((p) => Math.min(claimsTotalPages, p + 1))}
                      >
                        Вперёд
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>

      {editPrize ? (
        <div className="modal-backdrop daily-gift-modal-backdrop" onClick={requestCloseModal}>
          <div className="daily-gift-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header className="daily-gift-modal__header">
              <div>
                <h3>{editPrize.id ? "Редактировать подарок" : "Новый подарок"}</h3>
                <p className="daily-gift-modal__subtitle">
                  Создайте подарок, который сможет выпадать пользователям каждый день
                </p>
              </div>
              <button type="button" className="daily-gift-modal__close" aria-label="Закрыть" onClick={requestCloseModal}>
                ×
              </button>
            </header>

            <div className="daily-gift-modal__body">
              <div className="form-field">
                <label>Название подарка *</label>
                <input
                  placeholder="Например: 3 ГБ трафика"
                  value={editPrize.title ?? ""}
                  maxLength={60}
                  className={prizeErrors.title ? "field-error" : ""}
                  onChange={(e) => setEditPrize({ ...editPrize, title: e.target.value })}
                />
                {prizeErrors.title ? <p className="field-hint promo-field-error">{prizeErrors.title}</p> : null}
              </div>

              <div className="form-field">
                <label>Тип подарка *</label>
                <select
                  value={editPrize.type ?? "gb"}
                  onChange={(e) => {
                    const type = e.target.value as DailyGiftPrizeType;
                    setEditPrize({
                      ...editPrize,
                      type,
                      value: "",
                      description: editPrize.description || DEFAULT_DESCRIPTION[type],
                    });
                  }}
                >
                  {PRIZE_TYPE_OPTIONS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>{valueLabel(editPrize.type ?? "gb")}</label>
                <input
                  type={editPrize.type === "promo" || editPrize.type === "discount" ? "number" : "text"}
                  min={editPrize.type === "promo" || editPrize.type === "discount" ? 1 : undefined}
                  max={editPrize.type === "promo" || editPrize.type === "discount" ? 100 : undefined}
                  placeholder={valuePlaceholder(editPrize.type ?? "gb")}
                  value={editPrize.value ?? ""}
                  className={prizeErrors.value ? "field-error" : ""}
                  onChange={(e) => setEditPrize({ ...editPrize, value: e.target.value })}
                />
                {editPrize.type === "promo" ? (
                  <p className="field-hint">Код создаётся автоматически: одноразовый, случайный, привязан к TG ID получателя.</p>
                ) : null}
                {prizeErrors.value ? <p className="field-hint promo-field-error">{prizeErrors.value}</p> : null}
              </div>

              <div className="form-field">
                <label>Описание для пользователя</label>
                <textarea
                  rows={4}
                  maxLength={200}
                  placeholder="Например: Дополнительный трафик уже начислен на ваш аккаунт"
                  value={editPrize.description ?? ""}
                  className={prizeErrors.description ? "field-error" : ""}
                  onChange={(e) => setEditPrize({ ...editPrize, description: e.target.value })}
                />
                <p className="field-hint">{(editPrize.description ?? "").length} / 200</p>
                {prizeErrors.description ? (
                  <p className="field-hint promo-field-error">{prizeErrors.description}</p>
                ) : null}
              </div>

              <div className="form-field">
                <label>Вес выпадения *</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={editPrize.weight ?? 1}
                  className={prizeErrors.weight ? "field-error" : ""}
                  onChange={(e) => setEditPrize({ ...editPrize, weight: Number(e.target.value) || 1 })}
                />
                <p className="field-hint">
                  Чем больше вес, тем выше шанс выпадения. Подарок с весом 10 выпадает чаще, чем с весом 1.
                </p>
                {prizeErrors.weight ? <p className="field-hint promo-field-error">{prizeErrors.weight}</p> : null}
              </div>

              <div className="form-field shop-toggle-row">
                <div>
                  <label>Золотой подарок</label>
                  <p className="field-hint">Редкий подарок с золотым оформлением и свечением в WebApp</p>
                </div>
                <button
                  type="button"
                  className={`toggle ${editPrize.golden === true ? "on" : ""}`}
                  onClick={() => setEditPrize({ ...editPrize, golden: !(editPrize.golden === true) })}
                />
              </div>

              <div className="form-field shop-toggle-row">
                <div>
                  <label>Подарок активен</label>
                  <p className="field-hint">Активные подарки участвуют в ежедневной выдаче</p>
                </div>
                <button
                  type="button"
                  className={`toggle ${editPrize.active !== false ? "on" : ""}`}
                  onClick={() => setEditPrize({ ...editPrize, active: !(editPrize.active !== false) })}
                />
              </div>

              <button type="button" className="ghost daily-gift-advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? "Скрыть дополнительные настройки" : "Дополнительные настройки"}
              </button>

              {showAdvanced ? (
                <div className="daily-gift-advanced">
                  <div className="form-field">
                    <label>Максимальное количество выдач</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="Без ограничений"
                      value={editPrize.max_total_claims ?? ""}
                      onChange={(e) =>
                        setEditPrize({
                          ...editPrize,
                          max_total_claims: e.target.value ? Math.floor(Number(e.target.value)) : null,
                        })
                      }
                    />
                  </div>
                  <div className="daily-gift-advanced-grid">
                    <div className="form-field">
                      <label>Дата начала</label>
                      <input
                        type="date"
                        value={editPrize.valid_from?.slice(0, 10) ?? ""}
                        onChange={(e) =>
                          setEditPrize({ ...editPrize, valid_from: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })
                        }
                      />
                    </div>
                    <div className="form-field">
                      <label>Дата окончания</label>
                      <input
                        type="date"
                        value={editPrize.valid_until?.slice(0, 10) ?? ""}
                        onChange={(e) =>
                          setEditPrize({
                            ...editPrize,
                            valid_until: e.target.value ? `${e.target.value}T23:59:59.999Z` : null,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="daily-gift-preview">
                <span className="daily-gift-preview__label">Так подарок увидит пользователь</span>
                <div className={`daily-gift-preview__card${editPrize.golden === true ? " daily-gift-preview__card--golden" : ""}`}>
                  <div className="daily-gift-preview__icon" aria-hidden>
                    {previewIcon}
                  </div>
                  <strong>{previewTitle}</strong>
                  <p>{previewDesc}</p>
                  {editPrize?.type === "promo" ? (
                    <div className="daily-gift-preview__promo-code">
                      <strong className="daily-gift-preview__promo-code-text">DG8F3A2B1C</strong>
                      <span className="daily-gift-preview__promo-copy" aria-hidden title="Скопировать">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <footer className="daily-gift-modal__footer">
              <button type="button" className="ghost" disabled={prizeSaving} onClick={requestCloseModal}>
                Отмена
              </button>
              <button type="button" className="primary" disabled={prizeSaving} onClick={() => void onSavePrize()}>
                {prizeSaving ? "Сохраняем…" : "Сохранить подарок"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {confirmClose ? (
        <div className="modal-backdrop daily-gift-modal-backdrop daily-gift-modal-backdrop--nested">
          <div className="daily-gift-confirm" onClick={(e) => e.stopPropagation()}>
            <h4>Закрыть без сохранения?</h4>
            <p>Все введённые данные будут потеряны.</p>
            <div className="daily-gift-confirm__actions">
              <button type="button" className="ghost" onClick={() => setConfirmClose(false)}>
                Продолжить редактирование
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setConfirmClose(false);
                  setEditPrize(null);
                }}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
