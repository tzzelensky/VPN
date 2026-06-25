import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
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
import type { ExtraVlessLinkDto } from "../api";
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

export type UserModalMode = "create" | "edit";

function sanitizePositiveIntInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  const n = Math.max(1, Math.floor(Number(digits) || 1));
  return String(n);
}

type Props = {
  open: boolean;
  mode: UserModalMode;
  user: UserDto | null;
  /** Развёрнутые серверы (порядок — как в API, обычно по id). */
  deployedServers: ServerDto[];
  onClose: () => void;
  onCreate: (payload: CreateUserPayload) => void | Promise<void>;
  onUpdate: (id: number, payload: CreateUserPayload) => Promise<void>;
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

export default function UserModal({
  open,
  mode,
  user,
  deployedServers,
  onClose,
  onCreate,
  onUpdate,
}: Props) {
  const [enable, setEnable] = useState(true);
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
  const [speedLimitMbps, setSpeedLimitMbps] = useState("");
  const [shopPlans, setShopPlans] = useState<SubscriptionShopPlanDto[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState(0);
  const [saving, setSaving] = useState(false);
  const [expiryNotifyBusy, setExpiryNotifyBusy] = useState(false);
  const [expiryNotifyFlash, setExpiryNotifyFlash] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [extraVlessLinks, setExtraVlessLinks] = useState<ExtraVlessLinkDto[]>([]);
  const [addVlessOpen, setAddVlessOpen] = useState(false);
  const [editingVlessLink, setEditingVlessLink] = useState<ExtraVlessLinkDto | null>(null);
  const planTouchedRef = useRef(false);
  const formInitKeyRef = useRef("");

  useEffect(() => {
    if (!open) setExpiryNotifyFlash(null);
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
      setEmail("");
      setRemark("");
      setTgId("");
      setComment("");
      setTotalGb("0");
      setExpiryMs(0);
      setSelectedServerIds(deployedIdsOrdered(deployedServers));
      setSpeedLimitMbps("");
      setSelectedPlanId(0);
      setExtraVlessLinks([]);
      return;
    }
    if (!user) return;
    const initKey = `edit:${userId}`;
    if (formInitKeyRef.current === initKey) return;
    formInitKeyRef.current = initKey;
    setEnable(user.enable);
    setEmail(user.email);
    setRemark(user.name);
    setUuid(user.vless_uuid);
    setSubToken(user.sub_token);
    setTgId(user.tg_id);
    setComment(user.comment);
    setTotalGb(String(user.total_gb ?? 0));
    setExpiryMs(Number(user.expiry_time) > 0 ? Number(user.expiry_time) : 0);
    setSelectedServerIds(serverIdsFromUser(user, deployedServers));
    setSpeedLimitMbps(
      Number(user.speed_limit_mbps) > 0 ? String(Math.floor(Number(user.speed_limit_mbps))) : "",
    );
    setExtraVlessLinks(user.extra_vless_links?.length ? [...user.extra_vless_links] : []);
  }, [open, mode, userId, user, deployedServers]);

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

  function parseSpeedLimitMbps(raw: string): number {
    const n = Math.floor(Number(String(raw).replace(",", ".")) || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(9999, n);
  }

  function buildPayload(): CreateUserPayload {
    const base: CreateUserPayload = {
      name: remark.trim() || email.trim() || "Пользователь",
      email: email.trim() || remark.trim() || "user",
      flow: FLOW_FIXED,
      total_gb: Math.max(0, Math.min(1e9, Number.parseFloat(String(totalGb).replace(",", ".")) || 0)),
      expiry_time: expiryMs > 0 && Number.isFinite(expiryMs) ? expiryMs : 0,
      enable,
      tg_id: tgId.trim(),
      comment: comment.trim(),
      subscription_server_ids: selectedServerIds,
      speed_limit_mbps: parseSpeedLimitMbps(speedLimitMbps),
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
    setEditingVlessLink(null);
    setAddVlessOpen(true);
  }

  function openEditVlessModal(link: ExtraVlessLinkDto) {
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

  const deployedTotal = deployedServers.length;
  const selectedCount = selectedServerIds.length;
  const allSelected = deployedTotal > 0 && selectedCount >= deployedTotal;

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
    <div
      className="modal-backdrop modal-backdrop--admin"
      role="presentation"
    >
      <div
        className="modal user-modal-panel"
        role="dialog"
        aria-labelledby="user-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head user-modal-head">
          <div>
            <h2 id="user-modal-title">{isCreate ? "Новый клиент" : "Клиент"}</h2>
            <p className="user-modal-sub">Лимиты, срок и список узлов в подписке</p>
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
          <section className="user-modal-card">
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
            <p className="user-modal-hint" style={{ margin: 0 }}>
              Параметры VLESS / REALITY (порт, pbk, SNI, flow) настраиваются в карточке сервера → «Настройки подписки».
            </p>
          </section>

          <section className="user-modal-card">
            <h3 className="user-modal-section-title">Профиль</h3>
            <div className="user-form-grid">
              <div className="form-field">
                <label>Email / метка</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email или логин" autoComplete="off" />
              </div>
              <div className="form-field">
                <label>Имя в подписке (remark)</label>
                <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="🇳🇱 VPN" />
              </div>
              <div className="form-field">
                <label>Telegram Chat ID получателя</label>
                <input
                  value={tgId}
                  onChange={(e) => setTgId(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder="числовой id из @userinfobot"
                />
                <p className="field-hint">Укажите id пользователя, которому выдали эту подписку — бот покажет ему статистику и ссылку.</p>
                {!isCreate &&
                user &&
                (userExpiryNotifyEligible({ tg_id: tgId, expiry_time: expiryMs }) ||
                  userExpiredNotifyEligible({ tg_id: tgId, expiry_time: expiryMs })) ? (
                  <div className="expiry-notify-block" style={{ marginTop: "0.55rem" }}>
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
                      <p
                        className={expiryNotifyFlash.type === "ok" ? "field-hint" : "field-hint err"}
                        style={{ marginTop: "0.35rem", marginBottom: 0 }}
                      >
                        {expiryNotifyFlash.text}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="form-field form-field-span-2">
                <label>Информация о клиенте (только в панели)</label>
                <textarea
                  className="user-modal-textarea"
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Например: Для мамы, тариф по договоренности, важные заметки..."
                />
              </div>
            </div>
          </section>

          <section className="user-modal-card user-modal-card-highlight">
            <h3 className="user-modal-section-title">Лимиты и подписка</h3>
            <div className="user-form-grid">
              <div className="form-field form-field-span-2">
                <label>Тариф</label>
                <p className="field-hint" style={{ marginTop: 0, marginBottom: "0.45rem" }}>
                  Сейчас: <b>{currentPlanLabel}</b>
                </p>
                <select
                  value={String(selectedPlanId)}
                  onChange={(e) => applyPlan(Number(e.target.value) || 0)}
                  disabled={saving || shopPlans.length === 0}
                >
                  <option value="0">Индивидуальный (ручные лимиты)</option>
                  {shopPlans.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {planOptionLabel(p)}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  Список и параметры тарифов — из раздела «Подписки». При выборе тарифа обновляются лимит ГБ и срок
                  подписки.
                </p>
              </div>
              <div className="form-field">
                <label>Общий лимит трафика (GB)</label>
                <input
                  value={totalGb}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTotalGb(v);
                    planTouchedRef.current = true;
                    const gb = Math.max(0, Number.parseFloat(v.replace(",", ".")) || 0);
                    setSelectedPlanId(detectPlanId(gb, shopPlans));
                  }}
                  inputMode="decimal"
                  placeholder="0 = без лимита"
                />
                <p className="field-hint">
                  Трафик и «Онлайн» подтягиваются с узлов при обновлении списка клиентов (Xray statsquery). Здесь можно
                  скорректировать вручную при необходимости.
                </p>
              </div>
              <div className="form-field">
                <label>Дата окончания</label>
                <ExpiryDateTimePicker valueMs={expiryMs} onChangeMs={setExpiryMs} disabled={saving} />
                <p className="field-hint">
                  Пусто / «Без срока» — без ограничения по времени. Если дата задана, окончание — в <b>12:00</b> этого дня
                  (по времени браузера).
                </p>
              </div>
              <div className="form-field form-field-span-2">
                <label>Серверы в подписке</label>
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
                <p className="field-hint">
                  Как в «Коммуникациях»: переносите узлы вправо. По умолчанию в подписке все развёрнутые серверы.
                </p>
              </div>
              <div className="form-field form-field-span-2">
                <label>Ограничение скорости, Мбит/с</label>
                <input
                  value={speedLimitMbps}
                  onChange={(e) => setSpeedLimitMbps(sanitizePositiveIntInput(e.target.value))}
                  onBlur={() => setSpeedLimitMbps((v) => (v ? sanitizePositiveIntInput(v) : ""))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="0 = без лимита"
                  disabled={saving}
                  style={{ maxWidth: "180px" }}
                />
                <p className="field-hint">
                  По умолчанию выключено. Пусто или 0 — без ограничения. Лимит применяется на узлах Xray только к этому
                  пользователю.
                </p>
              </div>
            </div>
          </section>

          {!isCreate && user ? (
            <section className="user-modal-card">
              <h3 className="user-modal-section-title">Идентификаторы</h3>
              <div className="user-form-grid">
                <div className="form-field">
                  <label>UUID</label>
                  <input className="mono" value={uuid} readOnly title="Задаётся при создании" />
                </div>
                <div className="form-field">
                  <label>Subscription ID</label>
                  <input className="mono" value={subToken} readOnly title="Токен URL подписки" />
                </div>
              </div>
            </section>
          ) : (
            <section className="user-modal-card user-modal-card-muted">
              <p className="user-modal-hint" style={{ margin: 0 }}>
                После создания здесь появятся UUID и subscription id — их можно скопировать в списке клиентов.
              </p>
            </section>
          )}

          <section className="user-modal-card">
            <div className="user-modal-section-head">
              <h3 className="user-modal-section-title">Дополнительные VLESS ключи</h3>
              <button type="button" className="ghost btn-sm" disabled={saving} onClick={openAddVlessModal}>
                Добавить vless ключ
              </button>
            </div>
            <p className="user-modal-hint" style={{ marginTop: 0 }}>
              Вручную добавленные ссылки попадают в подписку клиента вместе с узлами панели. На сервера Xray не
              деплоятся.
            </p>
            {extraVlessLinks.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
                Нет дополнительных ключей.
              </p>
            ) : (
              <ul className="user-extra-vless-list">
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
          </section>
        </form>

        <div className="modal-footer user-modal-footer">
          <button type="button" className="ghost" onClick={() => onClose()}>
            Закрыть
          </button>
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
