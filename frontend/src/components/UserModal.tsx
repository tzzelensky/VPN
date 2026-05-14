import { FormEvent, useEffect, useState } from "react";
import { fetchRealityKeyPair, notifyUserExpiring, type CreateUserPayload, type ServerDto, type UserDto } from "../api";
import { formatNotifyExpiryError, userExpiryNotifyEligible } from "../expiryNotify";
import ExpiryDateTimePicker from "./ExpiryDateTimePicker";
import Spinner from "./Spinner";

const FLOW_FIXED = "xtls-rprx-vision";

const REALITY_SNI_PRESETS = [
  "www.oracle.com",
  "www.microsoft.com",
  "www.cloudflare.com",
  "dl.google.com",
  "github.com",
  "www.apple.com",
] as const;

const SNI_CUSTOM = "__custom__";

export type UserModalMode = "create" | "edit";

function randomShortIdHex(): string {
  const a = new Uint8Array(3);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
  onCreate: (payload: CreateUserPayload) => Promise<void>;
  onUpdate: (id: number, payload: CreateUserPayload) => Promise<void>;
};

function serverSegLabel(s: ServerDto): string {
  const flag = (s.country_flag || "").trim();
  const cc = (s.country_code || "").trim().toUpperCase();
  const prefix = flag || (cc ? `[${cc}]` : "");
  const name = (s.name || s.host || "узел").trim();
  return prefix ? `${prefix} ${name}` : name;
}

function buildServerCountOptions(servers: ServerDto[]): { value: number; label: string; title: string }[] {
  const ord = [...servers].sort((a, b) => a.id - b.id);
  if (ord.length === 0) {
    return [{ value: 0, label: "Все развёрнутые (узлов пока нет)", title: "Добавьте и разверните VLESS на сервере" }];
  }
  const out: { value: number; label: string; title: string }[] = [];
  out.push({
    value: 0,
    label: `Все развёрнутые (${ord.length})`,
    title: "В подписке все узлы подряд, как в списке «Серверы»",
  });
  for (let n = 1; n <= ord.length; n++) {
    const slice = ord.slice(0, n);
    const full = `Только: ${slice.map(serverSegLabel).join(" · ")}`;
    const label = full.length > 56 ? `${full.slice(0, 53)}…` : full;
    out.push({ value: n, label, title: full });
  }
  return out;
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
  const [serverCount, setServerCount] = useState(0);
  const [deviceLimitEnabled, setDeviceLimitEnabled] = useState(false);
  const [deviceLimitCount, setDeviceLimitCount] = useState("2");
  const [speedLimitMbps, setSpeedLimitMbps] = useState("");
  const [whitelistHappEnabled, setWhitelistHappEnabled] = useState(false);
  const [remotePort, setRemotePort] = useState("");
  const [realityPbk, setRealityPbk] = useState("");
  const [realityFp, setRealityFp] = useState("chrome");
  const [sniMode, setSniMode] = useState<string>(REALITY_SNI_PRESETS[0]);
  const [sniCustom, setSniCustom] = useState("");
  const [realitySid, setRealitySid] = useState("");
  const [realitySpx, setRealitySpx] = useState("/");
  const [saving, setSaving] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [expiryNotifyBusy, setExpiryNotifyBusy] = useState(false);
  const [expiryNotifyFlash, setExpiryNotifyFlash] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!open) setExpiryNotifyFlash(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setEnable(true);
      setEmail("");
      setRemark("");
      setTgId("");
      setComment("");
      setTotalGb("0");
      setExpiryMs(0);
      setServerCount(0);
      setDeviceLimitEnabled(false);
      setDeviceLimitCount("2");
      setSpeedLimitMbps("");
      setWhitelistHappEnabled(false);
      setRemotePort("");
      setRealityPbk("");
      setRealityFp("chrome");
      setSniMode(REALITY_SNI_PRESETS[0]);
      setSniCustom("");
      setRealitySid(randomShortIdHex());
      setRealitySpx("/");
      return;
    }
    if (!user) return;
    setEnable(user.enable);
    setEmail(user.email);
    setRemark(user.name);
    setUuid(user.vless_uuid);
    setSubToken(user.sub_token);
    setTgId(user.tg_id);
    setComment(user.comment);
    setTotalGb(String(user.total_gb ?? 0));
    setExpiryMs(Number(user.expiry_time) > 0 ? Number(user.expiry_time) : 0);
    setServerCount(Math.max(0, Math.floor(Number(user.subscription_server_count) || 0)));
    setDeviceLimitEnabled(Boolean(user.device_limit_enabled));
    setDeviceLimitCount(String(Math.max(1, Math.floor(Number(user.device_limit_count) || 1))));
    setSpeedLimitMbps(
      Number(user.speed_limit_mbps) > 0 ? String(Math.floor(Number(user.speed_limit_mbps))) : "",
    );
    setWhitelistHappEnabled(Boolean(user.whitelist_happ_enabled));
    setRemotePort(user.remote_port != null ? String(user.remote_port) : "");
    setRealityPbk(user.reality_pbk ?? "");
    setRealityFp(user.reality_fp || "chrome");
    const sni = (user.reality_sni ?? "").trim();
    if (REALITY_SNI_PRESETS.includes(sni as (typeof REALITY_SNI_PRESETS)[number])) {
      setSniMode(sni);
      setSniCustom("");
    } else {
      setSniMode(SNI_CUSTOM);
      setSniCustom(sni);
    }
    setRealitySid(user.reality_sid ?? "");
    setRealitySpx(user.reality_spx || "/");
  }, [open, mode, user]);

  useEffect(() => {
    if (!open) return;
    const m = deployedServers.length;
    setServerCount((c) => {
      if (m === 0) return 0;
      return c > m ? m : c < 0 ? 0 : c;
    });
  }, [open, deployedServers]);

  if (!open) return null;
  if (mode === "edit" && !user) return null;

  const formId = "user-form-main";
  const isCreate = mode === "create";

  function effectiveSni(): string {
    if (sniMode === SNI_CUSTOM) return sniCustom.trim();
    return sniMode;
  }

  function parseSpeedLimitMbps(raw: string): number {
    const n = Math.floor(Number(String(raw).replace(",", ".")) || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(9999, n);
  }

  function buildPayload(): CreateUserPayload {
    const rp = remotePort.trim() ? Number(remotePort) : null;
    const base: CreateUserPayload = {
      name: remark.trim() || email.trim() || "Пользователь",
      email: email.trim() || remark.trim() || "user",
      flow: FLOW_FIXED,
      total_gb: Math.max(0, Math.min(1e9, Number.parseFloat(String(totalGb).replace(",", ".")) || 0)),
      expiry_time: expiryMs > 0 && Number.isFinite(expiryMs) ? expiryMs : 0,
      enable,
      tg_id: tgId.trim(),
      comment: comment.trim(),
      remote_port: rp != null && rp > 0 ? rp : null,
      reality_pbk: realityPbk.trim() || undefined,
      reality_fp: realityFp.trim() || undefined,
      reality_sni: effectiveSni() || "www.oracle.com",
      reality_sid: realitySid.trim() || undefined,
      reality_spx: realitySpx.trim() || undefined,
      subscription_server_count: serverCount,
      device_limit_enabled: deviceLimitEnabled,
      device_limit_count: Math.max(1, Math.floor(Number(deviceLimitCount) || 1)),
      speed_limit_mbps: parseSpeedLimitMbps(speedLimitMbps),
      whitelist_happ_enabled: whitelistHappEnabled,
    };
    if (isCreate) return base;
    return {
      ...base,
      vless_uuid: uuid.trim(),
      sub_token: subToken.trim() || undefined,
    };
  }

  async function save() {
    setSaving(true);
    try {
      if (isCreate) await onCreate(buildPayload());
      else if (user) await onUpdate(user.id, buildPayload());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    await save();
  }

  async function generatePbk() {
    setKeyBusy(true);
    try {
      const p = await fetchRealityKeyPair();
      setRealityPbk(p.publicKey);
      window.prompt(
        "Скопируйте приватный ключ и укажите его в Xray inbound (realitySettings.privateKey). Публичный ключ уже в поле pbk.",
        p.privateKey,
      );
    } catch (err) {
      window.alert(String(err));
    } finally {
      setKeyBusy(false);
    }
  }

  const serverOptions = buildServerCountOptions(deployedServers);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
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
            <p className="user-modal-flow">
              Flow для ссылок: <span className="mono">{FLOW_FIXED}</span>
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
                {!isCreate && user && userExpiryNotifyEligible({ tg_id: tgId, expiry_time: expiryMs }) ? (
                  <div className="expiry-notify-block" style={{ marginTop: "0.55rem" }}>
                    <button
                      type="button"
                      className="ghost"
                      disabled={expiryNotifyBusy || saving}
                      onClick={() => {
                        void (async () => {
                          setExpiryNotifyFlash(null);
                          setExpiryNotifyBusy(true);
                          try {
                            await notifyUserExpiring(user.id, { tg_id: tgId, expiry_time: expiryMs });
                            setExpiryNotifyFlash({ type: "ok", text: "Сообщение отправлено в Telegram." });
                          } catch (e) {
                            setExpiryNotifyFlash({
                              type: "err",
                              text: formatNotifyExpiryError(String(e)),
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
              <div className="form-field">
                <label>Общий лимит трафика (GB)</label>
                <input
                  value={totalGb}
                  onChange={(e) => setTotalGb(e.target.value)}
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
                <label>Серверов в подписке</label>
                <div className="seg-row" role="group" aria-label="Число узлов в подписке">
                  {serverOptions.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={`seg-btn ${serverCount === o.value ? "active" : ""}`}
                      title={o.title || o.label}
                      onClick={() => setServerCount(o.value)}
                      disabled={saving}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="field-hint">Порядок — как в списке «Серверы» (по id). «Все» = каждый развёрнутый узел.</p>
              </div>
              <div className="form-field form-field-span-2">
                <label>Ограничение по устройствам</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                  <button
                    type="button"
                    className={`toggle ${deviceLimitEnabled ? "on" : ""}`}
                    onClick={() => setDeviceLimitEnabled((v) => !v)}
                    disabled={saving}
                    aria-pressed={deviceLimitEnabled}
                    title={deviceLimitEnabled ? "Отключить лимит устройств" : "Включить лимит устройств"}
                  />
                  <input
                    value={deviceLimitCount}
                    onChange={(e) => setDeviceLimitCount(sanitizePositiveIntInput(e.target.value))}
                    onBlur={() => setDeviceLimitCount((v) => (v ? sanitizePositiveIntInput(v) : "1"))}
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    placeholder="Количество"
                    disabled={!deviceLimitEnabled || saving}
                    style={{ width: "130px" }}
                  />
                </div>
                <p className="field-hint">По умолчанию выключено. При превышении клиент получает заглушку вместо серверов.</p>
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
              <div className="form-field form-field-span-2">
                <label>Включить белые списки</label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                  <button
                    type="button"
                    className={`toggle ${whitelistHappEnabled ? "on" : ""}`}
                    onClick={() => setWhitelistHappEnabled((v) => !v)}
                    disabled={saving}
                    aria-pressed={whitelistHappEnabled}
                    title={whitelistHappEnabled ? "Отключить режим белых списков" : "Включить режим белых списков"}
                  />
                </div>
                <p className="field-hint">
                  По умолчанию выключено. Если включено: к обычной подписке в конце добавляются <b>последние 4</b> узла
                  (те же VLESS-строки, что соответствуют блоку белых списков) и строка <span className="mono">happ://…</span>
                  с конфигом Happ.
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
            <h3 className="user-modal-section-title">Reality</h3>
            <div className="user-form-grid">
              <div className="form-field">
                <label>Порт в ссылке</label>
                <input
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                  placeholder="пусто = порт сервера"
                />
              </div>
              <div className="form-field">
                <label>Reality pbk</label>
                <div className="input-with-action user-modal-input-action">
                  <input className="mono" value={realityPbk} onChange={(e) => setRealityPbk(e.target.value)} placeholder="публичный ключ" />
                  <button
                    type="button"
                    className="ghost icon-btn"
                    title="Сгенерировать пару ключей"
                    disabled={keyBusy}
                    onClick={() => void generatePbk()}
                  >
                    {keyBusy ? <Spinner /> : "Ключ"}
                  </button>
                </div>
              </div>
              <div className="form-field">
                <label>Reality fp</label>
                <input value={realityFp} onChange={(e) => setRealityFp(e.target.value)} />
              </div>
              <div className="form-field">
                <label>Reality spiderX</label>
                <input value={realitySpx} onChange={(e) => setRealitySpx(e.target.value)} />
              </div>
              <div className="form-field form-field-span-2 sni-block user-modal-sni">
                <label>Reality SNI</label>
                <select value={sniMode} onChange={(e) => setSniMode(e.target.value)}>
                  {REALITY_SNI_PRESETS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                  <option value={SNI_CUSTOM}>Другой…</option>
                </select>
                {sniMode === SNI_CUSTOM ? (
                  <input
                    className="sni-custom-input"
                    value={sniCustom}
                    onChange={(e) => setSniCustom(e.target.value)}
                    placeholder="ваш домен для SNI"
                  />
                ) : null}
              </div>
              <div className="form-field">
                <label>Reality shortId</label>
                <div className="input-with-action user-modal-input-action">
                  <input className="mono" value={realitySid} onChange={(e) => setRealitySid(e.target.value)} />
                  <button type="button" className="ghost icon-btn" title="Сгенерировать shortId" onClick={() => setRealitySid(randomShortIdHex())}>
                    ↻
                  </button>
                </div>
              </div>
            </div>
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
    </div>
  );
}
