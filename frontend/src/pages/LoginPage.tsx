import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login, loginVerifyCode } from "../api";
import AmbientThemeDock from "../components/AmbientThemeDock";

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const nav = useNavigate();
  const location = useLocation();
  const sessionExpired = Boolean((location.state as { sessionExpired?: boolean } | null)?.sessionExpired);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastCodeAttempt = useRef("");

  const verifyCode = useCallback(
    async (codeValue: string) => {
      setErr(null);
      setLoading(true);
      try {
        await loginVerifyCode(codeValue);
        onSuccess();
        nav("/servers", { replace: true });
      } catch (e) {
        const txt = String(e);
        if (txt.includes("2fa_code_expired")) {
          setErr("Код истёк. Введите логин и пароль снова.");
          setAwaitingCode(false);
          setCode("");
          lastCodeAttempt.current = "";
          return;
        }
        if (txt.includes("2fa_code_invalid")) {
          setErr("Неверный код авторизации.");
          setCode("");
          lastCodeAttempt.current = "";
          return;
        }
        if (txt.includes("no_pending_2fa")) {
          setErr("Сессия авторизации не найдена. Введите логин и пароль снова.");
          setAwaitingCode(false);
          setCode("");
          lastCodeAttempt.current = "";
          return;
        }
        setErr("Ошибка проверки кода.");
        setCode("");
        lastCodeAttempt.current = "";
      } finally {
        setLoading(false);
      }
    },
    [nav, onSuccess],
  );

  useEffect(() => {
    if (!awaitingCode || code.length !== 4 || loading) return;
    if (lastCodeAttempt.current === code) return;
    lastCodeAttempt.current = code;
    void verifyCode(code);
  }, [awaitingCode, code, loading, verifyCode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (awaitingCode) {
      if (code.length === 4 && !loading) {
        lastCodeAttempt.current = "";
        await verifyCode(code);
      }
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const res = await login(username, password);
      if (res.ok) {
        onSuccess();
        nav("/servers", { replace: true });
        return;
      }
      if (res.requires_code) {
        setAwaitingCode(true);
        setCode("");
        lastCodeAttempt.current = "";
        setErr(null);
        return;
      }
      setErr("Не удалось начать вход.");
    } catch (e) {
      const txt = String(e);
      if (txt.includes("2fa_delivery_failed")) {
        setErr("Не удалось отправить код в Telegram. Проверьте TELEGRAM_BOT_TOKEN и доступ бота.");
        return;
      }
      setErr("Неверный логин или пароль.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <AmbientThemeDock />
      <div className="login-page__content">
        <div className="login-card">
          <div className="login-card__glow" aria-hidden />
          <div className="login-card__head">
            <div className="login-card__logo" aria-hidden>
              <span className="login-card__logo-mark">◆</span>
            </div>
            <h1 className="login-card__title">Панель управления</h1>
            <p className="login-card__sub">
              {awaitingCode ? "Введите код из Telegram" : "Вход в панель управления"}
            </p>
          </div>

          {sessionExpired ? (
            <div className="flash err login-card__flash">Сессия завершена из‑за бездействия. Войдите снова.</div>
          ) : null}

          <form className="login-form" onSubmit={onSubmit}>
            {!awaitingCode ? (
              <>
                <label className="login-field">
                  <span className="login-field__label">Логин</span>
                  <input
                    className="login-field__input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    placeholder="admin"
                  />
                </label>
                <label className="login-field">
                  <span className="login-field__label">Пароль</span>
                  <input
                    className="login-field__input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </label>
              </>
            ) : (
              <label className="login-field">
                <span className="login-field__label">Код авторизации</span>
                <input
                  className="login-field__input login-field__input--code"
                  value={code}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\D/g, "").slice(0, 4);
                    if (next.length < 4) lastCodeAttempt.current = "";
                    setCode(next);
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="• • • •"
                  autoFocus
                />
                <span className="login-field__hint">
                  {loading ? "Проверяем код…" : "Код отправлен в Telegram администратору."}
                </span>
              </label>
            )}

            {err ? <div className="flash err login-card__flash">{err}</div> : null}

            <div className="login-form__actions">
              {!awaitingCode ? (
                <button className="primary login-form__submit" type="submit" disabled={loading}>
                  {loading ? "Проверка…" : "Войти"}
                </button>
              ) : (
                <button
                  className="ghost login-form__back"
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setAwaitingCode(false);
                    setCode("");
                    lastCodeAttempt.current = "";
                    setErr(null);
                  }}
                >
                  Назад
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
