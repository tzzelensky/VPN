import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadRevenueReport,
  patchRevenueAmount,
  type RevenueReportDto,
  type RevenueReportRowDto,
} from "../api";
import PageLoadingState from "./PageLoadingState";
import Spinner from "./Spinner";
import { usePanelSettings } from "../panelSettingsContext";

function ymdMonthInTimezone(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date(ts))
    .slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map((x) => Number(x));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return month;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatWhen(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function channelLabel(channel: string): string {
  if (channel === "webapp") return "WebApp";
  if (channel === "admin") return "Админ";
  return "Бот";
}

function kindLabel(kind: string): string {
  if (kind === "topup") return "Докупка";
  if (kind === "test") return "Тест";
  if (kind === "combo") return "Комбо";
  return "Подписка";
}

function clientLabel(row: RevenueReportRowDto): string {
  const name = row.target_user_name?.trim();
  if (name) return name;
  return row.payer_name || "—";
}

export default function RevenueReportPanel() {
  const panel = usePanelSettings();
  const timeZone = panel.settings?.ui.timezone?.trim() || "Asia/Yekaterinburg";
  const currentMonth = useMemo(() => ymdMonthInTimezone(Date.now(), timeZone), [timeZone]);
  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState<RevenueReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftAmount, setDraftAmount] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadRevenueReport(m);
      setReport(data);
    } catch (e) {
      setError(String(e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(month);
  }, [month, refresh]);

  function startEdit(row: RevenueReportRowDto) {
    setEditingId(row.id);
    setDraftAmount(String(row.amount_rub));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftAmount("");
  }

  async function saveEdit(row: RevenueReportRowDto) {
    const amount = Math.round(Number(draftAmount.replace(",", ".")));
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Сумма должна быть числом ≥ 0");
      return;
    }
    setSavingId(row.id);
    setError(null);
    try {
      const res = await patchRevenueAmount(row.id, amount);
      setReport((prev) => {
        if (!prev) return prev;
        const rows = prev.rows.map((r) => (r.id === row.id ? { ...r, ...res.row } : r));
        const total_rub = rows.reduce((s, r) => s + Math.max(0, Math.round(r.amount_rub) || 0), 0);
        const by_channel = { chat: 0, webapp: 0, admin: 0 };
        for (const r of rows) {
          const a = Math.max(0, Math.round(r.amount_rub) || 0);
          if (r.channel === "webapp") by_channel.webapp += a;
          else if (r.channel === "admin") by_channel.admin += a;
          else by_channel.chat += a;
        }
        return { ...prev, rows, total_rub, count: rows.length, by_channel };
      });
      cancelEdit();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="panel pay-sess-panel">
      <div className="pay-sess-head">
        <div>
          <h2 className="pay-sess-title">Выручка за месяц</h2>
          <p className="pay-sess-sub">
            Подтверждённые оплаты и ручные продления админом. Клиенты с флагом «Не учитывать в выручке» скрыты.
          </p>
        </div>
        <div className="pay-sess-head-actions" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button type="button" className="btn secondary" onClick={() => setMonth((m) => shiftMonth(m, -1))} disabled={loading}>
            ←
          </button>
          <span style={{ minWidth: "9rem", textAlign: "center", fontWeight: 600, textTransform: "capitalize" }}>
            {formatMonthLabel(month)}
          </span>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={loading || month >= currentMonth}
          >
            →
          </button>
          {month !== currentMonth ? (
            <button type="button" className="btn secondary" onClick={() => setMonth(currentMonth)} disabled={loading}>
              Текущий
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="flash err">{error}</div> : null}

      {loading && !report ? (
        <PageLoadingState />
      ) : report ? (
        <>
          <div className="pay-sess-stats">
            <div className="pay-sess-stat pay-sess-stat--ok">
              <span>Сумма</span>
              <strong>{report.total_rub.toLocaleString("ru-RU")} ₽</strong>
            </div>
            <div className="pay-sess-stat">
              <span>Покупок</span>
              <strong>{report.count}</strong>
            </div>
            <div className="pay-sess-stat">
              <span>Бот</span>
              <strong>{report.by_channel.chat.toLocaleString("ru-RU")} ₽</strong>
            </div>
            <div className="pay-sess-stat">
              <span>WebApp</span>
              <strong>{report.by_channel.webapp.toLocaleString("ru-RU")} ₽</strong>
            </div>
            <div className="pay-sess-stat">
              <span>Админ</span>
              <strong>{report.by_channel.admin.toLocaleString("ru-RU")} ₽</strong>
            </div>
          </div>

          {report.rows.length === 0 ? (
            <p className="pay-sess-sub" style={{ marginTop: "1.25rem" }}>
              За этот месяц подтверждённых покупок нет.
            </p>
          ) : (
            <div className="table-wrap" style={{ marginTop: "1rem" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Клиент</th>
                    <th>Тип</th>
                    <th>Тариф</th>
                    <th>Источник</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => {
                    const editing = editingId === row.id;
                    return (
                      <tr key={row.id}>
                        <td>{formatWhen(row.completed_at || row.created_at, timeZone)}</td>
                        <td>{clientLabel(row)}</td>
                        <td>
                          <span className="pay-sess-kind">{kindLabel(row.kind)}</span>
                        </td>
                        <td>{row.plan_title || row.tariff_line || "—"}</td>
                        <td>
                          <span className={`pay-sess-badge pay-sess-badge--${row.channel === "admin" ? "pending_admin" : "confirmed"}`}>
                            {channelLabel(row.channel)}
                          </span>
                        </td>
                        <td>
                          {editing ? (
                            <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={draftAmount}
                                onChange={(e) => setDraftAmount(e.target.value)}
                                style={{ width: "5.5rem" }}
                                disabled={savingId === row.id}
                              />
                              <span>₽</span>
                              <button
                                type="button"
                                className="btn"
                                disabled={savingId === row.id}
                                onClick={() => void saveEdit(row)}
                              >
                                {savingId === row.id ? <Spinner /> : "OK"}
                              </button>
                              <button type="button" className="btn secondary" disabled={savingId === row.id} onClick={cancelEdit}>
                                Отмена
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ padding: "0.2rem 0.55rem" }}
                              onClick={() => startEdit(row)}
                              title="Изменить сумму"
                            >
                              {row.amount_rub.toLocaleString("ru-RU")} ₽
                              {row.amount_original_rub != null && row.amount_original_rub !== row.amount_rub
                                ? ` (было ${row.amount_original_rub.toLocaleString("ru-RU")})`
                                : ""}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {loading ? (
            <p className="pay-sess-sub" style={{ marginTop: "0.75rem" }}>
              Обновление…
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
