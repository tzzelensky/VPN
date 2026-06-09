import { useCallback, useEffect, useMemo, useState } from "react";
import { subscriptionLabel } from "../subscriptionLabel";
import DashboardLayout from "../components/DashboardLayout";
import Spinner from "../components/Spinner";
import {
  getPrizeColor,
  prizePreviewLine,
  type PrizeDisplayInput,
} from "../roulettePrizeDisplay";
import {
  grantDropperGameTickets,
  listUsers,
  loadDropperGameConfig,
  loadDropperGameReport,
  loadGameSettings,
  loadRouletteReport,
  loadRouletteStats,
  loadRouletteTicketPurchases,
  normalizeRouletteChances,
  rouletteTicketPurchasesExportCsvUrl,
  resetAllDropperGameTickets,
  saveDropperGameConfig,
  saveGameSettings,
  saveRoulettePrizes,
  setDropperUserTicketsPool,
  testRouletteSpin,
  type DropperAdminReportDto,
  type DropperGameConfigDto,
  type GameSettingsDto,
  type RoulettePrizeAdminDto,
  type RouletteStatsDto,
  type RouletteTicketPurchaseRowDto,
  type RouletteTicketShopConfigDto,
  type UserDto,
  type WebAppActiveGame,
} from "../api";

function dropperPoolForRow(u: UserDto, all: UserDto[]): number {
  const tg = (u.tg_id || "").trim();
  if (!tg) return u.dropper_tickets ?? 0;
  return all.filter((x) => (x.tg_id || "").trim() === tg).reduce((s, x) => s + (x.dropper_tickets ?? 0), 0);
}

const TICKETS_PAGE_SIZE = 12;
type AdminTab = "general" | "dropper" | "roulette" | "tickets" | "reports";

export default function DropperGamePage({ onLogout }: { onLogout: () => void }) {
  const [adminTab, setAdminTab] = useState<AdminTab>("general");
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
  const [cfg, setCfg] = useState<DropperGameConfigDto | null>(null);
  const [report, setReport] = useState<DropperAdminReportDto | null>(null);
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
  const [flightDurDraft, setFlightDurDraft] = useState("");
  const [flightDurFocused, setFlightDurFocused] = useState(false);

  useEffect(() => {
    if (!flightDurFocused && cfg) setFlightDurDraft(String(cfg.flight_duration_sec));
  }, [cfg, flightDurFocused]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [c, r, u, gs, rs, tp] = await Promise.all([
        loadDropperGameConfig(),
        loadDropperGameReport(),
        listUsers(),
        loadGameSettings(),
        loadRouletteStats(),
        loadRouletteTicketPurchases({ limit: "200" }),
      ]);
      setCfg(c);
      setReport(r);
      setUsers(u);
      setGameSettings(gs);
      setRoulettePrizes(gs.prizes ?? []);
      setRouletteStats(rs);
      setTicketPurchases(tp.rows);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function clampFlightSec(raw: string, fallback: number): number {
    const n = Math.floor(Number(String(raw).replace(/[^\d]/g, "")) || fallback);
    return Math.max(15, Math.min(180, n));
  }

  function clampSpeedMult(n: number): number {
    return Math.max(0.25, Math.min(4, Math.round(n * 100) / 100));
  }

  async function onSaveGameSettings() {
    if (!gameSettings) return;
    setSaving(true);
    setMsg(null);
    try {
      const next = await saveGameSettings({
        active_game: gameSettings.active_game,
        tickets_per_purchase: gameSettings.tickets_per_purchase,
      });
      setGameSettings(next);
      setRoulettePrizes(next.prizes ?? []);
      const c = await loadDropperGameConfig();
      setCfg(c);
      setMsg({ type: "ok", text: "Настройки игр сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

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
      setGameSettings(next);
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

  async function onSaveRoulettePrizes() {
    setPrizeSaving(true);
    setMsg(null);
    try {
      const saved = await saveRoulettePrizes(roulettePrizes);
      setRoulettePrizes(saved.prizes);
      setGameSettings((prev) => (prev ? { ...prev, prizes: saved.prizes, chance_sum: saved.chance_sum } : prev));
      setMsg({ type: "ok", text: "Призы рулетки сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
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

  async function onSave() {
    if (!cfg || !gameSettings) return;
    setSaving(true);
    setMsg(null);
    try {
      const flightSec = clampFlightSec(flightDurDraft, cfg.flight_duration_sec);
      const speedMult = clampSpeedMult(Number(cfg.flight_speed_mult) || 1);
      setFlightDurDraft(String(flightSec));
      const game = gameSettings.active_game ?? (cfg.enabled ? "dropper" : "none");
      const next = await saveDropperGameConfig({
        ...cfg,
        enabled: game === "dropper",
        tickets_per_purchase: gameSettings.tickets_per_purchase,
        flight_duration_sec: flightSec,
        flight_speed_mult: speedMult,
      });
      setCfg(next);
      setMsg({ type: "ok", text: "Настройки игры сохранены." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setSaving(false);
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
      const r = await loadDropperGameReport();
      setReport(r);
      setMsg({
        type: "ok",
        text: `Начислено по ${gr.tickets_each} билет(ов) каждому из ${gr.unique_pools} получателей (отмечено строк: ${gr.selected_rows}). Один Telegram — одно начисление на общий пул.`,
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
    return userOptions.filter((u) => (u.name || "").toLowerCase().includes(q));
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

  async function saveEditedTickets(anchorUserId: number) {
    const n = Math.max(0, Math.floor(Number(ticketsEditDraft) || 0));
    setTicketsSaving(true);
    setMsg(null);
    try {
      await setDropperUserTicketsPool({ user_id: anchorUserId, tickets: n });
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
    if (
      !window.confirm(
        "Обнулить билеты «Дроппер» у всех клиентов? Это действие нельзя отменить.",
      )
    ) {
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

  if (loading || !cfg || !gameSettings) {
    return (
      <DashboardLayout onLogout={onLogout}>
        <section className="panel">
          <Spinner /> Загрузка…
        </section>
      </DashboardLayout>
    );
  }

  const activeGame = gameSettings?.active_game ?? (cfg?.enabled ? "dropper" : "none");
  const chanceSum = gameSettings?.chance_sum ?? roulettePrizes.filter((p) => p.active && !p.archived).reduce((s, p) => s + p.chance_percent, 0);

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <div className="users-hero-top">
          <div>
            <h1>Игра</h1>
            <p className="sub users-hero-sub">Дроппер, рулетка, билеты и отчёты в WebApp.</p>
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={loading || saving} onClick={() => void refresh()}>
              Обновить
            </button>
            <button type="button" className="primary" disabled={saving || prizeSaving} onClick={() => {
              if (adminTab === "general") void onSaveGameSettings();
              else if (adminTab === "roulette") void onSaveRoulettePrizes();
              else void onSave();
            }}>
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
        {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
        <div className="game-admin-tabs" role="tablist">
          {([
            ["general", "Общие"],
            ["dropper", "Дроппер"],
            ["roulette", "Рулетка"],
            ["tickets", "Билеты"],
            ["reports", "Отчёты"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={adminTab === id}
              className={adminTab === id ? "primary" : "ghost"}
              onClick={() => setAdminTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {adminTab === "general" && gameSettings ? (
      <section className="panel">
        <div className="referral-program-form user-form-grid">
          <div className="form-field form-field-span-2">
            <label>Игры в WebApp</label>
            <p className="field-hint">Можно включить только одну игру одновременно.</p>
            <div className="game-admin-segment">
              {(["none", "dropper", "roulette"] as WebAppActiveGame[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={activeGame === g ? "primary" : "ghost"}
                  onClick={() => setGameSettings({ ...gameSettings, active_game: g })}
                >
                  {g === "none" ? "Выключено" : g === "dropper" ? "Дроппер" : "Рулетка"}
                </button>
              ))}
            </div>
            <p className="field-hint" style={{ marginTop: "0.65rem" }}>
              Одновременно может работать только одна игра. При включении рулетки дроппер будет выключен.
            </p>
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
            <p className="field-hint">1 билет = 1 попытка в дроппере или 1 прокрут рулетки.</p>
          </div>
        </div>
      </section>
      ) : null}

      {adminTab === "dropper" && cfg ? (
      <section className="panel">
        <div className="referral-program-form user-form-grid">
          <div className="form-field form-field-span-2 shop-toggle-row">
            <div>
              <label>Дроппер включён</label>
              <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                {activeGame === "dropper" ? "Активная игра в WebApp." : "Включите «Дроппер» во вкладке «Общие»."}
              </p>
            </div>
            <button
              type="button"
              className={`toggle ${activeGame === "dropper" ? "on" : ""}`}
              aria-pressed={activeGame === "dropper"}
              disabled
            />
          </div>
          <div className="form-field form-field-span-2 shop-toggle-row">
            <div>
              <label>Смерть от удара о бок препятствия</label>
              <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                Если выключено, боковое касание платформы не убивает: персонаж скользит вдоль края. Падение сверху на
                препятствие по-прежнему считается проигрышем.
              </p>
            </div>
            <button
              type="button"
              className={`toggle ${cfg.side_hit_death_enabled ? "on" : ""}`}
              aria-pressed={cfg.side_hit_death_enabled}
              onClick={() => setCfg({ ...cfg, side_hit_death_enabled: !cfg.side_hit_death_enabled })}
            />
          </div>
          <div className="form-field form-field-span-2">
            <label>Базовая длительность полёта, сек (15–180), при множителе скорости 1</label>
            <input
              type="range"
              min={15}
              max={180}
              step={1}
              value={cfg.flight_duration_sec}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCfg({ ...cfg, flight_duration_sec: n });
                setFlightDurDraft(String(n));
              }}
              style={{ width: "100%", maxWidth: "420px", display: "block", marginTop: "0.35rem" }}
            />
            <input
              inputMode="numeric"
              aria-label="Точное значение секунд"
              value={flightDurDraft}
              onFocus={() => setFlightDurFocused(true)}
              onChange={(e) => setFlightDurDraft(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => {
                setFlightDurFocused(false);
                const n = clampFlightSec(flightDurDraft, cfg.flight_duration_sec);
                setCfg({ ...cfg, flight_duration_sec: n });
                setFlightDurDraft(String(n));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              style={{ marginTop: "0.5rem", maxWidth: "120px" }}
            />
            <p className="field-hint">
              Ползунок или ввод числа (15–180 при уходе с поля или по «Сохранить»). Это{" "}
              <strong>реальное время раунда</strong> до финиша по вертикали — не зависит от множителя ниже.
            </p>
          </div>
          <div className="form-field form-field-span-2">
            <label>
              Скорость падения (×{cfg.flight_speed_mult.toFixed(2).replace(/\.?0+$/, "")}) — 1 норма; меньше медленнее,
              больше быстрее
            </label>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={cfg.flight_speed_mult}
              onChange={(e) =>
                setCfg({ ...cfg, flight_speed_mult: clampSpeedMult(Number(e.target.value)) })
              }
              style={{ width: "100%", maxWidth: "420px", display: "block", marginTop: "0.35rem" }}
            />
            <input
              type="number"
              inputMode="decimal"
              min={0.25}
              max={4}
              step={0.05}
              value={cfg.flight_speed_mult}
              onChange={(e) => {
                const x = Number(e.target.value);
                if (!Number.isFinite(x)) return;
                setCfg({ ...cfg, flight_speed_mult: clampSpeedMult(x) });
              }}
              style={{ marginTop: "0.5rem", maxWidth: "120px" }}
            />
            <p className="field-hint">
              Ориентир: до финиша ≈{" "}
              <strong>
                {(cfg.flight_duration_sec / Math.max(0.25, cfg.flight_speed_mult)).toFixed(1)}
              </strong>{" "}
              с. Управление влево-вправо фиксированное; античит на сервере по этому времени.
            </p>
          </div>
          <div className="form-field">
            <label>Награда за победу, ГБ</label>
            <input
              inputMode="numeric"
              value={cfg.reward_gb}
              onChange={(e) => setCfg({ ...cfg, reward_gb: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
          </div>
          <div className="form-field">
            <label>Награда за победу, дней подписки</label>
            <input
              inputMode="numeric"
              value={cfg.reward_days}
              onChange={(e) => setCfg({ ...cfg, reward_days: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
          </div>
        </div>
      </section>
      ) : null}

      {adminTab === "roulette" ? (
      <section className="panel">
        <h2 className="user-modal-section-title">Рулетка</h2>
        <p className="field-hint">
          {activeGame === "roulette"
            ? "Рулетка активна в WebApp."
            : "Рулетка выключена. В Mini App пользователи её не видят."}
        </p>
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
          <p className="field-hint">Только для рулетки. Дроппер эту механику не использует.</p>
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
          Для одного Telegram несколько подписок — один общий счётчик билетов (сумма по записям) и одно число побед по
          этому Telegram. Редактирование задаёт общий пул билетов для всех таких подписок.
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
                const pool = dropperPoolForRow(u, users);
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
                        <span className="mono">{pool}</span>
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
                            setTicketsEditDraft(String(pool));
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
          Если в списке отмечены несколько подписок с одним и тем же Telegram, билеты начисляются один раз на общий пул,
          а не по разу на каждую строку.
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
            {granting ? "Выдача…" : "Выдать билеты на игру"}
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
      <>
      <section className="panel">
        <h2 className="user-modal-section-title">Отчёт — дроппер</h2>
        {report ? (
          <ul style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.6 }}>
            <li>Всего игр (записей): {report.total_plays}</li>
            <li>Побед: {report.total_wins}</li>
            <li>Поражений: {report.total_loses}</li>
            <li>Уникальных игроков: {report.unique_players}</li>
            <li>Уникальных победителей: {report.unique_winners}</li>
            <li>Выбрали подарок «ГБ»: {report.gifts_gb_choices}</li>
            <li>Выбрали подарок «дни»: {report.gifts_days_choices}</li>
          </ul>
        ) : (
          <p className="sub">Нет данных.</p>
        )}
      </section>
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
      </>
      ) : null}
    </DashboardLayout>
  );
}
