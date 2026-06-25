import { FormEvent, useCallback, useEffect, useState, type SVGProps } from "react";
import { addServer } from "../api";
import { COUNTRY_CODES_ALPHA2, countryCodeLabel } from "../countryCodes";
import { countryFlagEmoji } from "../flagEmoji";
import Spinner from "./Spinner";

type FieldKey = "name" | "host" | "sshUser" | "sshPass" | "sshPort" | "vlessPort";
type FieldErrors = Partial<Record<FieldKey, string>>;

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
  onToast: (type: "ok" | "err", text: string) => void;
};

function IconServer(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <rect x="2" y="3" width="20" height="6" rx="1" />
      <rect x="2" y="15" width="20" height="6" rx="1" />
      <circle cx="7" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconSsh(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function IconNetwork(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
    </svg>
  );
}

function IconEye(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...p}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function portError(value: string): string | null {
  const n = Number(value);
  if (!value.trim() || !Number.isInteger(n) || n < 1 || n > 65535) {
    return "Порт должен быть числом от 1 до 65535";
  }
  return null;
}

function validateForm(values: {
  name: string;
  host: string;
  sshUser: string;
  sshPass: string;
  sshPort: string;
  vlessPort: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (values.name.trim().length < 2) errors.name = "Введите название сервера";
  if (!values.host.trim()) errors.host = "Введите IP или домен";
  if (!values.sshUser.trim()) errors.sshUser = "Введите SSH пользователя";
  if (!values.sshPass) errors.sshPass = "Введите SSH пароль";
  const sshPortErr = portError(values.sshPort);
  if (sshPortErr) errors.sshPort = sshPortErr;
  const vlessPortErr = portError(values.vlessPort);
  if (vlessPortErr) errors.vlessPort = vlessPortErr;
  return errors;
}

const DEFAULTS = {
  sshUser: "root",
  sshPort: "22",
  vlessPort: "8443",
};

export default function AddServerModal({ open, onClose, onSuccess, onToast }: Props) {
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [host, setHost] = useState("");
  const [sshUser, setSshUser] = useState(DEFAULTS.sshUser);
  const [sshPass, setSshPass] = useState("");
  const [sshPort, setSshPort] = useState(DEFAULTS.sshPort);
  const [vlessPort, setVlessPort] = useState(DEFAULTS.vlessPort);
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setCountryCode("");
    setHost("");
    setSshUser(DEFAULTS.sshUser);
    setSshPass("");
    setSshPort(DEFAULTS.sshPort);
    setVlessPort(DEFAULTS.vlessPort);
    setShowPass(false);
    setErrors({});
    setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    resetForm();
  }, [open, resetForm]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  function clearFieldError(key: FieldKey) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors = validateForm({ name, host, sshUser, sshPass, sshPort, vlessPort });
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      onToast("err", "Не удалось добавить сервер");
      return;
    }

    setSubmitting(true);
    setErrors({});
    try {
      await addServer({
        name: name.trim(),
        country_code: countryCode || undefined,
        host: host.trim(),
        ssh_user: sshUser.trim(),
        ssh_password: sshPass,
        ssh_port: Number(sshPort),
        vless_port: Number(vlessPort),
      });
      onToast("ok", "Сервер добавлен");
      await onSuccess();
      onClose();
    } catch {
      onToast("err", "Не удалось добавить сервер");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const fieldClass = (key: FieldKey) =>
    `add-server-field${errors[key] ? " add-server-field--error" : ""}`;

  return (
    <div
      className="modal-backdrop add-server-modal-backdrop"
      role="presentation"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="modal add-server-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-server-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head add-server-modal__head">
          <div className="add-server-modal__head-text">
            <div className="add-server-modal__title-row">
              <span className="add-server-modal__title-icon" aria-hidden>
                <IconServer />
              </span>
              <h2 id="add-server-modal-title">Добавить сервер</h2>
            </div>
            <p className="add-server-modal__subtitle">
              Укажите данные VPS, SSH-доступ и параметры VLESS. После добавления сервер появится в подписках
              пользователей.
            </p>
          </div>
          <button
            type="button"
            className="ghost modal-close add-server-modal__close"
            aria-label="Закрыть"
            disabled={submitting}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form className="add-server-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <div className="modal-body add-server-modal__body">
            <section className="add-server-section" aria-labelledby="add-server-section-main">
              <div className="add-server-section__head">
                <span className="add-server-section__icon" aria-hidden>
                  <IconServer />
                </span>
                <h3 id="add-server-section-main" className="add-server-section__title">
                  Основная информация
                </h3>
              </div>
              <div className="add-server-form__grid">
                <label className={fieldClass("name")}>
                  <span className="add-server-field__label">Название в подписке</span>
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      clearFieldError("name");
                    }}
                    placeholder="Например, HSN-VPN"
                    autoComplete="off"
                  />
                  <span className="add-server-field__hint">Будет отображаться у клиента в списке серверов</span>
                  {errors.name ? <span className="add-server-field__error">{errors.name}</span> : null}
                </label>

                <label className="add-server-field">
                  <span className="add-server-field__label">Страна</span>
                  <div className="add-server-select-wrap">
                    <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
                      <option value="">Без флага</option>
                      {COUNTRY_CODES_ALPHA2.map((code) => (
                        <option key={code} value={code}>
                          {countryFlagEmoji(code)} {countryCodeLabel(code)}
                        </option>
                      ))}
                    </select>
                    <span className="add-server-select-wrap__preview" aria-hidden>
                      {countryCode ? countryFlagEmoji(countryCode) : "—"}
                    </span>
                  </div>
                </label>

                <label className={`${fieldClass("host")} add-server-form__span-2`}>
                  <span className="add-server-field__label">IP или домен</span>
                  <input
                    value={host}
                    onChange={(e) => {
                      setHost(e.target.value);
                      clearFieldError("host");
                    }}
                    placeholder="203.0.113.10 или vpn.example.com"
                    autoComplete="off"
                  />
                  <span className="add-server-field__hint">Адрес VPS, на который будет идти подключение</span>
                  {errors.host ? <span className="add-server-field__error">{errors.host}</span> : null}
                </label>
              </div>
            </section>

            <section className="add-server-section" aria-labelledby="add-server-section-ssh">
              <div className="add-server-section__head">
                <span className="add-server-section__icon" aria-hidden>
                  <IconSsh />
                </span>
                <div>
                  <h3 id="add-server-section-ssh" className="add-server-section__title">
                    SSH-доступ
                  </h3>
                  <p className="add-server-section__sub">Используется для проверки сервера и установки Xray</p>
                </div>
              </div>
              <div className="add-server-form__grid">
                <label className={fieldClass("sshUser")}>
                  <span className="add-server-field__label">SSH пользователь</span>
                  <input
                    value={sshUser}
                    onChange={(e) => {
                      setSshUser(e.target.value);
                      clearFieldError("sshUser");
                    }}
                    placeholder="root"
                    autoComplete="off"
                  />
                  {errors.sshUser ? <span className="add-server-field__error">{errors.sshUser}</span> : null}
                </label>

                <label className={fieldClass("sshPort")}>
                  <span className="add-server-field__label">SSH порт</span>
                  <input
                    value={sshPort}
                    onChange={(e) => {
                      setSshPort(e.target.value.replace(/\D/g, "").slice(0, 5));
                      clearFieldError("sshPort");
                    }}
                    inputMode="numeric"
                    placeholder="22"
                    autoComplete="off"
                  />
                  {errors.sshPort ? <span className="add-server-field__error">{errors.sshPort}</span> : null}
                </label>

                <label className={`${fieldClass("sshPass")} add-server-form__span-2`}>
                  <span className="add-server-field__label">SSH пароль</span>
                  <div className="add-server-password">
                    <input
                      type={showPass ? "text" : "password"}
                      value={sshPass}
                      onChange={(e) => {
                        setSshPass(e.target.value);
                        clearFieldError("sshPass");
                      }}
                      placeholder="Введите SSH пароль"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="add-server-password__toggle ghost"
                      aria-label={showPass ? "Скрыть пароль" : "Показать пароль"}
                      onClick={() => setShowPass((v) => !v)}
                    >
                      {showPass ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                  {errors.sshPass ? <span className="add-server-field__error">{errors.sshPass}</span> : null}
                </label>
              </div>
            </section>

            <section className="add-server-section" aria-labelledby="add-server-section-vless">
              <div className="add-server-section__head">
                <span className="add-server-section__icon" aria-hidden>
                  <IconNetwork />
                </span>
                <h3 id="add-server-section-vless" className="add-server-section__title">
                  Параметры VLESS
                </h3>
              </div>
              <div className="add-server-form__grid add-server-form__grid--single">
                <label className={fieldClass("vlessPort")}>
                  <span className="add-server-field__label">Порт VLESS</span>
                  <input
                    value={vlessPort}
                    onChange={(e) => {
                      setVlessPort(e.target.value.replace(/\D/g, "").slice(0, 5));
                      clearFieldError("vlessPort");
                    }}
                    inputMode="numeric"
                    placeholder="8443"
                    autoComplete="off"
                  />
                  <span className="add-server-field__hint">Порт, который будет использоваться для подключения клиентов</span>
                  {errors.vlessPort ? <span className="add-server-field__error">{errors.vlessPort}</span> : null}
                </label>
              </div>
            </section>
          </div>

          <div className="modal-footer add-server-modal__footer">
            <button type="button" className="ghost add-server-modal__cancel" disabled={submitting} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="primary add-server-modal__submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner />
                  <span>Добавляем…</span>
                </>
              ) : (
                "Добавить сервер"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
