import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearPaymentSessionsReport,
  loadPaymentSessionsReport,
  type PaymentSessionChatMessageDto,
  type PaymentSessionLogStatus,
  type PaymentSessionReportRowDto,
} from "../api";
import PageLoadingState from "./PageLoadingState";
import Spinner from "./Spinner";
import { usePanelSettings } from "../panelSettingsContext";

function ymdInTimezone(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function defaultDateRange(timeZone: string): { from: string; to: string } {
  const to = ymdInTimezone(Date.now(), timeZone);
  const [y, m, d] = to.split("-").map((x) => Number(x));
  const prev = Date.UTC(y, m - 1, d) - 6 * 86_400_000;
  const from = ymdInTimezone(prev, timeZone);
  return { from, to };
}

function statusLabel(status: PaymentSessionLogStatus): string {
  if (status === "awaiting_proof") return "Ждём чек";
  if (status === "pending_admin") return "На проверке";
  if (status === "confirmed") return "Успех";
  if (status === "rejected") return "Отказано";
  return "Отменено";
}

function formatMoney(row: PaymentSessionReportRowDto): string {
  if (row.amount_original_rub != null && row.amount_original_rub > row.amount_rub) {
    return `${row.amount_rub} ₽ (было ${row.amount_original_rub} ₽)`;
  }
  return `${row.amount_rub} ₽`;
}

function formatWhen(iso: string, timeZone: string): string {
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

function MessageBubble({ msg, timeZone }: { msg: PaymentSessionChatMessageDto; timeZone: string }) {
  return (
    <div className={`pay-sess-msg pay-sess-msg--${msg.direction}`}>
      <div className="pay-sess-msg-meta">
        <span>{msg.direction === "bot" ? "Бот" : "Пользователь"}</span>
        <time dateTime={msg.at}>{formatWhen(msg.at, timeZone)}</time>
      </div>
      <div className="pay-sess-msg-text">
        {msg.has_photo
          ? `📷 ${(msg.text || "Фото чека").replace(/^📷\s*/, "")}`
          : msg.text}
      </div>
    </div>
  );
}

export default function PaymentSessionsPanel() {
  const panel = usePanelSettings();
  const timeZone = panel.settings?.ui.timezone?.trim() || "Asia/Yekaterinburg";
  const defaults = useMemo(() => defaultDateRange(timeZone), [timeZone]);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [status, setStatus] = useState<string>("all");
  const [rows, setRows] = useState<PaymentSessionReportRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string>("");
  const [err, setErr] = useState("");
  const [clearBusy, setClearBusy] = useState(false);
  const [clearMsg, setClearMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await loadPaymentSessionsReport({ from, to, status });
      setRows(data.sessions ?? []);
    } catch (e) {
      setErr(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {
      awaiting_proof: 0,
      pending_admin: 0,
      confirmed: 0,
      rejected: 0,
      cancelled: 0,
    };
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  async function onClear() {
    const statusLabel =
      status === "all"
        ? "все записи"
        : status === "awaiting_proof"
          ? "«Ждём чек»"
          : status === "pending_admin"
            ? "«На проверке»"
            : status === "confirmed"
              ? "«Успех»"
              : status === "rejected"
                ? "«Отказано»"
                : "«Отменено»";
    const text =
      `Удалить из отчёта ${statusLabel} за период ${from} — ${to}?\n\n` +
      "Для записей «Ждём чек» и «На проверке» бот перестанет ждать фото чека у этих пользователей.";
    if (!window.confirm(text)) return;
    setClearBusy(true);
    setClearMsg(null);
    setErr("");
    try {
      const result = await clearPaymentSessionsReport({ from, to, status });
      setClearMsg({
        type: "ok",
        text:
          result.removed > 0
            ? `Удалено записей: ${result.removed}` +
              (result.bot_sessions_cancelled > 0
                ? `. Сброшено активных сессий в боте: ${result.bot_sessions_cancelled}.`
                : ".")
            : "Ничего не найдено по текущим фильтрам.",
      });
      setExpandedId("");
      await refresh();
    } catch (e) {
      setClearMsg({ type: "err", text: String(e) });
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <section className="panel pay-sess-panel">
      <div className="pay-sess-head">
        <div>
          <h2 className="pay-sess-title">Сессии оплаты</h2>
          <p className="sub pay-sess-sub">
            Журнал заявок из Telegram-бота и WebApp: от выбора тарифа до подтверждения или отказа администратором.
          </p>
        </div>
        <div className="pay-sess-head-actions">
          <button type="button" className="ghost" disabled={loading || clearBusy} onClick={() => void refresh()}>
            Обновить
          </button>
          <button
            type="button"
            className="ghost pay-sess-clear-btn"
            disabled={loading || clearBusy || rows.length === 0}
            onClick={() => void onClear()}
          >
            {clearBusy ? (
              <>
                <Spinner /> Очистка…
              </>
            ) : (
              "Очистить"
            )}
          </button>
        </div>
      </div>

      <div className="pay-sess-stats">
        <span className="pay-sess-stat">
          Ждём чек <strong>{stats.awaiting_proof}</strong>
        </span>
        <span className="pay-sess-stat">
          На проверке <strong>{stats.pending_admin}</strong>
        </span>
        <span className="pay-sess-stat pay-sess-stat--ok">
          Успех <strong>{stats.confirmed}</strong>
        </span>
        <span className="pay-sess-stat pay-sess-stat--bad">
          Отказано <strong>{stats.rejected}</strong>
        </span>
        <span className="pay-sess-stat pay-sess-stat--muted">
          Отменено <strong>{stats.cancelled}</strong>
        </span>
      </div>

      <div className="pay-sess-filters">
        <label className="pay-sess-filter">
          <span>С</span>
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="pay-sess-filter">
          <span>По</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="pay-sess-filter pay-sess-filter--grow">
          <span>Статус</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Все</option>
            <option value="awaiting_proof">Ждём чек</option>
            <option value="pending_admin">На проверке</option>
            <option value="confirmed">Успех</option>
            <option value="rejected">Отказано</option>
            <option value="cancelled">Отменено</option>
          </select>
        </label>
      </div>

      {err ? <div className="flash err">{err}</div> : null}
      {clearMsg ? <div className={`flash ${clearMsg.type === "ok" ? "ok" : "err"}`}>{clearMsg.text}</div> : null}

      {loading ? (
        <PageLoadingState />
      ) : rows.length === 0 ? (
        <p className="sub pay-sess-empty">За выбранный период сессий оплаты нет.</p>
      ) : (
        <div className="pay-sess-list">
          {rows.map((row) => {
            const open = expandedId === row.id;
            return (
              <article key={row.id} className={`pay-sess-card ${open ? "pay-sess-card--open" : ""}`}>
                <button
                  type="button"
                  className="pay-sess-card-toggle"
                  aria-expanded={open}
                  onClick={() => setExpandedId(open ? "" : row.id)}
                >
                  <div className="pay-sess-card-main">
                    <div className="pay-sess-card-top">
                      <span className={`pay-sess-badge pay-sess-badge--${row.status}`}>{statusLabel(row.status)}</span>
                      <span className="pay-sess-kind">{row.kind_label}</span>
                      <span className="pay-sess-channel">{row.channel === "webapp" ? "WebApp" : "Чат"}</span>
                    </div>
                    <div className="pay-sess-card-title">
                      <strong>{row.payer_name}</strong>
                      <span className="pay-sess-amount">{formatMoney(row)}</span>
                    </div>
                    <div className="pay-sess-card-meta">
                      <span>
                        {row.plan_title} · {row.tariff_line}
                      </span>
                      {row.target_user_name ? <span>Клиент: {row.target_user_name}</span> : null}
                      {row.new_subscription_name ? <span>Новая: {row.new_subscription_name}</span> : null}
                      {row.discount_label ? <span className="pay-sess-discount">{row.discount_label}</span> : null}
                    </div>
                  </div>
                  <div className="pay-sess-card-side">
                    <time dateTime={row.updated_at}>{formatWhen(row.updated_at, timeZone)}</time>
                    <span className="pay-sess-chevron" aria-hidden="true">
                      {open ? "▴" : "▾"}
                    </span>
                  </div>
                </button>

                {open ? (
                  <div className="pay-sess-card-body">
                    <div className="pay-sess-detail-grid">
                      <div>
                        <span className="pay-sess-detail-label">Создана</span>
                        <span>{formatWhen(row.created_at, timeZone)}</span>
                      </div>
                      {row.completed_at ? (
                        <div>
                          <span className="pay-sess-detail-label">Завершена</span>
                          <span>{formatWhen(row.completed_at, timeZone)}</span>
                        </div>
                      ) : null}
                      <div>
                        <span className="pay-sess-detail-label">ID сессии</span>
                        <code className="pay-sess-id">{row.id}</code>
                      </div>
                    </div>

                    <h3 className="pay-sess-msgs-title">Последние сообщения</h3>
                    {row.recent_messages.length === 0 ? (
                      <p className="sub pay-sess-msgs-empty">Сообщений пока нет.</p>
                    ) : (
                      <div className="pay-sess-msgs">
                        {row.recent_messages.map((msg, i) => (
                          <MessageBubble key={`${row.id}-${i}`} msg={msg} timeZone={timeZone} />
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
