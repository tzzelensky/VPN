import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearPurchaseDiscountsForUser,
  deletePurchaseDiscount,
  listPurchaseDiscounts,
  type PurchaseDiscountSource,
  type PurchaseDiscountUserDto,
} from "../api";

const SOURCE_LABELS: Record<PurchaseDiscountSource, string> = {
  roulette: "Рулетка",
  daily_gift: "Ежедневный подарок",
  admin: "Админ",
};

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function discountSourceLabel(source: PurchaseDiscountSource, custom?: string): string {
  const base = SOURCE_LABELS[source] ?? source;
  return custom?.trim() ? `${base}: ${custom.trim()}` : base;
}

export default function PurchaseDiscountsTab() {
  const [data, setData] = useState<{ users: PurchaseDiscountUserDto[]; total_discounts: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const next = await listPurchaseDiscounts();
      setData(next);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const users = data?.users ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const id = String(u.tg_user_id);
      const name = String(u.user_name ?? "").toLowerCase();
      return id.includes(q) || name.includes(q);
    });
  }, [data, search]);

  async function handleClearUser(tgUserId: number) {
    if (!window.confirm(`Обнулить все скидки пользователя ${tgUserId}?`)) return;
    setBusyId(`user:${tgUserId}`);
    try {
      const res = await clearPurchaseDiscountsForUser(tgUserId);
      setMsg({ type: "ok", text: `Снято скидок: ${res.removed}` });
      await refresh();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteOne(id: string) {
    setBusyId(id);
    try {
      await deletePurchaseDiscount(id);
      setMsg({ type: "ok", text: "Скидка удалена." });
      await refresh();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusyId(null);
    }
  }

  const totalUsers = data?.users.length ?? 0;
  const totalDiscounts = data?.total_discounts ?? 0;

  return (
    <div className="purchase-discounts">
      {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}

      <div className="purchase-discounts__summary">
        <div className="purchase-discounts__stat">
          <span className="purchase-discounts__stat-value">{totalUsers}</span>
          <span className="purchase-discounts__stat-label">пользователей со скидками</span>
        </div>
        <div className="purchase-discounts__stat">
          <span className="purchase-discounts__stat-value">{totalDiscounts}</span>
          <span className="purchase-discounts__stat-label">скидок в очереди</span>
        </div>
      </div>

      <p className="field-hint purchase-discounts__hint">
        Скидки не суммируются — при оплате применяется самая старая в очереди. Источники: рулетка и ежедневный подарок.
      </p>

      <div className="purchase-discounts__toolbar">
        <input
          className="purchase-discounts__search"
          placeholder="Поиск по TG ID или имени…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="ghost" onClick={() => void refresh()} disabled={loading}>
          Обновить
        </button>
      </div>

      {loading ? <p className="field-hint">Загрузка…</p> : null}

      {!loading && filtered.length === 0 ? (
        <div className="purchase-discounts__empty">
          <span className="purchase-discounts__empty-icon" aria-hidden>
            🏷️
          </span>
          <p>Нет активных скидок в очереди</p>
        </div>
      ) : null}

      <div className="purchase-discounts__list">
        {filtered.map((user) => {
          const open = expanded[user.tg_user_id] ?? false;
          const busy = busyId === `user:${user.tg_user_id}`;
          return (
            <article key={user.tg_user_id} className={`purchase-discounts__card${open ? " purchase-discounts__card--open" : ""}`}>
              <div className="purchase-discounts__card-head">
                <button
                  type="button"
                  className="purchase-discounts__card-toggle"
                  onClick={() => setExpanded((prev) => ({ ...prev, [user.tg_user_id]: !open }))}
                >
                  <span className="purchase-discounts__user-id">TG {user.tg_user_id}</span>
                  {user.user_name ? <span className="purchase-discounts__user-name">{user.user_name}</span> : null}
                </button>
                <div className="purchase-discounts__card-badges">
                  <span className="purchase-discounts__badge purchase-discounts__badge--count">
                    {user.queue_count} в очереди
                  </span>
                  {user.next_percent != null ? (
                    <span className="purchase-discounts__badge purchase-discounts__badge--next">
                      Следующая: −{user.next_percent}%
                    </span>
                  ) : null}
                </div>
                <div className="purchase-discounts__card-actions">
                  <button
                    type="button"
                    className="ghost danger"
                    disabled={busy || Boolean(busyId)}
                    onClick={() => void handleClearUser(user.tg_user_id)}
                  >
                    Обнулить все
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setExpanded((prev) => ({ ...prev, [user.tg_user_id]: !open }))}
                  >
                    {open ? "Свернуть" : "Подробнее"}
                  </button>
                </div>
              </div>

              {open ? (
                <div className="purchase-discounts__queue">
                  <ol className="purchase-discounts__queue-list">
                    {user.discounts.map((d, idx) => (
                      <li key={d.id} className="purchase-discounts__queue-item">
                        <div className="purchase-discounts__queue-main">
                          <span className="purchase-discounts__queue-pos">{idx + 1}</span>
                          <div className="purchase-discounts__queue-text">
                            <strong>−{d.discount_percent}%</strong>
                            <span>{discountSourceLabel(d.source, d.source_label)}</span>
                            <span className="purchase-discounts__queue-date">{formatDate(d.created_at)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="ghost danger purchase-discounts__queue-remove"
                          disabled={busyId === d.id}
                          onClick={() => void handleDeleteOne(d.id)}
                        >
                          Удалить
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
