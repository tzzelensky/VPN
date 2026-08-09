import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscriptionLabel } from "../subscriptionLabel";
import DashboardLayout from "../components/DashboardLayout";
import PanelTabs from "../components/PanelTabs";
import PageLoadingState from "../components/PageLoadingState";
import Spinner from "../components/Spinner";
import {
  getPrizeColor,
  prizePreviewLine,
  type PrizeDisplayInput,
} from "../roulettePrizeDisplay";
import {
  grantDropperGameTickets,
  listUsers,
  loadGameSettings,
  loadRouletteReport,
  loadRouletteStats,
  loadRouletteTicketPurchases,
  normalizeRouletteChances,
  rouletteTicketPurchasesExportCsvUrl,
  resetAllDropperGameTickets,
  saveGameSettings,
  saveRoulettePrizes,
  setDropperUserTicketsPool,
  testRouletteSpin,
  type GameSettingsDto,
  type RoulettePrizeAdminDto,
  type RouletteStatsDto,
  type RouletteTicketPurchaseRowDto,
  type RouletteTicketShopConfigDto,
  type UserDto,
  type WebAppActiveGame,
} from "../api";
import { usePanelTabParam } from "../lib/panelTabRoute";

const TICKETS_PAGE_SIZE = 12;
const ADMIN_TABS = ["roulette", "tickets", "reports"] as const;
type RouletteActiveGameUi = Extract<WebAppActiveGame, "none" | "roulette">;

export default function DropperGamePage({ onLogout }: { onLogout: () => void }) {
  const { tab: adminTab, setTab: setAdminTab } = usePanelTabParam("/roulette-game", ADMIN_TABS);
  const [gameSettings, setGameSettings] = useState<GameSettingsDto | null>(null);
  const [roulettePrizes, setRoulettePrizes] = useState<RoulettePrizeAdminDto[]>([]);
  const [rouletteStats, setRouletteStats] = useState<RouletteStatsDto | null>(null);
  const [rouletteReport, setRouletteReport] = useState<{ rows: import("../api").RouletteReportRowDto[]; total: number } | null>(null);
  const [rouletteReportUser, setRouletteReportUser] = useState("");
  const [rouletteReportPageSize, setRouletteReportPageSize] = useState(50);
  const [rouletteReportPage, setRouletteReportPage] = useState(1);
  const [rouletteReportLoading, setRouletteReportLoading] = useState(false);
  const [prizeSaving, setPrizeSaving] = useState(false);
  const [testSpinResult, setTestSpinResult] = useState<string | null>(null);
  const [ticketPurchases, setTicketPurchases] = useState<RouletteTicketPurchaseRowDto[]>([]);
  const [ticketShopSaving, setTicketShopSaving] = useState(false);
  const [ticketShopErrors, setTicketShopErrors] = useState<Partial<Record<keyof RouletteTicketShopConfigDto, string>>>({});
  const [purchaseFilterDateFrom, setPurchaseFilterDateFrom] = useState("");
  const [purchaseFilterDateTo, setPurchaseFilterDateTo] = useState("");
  const [purchaseFilterUser, setPurchaseFilterUser] = useState("");
  const [purchaseFilterPayment, setPurchaseFilterPayment] = useState("");
  const [purchaseFilterStatus, setPurchaseFilterStatus] = useState("");
  const [users, setUsers] = useState<UserDto[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [grantTickets, setGrantTickets] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [granting, setGranting] = useState(false);
  const [ticketsEditUserId, setTicketsEditUserId] = useState<number | null>(null);
  const [ticketsEditDraft, setTicketsEditDraft] = useState("");
  const [ticketsSaving, setTicketsSaving] = useState(false);
  const [resettingTickets, setResettingTickets] = useState(false);
  const [ticketsListSearch, setTicketsListSearch] = useState("");
  const [ticketsPage, setTicketsPage] = useState(1);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const dropperClearedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [u, gs, rs, tp] = await Promise.all([
        listUsers(),
        loadGameSettings(),
        loadRouletteStats(),
        loadRouletteTicketPurchases({ limit: "200" }),
      ]);
      setUsers(u);
      const active: RouletteActiveGameUi = gs.active_game === "roulette" ? "roulette" : "none";
      setGameSettings({ ...gs, active_game: active });
      setRoulettePrizes(gs.prizes ?? []);
      setRouletteStats(rs);
      setTicketPurchases(tp.rows);
      if (gs.active_game === "dropper" && !dropperClearedRef.current) {
        dropperClearedRef.current = true;
        try {
          const next = await saveGameSettings({ active_game: "none" });
          const cleared: RouletteActiveGameUi = next.active_game === "roulette" ? "roulette" : "none";
          setGameSettings({ ...next, active_game: cleared });
          setRoulettePrizes(next.prizes ?? []);
        } catch {
          /* local UI already shows none; user can save */
        }
      }
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ticketShop = gameSettings?.ticket_shop;

  function patchTicketShop(patch: Partial<RouletteTicketShopConfigDto>) {
    setGameSettings((prev) =>
      prev
        ? {
            ...prev,
            ticket_shop: { ...(prev.ticket_shop ?? defaultTicketShop()), ...patch },
          }
        : prev,
    );
    setTicketShopErrors({});
  }

  function defaultTicketShop(): RouletteTicketShopConfigDto {
    return {
      enabled: false,
      price_days_per_ticket: 1,
      price_gb_per_ticket: 5,
      min_tickets: 1,
      max_tickets: 10,
      allow_days: true,
      allow_gb: true,
      notify_telegram_on_purchase: false,
    };
  }

  function validateTicketShopLocal(cfg: RouletteTicketShopConfigDto): Partial<Record<keyof RouletteTicketShopConfigDto, string>> {
    const errors: Partial<Record<keyof RouletteTicketShopConfigDto, string>> = {};
    if (cfg.enabled) {
      if (!cfg.allow_days && !cfg.allow_gb) {
        errors.enabled = "Включите хотя бы один способ оплаты (дни или ГБ).";
      }
      if (cfg.allow_days && cfg.price_days_per_ticket <= 0) {
        errors.price_days_per_ticket = "Цена в днях должна быть больше 0.";
      }
      if (cfg.allow_gb && cfg.price_gb_per_ticket <= 0) {
        errors.price_gb_per_ticket = "Цена в ГБ должна быть больше 0.";
      }
    }
    if (cfg.max_tickets < cfg.min_tickets) {
      errors.max_tickets = "Максимум не может быть меньше минимума.";
    }
    return errors;
  }

  async function onSaveTicketShop() {
    if (!ticketShop) return;
    const errors = validateTicketShopLocal(ticketShop);
    if (Object.keys(errors).length > 0) {
      setTicketShopErrors(errors);
      setMsg({ type: "err", text: "Исправьте ошибки в настройках покупки билетов." });
      return;
    }
    setTicketShopSaving(true);
    setMsg(null);
    try {
      const next = await saveGameSettings({ ticket_shop: ticketShop });
      const cleared: RouletteActiveGameUi = next.active_game === "roulette" ? "roulette" : "none";
      setGameSettings({ ...next, active_game: cleared });
      setTicketShopErrors({});
      setMsg({ type: "ok", text: "Настройки покупки билетов сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setTicketShopSaving(false);
    }
  }

  const refreshRouletteReport = useCallback(async (page = 1) => {
    setRouletteReportLoading(true);
    try {
      const offset = (page - 1) * rouletteReportPageSize;
      const rr = await loadRouletteReport({
        limit: String(rouletteReportPageSize),
        offset: String(offset),
        ...(rouletteReportUser.trim() ? { user_query: rouletteReportUser.trim() } : {}),
      });
      setRouletteReport(rr);
      setRouletteReportPage(page);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setRouletteReportLoading(false);
    }
  }, [rouletteReportPageSize, rouletteReportUser]);

  useEffect(() => {
    if (adminTab === "reports") void refreshRouletteReport(1);
  }, [adminTab, rouletteReportPageSize, refreshRouletteReport]);

  const rouletteReportPagesCount = Math.max(1, Math.ceil((rouletteReport?.total ?? 0) / rouletteReportPageSize));
  const rouletteReportPageNumbers = useMemo(() => {
    const start = Math.max(1, rouletteReportPage - 2);
    const end = Math.min(rouletteReportPagesCount, start + 4);
    const normalizedStart = Math.max(1, end - 4);
    return Array.from({ length: end - normalizedStart + 1 }, (_, i) => normalizedStart + i);
  }, [rouletteReportPagesCount, rouletteReportPage]);

  async function refreshTicketPurchases() {
    const params: Record<string, string> = { limit: "500" };
    if (purchaseFilterDateFrom) params.date_from = purchaseFilterDateFrom;
    if (purchaseFilterDateTo) params.date_to = purchaseFilterDateTo;
    if (purchaseFilterUser.trim()) params.user_id = purchaseFilterUser.trim();
    if (purchaseFilterPayment) params.payment_type = purchaseFilterPayment;
    if (purchaseFilterStatus) params.status = purchaseFilterStatus;
    const tp = await loadRouletteTicketPurchases(params);
    setTicketPurchases(tp.rows);
  }

  /** Primary Save on roulette tab: game settings + ticket shop + prizes. */
  async function onSaveRouletteTab() {
    if (!gameSettings) return;
    if (ticketShop) {
      const errors = validateTicketShopLocal(ticketShop);
      if (Object.keys(errors).length > 0) {
        setTicketShopErrors(errors);
        setMsg({ type: "err", text: "Исправьте ошибки в настройках покупки билетов." });
        return;
      }
    }
    setSaving(true);
    setPrizeSaving(true);
    setMsg(null);
    try {
      const active: RouletteActiveGameUi = gameSettings.active_game === "roulette" ? "roulette" : "none";
      const next = await saveGameSettings({
        active_game: active,
        tickets_per_purchase: gameSettings.tickets_per_purchase,
        ...(ticketShop ? { ticket_shop: ticketShop } : {}),
      });
      const saved = await saveRoulettePrizes(roulettePrizes);
      const cleared: RouletteActiveGameUi = next.active_game === "roulette" ? "roulette" : "none";
      setGameSettings({ ...next, active_game: cleared, prizes: saved.prizes, chance_sum: saved.chance_sum });
      setRoulettePrizes(saved.prizes);
      setTicketShopErrors({});
      setMsg({ type: "ok", text: "Настройки рулетки и призы сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
      setPrizeSaving(false);
    }
  }

  async function onNormalizeChances() {
    try {
      const saved = await normalizeRouletteChances();
      setRoulettePrizes(saved.prizes);
      setGameSettings((prev) => (prev ? { ...prev, prizes: saved.prizes, chance_sum: saved.chance_sum } : prev));
      setMsg({ type: "ok", text: "Шансы нормализованы до 100%." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    }
  }

  async function onTestSpin() {
    setTestSpinResult(null);
    try {
      const r = await testRouletteSpin();
      setTestSpinResult(r.prize?.title ?? "—");
    } catch (e) {
      setTestSpinResult(String(e));
    }
  }

  async function onGrant() {
    const ids = [...new Set(selectedUserIds.filter((n) => n > 0))];
    const t = Math.max(0, Math.floor(grantTickets));
    if (!ids.length) {
      setMsg({ type: "err", text: "Выберите хотя бы одного пользователя." });
      return;
    }
    if (t <= 0) {
      setMsg({ type: "err", text: "Укажите число билетов больше нуля." });
      return;
    }
    setGranting(true);
    setMsg(null);
    try {
      const gr = await grantDropperGameTickets({ user_ids: ids, tickets: t });
      const u = await listUsers();
      setUsers(u);
      setMsg({
        type: "ok",
        text: `Начислено по ${gr.tickets_each} билет(ов) каждой из ${gr.unique_pools} подписок (отмечено строк: ${gr.selected_rows}).`,
      });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setGranting(false);
    }
  }

  const userOptions = useMemo(() => [...users].sort((a, b) => a.id - b.id), [users]);

  const filteredTicketRows = useMemo(() => {
    const q = ticketsListSearch.trim().toLowerCase();
    if (!q) return userOptions;
    return userOptions.filter(
      (u) =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.tg_id || "").toLowerCase().includes(q),
    );
  }, [userOptions, ticketsListSearch]);

  const ticketPagesCount = Math.max(1, Math.ceil(filteredTicketRows.length / TICKETS_PAGE_SIZE));
  const pagedTicketRows = useMemo(() => {
    const start = (ticketsPage - 1) * TICKETS_PAGE_SIZE;
    return filteredTicketRows.slice(start, start + TICKETS_PAGE_SIZE);
  }, [filteredTicketRows, ticketsPage]);
  const ticketPageNumbers = useMemo(() => {
    const start = Math.max(1, ticketsPage - 2);
    const end = Math.min(ticketPagesCount, start + 4);
    const normalizedStart = Math.max(1, end - 4);
    return Array.from({ length: end - normalizedStart + 1 }, (_, i) => normalizedStart + i);
  }, [ticketPagesCount, ticketsPage]);

  useEffect(() => {
    setTicketsPage(1);
  }, [ticketsListSearch]);

  useEffect(() => {
    setTicketsPage((prev) => Math.min(prev, ticketPagesCount));
  }, [ticketPagesCount]);

  async function saveEditedTickets(userId: number) {
    const n = Math.max(0, Math.floor(Number(ticketsEditDraft) || 0));
    setTicketsSaving(true);
    setMsg(null);
    try {
      await setDropperUserTicketsPool({ user_id: userId, tickets: n });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, dropper_tickets: n } : u)));
      const u = await listUsers();
      setUsers(u);
      setTicketsEditUserId(null);
      setTicketsEditDraft("");
      setMsg({ type: "ok", text: "Билеты сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setTicketsSaving(false);
    }
  }

  async function onResetAllTickets() {
    if (!window.confirm("Обнулить билеты рулетки у всех клиентов? Это действие нельзя отменить.")) {
      return;
    }
    setResettingTickets(true);
    setMsg(null);
    try {
      await resetAllDropperGameTickets();
      const u = await listUsers();
      setUsers(u);
      setMsg({ type: "ok", text: "Билеты у всех пользователей обнулены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setResettingTickets(false);
    }
  }

  if (loading || !gameSettings) {
    return (
      <DashboardLayout onLogout={onLogout}>
        <section className="panel">
          <PageLoadingState />
        </section>
      </DashboardLayout>
    );
  }

  const activeGame: RouletteActiveGameUi = gameSettings.active_game === "roulette" ? "roulette" : "none";
  const chanceSum = gameSettings.chance_sum ?? roulettePrizes.filter((p) => p.active && !p.archived).reduce((s, p) => s + p.chance_percent, 0);

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <div className="users-hero-top">
          <div>
            <h1>Рулетка</h1>
            <p className="sub users-hero-sub">Настройки рулетки, билеты и отчёты в WebApp.</p>
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={loading || saving} onClick={() => void refresh()}>
              Обновить
            </button>
            {adminTab === "roulette" ? (
              <button
                type="button"
                className="primary"
                disabled={saving || prizeSaving}
                onClick={() => void onSaveRouletteTab()}
              >
                {saving || prizeSaving ? (
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
        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
      </section>

      <PanelTabs
        tabs={[
          { id: "roulette", label: "Рулетка" },
          { id: "tickets", label: "Билеты" },
          { id: "reports", label: "Отчёты" },
        ]}
        value={adminTab}
        onChange={setAdminTab}
      />

      {adminTab === "roulette" ? (
      <section className="panel">
        <div className="referral-program-form user-form-grid" style={{ marginBottom: "1rem" }}>
          <div className="form-field form-field-span-2">
            <label>Игра в WebApp</label>
            <p className="field-hint">Включить или выключить рулетку в Mini App.</p>
            <div className="game-admin-segment">
              {(["none", "roulette"] as RouletteActiveGameUi[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={activeGame === g ? "primary" : "ghost"}
                  onClick={() => setGameSettings({ ...gameSettings, active_game: g })}
                >
                  {g === "none" ? "Выключено" : "Рулетка"}
                </button>
              ))}
            </div>
          </div>
          <div className="form-field form-field-span-2">
            <label>Выдавать билетов за покупку</label>
            <input
              inputMode="numeric"
              value={gameSettings.tickets_per_purchase}
              onChange={(e) =>
                setGameSettings({
                  ...gameSettings,
                  tickets_per_purchase: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                })
              }
            />
            <p className="field-hint">1 билет = 1 прокрут рулетки.</p>
          </div>
        </div>

        <h2 className="user-modal-section-title">Рулетка</h2>
        <p className="field-hint">
          {activeGame === "roulette"
            ? "Рулетка активна в WebApp."
            : "Рулетка выключена. В Mini App пользователи её не видят."}
        </p>
        <div className="roulette-ui-mode" style={{ marginTop: "0.85rem" }}>
          <label className="roulette-ui-mode__title">Отображение открытия кейса</label>
          <div className="roulette-ui-mode__switch" role="radiogroup" aria-label="Отображение открытия кейса">
            {(
              [
                {
                  id: "wheel" as const,
                  title: "Колесо",
                  desc: "Классическая круговая рулетка",
                  icon: "🎡",
                },
                {
                  id: "case" as const,
                  title: "Кейс",
                  desc: "Горизонтальная лента, как в CS",
                  icon: "📦",
                },
              ] as const
            ).map((opt) => {
              const active = (gameSettings.ui_mode ?? "wheel") === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`roulette-ui-mode__option ${active ? "is-active" : ""}`}
                  disabled={saving}
                  onClick={() => {
                    if (active) return;
                    setGameSettings({ ...gameSettings, ui_mode: opt.id });
                    void (async () => {
                      setSaving(true);
                      setMsg(null);
                      try {
                        const next = await saveGameSettings({ ui_mode: opt.id });
                        const cleared: RouletteActiveGameUi = next.active_game === "roulette" ? "roulette" : "none";
                        setGameSettings({ ...next, active_game: cleared });
                        setRoulettePrizes(next.prizes ?? []);
                        setMsg({
                          type: "ok",
                          text: opt.id === "case" ? "Отображение: кейс." : "Отображение: колесо.",
                        });
                      } catch (e) {
                        setMsg({ type: "err", text: String(e) });
                      } finally {
                        setSaving(false);
                      }
                    })();
                  }}
                >
                  <span className="roulette-ui-mode__icon" aria-hidden>
                    {opt.icon}
                  </span>
                  <span className="roulette-ui-mode__text">
                    <span className="roulette-ui-mode__name">{opt.title}</span>
                    <span className="roulette-ui-mode__desc">{opt.desc}</span>
                  </span>
                  <span className={`roulette-ui-mode__check ${active ? "is-on" : ""}`} aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
        {Math.abs(chanceSum - 100) > 0.01 ? (
          <div className="flash err">
            Сумма шансов активных призов: {chanceSum.toFixed(1)}%. Для корректной работы должно быть 100%.
            <button type="button" className="ghost" style={{ marginLeft: "0.5rem" }} onClick={() => void onNormalizeChances()}>
              Нормализовать шансы
            </button>
          </div>
        ) : null}
        <div className="table-wrap admin-mobile-scroll-x" style={{ marginTop: "0.75rem" }}>
          <table className="dropper-tickets-admin-table">
            <thead>
              <tr>
                <th>Приз</th>
                <th>Preview</th>
                <th>Тип</th>
                <th>Знач.</th>
                <th>Шанс %</th>
                <th>Активен</th>
                <th>Иконка</th>
                <th>Цвет</th>
              </tr>
            </thead>
            <tbody>
              {roulettePrizes.filter((p) => !p.archived).map((p) => {
                const display: PrizeDisplayInput = {
                  type: p.type,
                  value: p.value,
                  title: p.title,
                  icon: p.icon,
                  color: p.color,
                  chance_percent: p.chance_percent,
                };
                return (
                <tr key={p.id}>
                  <td>
                    <input value={p.title} onChange={(e) => setRoulettePrizes((rows) => rows.map((x) => x.id === p.id ? { ...x, title: e.target.value } : x))} />
                  </td>
                  <td className="mono" title="Как в Mini App">
                    {prizePreviewLine(display)}
                  </td>
                  <td>{p.type}</td>
                  <td>
                    <input
                      style={{ width: "4rem" }}
                      inputMode="numeric"
                      value={p.value}
                      onChange={(e) => setRoulettePrizes((rows) => rows.map((x) => x.id === p.id ? { ...x, value: Math.floor(Number(e.target.value) || 0) } : x))}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: "4rem" }}
                      inputMode="decimal"
                      value={p.chance_percent}
                      onChange={(e) => setRoulettePrizes((rows) => rows.map((x) => x.id === p.id ? { ...x, chance_percent: Number(e.target.value) || 0 } : x))}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`toggle ${p.active ? "on" : ""}`}
                      aria-pressed={p.active}
                      onClick={() => setRoulettePrizes((rows) => rows.map((x) => x.id === p.id ? { ...x, active: !x.active } : x))}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: "3rem" }}
                      value={p.icon}
                      onChange={(e) => setRoulettePrizes((rows) => rows.map((x) => x.id === p.id ? { ...x, icon: e.target.value } : x))}
                      title="Пусто = иконка по типу"
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      value={getPrizeColor(display)}
                      onChange={(e) => setRoulettePrizes((rows) => rows.map((x) => x.id === p.id ? { ...x, color: e.target.value } : x))}
                    />
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        <div className="users-hero-actions" style={{ marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="ghost" onClick={() => void onNormalizeChances()}>Нормализовать шансы</button>
          <button type="button" className="ghost" onClick={() => void onTestSpin()}>Тестовый прокрут</button>
          {testSpinResult ? <span className="field-hint">Тест: {testSpinResult}</span> : null}
        </div>
        {rouletteStats ? (
          <ul style={{ marginTop: "1rem", paddingLeft: "1.2rem", lineHeight: 1.6 }}>
            <li>Всего прокрутов: {rouletteStats.total_spins}</li>
            <li>Сегодня: {rouletteStats.spins_today}</li>
            <li>Выдано дней: {rouletteStats.subscription_days_given}</li>
            <li>Выдано ГБ: {rouletteStats.traffic_gb_given}</li>
            <li>Улучшений тарифа: {rouletteStats.tariff_upgrades}</li>
            <li>Частый приз: {rouletteStats.top_prize}</li>
          </ul>
        ) : null}

        <div className="panel" style={{ marginTop: "1.25rem", padding: "1rem" }}>
          <h3 className="user-modal-section-title">Покупка билетов за ресурсы подписки</h3>
          <p className="field-hint">Покупка билетов за дни подписки или ГБ трафика.</p>
          {ticketShop ? (
            <div className="form-grid" style={{ marginTop: "0.75rem" }}>
              <div className="form-field">
                <label>Включить покупку билетов за дни/ГБ</label>
                <button
                  type="button"
                  className={`toggle ${ticketShop.enabled ? "on" : ""}`}
                  aria-pressed={ticketShop.enabled}
                  onClick={() => patchTicketShop({ enabled: !ticketShop.enabled })}
                />
                {ticketShopErrors.enabled ? <span className="field-hint promo-field-error">{ticketShopErrors.enabled}</span> : null}
              </div>
              <div className="form-field">
                <label htmlFor="rts-price-days">Цена 1 билета в днях подписки</label>
                <input
                  id="rts-price-days"
                  type="number"
                  min={1}
                  value={ticketShop.price_days_per_ticket}
                  onChange={(e) => patchTicketShop({ price_days_per_ticket: Math.floor(Number(e.target.value) || 0) })}
                />
                {ticketShopErrors.price_days_per_ticket ? (
                  <span className="field-hint promo-field-error">{ticketShopErrors.price_days_per_ticket}</span>
                ) : null}
              </div>
              <div className="form-field">
                <label htmlFor="rts-price-gb">Цена 1 билета в ГБ</label>
                <input
                  id="rts-price-gb"
                  type="number"
                  min={1}
                  value={ticketShop.price_gb_per_ticket}
                  onChange={(e) => patchTicketShop({ price_gb_per_ticket: Math.floor(Number(e.target.value) || 0) })}
                />
                {ticketShopErrors.price_gb_per_ticket ? (
                  <span className="field-hint promo-field-error">{ticketShopErrors.price_gb_per_ticket}</span>
                ) : null}
              </div>
              <div className="form-field">
                <label htmlFor="rts-min">Минимальное количество билетов</label>
                <input
                  id="rts-min"
                  type="number"
                  min={1}
                  value={ticketShop.min_tickets}
                  onChange={(e) => patchTicketShop({ min_tickets: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                />
              </div>
              <div className="form-field">
                <label htmlFor="rts-max">Максимальное количество за покупку</label>
                <input
                  id="rts-max"
                  type="number"
                  min={1}
                  value={ticketShop.max_tickets}
                  onChange={(e) => patchTicketShop({ max_tickets: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                />
                {ticketShopErrors.max_tickets ? <span className="field-hint promo-field-error">{ticketShopErrors.max_tickets}</span> : null}
              </div>
              <div className="form-field">
                <label>Разрешить покупку за дни</label>
                <button
                  type="button"
                  className={`toggle ${ticketShop.allow_days ? "on" : ""}`}
                  aria-pressed={ticketShop.allow_days}
                  onClick={() => patchTicketShop({ allow_days: !ticketShop.allow_days })}
                />
              </div>
              <div className="form-field">
                <label>Разрешить покупку за ГБ</label>
                <button
                  type="button"
                  className={`toggle ${ticketShop.allow_gb ? "on" : ""}`}
                  aria-pressed={ticketShop.allow_gb}
                  onClick={() => patchTicketShop({ allow_gb: !ticketShop.allow_gb })}
                />
              </div>
              <div className="form-field">
                <label>Отправлять сообщение в Telegram после покупки</label>
                <button
                  type="button"
                  className={`toggle ${ticketShop.notify_telegram_on_purchase ? "on" : ""}`}
                  aria-pressed={ticketShop.notify_telegram_on_purchase}
                  onClick={() => patchTicketShop({ notify_telegram_on_purchase: !ticketShop.notify_telegram_on_purchase })}
                />
              </div>
            </div>
          ) : null}
          <div className="users-hero-actions" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="primary" disabled={ticketShopSaving} onClick={() => void onSaveTicketShop()}>
              {ticketShopSaving ? <Spinner /> : null}
              Сохранить настройки покупки
            </button>
          </div>
        </div>

        <div className="panel" style={{ marginTop: "1.25rem", padding: "1rem" }}>
          <h3 className="user-modal-section-title">Покупки билетов</h3>
          <div className="form-grid" style={{ marginBottom: "0.75rem" }}>
            <div className="form-field">
              <label htmlFor="tp-from">Дата с</label>
              <input id="tp-from" type="date" value={purchaseFilterDateFrom} onChange={(e) => setPurchaseFilterDateFrom(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="tp-to">Дата по</label>
              <input id="tp-to" type="date" value={purchaseFilterDateTo} onChange={(e) => setPurchaseFilterDateTo(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="tp-user">Telegram ID</label>
              <input id="tp-user" value={purchaseFilterUser} onChange={(e) => setPurchaseFilterUser(e.target.value)} placeholder="123456789" />
            </div>
            <div className="form-field">
              <label htmlFor="tp-payment">Способ оплаты</label>
              <select id="tp-payment" value={purchaseFilterPayment} onChange={(e) => setPurchaseFilterPayment(e.target.value)}>
                <option value="">Все</option>
                <option value="subscription_days">Дни</option>
                <option value="traffic_gb">ГБ</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="tp-status">Статус</label>
              <select id="tp-status" value={purchaseFilterStatus} onChange={(e) => setPurchaseFilterStatus(e.target.value)}>
                <option value="">Все</option>
                <option value="success">Успех</option>
                <option value="failed">Ошибка</option>
              </select>
            </div>
          </div>
          <div className="users-hero-actions" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" className="ghost" onClick={() => void refreshTicketPurchases()}>
              Применить фильтры
            </button>
            <a
              className="ghost"
              href={rouletteTicketPurchasesExportCsvUrl({
                ...(purchaseFilterDateFrom ? { date_from: purchaseFilterDateFrom } : {}),
                ...(purchaseFilterDateTo ? { date_to: purchaseFilterDateTo } : {}),
                ...(purchaseFilterUser.trim() ? { user_id: purchaseFilterUser.trim() } : {}),
                ...(purchaseFilterPayment ? { payment_type: purchaseFilterPayment } : {}),
                ...(purchaseFilterStatus ? { status: purchaseFilterStatus } : {}),
              })}
              download
            >
              Экспорт CSV
            </a>
          </div>
          <div className="table-wrap admin-mobile-scroll-x">
            <table className="dropper-tickets-admin-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Telegram</th>
                  <th>Дата</th>
                  <th>Билетов</th>
                  <th>Оплата</th>
                  <th>Списано</th>
                  <th>Статус</th>
                  <th>Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {ticketPurchases.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="field-hint">
                      Покупок пока нет.
                    </td>
                  </tr>
                ) : (
                  ticketPurchases.slice(0, 100).map((r) => (
                    <tr key={r.id}>
                      <td>{r.user_name}</td>
                      <td className="mono">{r.tg_username}</td>
                      <td>{new Date(r.created_at).toLocaleString("ru-RU")}</td>
                      <td>{r.tickets_amount}</td>
                      <td>{r.payment_type === "subscription_days" ? "Дни" : "ГБ"}</td>
                      <td>{r.spent_amount}</td>
                      <td>{r.status === "success" ? "Успех" : "Ошибка"}</td>
                      <td className="mono">{r.error_message ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      ) : null}

      {adminTab === "tickets" ? (
      <>
      <section className="panel">
        <h2 className="user-modal-section-title">Билеты по клиентам</h2>
        <p className="field-hint" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
          У каждой подписки свой счётчик билетов.
        </p>
        <div className="form-field" style={{ marginBottom: "0.65rem" }}>
          <label htmlFor="dropper-tickets-search">Поиск по имени клиента</label>
          <input
            id="dropper-tickets-search"
            type="search"
            autoComplete="off"
            placeholder="Начните вводить имя…"
            value={ticketsListSearch}
            onChange={(e) => setTicketsListSearch(e.target.value)}
          />
        </div>
        <div className="dropper-tickets-toolbar">
          <span className="field-hint">
            Показано {filteredTicketRows.length === 0 ? 0 : (ticketsPage - 1) * TICKETS_PAGE_SIZE + 1}-
            {Math.min(filteredTicketRows.length, ticketsPage * TICKETS_PAGE_SIZE)} из {filteredTicketRows.length}
          </span>
        </div>
        <div className="table-wrap admin-mobile-scroll-x dropper-tickets-admin-scroll-wrap">
            <table className="dropper-tickets-admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Имя</th>
                <th>Telegram</th>
                <th>Билетов</th>
                <th>Побед</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredTicketRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dropper-tickets-admin-empty">
                    {ticketsListSearch.trim() ? "Никого не найдено." : "Нет клиентов."}
                  </td>
                </tr>
              ) : null}
              {pagedTicketRows.map((u) => {
                const tickets = u.dropper_tickets ?? 0;
                const editing = ticketsEditUserId === u.id;
                return (
                  <tr key={u.id}>
                    <td className="mono">{u.id}</td>
                    <td>{u.name}</td>
                    <td className="mono">{u.tg_id || "—"}</td>
                    <td>
                      {editing ? (
                        <div className="dropper-tickets-edit-row">
                          <input
                            className="dropper-tickets-edit-input"
                            inputMode="numeric"
                            autoFocus
                            disabled={ticketsSaving}
                            value={ticketsEditDraft}
                            onChange={(e) => setTicketsEditDraft(e.target.value.replace(/[^\d]/g, ""))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveEditedTickets(u.id);
                              if (e.key === "Escape") {
                                setTicketsEditUserId(null);
                                setTicketsEditDraft("");
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="ghost"
                            disabled={ticketsSaving}
                            onClick={() => void saveEditedTickets(u.id)}
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            disabled={ticketsSaving}
                            onClick={() => {
                              setTicketsEditUserId(null);
                              setTicketsEditDraft("");
                            }}
                          >
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <span className="mono">{tickets}</span>
                      )}
                    </td>
                    <td className="mono">{u.dropper_wins ?? 0}</td>
                    <td>
                      {!editing ? (
                        <button
                          type="button"
                          className="dropper-tickets-pencil"
                          title="Изменить количество билетов"
                          aria-label="Редактировать билеты"
                          onClick={() => {
                            setTicketsEditUserId(u.id);
                            setTicketsEditDraft(String(tickets));
                          }}
                        >
                          ✏️
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredTicketRows.length > TICKETS_PAGE_SIZE ? (
          <div className="dropper-tickets-pagination" aria-label="Листание списка клиентов">
            <button type="button" className="ghost" disabled={ticketsPage <= 1} onClick={() => setTicketsPage((p) => Math.max(1, p - 1))}>
              Назад
            </button>
            <div className="dropper-tickets-pagination-pages">
              {ticketPageNumbers.map((page) => (
                <button
                  key={page}
                  type="button"
                  className={page === ticketsPage ? "primary" : "ghost"}
                  onClick={() => setTicketsPage(page)}
                  aria-current={page === ticketsPage ? "page" : undefined}
                >
                  {page}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghost"
              disabled={ticketsPage >= ticketPagesCount}
              onClick={() => setTicketsPage((p) => Math.min(ticketPagesCount, p + 1))}
            >
              Вперёд
            </button>
          </div>
        ) : null}
      </section>
      <section className="panel">
        <h2 className="user-modal-section-title">Выдача билетов</h2>
        <p className="field-hint" style={{ marginTop: 0, marginBottom: "0.65rem" }}>
          Билеты начисляются отдельно на каждую отмеченную подписку.
        </p>
        <div className="form-field">
          <label>Пользователи (удерживайте Ctrl/Cmd для нескольких)</label>
          <div className="admin-mobile-scroll-y dropper-grant-users-wrap">
            <select
              multiple
              size={10}
              className="dropper-grant-users-select"
              value={selectedUserIds.map(String)}
              onChange={(e) => {
                const ids = Array.from(e.currentTarget.selectedOptions).map((o) => Number(o.value));
                setSelectedUserIds(ids.filter((n) => Number.isFinite(n) && n > 0));
              }}
            >
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {subscriptionLabel(u)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-field">
          <label>Количество билетов</label>
          <input
            inputMode="numeric"
            value={grantTickets}
            onChange={(e) => setGrantTickets(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
        </div>
        <div className="users-hero-actions" style={{ marginTop: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="primary" disabled={granting || resettingTickets} onClick={() => void onGrant()}>
            {granting ? "Выдача…" : "Выдать билеты"}
          </button>
          <button
            type="button"
            className="danger"
            disabled={granting || resettingTickets}
            onClick={() => void onResetAllTickets()}
          >
            {resettingTickets ? "Сброс…" : "Обнулить билеты"}
          </button>
        </div>
      </section>
      </>
      ) : null}

      {adminTab === "reports" ? (
      <section className="panel">
        <h2 className="user-modal-section-title">Отчёт — рулетка</h2>
        <div className="form-grid" style={{ marginBottom: "0.75rem" }}>
          <div className="form-field">
            <label htmlFor="rr-user">Пользователь</label>
            <input
              id="rr-user"
              type="search"
              autoComplete="off"
              placeholder="Имя, Telegram ID или @username"
              value={rouletteReportUser}
              onChange={(e) => setRouletteReportUser(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void refreshRouletteReport(1);
              }}
            />
          </div>
          <div className="form-field">
            <label htmlFor="rr-page-size">Строк на странице</label>
            <select
              id="rr-page-size"
              value={rouletteReportPageSize}
              onChange={(e) => setRouletteReportPageSize(Number(e.target.value) || 50)}
            >
              {[20, 50, 100, 150, 200, 300].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="users-hero-actions" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="ghost"
            disabled={rouletteReportLoading}
            onClick={() => void refreshRouletteReport(1)}
          >
            {rouletteReportLoading ? "Загрузка…" : "Применить фильтры"}
          </button>
        </div>
        {rouletteReportLoading && !rouletteReport ? (
          <p className="field-hint">Загрузка отчёта…</p>
        ) : rouletteReport && rouletteReport.total > 0 ? (
          <>
            <div className="dropper-tickets-toolbar">
              <span className="field-hint">
                Показано {(rouletteReportPage - 1) * rouletteReportPageSize + 1}-
                {Math.min(rouletteReport.total, rouletteReportPage * rouletteReportPageSize)} из {rouletteReport.total}
              </span>
            </div>
            <div className="table-wrap admin-mobile-scroll-x">
              <table className="dropper-tickets-admin-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Пользователь</th>
                    <th>Telegram</th>
                    <th>Приз</th>
                    <th>Статус</th>
                    <th>Ошибка</th>
                  </tr>
                </thead>
                <tbody>
                  {rouletteReport.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.created_at.slice(0, 16).replace("T", " ")}</td>
                      <td>{r.user_name}</td>
                      <td>{r.tg_username}</td>
                      <td>{r.prize_title}</td>
                      <td>{r.status}</td>
                      <td>{r.error_message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rouletteReportPagesCount > 1 ? (
              <div className="dropper-tickets-pagination" aria-label="Листание отчёта рулетки">
                <button
                  type="button"
                  className="ghost"
                  disabled={rouletteReportPage <= 1 || rouletteReportLoading}
                  onClick={() => void refreshRouletteReport(rouletteReportPage - 1)}
                >
                  Назад
                </button>
                <div className="dropper-tickets-pagination-pages">
                  {rouletteReportPageNumbers.map((page) => (
                    <button
                      key={page}
                      type="button"
                      className={page === rouletteReportPage ? "primary" : "ghost"}
                      disabled={rouletteReportLoading}
                      onClick={() => void refreshRouletteReport(page)}
                      aria-current={page === rouletteReportPage ? "page" : undefined}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="ghost"
                  disabled={rouletteReportPage >= rouletteReportPagesCount || rouletteReportLoading}
                  onClick={() => void refreshRouletteReport(rouletteReportPage + 1)}
                >
                  Вперёд
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="sub">Прокрутов пока нет.</p>
        )}
      </section>
      ) : null}
    </DashboardLayout>
  );
}
