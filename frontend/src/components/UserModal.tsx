import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SVGProps } from "react";
import { createPortal } from "react-dom";
import {
  fetchUserConfigVaultLinks,
  loadSubscriptionShop,
  notifyUserExpired,
  notifyUserExpiring,
  type CreateUserPayload,
  type ServerDto,
  type SubscriptionShopPlanDto,
  type UserDto,
} from "../api";
import { snapExpiryTimeToNoonLocal } from "../lib/rouletteTicketPurchase";
import {
  formatNotifyExpiredError,
  formatNotifyExpiryError,
  userExpiredNotifyEligible,
  userExpiryNotifyEligible,
} from "../expiryNotify";
import type { ConfigVaultLinkDto, ExtraVlessLinkDto } from "../api";
import AddVlessKeyModal from "./AddVlessKeyModal";
import DualListPicker from "./DualListPicker";
import ExpiryDateTimePicker from "./ExpiryDateTimePicker";
import Spinner from "./Spinner";

const FLOW_FIXED = "xtls-rprx-vision";
const DAY_MS = 86_400_000;

function planGbLabel(gb: number): string {
  return gb > 0 ? `${gb} ГБ` : "безлимит";
}

function planOptionLabel(p: SubscriptionShopPlanDto): string {
  return `Тариф #${p.id}: ${p.title} (${planGbLabel(p.total_gb)} / ${p.days} дн.)`;
}

function detectPlanId(totalGb: number, plans: SubscriptionShopPlanDto[]): number {
  const gb = Math.max(0, Number(totalGb) || 0);
  return plans.find((p) => p.total_gb === gb)?.id ?? 0;
}

function expiryAfterPlanDays(baseMs: number, days: number): number {
  if (days <= 0) return 0;
  const now = Date.now();
  const base = baseMs > now ? baseMs : now;
  return snapExpiryTimeToNoonLocal(base + days * DAY_MS);
}

function formatExpiryShort(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function expiryTone(expiryMs: number): { tone: "ok" | "warn" | "muted"; text: string } {
  if (!(expiryMs > 0)) return { tone: "muted", text: "Без срока" };
  const now = Date.now();
  if (expiryMs < now) return { tone: "warn", text: "Истекла" };
  const text = `до ${formatExpiryShort(expiryMs)}`;
  return { tone: expiryMs - now <= 3 * DAY_MS ? "warn" : "ok", text };
}

export type UserModalMode = "create" | "edit";

type Props = {
  open: boolean;
  mode: UserModalMode;
  user: UserDto | null;
  /** Развёрнутые серверы (порядок — как в API, обычно по id). */
  deployedServers: ServerDto[];
  onClose: () => void;
  onCreate: (payload: CreateUserPayload) => void | Promise<void>;
  onUpdate: (id: number, payload: CreateUserPayload) => Promise<void>;
  /** Открыть превью WebApp для tg_id клиента. */
  onOpenWebAppPreview?: (user: UserDto) => void;
};

function serverSegLabel(s: ServerDto): string {
  const flag = (s.country_flag || "").trim();
  const cc = (s.country_code || "").trim().toUpperCase();
  const prefix = flag || (cc ? `[${cc}]` : "");
  const name = (s.name || s.host || "узел").trim();
  return prefix ? `${prefix} ${name}` : name;
}

function deployedIdsOrdered(servers: ServerDto[]): number[] {
  return [...servers].sort((a, b) => a.id - b.id).map((s) => s.id);
}

function serverIdsFromUser(user: UserDto, deployed: ServerDto[]): number[] {
  const all = deployedIdsOrdered(deployed);
  if (user.subscription_server_ids?.length) {
    const valid = new Set(all);
    return user.subscription_server_ids.filter((id) => valid.has(id));
  }
  const lim = Math.max(0, Math.floor(Number(user.subscription_server_count) || 0));
  if (lim <= 0 || lim >= all.length) return all;
  return all.slice(0, lim);
}

function IconCopy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconChevron(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function FloatField({
  label,
  filled = false,
  span = false,
  hint,
  extra,
  textarea = false,
  picker = false,
  action = false,
  children,
}: {
  label: string;
  filled?: boolean;
  span?: boolean;
  hint?: ReactNode;
  extra?: ReactNode;
  textarea?: boolean;
  picker?: boolean;
  action?: boolean;
  children: ReactNode;
}) {
  const cls = [
    "user-modal-field",
    filled ? "is-filled" : "",
    span ? "user-modal-field--span" : "",
    textarea ? "user-modal-field--textarea" : "",
    picker ? "user-modal-field--picker" : "",
    action ? "user-modal-field--action" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <div className="user-modal-field__box">
        {children}
        <span className="user-modal-field__label">{label}</span>
      </div>
      {hint ? <p className="user-modal-field__hint">{hint}</p> : null}
      {extra}
    </div>
  );
}

function CopyField({
  label,
  value,
  title,
  copyKey,
  copiedKey,
  onCopy,
}: {
  label: string;
  value: string;
  title: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const done = copiedKey === copyKey;
  return (
    <FloatField label={label} filled={Boolean(value)} action>
      <input className="user-modal-field__control mono" value={value} readOnly title={title} aria-label={label} />
      <button
        type="button"
        className={`ghost user-modal-copy-btn${done ? " is-copied" : ""}`}
        onClick={() => onCopy(copyKey, value)}
        title={done ? "Скопировано" : `Копировать ${label}`}
        aria-label={`Копировать ${label}`}
      >
        {done ? "✓" : <IconCopy />}
      </button>
    </FloatField>
  );
}

export default function UserModal({
  open,
  mode,
  user,
  deployedServers,
  onClose,
  onCreate,
  onUpdate,
  onOpenWebAppPreview,
}: Props) {
  const [enable, setEnable] = useState(true);
  const [excludeFromRevenue, setExcludeFromRevenue] = useState(false);
  const [email, setEmail] = useState("");
  const [remark, setRemark] = useState("");
  const [uuid, setUuid] = useState("");
  const [subToken, setSubToken] = useState("");
  const [tgId, setTgId] = useState("");
  const [comment, setComment] = useState("");
  const [totalGb, setTotalGb] = useState("0");
  const [expiryMs, setExpiryMs] = useState(0);
  const [selectedServerIds, setSelectedServerIds] = useState<number[]>([]);
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const [shopPlans, setShopPlans] = useState<SubscriptionShopPlanDto[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState(0);
  const [saving, setSaving] = useState(false);
  const [expiryNotifyBusy, setExpiryNotifyBusy] = useState(false);
  const [expiryNotifyFlash, setExpiryNotifyFlash] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [extraVlessLinks, setExtraVlessLinks] = useState<ExtraVlessLinkDto[]>([]);
  const [configVaultLinks, setConfigVaultLinks] = useState<ConfigVaultLinkDto[]>([]);
  const [addVlessOpen, setAddVlessOpen] = useState(false);
  const [editingVlessLink, setEditingVlessLink] = useState<ExtraVlessLinkDto | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [extraVlessOpen, setExtraVlessOpen] = useState(false);
  const planTouchedRef = useRef(false);
  const formInitKeyRef = useRef("");

  useEffect(() => {
    if (!open) {
      setExpiryNotifyFlash(null);
      setExtraVlessOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void loadSubscriptionShop()
      .then((shop) => setShopPlans(shop.plans))
      .catch(() => setShopPlans([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const userId = user?.id ?? 0;

  useEffect(() => {
    if (!open) {
      planTouchedRef.current = false;
      formInitKeyRef.current = "";
      return;
    }
    if (mode === "create") {
      if (formInitKeyRef.current === "create") return;
      formInitKeyRef.current = "create";
      setEnable(true);
      setExcludeFromRevenue(false);
      setEmail("");
      setRemark("");
      setTgId("");
      setComment("");
      setTotalGb("0");
      setExpiryMs(0);
      setSelectedServerIds(deployedIdsOrdered(deployedServers));
      setSelectedPlanId(0);
      setExtraVlessLinks([]);
      setConfigVaultLinks([]);
      return;
    }
    if (!user) return;
    const initKey = `edit:${userId}`;
    if (formInitKeyRef.current === initKey) return;
    formInitKeyRef.current = initKey;
    setEnable(user.enable);
    setExcludeFromRevenue(user.exclude_from_revenue === true);
    setEmail(user.email);
    setRemark(user.name);
    setUuid(user.vless_uuid);
    setSubToken(user.sub_token);
    setTgId(user.tg_id);
    setComment(user.comment);
    setTotalGb(String(user.total_gb ?? 0));
    setExpiryMs(Number(user.expiry_time) > 0 ? Number(user.expiry_time) : 0);
    setSelectedServerIds(serverIdsFromUser(user, deployedServers));
    setExtraVlessLinks(user.extra_vless_links?.length ? [...user.extra_vless_links] : []);
    setConfigVaultLinks(user.config_vault_links?.length ? [...user.config_vault_links] : []);
  }, [open, mode, userId, user, deployedServers]);

  useEffect(() => {
    if (!open || mode === "create" || !userId) return;
    if (user?.config_vault_links?.length) return;
    const count = user?.config_vault_links_count ?? 0;
    if (count <= 0) return;
    let cancelled = false;
    void fetchUserConfigVaultLinks(userId)
      .then((links) => {
        if (!cancelled) setConfigVaultLinks(links);
      })
      .catch(() => {
        if (!cancelled) setConfigVaultLinks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, userId, user?.config_vault_links, user?.config_vault_links_count]);

  useEffect(() => {
    if (!open || mode === "create" || !user || shopPlans.length === 0 || planTouchedRef.current) return;
    setSelectedPlanId(detectPlanId(user.total_gb ?? 0, shopPlans));
  }, [open, mode, userId, user?.total_gb, shopPlans]);

  useEffect(() => {
    if (!open || mode !== "create") return;
    setSelectedServerIds((prev) => {
      const all = deployedIdsOrdered(deployedServers);
      if (prev.length === 0) return all;
      const valid = new Set(all);
      const kept = prev.filter((id) => valid.has(id));
      return kept.length > 0 ? kept : all;
    });
  }, [open, mode, deployedServers]);

  const serverPickerItems = useMemo(
    () =>
      [...deployedServers]
        .sort((a, b) => a.id - b.id)
        .map((s) => ({
          id: s.id,
          label: `#${s.id} ${serverSegLabel(s)}`,
        })),
    [deployedServers],
  );

  useEffect(() => {
    if (!open) setServerPickerOpen(false);
  }, [open]);

  const visible = open && !(mode === "edit" && !user);
  const formId = "user-form-main";
  const isCreate = mode === "create";
  const displayName = (remark.trim() || email.trim() || (isCreate ? "Новый клиент" : "Клиент")).trim();
  const expiry = expiryTone(expiryMs);

  function buildPayload(): CreateUserPayload {
    const base: CreateUserPayload = {
      name: remark.trim() || email.trim() || "Пользователь",
      email: email.trim() || remark.trim() || "user",
      flow: FLOW_FIXED,
      total_gb: Math.max(0, Math.min(1e9, Number.parseFloat(String(totalGb).replace(",", ".")) || 0)),
      expiry_time: expiryMs > 0 && Number.isFinite(expiryMs) ? expiryMs : 0,
      enable,
      exclude_from_revenue: excludeFromRevenue,
      tg_id: tgId.trim(),
      comment: comment.trim(),
      subscription_server_ids: selectedServerIds,
      extra_vless_links: extraVlessLinks,
    };
    if (isCreate) return base;
    return {
      ...base,
      vless_uuid: uuid.trim(),
      sub_token: subToken.trim() || undefined,
    };
  }

  function applyPlan(planId: number) {
    planTouchedRef.current = true;
    setSelectedPlanId(planId);
    if (planId <= 0) return;
    const plan = shopPlans.find((p) => p.id === planId);
    if (!plan) return;
    setTotalGb(String(plan.total_gb));
    setExpiryMs(expiryAfterPlanDays(expiryMs, plan.days));
  }

  const currentPlanLabel = useMemo(() => {
    if (selectedPlanId > 0) {
      const plan = shopPlans.find((p) => p.id === selectedPlanId);
      if (plan) return planOptionLabel(plan);
    }
    const gb = Math.max(0, Number.parseFloat(String(totalGb).replace(",", ".")) || 0);
    return `Индивидуальный (${planGbLabel(gb)})`;
  }, [selectedPlanId, shopPlans, totalGb]);

  async function save() {
    if (isCreate) {
      onClose();
      void onCreate(buildPayload());
      return;
    }
    setSaving(true);
    try {
      if (user) await onUpdate(user.id, buildPayload());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    await save();
  }

  function labelFromVlessUri(trimmed: string): string {
    let label = "VLESS";
    const hash = trimmed.indexOf("#");
    if (hash >= 0) {
      try {
        label = decodeURIComponent(trimmed.slice(hash + 1)).trim() || label;
      } catch {
        label = trimmed.slice(hash + 1).trim() || label;
      }
    }
    return label;
  }

  function saveExtraVlessUri(uri: string, editId?: string) {
    const trimmed = uri.trim();
    const lower = trimmed.toLowerCase();
    const duplicate = extraVlessLinks.some((x) => x.uri.toLowerCase() === lower && x.id !== editId);
    if (duplicate) {
      window.alert("Эта ссылка уже добавлена.");
      return;
    }
    const label = labelFromVlessUri(trimmed);
    if (editId) {
      setExtraVlessLinks((prev) =>
        prev.map((x) => (x.id === editId ? { ...x, uri: trimmed, label } : x)),
      );
      return;
    }
    setExtraVlessLinks((prev) => [...prev, { id: crypto.randomUUID(), uri: trimmed, label }]);
  }

  function openAddVlessModal() {
    setExtraVlessOpen(true);
    setEditingVlessLink(null);
    setAddVlessOpen(true);
  }

  function openEditVlessModal(link: ExtraVlessLinkDto) {
    setExtraVlessOpen(true);
    setEditingVlessLink(link);
    setAddVlessOpen(true);
  }

  function closeVlessModal() {
    setAddVlessOpen(false);
    setEditingVlessLink(null);
  }

  function removeExtraVless(id: string) {
    setExtraVlessLinks((prev) => prev.filter((x) => x.id !== id));
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1600);
    } catch {
      /* ignore */
    }
  }

  const deployedTotal = deployedServers.length;
  const selectedCount = selectedServerIds.length;
  const allSelected = deployedTotal > 0 && selectedCount >= deployedTotal;
  const extraKeyCount = extraVlessLinks.length + configVaultLinks.length;

  if (!visible) {
    return (
      <DualListPicker
        open={false}
        title="Серверы в подписке"
        leftLabel="Доступные серверы"
        rightLabel="В подписке"
        items={serverPickerItems}
        selectedIds={selectedServerIds}
        onClose={() => setServerPickerOpen(false)}
        onSave={(ids) => {
          setSelectedServerIds(ids);
          setServerPickerOpen(false);
        }}
      />
    );
  }

  return createPortal(
    <>
    <div className="modal-backdrop modal-backdrop--admin user-modal-backdrop" role="presentation">
      <div
        className={`modal user-modal-panel${saving ? " user-modal-panel--busy" : ""}`}
        role="dialog"
        aria-labelledby="user-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head user-modal-head">
          <div className="user-modal-hero">
            <p className="user-modal-kicker">{isCreate ? "Создание" : "Карточка клиента"}</p>
            <h2 id="user-modal-title">{displayName}</h2>
            <p className="user-modal-sub">Лимиты, срок и узлы в подписке</p>
            <div className="user-modal-pills">
              <span className={`user-modal-pill user-modal-pill--${enable ? "ok" : "muted"}`}>
                {enable ? "Включён" : "Выключен"}
              </span>
              <span className={`user-modal-pill user-modal-pill--${expiry.tone}`}>{expiry.text}</span>
              {excludeFromRevenue ? (
                <span className="user-modal-pill user-modal-pill--muted">Не в выручке</span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="modal-close ghost"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <form id={formId} className="modal-body user-modal-body" onSubmit={(e) => void onFormSubmit(e)}>
          <section className="user-modal-card" style={{ "--i": 0 } as CSSProperties}>
            <h3 className="user-modal-section-title">Статус</h3>
            <div className="user-modal-toggle-row">
              <div>
                <div className="user-modal-label-lg">Включить</div>
                <p className="user-modal-hint">Клиент получает узлы в подписке только если включён и не вышел срок / лимит.</p>
              </div>
              <button
                type="button"
                className={`toggle ${enable ? "on" : ""}`}
                onClick={() => setEnable(!enable)}
                aria-pressed={enable}
              />
            </div>
            <div className="user-modal-toggle-row user-modal-toggle-row--spaced">
              <div>
                <div className="user-modal-label-lg">Не учитывать в выручке</div>
                <p className="user-modal-hint">Покупки и продления этого клиента не попадут в отчёт «Выручка».</p>
              </div>
              <button
                type="button"
                className={`toggle ${excludeFromRevenue ? "on" : ""}`}
                onClick={() => setExcludeFromRevenue(!excludeFromRevenue)}
                aria-pressed={excludeFromRevenue}
              />
            </div>
            <p className="user-modal-hint user-modal-hint--tight">
              Параметры VLESS / REALITY (порт, pbk, SNI, flow) настраиваются в карточке сервера → «Настройки подписки».
            </p>
          </section>

          <section className="user-modal-card" style={{ "--i": 1 } as CSSProperties}>
            <h3 className="user-modal-section-title">Профиль</h3>
            <div className="user-modal-fields">
              <FloatField label="Email / метка" filled={Boolean(email.trim())}>
                <input
                  className="user-modal-field__control"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  aria-label="Email / метка"
                />
              </FloatField>
              <FloatField label="Имя в подписке" filled={Boolean(remark.trim())}>
                <input
                  className="user-modal-field__control"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  autoComplete="off"
                  aria-label="Имя в подписке"
                />
              </FloatField>
              <FloatField
                label="Telegram Chat ID"
                filled={Boolean(tgId.trim())}
                span
                hint="Числовой id из @userinfobot"
                extra={
                  !isCreate &&
                  user &&
                  (userExpiryNotifyEligible({ tg_id: tgId, expiry_time: expiryMs }) ||
                    userExpiredNotifyEligible({ tg_id: tgId, expiry_time: expiryMs })) ? (
                    <div className="expiry-notify-block">
                      <button
                        type="button"
                        className="ghost"
                        disabled={expiryNotifyBusy || saving}
                        onClick={() => {
                          void (async () => {
                            setExpiryNotifyFlash(null);
                            setExpiryNotifyBusy(true);
                            const expired = userExpiredNotifyEligible({ tg_id: tgId, expiry_time: expiryMs });
                            try {
                              if (expired) {
                                await notifyUserExpired(user.id, { tg_id: tgId, expiry_time: expiryMs });
                              } else {
                                await notifyUserExpiring(user.id, { tg_id: tgId, expiry_time: expiryMs });
                              }
                              setExpiryNotifyFlash({ type: "ok", text: "Сообщение отправлено в Telegram." });
                            } catch (e) {
                              setExpiryNotifyFlash({
                                type: "err",
                                text: expired ? formatNotifyExpiredError(String(e)) : formatNotifyExpiryError(String(e)),
                              });
                            } finally {
                              setExpiryNotifyBusy(false);
                            }
                          })();
                        }}
                      >
                        {expiryNotifyBusy ? (
                          <>
                            <Spinner /> Отправка…
                          </>
                        ) : userExpiredNotifyEligible({ tg_id: tgId, expiry_time: expiryMs }) ? (
                          "Подписка истекла — уведомить в Telegram"
                        ) : (
                          "Напоминание в Telegram (истекает ≤ 3 суток)"
                        )}
                      </button>
                      {expiryNotifyFlash ? (
                        <p className={expiryNotifyFlash.type === "ok" ? "user-modal-field__hint" : "user-modal-field__hint err"}>
                          {expiryNotifyFlash.text}
                        </p>
                      ) : null}
                    </div>
                  ) : null
                }
              >
                <input
                  className="user-modal-field__control"
                  value={tgId}
                  onChange={(e) => setTgId(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  aria-label="Telegram Chat ID"
                />
              </FloatField>
              <FloatField label="Комментарий" filled={Boolean(comment.trim())} span textarea>
                <textarea
                  className="user-modal-field__control"
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  aria-label="Комментарий"
                />
              </FloatField>
            </div>
          </section>

          <section className="user-modal-card user-modal-card-highlight" style={{ "--i": 2 } as CSSProperties}>
            <div className="user-modal-section-head">
              <h3 className="user-modal-section-title">Лимиты и подписка</h3>
              <span className="user-modal-section-kicker">{currentPlanLabel}</span>
            </div>
            <div className="user-modal-fields">
              <FloatField
                label="Тариф"
                filled
                span
                hint="Выбор обновляет ГБ и срок. Тарифы — в разделе «Подписки»."
              >
                <select
                  className="user-modal-field__control"
                  value={String(selectedPlanId)}
                  onChange={(e) => applyPlan(Number(e.target.value) || 0)}
                  disabled={saving || shopPlans.length === 0}
                  aria-label="Тариф"
                >
                  <option value="0">Индивидуальный (ручные лимиты)</option>
                  {shopPlans.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {planOptionLabel(p)}
                    </option>
                  ))}
                </select>
              </FloatField>
              <FloatField label="Лимит трафика, ГБ" filled={Boolean(String(totalGb).trim())} hint="0 = без лимита">
                <input
                  className="user-modal-field__control"
                  value={totalGb}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTotalGb(v);
                    planTouchedRef.current = true;
                    const gb = Math.max(0, Number.parseFloat(v.replace(",", ".")) || 0);
                    setSelectedPlanId(detectPlanId(gb, shopPlans));
                  }}
                  inputMode="decimal"
                  aria-label="Лимит трафика, ГБ"
                />
              </FloatField>
              <FloatField
                label="Дата окончания"
                filled={expiryMs > 0}
                picker
                hint="Пусто — без срока. Иначе окончание в 12:00."
              >
                <ExpiryDateTimePicker valueMs={expiryMs} onChangeMs={setExpiryMs} disabled={saving} />
              </FloatField>
              <div className="user-modal-servers user-modal-field--span">
                <div className="user-server-pick-row">
                  <button
                    type="button"
                    className="ghost"
                    disabled={saving || deployedTotal === 0}
                    onClick={() => setServerPickerOpen(true)}
                  >
                    Выбрать серверы
                  </button>
                  <span className="user-server-pick-summary">
                    {deployedTotal === 0
                      ? "Нет развёрнутых узлов"
                      : allSelected
                        ? `Все серверы (${deployedTotal})`
                        : `Выбрано: ${selectedCount} из ${deployedTotal}`}
                  </span>
                </div>
                <p className="user-modal-field__hint">По умолчанию все развёрнутые узлы.</p>
              </div>
            </div>
          </section>

          {!isCreate && user ? (
            <section className="user-modal-card" style={{ "--i": 3 } as CSSProperties}>
              <h3 className="user-modal-section-title">Идентификаторы</h3>
              <div className="user-modal-fields">
                <CopyField
                  label="UUID"
                  value={uuid}
                  title="Задаётся при создании"
                  copyKey="uuid"
                  copiedKey={copiedKey}
                  onCopy={(key, text) => void copyText(key, text)}
                />
                <CopyField
                  label="Subscription ID"
                  value={subToken}
                  title="Токен URL подписки"
                  copyKey="sub"
                  copiedKey={copiedKey}
                  onCopy={(key, text) => void copyText(key, text)}
                />
              </div>
            </section>
          ) : (
            <section className="user-modal-card user-modal-card-muted" style={{ "--i": 3 } as CSSProperties}>
              <p className="user-modal-hint user-modal-hint--tight">
                После создания здесь появятся UUID и subscription id — их можно скопировать в карточке клиента.
              </p>
            </section>
          )}

          <section className={`user-modal-card user-modal-vless${extraVlessOpen ? " is-open" : ""}`} style={{ "--i": 4 } as CSSProperties}>
            <button
              type="button"
              className="user-modal-vless__toggle"
              aria-expanded={extraVlessOpen}
              onClick={() => setExtraVlessOpen((v) => !v)}
            >
              <span className="user-modal-vless__toggle-copy">
                <span className="user-modal-section-title">Дополнительные VLESS ключи</span>
                <span className="user-modal-vless__count">
                  {extraKeyCount > 0 ? `${extraKeyCount}` : "нет"}
                </span>
              </span>
              <IconChevron className="user-modal-vless__chevron" />
            </button>
            <div className="user-modal-vless__fold">
              <div className="user-modal-vless__inner">
                <div className="user-modal-vless__toolbar">
                  <p className="user-modal-hint user-modal-hint--tight">
                    Ссылки из панели и конфиг-хранилища попадают в подписку. На Xray не деплоятся.
                  </p>
                  <button type="button" className="ghost btn-sm" disabled={saving} onClick={openAddVlessModal}>
                    Добавить ключ
                  </button>
                </div>
                {extraKeyCount === 0 ? (
                  <p className="muted user-modal-empty-keys">Нет дополнительных ключей.</p>
                ) : (
                  <ul className="user-extra-vless-list">
                    {configVaultLinks.map((link) => {
                      const uriPreview = link.masked_uri || link.uri;
                      return (
                        <li key={`vault-${link.vault_key_id}`} className="user-extra-vless-item user-extra-vless-item--vault">
                          <div className="user-extra-vless-meta">
                            <strong>
                              {link.name}
                              <span className="user-extra-vless-badge">Конфиг-хранилище</span>
                            </strong>
                            <span className="mono user-extra-vless-uri" title={link.uri}>
                              {uriPreview.length > 72 ? `${uriPreview.slice(0, 72)}…` : uriPreview}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                    {extraVlessLinks.map((link) => (
                      <li key={link.id} className="user-extra-vless-item">
                        <div className="user-extra-vless-meta">
                          <strong>{link.label}</strong>
                          <span className="mono user-extra-vless-uri" title={link.uri}>
                            {link.uri.length > 72 ? `${link.uri.slice(0, 72)}…` : link.uri}
                          </span>
                        </div>
                        <div className="user-extra-vless-actions">
                          <button
                            type="button"
                            className="ghost btn-sm"
                            disabled={saving}
                            onClick={() => openEditVlessModal(link)}
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            className="ghost btn-sm err-text"
                            disabled={saving}
                            onClick={() => removeExtraVless(link.id)}
                          >
                            Удалить
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </form>

        <div className="modal-footer user-modal-footer">
          <button type="button" className="ghost" onClick={() => onClose()}>
            Закрыть
          </button>
          {!isCreate && user && onOpenWebAppPreview ? (
            <button
              type="button"
              className="ghost"
              disabled={saving || !String(user.tg_id || "").trim()}
              title={String(user.tg_id || "").trim() ? "Открыть превью WebApp" : "Нет Telegram ID"}
              onClick={() => onOpenWebAppPreview(user)}
            >
              Превью WebApp
            </button>
          ) : null}
          <button type="submit" form={formId} className="primary" disabled={saving}>
            {saving ? (
              <>
                <Spinner /> {isCreate ? "Создание…" : "Сохранение…"}
              </>
            ) : isCreate ? (
              "Создать клиента"
            ) : (
              "Сохранить"
            )}
          </button>
        </div>
      </div>

      <DualListPicker
        open={serverPickerOpen}
        title="Серверы в подписке"
        leftLabel="Доступные серверы"
        rightLabel="В подписке"
        items={serverPickerItems}
        selectedIds={selectedServerIds}
        requireSelection
        onClose={() => setServerPickerOpen(false)}
        onSave={(ids) => {
          setSelectedServerIds(ids);
          setServerPickerOpen(false);
        }}
      />
    </div>

    <AddVlessKeyModal
      open={addVlessOpen}
      editLink={editingVlessLink}
      onClose={closeVlessModal}
      onSave={(uri, editId) => saveExtraVlessUri(uri, editId)}
    />
    </>,
    document.body,
  );
}
