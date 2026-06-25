import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import PurchaseDiscountsTab from "../components/PurchaseDiscountsTab";
import ExpiryDateTimePicker from "../components/ExpiryDateTimePicker";
import {
  createPromoCode,
  duplicatePromoCode,
  deletePromoCode,
  getPromoCodeReport,
  listPromoCodeUsages,
  listPromoCodes,
  loadSubscriptionShop,
  patchPromoCode,
  promoCodeReportCsvUrl,
  promoCodeReportXlsxUrl,
  type PromoCodeDto,
  type PromoCodeUsageDto,
  type SubscriptionShopDto,
} from "../api";

function toExpiryIsoFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const base = new Date(ms);
  const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toISOString();
}

export default function PromoCodesPage({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<"promos" | "discounts">("promos");
  const [promos, setPromos] = useState<PromoCodeDto[]>([]);
  const [shop, setShop] = useState<SubscriptionShopDto | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [promoType, setPromoType] = useState<PromoCodeDto["type"]>("percent");
  const [discountPercent, setDiscountPercent] = useState(10);
  const [discountRub, setDiscountRub] = useState(100);
  const [giftGb, setGiftGb] = useState(15);
  const [giftDays, setGiftDays] = useState(7);
  const [oneTime, setOneTime] = useState(true);
  const [maxUsesTotal, setMaxUsesTotal] = useState("");
  const [maxUsesPerUser, setMaxUsesPerUser] = useState(1);
  const [minPurchaseRub, setMinPurchaseRub] = useState("");
  const [firstPurchaseOnly, setFirstPurchaseOnly] = useState(false);
  const [newUsersOnly, setNewUsersOnly] = useState(false);
  const [applyPlanIds, setApplyPlanIds] = useState<number[]>([]);
  const [adminNote, setAdminNote] = useState("");
  const [active, setActive] = useState(true);
  const [validUntilMs, setValidUntilMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [statsPromoId, setStatsPromoId] = useState<string | null>(null);
  const [statsById, setStatsById] = useState<Record<string, PromoCodeUsageDto[]>>({});
  const [statsLoadingId, setStatsLoadingId] = useState<string | null>(null);

  const [editPromoId, setEditPromoId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "expired" | "limit_reached">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | PromoCodeDto["type"]>("all");
  const [sortBy, setSortBy] = useState<"new" | "old" | "uses_desc" | "expiring_soon">("new");

  const [report, setReport] = useState<{
    promo: PromoCodeDto & {
      status: "active" | "inactive" | "expired" | "limit_reached";
      usages_count: number;
      unique_users_count: number;
      sum_discount_rub: number;
      sum_bonus_gb: number;
      sum_bonus_days: number;
    };
    usages: PromoCodeUsageDto[];
  } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  async function reload() {
    const [data, s] = await Promise.all([listPromoCodes(), loadSubscriptionShop()]);
    setPromos(data.promos);
    setShop(s);
  }

  useEffect(() => {
    void reload().catch((e) => setMsg({ type: "err", text: String(e) }));
  }, []);

  function clearForm() {
    setEditPromoId(null);
    setName("");
    setCode("");
    setPromoType("percent");
    setDiscountPercent(10);
    setDiscountRub(100);
    setGiftGb(15);
    setGiftDays(7);
    setOneTime(true);
    setMaxUsesTotal("");
    setMaxUsesPerUser(1);
    setMinPurchaseRub("");
    setFirstPurchaseOnly(false);
    setNewUsersOnly(false);
    setApplyPlanIds([]);
    setAdminNote("");
    setActive(true);
    setValidUntilMs(0);
    setErrors({});
  }

  function promoStatus(p: PromoCodeDto): "active" | "inactive" | "expired" | "limit_reached" {
    if (p.status) return p.status;
    if (!p.active) return "inactive";
    const now = Date.now();
    if (p.valid_until && Number.isFinite(Date.parse(p.valid_until)) && Date.parse(p.valid_until) < now) return "expired";
    if (p.max_uses_total && (p.usages_count ?? 0) >= p.max_uses_total) return "limit_reached";
    return "active";
  }

  function validateForm(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Название не может быть пустым.";
    const normalizedCode = code.trim().toLocaleUpperCase("ru-RU");
    if (!normalizedCode) next.code = "Код промокода обязателен.";
    if (!/^[\p{L}\p{N}_-]{3,40}$/u.test(normalizedCode)) {
      next.code = "Только буквы, цифры, _ и - без пробелов.";
    }
    const duplicate = promos.find((p) => p.code === normalizedCode && p.id !== editPromoId);
    if (duplicate) next.code = "Такой код уже существует.";
    if (promoType === "percent" && (discountPercent < 1 || discountPercent > 100)) next.discount_percent = "Скидка должна быть 1..100%.";
    if (promoType === "rub" && discountRub <= 0) next.discount_rub = "Сумма скидки должна быть больше 0.";
    if (promoType === "gb" && giftGb <= 0) next.gift_gb = "ГБ должны быть больше 0.";
    if (promoType === "days" && giftDays <= 0) next.gift_days = "Дни должны быть больше 0.";
    if (promoType === "combo" && discountPercent <= 0 && giftGb <= 0 && giftDays <= 0) next.combo = "Для комбинированного типа задайте хотя бы один бонус.";
    if (validUntilMs > 0 && validUntilMs < Date.now()) next.valid_until = "Дата окончания не может быть в прошлом.";
    if (maxUsesTotal.trim() && Number(maxUsesTotal) < 1) next.max_uses_total = "Лимит применений должен быть >= 1.";
    if (maxUsesPerUser < 1) next.max_uses_per_user = "Максимум на пользователя должен быть >= 1.";
    if (minPurchaseRub.trim() && Number(minPurchaseRub) < 0) next.min_purchase_rub = "Минимальная сумма не может быть отрицательной.";
    return next;
  }

  async function onSubmit() {
    setBusy(true);
    setMsg(null);
    const v = validateForm();
    setErrors(v);
    if (Object.keys(v).length > 0) {
      setBusy(false);
      return;
    }
    try {
      const payload = {
        name: name.trim(),
        code: code.trim().toLocaleUpperCase("ru-RU"),
        type: promoType,
        discount_percent: Math.max(0, Math.min(100, Math.floor(Number(discountPercent) || 0))),
        discount_rub: Math.max(0, Math.floor(Number(discountRub) || 0)),
        gift_gb: Math.max(0, Math.floor(Number(giftGb) || 0)),
        gift_days: Math.max(0, Math.floor(Number(giftDays) || 0)),
        one_time_per_user: oneTime,
        max_uses_total: maxUsesTotal.trim() ? Math.max(1, Math.floor(Number(maxUsesTotal) || 1)) : undefined,
        max_uses_per_user: Math.max(1, Math.floor(Number(maxUsesPerUser) || 1)),
        min_purchase_rub: minPurchaseRub.trim() ? Math.max(0, Math.floor(Number(minPurchaseRub) || 0)) : undefined,
        first_purchase_only: firstPurchaseOnly,
        new_users_only: newUsersOnly,
        apply_plan_ids: applyPlanIds,
        admin_note: adminNote.trim() || undefined,
        active,
        valid_until: toExpiryIsoFromMs(validUntilMs),
      };
      if (editPromoId) {
        await patchPromoCode(editPromoId, payload);
        setMsg({ type: "ok", text: "Промокод обновлен." });
      } else {
        await createPromoCode(payload);
        setMsg({ type: "ok", text: "Промокод создан." });
      }
      clearForm();
      await reload();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleStats(p: PromoCodeDto) {
    if (statsPromoId === p.id) {
      setStatsPromoId(null);
      return;
    }
    setStatsPromoId(p.id);
    if (statsById[p.id]) return;
    setStatsLoadingId(p.id);
    try {
      const data = await listPromoCodeUsages(p.id);
      setStatsById((prev) => ({ ...prev, [p.id]: data.usages }));
    } catch {
      setStatsById((prev) => ({ ...prev, [p.id]: [] }));
    } finally {
      setStatsLoadingId(null);
    }
  }

  async function openReport(p: PromoCodeDto) {
    setReportLoading(true);
    try {
      const data = await getPromoCodeReport(p.id);
      setReport(data);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setReportLoading(false);
    }
  }

  function openEdit(p: PromoCodeDto) {
    setEditPromoId(p.id);
    setName(p.name);
    setCode(p.code);
    setPromoType(p.type ?? "percent");
    setDiscountPercent(p.discount_percent ?? 0);
    setDiscountRub(p.discount_rub ?? 0);
    setGiftGb(p.gift_gb ?? 0);
    setGiftDays(p.gift_days ?? 0);
    setOneTime(p.one_time_per_user);
    setMaxUsesTotal(p.max_uses_total ? String(p.max_uses_total) : "");
    setMaxUsesPerUser(p.max_uses_per_user ?? 1);
    setMinPurchaseRub(p.min_purchase_rub ? String(p.min_purchase_rub) : "");
    setFirstPurchaseOnly(Boolean(p.first_purchase_only));
    setNewUsersOnly(Boolean(p.new_users_only));
    setApplyPlanIds(p.apply_plan_ids ?? []);
    setAdminNote(p.admin_note ?? "");
    setActive(p.active !== false);
    setValidUntilMs(Number.isFinite(Date.parse(p.valid_until)) ? Date.parse(p.valid_until) : 0);
  }

  async function onDuplicate(p: PromoCodeDto) {
    const codeNew = window.prompt("Введите код для копии промокода", `${p.code}_COPY`);
    if (!codeNew) return;
    setBusy(true);
    try {
      await duplicatePromoCode(p.id, { code: codeNew.toLocaleUpperCase("ru-RU") });
      setMsg({ type: "ok", text: "Промокод продублирован." });
      await reload();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePromo(p: PromoCodeDto) {
    const used = (p.usages_count ?? 0) > 0;
    const question = used
      ? `Удалить промокод ${p.code}? У промокода есть история применений. Лучше отключить. Продолжить удаление?`
      : `Удалить промокод ${p.code}?`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setMsg(null);
    try {
      await deletePromoCode(p.id);
      setStatsById((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      if (statsPromoId === p.id) setStatsPromoId(null);
      if (editPromoId === p.id) clearForm();
      setMsg({ type: "ok", text: "Промокод удален." });
      await reload();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  function generateCode() {
    const words = ["SALE", "VPN", "GIFT", "MAY", "JUNE", "BONUS"];
    const left = words[Math.floor(Math.random() * words.length)];
    const right = String(Math.floor(10 + Math.random() * 90));
    setCode(`${left}${right}`.toUpperCase());
  }

  const filteredPromos = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = promos.filter((p) => {
      if (q && !(`${p.name} ${p.code}`.toLowerCase().includes(q))) return false;
      if (statusFilter !== "all" && promoStatus(p) !== statusFilter) return false;
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sortBy === "old") return Date.parse(a.created_at) - Date.parse(b.created_at);
      if (sortBy === "uses_desc") return (b.usages_count ?? 0) - (a.usages_count ?? 0);
      if (sortBy === "expiring_soon") {
        const ta = a.valid_until ? Date.parse(a.valid_until) : Number.POSITIVE_INFINITY;
        const tb = b.valid_until ? Date.parse(b.valid_until) : Number.POSITIVE_INFINITY;
        return ta - tb;
      }
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
    return rows;
  }, [promos, search, statusFilter, typeFilter, sortBy]);

  const formTitle = editPromoId ? "Редактирование промокода" : "Создание промокода";
  const submitTitle = editPromoId ? "Сохранить изменения" : "Создать промокод";

  const discountPreview = useMemo(() => {
    if (!shop) return [];
    return shop.plans.map((p) => {
      const byPercent = Math.floor((p.price_rub * Math.max(0, discountPercent)) / 100);
      const byRub = Math.max(0, discountRub);
      const discount =
        promoType === "percent" ? byPercent : promoType === "rub" ? byRub : promoType === "combo" ? Math.max(byPercent, byRub) : 0;
      return {
        id: p.id,
        title: `Тариф ${p.total_gb <= 0 ? "Безлимит" : `${p.total_gb}ГБ`} / ${p.days} дней`,
        oldPrice: p.price_rub,
        newPrice: Math.max(0, p.price_rub - discount),
      };
    });
  }, [shop, promoType, discountPercent, discountRub]);

  return (
    <DashboardLayout onLogout={onLogout}>
      <section className="panel users-hero-panel">
        <h1>Промоакции</h1>
        <p className="sub users-hero-sub">Промокоды, очередь скидок из рулетки и ежедневного подарка.</p>
        <div className="survey-segmented promo-page-tabs" role="tablist" aria-label="Раздел промоакций">
          <button
            type="button"
            role="tab"
            className={`survey-segmented-btn${tab === "promos" ? " active" : ""}`}
            aria-selected={tab === "promos"}
            onClick={() => setTab("promos")}
          >
            Промокоды
          </button>
          <button
            type="button"
            role="tab"
            className={`survey-segmented-btn${tab === "discounts" ? " active" : ""}`}
            aria-selected={tab === "discounts"}
            onClick={() => setTab("discounts")}
          >
            Скидки
          </button>
        </div>
        {msg && tab === "promos" ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}
      </section>

      {tab === "discounts" ? (
        <section className="panel">
          <PurchaseDiscountsTab />
        </section>
      ) : (
        <>
      <section className="panel">
        <div className="promos-layout">
          <div className="promos-create">
            <h2 className="referral-section-title">{formTitle}</h2>
            <div className="form-field">
              <label>Название промокода</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Майская акция" />
              {errors.name ? <p className="field-hint promo-field-error">{errors.name}</p> : null}
            </div>
            <div className="form-field">
              <label>Текст промокода</label>
              <div className="promo-code-row">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toLocaleUpperCase("ru-RU").replace(/\s+/g, ""))}
                  placeholder="МАЙСКИДКА25"
                />
                <button type="button" className="ghost" onClick={generateCode} disabled={busy}>
                  Сгенерировать
                </button>
              </div>
              {errors.code ? <p className="field-hint promo-field-error">{errors.code}</p> : null}
            </div>
            <div className="form-field">
              <label>Тип промокода</label>
              <select value={promoType} onChange={(e) => setPromoType(e.target.value as PromoCodeDto["type"])}>
                <option value="percent">Скидка в %</option>
                <option value="rub">Скидка в ₽</option>
                <option value="gb">Подарок ГБ</option>
                <option value="days">Подарок дней</option>
                <option value="combo">Комбинированный</option>
              </select>
            </div>
            {promoType === "percent" || promoType === "combo" ? (
              <div className="form-field">
                <label>Скидка, %</label>
                <input inputMode="numeric" value={discountPercent} onChange={(e) => setDiscountPercent(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                {errors.discount_percent ? <p className="field-hint promo-field-error">{errors.discount_percent}</p> : null}
              </div>
            ) : null}
            {promoType === "rub" || promoType === "combo" ? (
              <div className="form-field">
                <label>Скидка, ₽</label>
                <input inputMode="numeric" value={discountRub} onChange={(e) => setDiscountRub(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                {errors.discount_rub ? <p className="field-hint promo-field-error">{errors.discount_rub}</p> : null}
              </div>
            ) : null}
            {promoType === "gb" || promoType === "combo" ? (
              <div className="form-field">
                <label>Подарок ГБ</label>
                <input inputMode="numeric" value={giftGb} onChange={(e) => setGiftGb(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                {errors.gift_gb ? <p className="field-hint promo-field-error">{errors.gift_gb}</p> : null}
              </div>
            ) : null}
            {promoType === "days" || promoType === "combo" ? (
              <div className="form-field">
                <label>Подарок дней</label>
                <input inputMode="numeric" value={giftDays} onChange={(e) => setGiftDays(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                {errors.gift_days ? <p className="field-hint promo-field-error">{errors.gift_days}</p> : null}
              </div>
            ) : null}
            {errors.combo ? <p className="field-hint promo-field-error">{errors.combo}</p> : null}
            <div className="form-field">
              <label>Максимальное количество применений всего</label>
              <input value={maxUsesTotal} onChange={(e) => setMaxUsesTotal(e.target.value.replace(/[^\d]/g, ""))} placeholder="без ограничения" />
              {errors.max_uses_total ? <p className="field-hint promo-field-error">{errors.max_uses_total}</p> : null}
            </div>
            <div className="form-field">
              <label>Максимум применений на пользователя</label>
              <input inputMode="numeric" value={maxUsesPerUser} onChange={(e) => setMaxUsesPerUser(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
              {errors.max_uses_per_user ? <p className="field-hint promo-field-error">{errors.max_uses_per_user}</p> : null}
            </div>
            <div className="form-field">
              <label>Минимальная сумма покупки, ₽</label>
              <input value={minPurchaseRub} onChange={(e) => setMinPurchaseRub(e.target.value.replace(/[^\d]/g, ""))} placeholder="если применимо" />
            </div>
            <div className="form-field shop-toggle-row">
              <div>
                <label>Промокод активен</label>
                <p className="field-hint">Неактивный промокод нельзя применить.</p>
              </div>
              <button type="button" className={`toggle ${active ? "on" : ""}`} onClick={() => setActive((v) => !v)} />
            </div>
            <div className="form-field">
              <label>Действует до (дата)</label>
              <ExpiryDateTimePicker valueMs={validUntilMs} onChangeMs={setValidUntilMs} disabled={busy} />
              <div className="promo-date-quick">
                <button type="button" className="ghost" onClick={() => setValidUntilMs(Date.now() + 7 * 86400000)}>7 дней</button>
                <button type="button" className="ghost" onClick={() => setValidUntilMs(Date.now() + 14 * 86400000)}>14 дней</button>
                <button type="button" className="ghost" onClick={() => setValidUntilMs(Date.now() + 30 * 86400000)}>30 дней</button>
                <button type="button" className="ghost" onClick={() => setValidUntilMs(0)}>без ограничения</button>
              </div>
              <p className="field-hint">Пусто = без ограничения срока.</p>
              {errors.valid_until ? <p className="field-hint promo-field-error">{errors.valid_until}</p> : null}
            </div>
            <div className="form-field shop-toggle-row">
              <div>
                <label>Использовать 1 раз с 1 пользователем</label>
                <p className="field-hint">Если включено, один и тот же пользователь не сможет применить код повторно.</p>
              </div>
              <button type="button" className={`toggle ${oneTime ? "on" : ""}`} onClick={() => setOneTime((v) => !v)} />
            </div>
            <div className="form-field shop-toggle-row">
              <div>
                <label>Применять только к первой покупке</label>
              </div>
              <button type="button" className={`toggle ${firstPurchaseOnly ? "on" : ""}`} onClick={() => setFirstPurchaseOnly((v) => !v)} />
            </div>
            <div className="form-field shop-toggle-row">
              <div>
                <label>Применять только к новым пользователям</label>
              </div>
              <button type="button" className={`toggle ${newUsersOnly ? "on" : ""}`} onClick={() => setNewUsersOnly((v) => !v)} />
            </div>
            <div className="form-field">
              <label>Применять только к выбранным тарифам</label>
              <div className="promo-plan-chips">
                {(shop?.plans ?? []).map((p) => {
                  const on = applyPlanIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`ghost ${on ? "active" : ""}`}
                      onClick={() => setApplyPlanIds((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                    >
                      {p.title}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="form-field">
              <label>Заметка администратора</label>
              <textarea className="comms-textarea" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
            </div>

            <div className="form-field form-field-span-2">
              <label>Предпросмотр применения</label>
              {promoType === "percent" || promoType === "rub" || promoType === "combo" ? (
                <div className="referral-discount-cards">
                  {discountPreview.map((p) => (
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
              ) : null}
              {promoType === "gb" ? <p className="field-hint">Пользователь получит +{giftGb} ГБ</p> : null}
              {promoType === "days" ? <p className="field-hint">Пользователь получит +{giftDays} дней</p> : null}
              {promoType === "combo" ? (
                <p className="field-hint">Пользователь получит: скидка {discountPercent}% / +{giftGb} ГБ / +{giftDays} дней</p>
              ) : null}
            </div>

            <div className="promo-form-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void onSubmit()}>
                {busy ? "Сохранение..." : submitTitle}
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={clearForm}>
                Очистить форму
              </button>
            </div>
          </div>

          <aside className="promos-list" aria-label="Список промокодов">
            <label className="referral-feed-label">Созданные промокоды</label>
            <div className="promo-filters">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию/коду" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="all">Все</option>
                <option value="active">Активные</option>
                <option value="inactive">Выключенные</option>
                <option value="expired">Истекшие</option>
                <option value="limit_reached">Лимит исчерпан</option>
              </select>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
                <option value="all">Все типы</option>
                <option value="percent">Скидка %</option>
                <option value="rub">Скидка ₽</option>
                <option value="gb">ГБ</option>
                <option value="days">Дни</option>
                <option value="combo">Комбинированный</option>
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                <option value="new">Новые сверху</option>
                <option value="old">Старые сверху</option>
                <option value="uses_desc">Больше применений</option>
                <option value="expiring_soon">Скоро истекают</option>
              </select>
            </div>
            <div className="promos-list-scroll">
              {promos.length === 0 ? (
                <p className="sub promo-list-empty">
                  Пока нет промокодов.
                  <br />
                  Создайте первый промокод для акции или подарка клиентам.
                </p>
              ) : filteredPromos.length === 0 ? (
                <p className="sub promo-list-empty">Ничего не найдено по выбранным фильтрам.</p>
              ) : (
                <div className="promo-cards">
                  {filteredPromos.map((p) => {
                    const statsOpen = statsPromoId === p.id;
                    const usages = statsById[p.id];
                    const status = promoStatus(p);
                    return (
                      <div key={p.id} className={`promo-card ${statsOpen ? "promo-card--open" : ""}`}>
                        <div className="promo-card-main">
                          <div className="promo-card-text">
                            <div className="promo-card-title">
                              <span className="promo-card-name">{p.name}</span>
                              <span className="promo-card-code mono">({p.code})</span>
                            </div>
                            <div className="promo-card-meta">
                              Тип: {p.type} • бонус: {p.type === "percent" ? `${p.discount_percent}%` : p.type === "rub" ? `${p.discount_rub} ₽` : p.type === "gb" ? `+${p.gift_gb} ГБ` : p.type === "days" ? `+${p.gift_days} дней` : `${p.discount_percent}% +${p.gift_gb}ГБ +${p.gift_days}д`}
                            </div>
                            <div className="promo-card-meta">
                              Статус: {status === "active" ? "активен" : status === "inactive" ? "выключен" : status === "expired" ? "истек" : "лимит исчерпан"} • применений: {p.usages_count} / {p.max_uses_total ?? "∞"}
                            </div>
                            <div className="promo-card-meta">
                              До: {p.valid_until ? new Date(p.valid_until).toLocaleString("ru-RU") : "без ограничения"} • создан: {new Date(p.created_at).toLocaleDateString("ru-RU")}
                            </div>
                          </div>
                          <div className="promo-card-actions">
                            <button type="button" className="promo-icon-btn" title="Просмотр отчёта" disabled={busy} onClick={() => void openReport(p)}>Просмотр</button>
                            <button type="button" className="promo-icon-btn" title="Редактировать" disabled={busy} onClick={() => openEdit(p)}>Редактировать</button>
                            <button type="button" className="promo-icon-btn" title="Дублировать" disabled={busy} onClick={() => void onDuplicate(p)}>Дублировать</button>
                            <button
                              type="button"
                              className="promo-icon-btn"
                              title={p.active ? "Отключить" : "Включить"}
                              disabled={busy}
                              onClick={() => void patchPromoCode(p.id, { active: !p.active }).then(() => reload())}
                            >
                              {p.active ? "Отключить" : "Включить"}
                            </button>
                            <button type="button" className="promo-icon-btn danger" title="Удалить" disabled={busy} onClick={() => void onDeletePromo(p)}>Удалить</button>
                            <button
                              type="button"
                              className={`promo-icon-btn ${statsOpen ? "active" : ""}`}
                              title={statsOpen ? "Скрыть применения" : "Показать применения"}
                              aria-expanded={statsOpen}
                              disabled={busy}
                              onClick={() => void toggleStats(p)}
                            >
                              Применения
                            </button>
                          </div>
                        </div>
                        {statsOpen ? (
                          <div className="promo-card-stats">
                            {statsLoadingId === p.id ? (
                              <p className="field-hint">Загрузка…</p>
                            ) : !usages || usages.length === 0 ? (
                              <p className="field-hint">Промокод пока никто не применял.</p>
                            ) : (
                              <ul className="promo-stats-list">
                                {usages.map((u) => (
                                  <li key={u.id}>
                                    {(u.user_name || u.tg_first_name || "Пользователь") + (u.tg_username ? ` (@${u.tg_username})` : "")} •{" "}
                                    {new Date(u.applied_at).toLocaleString("ru-RU")}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      <section className="panel">
        <h2 className="referral-section-title">Отчёт по промокоду</h2>
        {!report ? (
          <p className="field-hint">Выберите «Просмотр» у нужного промокода.</p>
        ) : reportLoading ? (
          <p className="field-hint">Загрузка отчёта…</p>
        ) : (
          <>
            <div className="promo-report-summary">
              <div><b>Название:</b> {report.promo.name}</div>
              <div><b>Код:</b> {report.promo.code}</div>
              <div><b>Тип:</b> {report.promo.type}</div>
              <div><b>Статус:</b> {report.promo.status}</div>
              <div><b>Всего применений:</b> {report.promo.usages_count}</div>
              <div><b>Уникальных пользователей:</b> {report.promo.unique_users_count}</div>
              <div><b>Суммарная скидка:</b> {report.promo.sum_discount_rub} ₽</div>
              <div><b>Выдано ГБ:</b> {report.promo.sum_bonus_gb}</div>
              <div><b>Выдано дней:</b> {report.promo.sum_bonus_days}</div>
            </div>
            <div className="promo-report-actions">
              <button type="button" className="ghost" onClick={() => window.open(promoCodeReportCsvUrl(report.promo.id), "_blank")}>Экспорт CSV</button>
              <button type="button" className="ghost" onClick={() => window.open(promoCodeReportXlsxUrl(report.promo.id), "_blank")}>Экспорт XLSX</button>
            </div>
            {report.usages.length === 0 ? (
              <p className="field-hint">Промокод пока никто не применял.</p>
            ) : (
              <div className="referral-report-wrap">
                <table className="referral-report-table">
                  <thead>
                    <tr>
                      <th>Пользователь</th>
                      <th>Telegram username</th>
                      <th>Телефон</th>
                      <th>Дата применения</th>
                      <th>Тариф/покупка</th>
                      <th>Исходная цена</th>
                      <th>Итоговая цена</th>
                      <th>Скидка</th>
                      <th>ГБ</th>
                      <th>Дни</th>
                      <th>Статус</th>
                      <th>Ошибка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.usages.map((u) => (
                      <tr key={u.id}>
                        <td>{u.user_name || u.tg_first_name || `tg:${u.tg_user_id}`}</td>
                        <td>{u.tg_username ? `@${u.tg_username}` : "—"}</td>
                        <td>{u.phone || "—"}</td>
                        <td>{new Date(u.applied_at).toLocaleString("ru-RU")}</td>
                        <td>{u.plan_title || "—"}</td>
                        <td>{u.original_price_rub ?? "—"}</td>
                        <td>{u.final_price_rub ?? "—"}</td>
                        <td>{u.discount_rub ?? "—"}</td>
                        <td>{u.bonus_gb ?? "—"}</td>
                        <td>{u.bonus_days ?? "—"}</td>
                        <td>{u.status ?? "applied"}</td>
                        <td>{u.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
        </>
      )}
    </DashboardLayout>
  );
}
