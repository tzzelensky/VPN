import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import DualListPicker from "../components/DualListPicker";
import Spinner from "../components/Spinner";
import {
  grantReferralAdminGift,
  listUsers,
  loadReferralEvents,
  loadReferralMeta,
  loadReferralProgram,
  loadReferralReport,
  loadReferralSettingsHistory,
  loadReferralStats,
  loadSubscriptionShop,
  referralEventsExportUrl,
  referralEventsXlsxExportUrl,
  referralReportExportUrl,
  referralReportXlsxExportUrl,
  saveReferralProgram,
  type ReferralEventDto,
  type ReferralMetaDto,
  type ReferralProgramDto,
  type ReferralReportRowDto,
  type ReferralSettingsHistoryEntry,
  type ReferralStatsDto,
  type SubscriptionShopDto,
  type UserDto,
} from "../api";
import { usePanelSettings } from "../panelSettingsContext";
import { applyReferralInviteVars } from "../referralInvitePreview";
import { subscriptionLabel } from "../subscriptionLabel";

type MainTab = "settings" | "report" | "history";
type EventFilter = "all" | "invitations" | "rewards" | "gifts" | "errors";

function cfgEqual(a: ReferralProgramDto, b: ReferralProgramDto): boolean {
  return (
    a.enabled === b.enabled &&
    a.inviter_reward_gb === b.inviter_reward_gb &&
    a.inviter_reward_days === b.inviter_reward_days &&
    a.invited_discount_percent === b.invited_discount_percent &&
    a.invite_copy_text.trim() === b.invite_copy_text.trim()
  );
}

function validateCfg(cfg: ReferralProgramDto): string | null {
  if (cfg.inviter_reward_gb < 0) return "ГБ не может быть меньше 0.";
  if (cfg.inviter_reward_days < 0) return "Дни не могут быть меньше 0.";
  if (cfg.invited_discount_percent < 0 || cfg.invited_discount_percent > 100) {
    return "Скидка должна быть от 0 до 100%.";
  }
  if (!cfg.invite_copy_text.trim()) return "Текст приглашения не может быть пустым.";
  return null;
}

function eventKindRu(kind: ReferralEventDto["kind"]): string {
  if (kind === "invitation") return "Приглашение";
  if (kind === "reward") return "Награда";
  if (kind === "admin_gift") return "Ручной подарок";
  return "Ошибка";
}

function formatStatDiscount(v: number | null): string {
  if (v == null) return "нет данных";
  return `${v}%`;
}

function formatStatConversion(v: number | null): string {
  if (v == null) return "нет данных";
  return `${v}%`;
}

export default function ReferralProgramPage({ onLogout }: { onLogout: () => void }) {
  const panel = usePanelSettings();
  const [cfg, setCfg] = useState<ReferralProgramDto | null>(null);
  const [savedCfg, setSavedCfg] = useState<ReferralProgramDto | null>(null);
  const [shop, setShop] = useState<SubscriptionShopDto | null>(null);
  const [stats, setStats] = useState<ReferralStatsDto | null>(null);
  const [meta, setMeta] = useState<ReferralMetaDto | null>(null);
  const [events, setEvents] = useState<ReferralEventDto[]>([]);
  const [reportRows, setReportRows] = useState<ReferralReportRowDto[]>([]);
  const [settingsHistory, setSettingsHistory] = useState<ReferralSettingsHistoryEntry[]>([]);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [giftUserIds, setGiftUserIds] = useState<number[]>([]);
  const [giftPickerOpen, setGiftPickerOpen] = useState(false);
  const [giftKind, setGiftKind] = useState<"gb" | "days">("gb");
  const [giftAmount, setGiftAmount] = useState(30);
  const [giftComment, setGiftComment] = useState("");
  const [giftConfirmOpen, setGiftConfirmOpen] = useState(false);
  const [giftBusy, setGiftBusy] = useState(false);
  const grantGiftLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [inviterRewardGbEmpty, setInviterRewardGbEmpty] = useState(false);
  const [inviterRewardDaysEmpty, setInviterRewardDaysEmpty] = useState(false);
  const [invitedDiscountEmpty, setInvitedDiscountEmpty] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("settings");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [eventSearch, setEventSearch] = useState("");
  const [eventFrom, setEventFrom] = useState("");
  const [eventTo, setEventTo] = useState("");

  const brandName =
    meta?.brand_name?.trim() ||
    panel.settings?.panel.brandName?.trim() ||
    "HSN";

  const dirty = cfg && savedCfg ? !cfgEqual(cfg, savedCfg) : false;

  const refreshEvents = useCallback(async () => {
    setFeedLoading(true);
    try {
      const kindMap: Record<EventFilter, string> = {
        all: "all",
        invitations: "invitations",
        rewards: "rewards",
        gifts: "gifts",
        errors: "errors",
      };
      const r = await loadReferralEvents({
        kind: kindMap[eventFilter],
        q: eventSearch.trim() || undefined,
        from: eventFrom || undefined,
        to: eventTo || undefined,
      });
      setEvents(r.entries ?? []);
    } catch (e) {
      setToast({ type: "err", text: String(e) });
    } finally {
      setFeedLoading(false);
    }
  }, [eventFilter, eventSearch, eventFrom, eventTo]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setToast(null);
    try {
      const [c, s, st, m, u, rep, hist] = await Promise.all([
        loadReferralProgram(),
        loadSubscriptionShop(),
        loadReferralStats(),
        loadReferralMeta(),
        listUsers(),
        loadReferralReport(),
        loadReferralSettingsHistory(),
      ]);
      setCfg(c);
      setSavedCfg(c);
      setShop(s);
      setStats(st);
      setMeta(m);
      setUsers(u);
      setReportRows(rep.rows ?? []);
      setSettingsHistory(hist.entries ?? []);
      setInviterRewardGbEmpty(false);
      setInviterRewardDaysEmpty(false);
      setInvitedDiscountEmpty(false);
    } catch (e) {
      setToast({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!loading) void refreshEvents();
  }, [refreshEvents, loading]);

  const discounted = useMemo(() => {
    if (!cfg || !shop) return [];
    return shop.plans.map((p) => {
      const gbLabel = p.total_gb <= 0 ? "Безлимит" : `${p.total_gb}ГБ`;
      return {
        id: p.id,
        title: `Трафик ${gbLabel} / ${p.days} дней`,
        oldPrice: p.price_rub,
        newPrice: Math.max(0, Math.floor(p.price_rub - (p.price_rub * cfg.invited_discount_percent) / 100)),
      };
    });
  }, [cfg, shop]);

  const invitePreview = useMemo(() => {
    if (!cfg) return "";
    const link = meta?.sample_ref_link ?? "https://t.me/your_bot?start=ref_12345";
    return applyReferralInviteVars(cfg.invite_copy_text, {
      ref_link: link,
      discount: `${cfg.invited_discount_percent}%`,
      brand: brandName,
    });
  }, [cfg, meta, brandName]);

  const sharePreview = useMemo(() => {
    const link = meta?.sample_ref_link ?? "https://t.me/your_bot?start=ref_12345";
    return `${invitePreview}\n${link}`;
  }, [invitePreview, meta]);

  async function onSave() {
    if (!cfg) return;
    if (inviterRewardGbEmpty || inviterRewardDaysEmpty || invitedDiscountEmpty) {
      setToast({ type: "err", text: "Нельзя сохранять пустые значения." });
      return;
    }
    const err = validateCfg(cfg);
    if (err) {
      setToast({ type: "err", text: err });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const next = await saveReferralProgram({
        ...cfg,
        invite_copy_text: cfg.invite_copy_text.trim(),
      });
      setCfg(next);
      setSavedCfg(next);
      const [st, hist] = await Promise.all([loadReferralStats(), loadReferralSettingsHistory()]);
      setStats(st);
      setSettingsHistory(hist.entries ?? []);
      setToast({ type: "ok", text: "Настройки реферальной программы сохранены" });
    } catch (e) {
      const raw = String(e);
      if (raw.includes("invite_copy_text")) {
        setToast({ type: "err", text: "Текст приглашения не может быть пустым." });
      } else {
        setToast({ type: "err", text: raw });
      }
    } finally {
      setSaving(false);
    }
  }

  async function onGrantGiftConfirmed() {
    if (giftUserIds.length === 0) return;
    if (grantGiftLock.current) return;
    const amount = Math.max(1, Math.floor(Number(giftAmount) || 0));
    grantGiftLock.current = true;
    setGiftBusy(true);
    setGiftConfirmOpen(false);
    setToast(null);
    try {
      const r = await grantReferralAdminGift({
        user_ids: giftUserIds,
        kind: giftKind,
        amount,
        admin_comment: giftComment.trim() || undefined,
      });
      const skipped = r.errors?.length ?? 0;
      setToast({
        type: "ok",
        text:
          skipped > 0
            ? `Подарок поставлен в очередь для ${r.queued} из ${giftUserIds.length} (${skipped} пропущено).`
            : `Подарок принят для ${r.queued} пользователей. Начисление выполняется в фоне.`,
      });
      setGiftComment("");
      const [st] = await Promise.all([loadReferralStats()]);
      setStats(st);
      window.setTimeout(() => void refreshEvents(), 1500);
    } catch (e) {
      const raw = String(e);
      if (raw.includes("gift_already_processing")) {
        setToast({ type: "err", text: "Подарок для этого пользователя уже начисляется." });
      } else if (raw.includes("user_unlimited_gb")) {
        setToast({ type: "err", text: "У пользователя безлимит — выберите подарок в днях." });
      } else if (raw.includes("user_no_tg_id")) {
        setToast({ type: "err", text: "У пользователя не указан Telegram ID." });
      } else {
        setToast({ type: "err", text: raw });
      }
    } finally {
      setGiftBusy(false);
      window.setTimeout(() => {
        grantGiftLock.current = false;
      }, 800);
    }
  }

  const giftUsers = useMemo(
    () => [...users].sort((a, b) => subscriptionLabel(a).localeCompare(subscriptionLabel(b), "ru")),
    [users],
  );

  const giftUserPickerItems = useMemo(
    () =>
      giftUsers.map((u) => ({
        id: u.id,
        label: `${subscriptionLabel(u)}${u.tg_id ? ` (tg ${u.tg_id})` : ""}`,
      })),
    [giftUsers],
  );

  const giftKindLabel = giftKind === "gb" ? "Гигабайты" : "Дни подписки";

  function exportEvents() {
    window.open(referralEventsExportUrl({ kind: eventFilter === "all" ? undefined : eventFilter }), "_blank");
  }

  function exportEventsXlsx() {
    window.open(
      referralEventsXlsxExportUrl({ kind: eventFilter === "all" ? undefined : eventFilter }),
      "_blank",
    );
  }

  function exportReport() {
    window.open(referralReportExportUrl(), "_blank");
  }

  function exportReportXlsx() {
    window.open(referralReportXlsxExportUrl(), "_blank");
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <div className="users-hero-top">
          <div>
            <h1>Реферальная программа</h1>
            <p className="sub users-hero-sub">Настройка кнопки в боте, скидки приглашенному и награды пригласившему.</p>
            {dirty ? <p className="referral-unsaved-hint">Есть несохранённые изменения</p> : null}
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={loading || saving} onClick={() => void refresh()}>
              Обновить
            </button>
            <button
              type="button"
              className="primary"
              disabled={!cfg || saving || !dirty}
              onClick={() => void onSave()}
            >
              {saving ? (
                <>
                  <Spinner /> Сохранение…
                </>
              ) : (
                "Сохранить"
              )}
            </button>
          </div>
        </div>
        {toast ? <div className={`flash ${toast.type === "ok" ? "ok" : "err"}`}>{toast.text}</div> : null}
      </section>

      {loading || !cfg ? (
        <section className="panel">
          <Spinner /> Загрузка…
        </section>
      ) : (
        <>
          {!cfg.enabled ? (
            <section className="panel">
              <div className="flash warn referral-disabled-banner">
                Реферальная программа выключена. Кнопка «Пригласи друга» скрыта в Telegram-боте.
              </div>
            </section>
          ) : null}

          <section className="panel referral-stats-panel">
            <div className="referral-stats-grid">
              <div className="referral-stat-card">
                <span className="referral-stat-label">Всего приглашений</span>
                <strong>{stats?.total_invites ?? 0}</strong>
              </div>
              <div className="referral-stat-card">
                <span className="referral-stat-label">Активных приглашений</span>
                <strong>{stats?.active_invites ?? 0}</strong>
              </div>
              <div className="referral-stat-card">
                <span className="referral-stat-label">Выдано ГБ</span>
                <strong>{stats?.gb_issued ?? 0}</strong>
              </div>
              <div className="referral-stat-card">
                <span className="referral-stat-label">Выдано дней</span>
                <strong>{stats?.days_issued ?? 0}</strong>
              </div>
              <div className="referral-stat-card">
                <span className="referral-stat-label">Средняя скидка</span>
                <strong>{formatStatDiscount(stats?.avg_discount_percent ?? null)}</strong>
              </div>
              <div className="referral-stat-card">
                <span className="referral-stat-label">Конверсия в покупку</span>
                <strong>{formatStatConversion(stats?.conversion_percent ?? null)}</strong>
              </div>
              <div className="referral-stat-card">
                <span className="referral-stat-label">Ручных подарков</span>
                <strong>{stats?.manual_gifts_count ?? 0}</strong>
              </div>
            </div>
          </section>

          <section className="panel referral-tabs-bar">
            <div className="referral-main-tabs" role="tablist">
              <button
                type="button"
                className={mainTab === "settings" ? "active" : ""}
                role="tab"
                aria-selected={mainTab === "settings"}
                onClick={() => setMainTab("settings")}
              >
                Настройки
              </button>
              <button
                type="button"
                className={mainTab === "report" ? "active" : ""}
                role="tab"
                aria-selected={mainTab === "report"}
                onClick={() => setMainTab("report")}
              >
                Отчёт
              </button>
              <button
                type="button"
                className={mainTab === "history" ? "active" : ""}
                role="tab"
                aria-selected={mainTab === "history"}
                onClick={() => setMainTab("history")}
              >
                История изменений
              </button>
            </div>
          </section>

          {mainTab === "report" ? (
            <section className="panel referral-report-panel">
              <div className="referral-report-toolbar">
                <h2 className="referral-section-title">Отчёт по реферальной программе</h2>
                <button type="button" className="ghost" onClick={exportReport}>
                  Экспорт CSV
                </button>
                <button type="button" className="ghost" onClick={exportReportXlsx}>
                  Экспорт XLSX
                </button>
              </div>
              {reportRows.length === 0 ? (
                <p className="sub referral-empty">Пока нет приглашений и подарков.</p>
              ) : (
                <div className="referral-report-wrap">
                  <table className="referral-report-table">
                    <thead>
                      <tr>
                        <th>Пригласивший</th>
                        <th>Приглашённый</th>
                        <th>Дата приглашения</th>
                        <th>Купил</th>
                        <th>Скидка</th>
                        <th>Награда пригласившему</th>
                        <th>Награда приглашённому</th>
                        <th>Статус</th>
                        <th>Дата начисления</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((r, i) => (
                        <tr key={`${r.invited_at}-${i}`}>
                          <td>{r.inviter_name}</td>
                          <td>{r.invitee_name}</td>
                          <td>{new Date(r.invited_at).toLocaleString("ru-RU")}</td>
                          <td>{r.purchased ? "да" : "нет"}</td>
                          <td>{r.discount_percent}%</td>
                          <td>{r.inviter_reward}</td>
                          <td>{r.invitee_reward}</td>
                          <td>{r.status}</td>
                          <td>{r.rewarded_at ? new Date(r.rewarded_at).toLocaleString("ru-RU") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="field-hint">Файл CSV можно открыть в Excel. Формат XLSX — через импорт CSV.</p>
            </section>
          ) : null}

          {mainTab === "history" ? (
            <section className="panel referral-history-panel">
              <h2 className="referral-section-title">История изменений настроек</h2>
              {settingsHistory.length === 0 ? (
                <p className="sub referral-empty">Изменений настроек пока не было.</p>
              ) : (
                <ul className="referral-history-list">
                  {settingsHistory.map((h) => (
                    <li key={h.id}>
                      <time dateTime={h.created_at}>
                        {new Date(h.created_at).toLocaleString("ru-RU", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </time>
                      {" — "}
                      <span>
                        {h.changed_by}: {h.field_label}: {h.old_value} → {h.new_value}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {mainTab === "settings" ? (
            <section className="panel">
              <div className="referral-program-layout">
                <div className="referral-program-form user-form-grid">
                  <div className="form-field form-field-span-2 shop-toggle-row">
                    <div>
                      <label>Реферальная программа</label>
                      <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                        Если выключено — кнопка «Пригласи друга» скрыта из Telegram-бота.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`toggle ${cfg.enabled ? "on" : ""}`}
                      aria-pressed={cfg.enabled}
                      onClick={() => setCfg({ ...cfg, enabled: !cfg.enabled })}
                    />
                  </div>

                  <div className="form-field">
                    <label>Награда пригласившему: ГБ</label>
                    <input
                      inputMode="numeric"
                      value={cfg.inviter_reward_gb}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          setInviterRewardGbEmpty(true);
                          setCfg({ ...cfg, inviter_reward_gb: 0 });
                          return;
                        }
                        setInviterRewardGbEmpty(false);
                        setCfg({ ...cfg, inviter_reward_gb: Math.max(0, Math.floor(Number(v) || 0)) });
                      }}
                    />
                    <p className="field-hint">
                      Сколько гигабайт получит пользователь, который пригласил друга после активации реферальной ссылки.
                    </p>
                  </div>
                  <div className="form-field">
                    <label>Награда пригласившему: Дней</label>
                    <input
                      inputMode="numeric"
                      value={cfg.inviter_reward_days}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          setInviterRewardDaysEmpty(true);
                          setCfg({ ...cfg, inviter_reward_days: 0 });
                          return;
                        }
                        setInviterRewardDaysEmpty(false);
                        setCfg({ ...cfg, inviter_reward_days: Math.max(0, Math.floor(Number(v) || 0)) });
                      }}
                    />
                    <p className="field-hint">
                      Сколько дней подписки получит пользователь, который пригласил друга.
                    </p>
                  </div>

                  <div className="form-field">
                    <label>Скидка приглашенному, %</label>
                    <input
                      inputMode="numeric"
                      value={cfg.invited_discount_percent}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          setInvitedDiscountEmpty(true);
                          setCfg({ ...cfg, invited_discount_percent: 0 });
                          return;
                        }
                        setInvitedDiscountEmpty(false);
                        setCfg({
                          ...cfg,
                          invited_discount_percent: Math.min(100, Math.max(0, Math.floor(Number(v) || 0))),
                        });
                      }}
                    />
                    <p className="field-hint">Скидка применяется к первой покупке приглашенного пользователя.</p>
                  </div>

                  <div className="form-field form-field-span-2">
                    <label>Превью скидки</label>
                    {discounted.length === 0 ? (
                      <p className="sub referral-empty">Нет тарифов для расчета превью скидки.</p>
                    ) : (
                      <div className="referral-discount-cards">
                        {discounted.map((p) => (
                          <div key={p.id} className="referral-discount-card">
                            <div className="referral-discount-card-title">{p.title}</div>
                            <div className="referral-discount-card-price">
                              <span className="referral-price-old">{p.oldPrice} ₽</span>
                              <span className="referral-price-arrow">→</span>
                              <span className="referral-price-new">{p.newPrice} ₽</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="form-field form-field-span-2">
                    <label>Текст приглашения</label>
                    <textarea
                      className="comms-textarea"
                      value={cfg.invite_copy_text}
                      onChange={(e) => setCfg({ ...cfg, invite_copy_text: e.target.value })}
                      placeholder="Я пользуюсь этим VPN, вот тебе скидка на первую покупку!"
                    />
                    <p className="field-hint">Этот текст пользователь сможет скопировать и отправить другу.</p>
                    <p className="field-hint">
                      Доступные переменные: {"{ref_link}"}, {"{discount}"}, {"{brand}"}
                    </p>
                  </div>

                  <div className="form-field form-field-span-2 referral-telegram-preview">
                    <label>Как это выглядит в Telegram</label>
                    <div className="referral-tg-mock">
                      <div className="referral-tg-mock-btn">Пригласи друга</div>
                      <div className="referral-tg-mock-msg">{invitePreview}</div>
                      <div className="referral-tg-mock-link">{meta?.sample_ref_link ?? "https://t.me/your_bot?start=ref_12345"}</div>
                      <p className="field-hint referral-tg-share-label">Пример сообщения для друга:</p>
                      <pre className="referral-tg-share">{sharePreview}</pre>
                    </div>
                  </div>

                  <div className="form-field form-field-span-2 referral-admin-gift-card">
                    <h2 className="referral-section-title">Ручное начисление подарка</h2>
                    <p className="field-hint">
                      Выберите пользователей и тип подарка. Начисление выполняется в фоне, каждому пользователю придет
                      сообщение в Telegram.
                    </p>
                    <div className="referral-admin-gift-grid">
                      <div className="form-field referral-admin-gift-users">
                        <label>Пользователи</label>
                        {giftUsers.length === 0 ? (
                          <p className="sub referral-empty">Нет доступных пользователей.</p>
                        ) : (
                          <button
                            type="button"
                            className="ghost referral-gift-pick-btn"
                            onClick={() => setGiftPickerOpen(true)}
                          >
                            {giftUserIds.length > 0 ? `Выбрано: ${giftUserIds.length}` : "Выбрать пользователей…"}
                          </button>
                        )}
                        {giftUserIds.length > 0 ? (
                          <div className="referral-gift-picked">
                            {giftUserIds.slice(0, 4).map((id) => {
                              const u = giftUsers.find((x) => x.id === id);
                              return (
                                <span key={id} className="referral-gift-picked-chip">
                                  {u ? subscriptionLabel(u) : `#${id}`}
                                </span>
                              );
                            })}
                            {giftUserIds.length > 4 ? (
                              <span className="referral-gift-picked-more">+{giftUserIds.length - 4}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="form-field">
                        <label>Тип подарка</label>
                        <select value={giftKind} onChange={(e) => setGiftKind(e.target.value === "days" ? "days" : "gb")}>
                          <option value="gb">Гигабайты (+ ГБ)</option>
                          <option value="days">Дни подписки (+ дни)</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label>Количество</label>
                        <input
                          inputMode="numeric"
                          value={giftAmount}
                          onChange={(e) => setGiftAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                        />
                      </div>
                      <div className="form-field form-field-span-2">
                        <label>Комментарий администратора (необязательно)</label>
                        <input
                          type="text"
                          value={giftComment}
                          onChange={(e) => setGiftComment(e.target.value)}
                          placeholder="Причина начисления"
                        />
                      </div>
                      <div className="form-field referral-admin-gift-action">
                        <button
                          type="button"
                          className="primary"
                          disabled={giftBusy || giftUserIds.length === 0}
                          onClick={() => setGiftConfirmOpen(true)}
                        >
                          {giftBusy ? (
                            <>
                              <Spinner /> Начисление…
                            </>
                          ) : (
                            "Начислить подарок"
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="referral-program-feed" aria-label="Журнал приглашений и наград">
                  <label className="referral-feed-label">Приглашения, награды и подарки</label>
                  <div className="referral-feed-toolbar">
                    <input
                      type="search"
                      className="referral-feed-search"
                      placeholder="Поиск по имени…"
                      value={eventSearch}
                      onChange={(e) => setEventSearch(e.target.value)}
                    />
                    <select
                      className="referral-feed-filter"
                      value={eventFilter}
                      onChange={(e) => setEventFilter(e.target.value as EventFilter)}
                      aria-label="Фильтр по типу"
                    >
                      <option value="all">Все</option>
                      <option value="invitations">Приглашения</option>
                      <option value="rewards">Награды</option>
                      <option value="gifts">Ручные подарки</option>
                      <option value="errors">Ошибки</option>
                    </select>
                  </div>
                  <div className="referral-feed-dates">
                    <input type="date" value={eventFrom} onChange={(e) => setEventFrom(e.target.value)} aria-label="С" />
                    <span>—</span>
                    <input type="date" value={eventTo} onChange={(e) => setEventTo(e.target.value)} aria-label="По" />
                    <button type="button" className="ghost" disabled={feedLoading} onClick={() => void refreshEvents()}>
                      {feedLoading ? <Spinner /> : "Обновить"}
                    </button>
                    <button type="button" className="ghost" onClick={exportEvents}>
                      Экспорт CSV
                    </button>
                    <button type="button" className="ghost" onClick={exportEventsXlsx}>
                      Экспорт XLSX
                    </button>
                  </div>
                  <div className="ref-ios-wheel" role="log">
                    <div className="ref-ios-wheel-mask" aria-hidden="true" />
                    <div className="ref-ios-wheel-scroll">
                      {feedLoading && events.length === 0 ? (
                        <p className="sub ref-ios-empty">
                          <Spinner /> Загрузка…
                        </p>
                      ) : events.length === 0 ? (
                        <p className="sub ref-ios-empty">Пока нет приглашений и подарков.</p>
                      ) : (
                        events.map((e, idx) => (
                          <article key={`${e.created_at}-${e.kind}-${idx}`} className="referral-event-card">
                            <div className="referral-event-row">
                              <span className="referral-event-k">Тип</span>
                              <span>{eventKindRu(e.kind)}</span>
                            </div>
                            {e.inviter_name || e.granted_by ? (
                              <div className="referral-event-row">
                                <span className="referral-event-k">
                                  {e.kind === "admin_gift" ? "Кто начислил" : "Кто пригласил"}
                                </span>
                                <span>{e.granted_by ?? e.inviter_name}</span>
                              </div>
                            ) : null}
                            {e.invitee_name || e.user_name ? (
                              <div className="referral-event-row">
                                <span className="referral-event-k">
                                  {e.kind === "admin_gift" ? "Кому" : "Кого пригласил"}
                                </span>
                                <span>{e.invitee_name ?? e.user_name}</span>
                              </div>
                            ) : null}
                            {e.reward_text ? (
                              <div className="referral-event-row">
                                <span className="referral-event-k">Награда</span>
                                <span>{e.reward_text}</span>
                              </div>
                            ) : null}
                            <div className="referral-event-row">
                              <span className="referral-event-k">Дата</span>
                              <span>
                                {e.created_at
                                  ? new Date(e.created_at).toLocaleString("ru-RU", {
                                      dateStyle: "short",
                                      timeStyle: "short",
                                    })
                                  : ""}
                              </span>
                            </div>
                            {e.status ? (
                              <div className="referral-event-row">
                                <span className="referral-event-k">Статус</span>
                                <span className={e.legacy || e.status_note ? "referral-event-muted" : ""}>
                                  {e.status}
                                  {e.status_note ? ` (${e.status_note})` : ""}
                                </span>
                              </div>
                            ) : null}
                            {e.admin_comment ? (
                              <div className="referral-event-row">
                                <span className="referral-event-k">Комментарий</span>
                                <span>{e.admin_comment}</span>
                              </div>
                            ) : null}
                            {e.telegram_sent === false ? (
                              <div className="referral-event-row">
                                <span className="referral-event-k">Telegram</span>
                                <span className="referral-event-err">не доставлено</span>
                              </div>
                            ) : null}
                          </article>
                        ))
                      )}
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          ) : null}
        </>
      )}

      {giftConfirmOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setGiftConfirmOpen(false)}>
          <div
            className="modal referral-gift-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gift-confirm-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="gift-confirm-title">Подтверждение</h2>
            <p>
              Вы собираетесь начислить подарок <b>{giftUserIds.length}</b> пользователям:
              <br />
              Тип: <b>{giftKindLabel}</b>
              <br />
              Количество: <b>{giftAmount}</b> {giftKind === "gb" ? "ГБ" : "дн."}
              {giftComment.trim() ? (
                <>
                  <br />
                  Комментарий: {giftComment.trim()}
                </>
              ) : null}
            </p>
            <p>Продолжить?</p>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setGiftConfirmOpen(false)}>
                Отмена
              </button>
              <button type="button" className="primary" disabled={giftBusy} onClick={() => void onGrantGiftConfirmed()}>
                Продолжить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <DualListPicker
        open={giftPickerOpen}
        title="Пользователи для подарка"
        leftLabel="Доступные"
        rightLabel="Выбранные"
        items={giftUserPickerItems}
        selectedIds={giftUserIds}
        requireSelection
        onClose={() => setGiftPickerOpen(false)}
        onSave={(ids) => {
          setGiftUserIds(ids);
          setGiftPickerOpen(false);
        }}
      />
    </DashboardLayout>
  );
}
