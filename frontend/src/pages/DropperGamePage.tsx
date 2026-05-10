import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import Spinner from "../components/Spinner";
import {
  grantDropperGameTickets,
  listUsers,
  loadDropperGameConfig,
  loadDropperGameReport,
  saveDropperGameConfig,
  type DropperAdminReportDto,
  type DropperGameConfigDto,
  type UserDto,
} from "../api";

export default function DropperGamePage({ onLogout }: { onLogout: () => void }) {
  const [cfg, setCfg] = useState<DropperGameConfigDto | null>(null);
  const [report, setReport] = useState<DropperAdminReportDto | null>(null);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [grantTickets, setGrantTickets] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [granting, setGranting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

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

  async function onSave() {
    if (!cfg) return;
    setSaving(true);
    setMsg(null);
    try {
      const next = await saveDropperGameConfig(cfg);
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
      await grantDropperGameTickets({ user_ids: ids, tickets: t });
      const r = await loadDropperGameReport();
      setReport(r);
      setMsg({ type: "ok", text: `Выдано по ${t} билет(ов) для ${ids.length} пользователей.` });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setGranting(false);
    }
  }

  const userOptions = useMemo(() => [...users].sort((a, b) => a.id - b.id), [users]);

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
        <h2 className="user-modal-section-title">Выдача билетов</h2>
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
        <button type="button" className="primary" disabled={granting} onClick={() => void onGrant()}>
          {granting ? "Выдача…" : "Выдать билеты на игру"}
        </button>
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
