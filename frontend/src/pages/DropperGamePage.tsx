import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import Spinner from "../components/Spinner";
import {
  grantDropperGameTickets,
  listUsers,
  loadDropperGameConfig,
  loadDropperGameReport,
  resetAllDropperGameTickets,
  saveDropperGameConfig,
  setDropperUserTicketsPool,
  type DropperAdminReportDto,
  type DropperGameConfigDto,
  type UserDto,
} from "../api";

function dropperPoolForRow(u: UserDto, all: UserDto[]): number {
  const tg = (u.tg_id || "").trim();
  if (!tg) return u.dropper_tickets ?? 0;
  return all.filter((x) => (x.tg_id || "").trim() === tg).reduce((s, x) => s + (x.dropper_tickets ?? 0), 0);
}

export default function DropperGamePage({ onLogout }: { onLogout: () => void }) {
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
      const [c, r, u] = await Promise.all([loadDropperGameConfig(), loadDropperGameReport(), listUsers()]);
      setCfg(c);
      setReport(r);
      setUsers(u);
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

  async function onSave() {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    try {
      const flightSec = clampFlightSec(flightDurDraft, cfg.flight_duration_sec);
      const speedMult = clampSpeedMult(Number(cfg.flight_speed_mult) || 1);
      setFlightDurDraft(String(flightSec));
      const next = await saveDropperGameConfig({ ...cfg, flight_duration_sec: flightSec, flight_speed_mult: speedMult });
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

  if (loading || !cfg) {
    return (
      <DashboardLayout onLogout={onLogout}>
        <section className="panel">
          <Spinner /> Загрузка…
        </section>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <div className="users-hero-top">
          <div>
            <h1>Игра «Дроппер»</h1>
            <p className="sub users-hero-sub">Мини-игра в WebApp: билеты, награды и отчёт.</p>
          </div>
          <div className="users-hero-actions">
            <button type="button" className="ghost" disabled={loading || saving} onClick={() => void refresh()}>
              Обновить
            </button>
            <button type="button" className="primary" disabled={saving} onClick={() => void onSave()}>
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
      </section>

      <section className="panel">
        <div className="referral-program-form user-form-grid">
          <div className="form-field form-field-span-2 shop-toggle-row">
            <div>
              <label>Игра в WebApp</label>
              <p className="field-hint" style={{ marginTop: "0.25rem" }}>
                Если выключено — вкладка «Игра» скрыта в мини-приложении.
              </p>
            </div>
            <button
              type="button"
              className={`toggle ${cfg.enabled ? "on" : ""}`}
              aria-pressed={cfg.enabled}
              onClick={() => setCfg({ ...cfg, enabled: !cfg.enabled })}
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
          <div className="form-field form-field-span-2">
            <label>Сколько билетов на игру выдавать за одну подтверждённую покупку</label>
            <input
              inputMode="numeric"
              value={cfg.tickets_per_purchase}
              onChange={(e) =>
                setCfg({ ...cfg, tickets_per_purchase: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
            />
            <p className="field-hint">Это значение используется ботом при подтверждении оплаты (WebApp / чек).</p>
          </div>
        </div>
      </section>

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
        <div className="dropper-tickets-admin-scroll-wrap">
          <div className="dropper-tickets-admin-scroll">
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
              {filteredTicketRows.map((u) => {
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
        </div>
      </section>

      <section className="panel">
        <h2 className="user-modal-section-title">Выдача билетов</h2>
        <p className="field-hint" style={{ marginTop: 0, marginBottom: "0.65rem" }}>
          Если в списке отмечены несколько подписок с одним и тем же Telegram, билеты начисляются один раз на общий пул,
          а не по разу на каждую строку.
        </p>
        <div className="form-field">
          <label>Пользователи (удерживайте Ctrl/Cmd для нескольких)</label>
          <select
            multiple
            size={10}
            value={selectedUserIds.map(String)}
            onChange={(e) => {
              const ids = Array.from(e.currentTarget.selectedOptions).map((o) => Number(o.value));
              setSelectedUserIds(ids.filter((n) => Number.isFinite(n) && n > 0));
            }}
          >
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                #{u.id} {u.name}
              </option>
            ))}
          </select>
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

      <section className="panel">
        <h2 className="user-modal-section-title">Отчёт</h2>
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
    </DashboardLayout>
  );
}
