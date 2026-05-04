import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, loginVerifyCode } from "../api";

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (!awaitingCode) {
        const res = await login(username, password);
        if (res.ok) {
          onSuccess();
          nav("/servers", { replace: true });
          return;
        }
        if (res.requires_code) {
          setAwaitingCode(true);
          setErr(null);
          return;
        }
        setErr("Не удалось начать вход.");
        return;
      }
      await loginVerifyCode(code);
      onSuccess();
      nav("/servers", { replace: true });
    } catch (e) {
      const txt = String(e);
      if (!awaitingCode) {
        if (txt.includes("2fa_delivery_failed")) {
          setErr("Не удалось отправить код в Telegram. Проверьте TELEGRAM_BOT_TOKEN и доступ бота.");
          return;
        }
        setErr("Неверный логин или пароль.");
        return;
      }
      if (txt.includes("2fa_code_expired")) {
        setErr("Код истёк. Введите логин и пароль снова.");
        setAwaitingCode(false);
        setCode("");
        return;
      }
      if (txt.includes("2fa_code_invalid")) {
        setErr("Неверный код авторизации.");
        return;
      }
      if (txt.includes("no_pending_2fa")) {
        setErr("Сессия авторизации не найдена. Введите логин и пароль снова.");
        setAwaitingCode(false);
        setCode("");
        return;
      }
      setErr("Ошибка проверки кода.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="panel login-card">
        <div className="brand" style={{ marginBottom: "0.25rem" }}>
          Панель управления
        </div>
        <p className="sub" style={{ marginBottom: "1rem" }}>
          {awaitingCode ? "Введите код из Telegram" : "Вход в панель управления"}
        </p>
        <form className="stack-sm" onSubmit={onSubmit}>
          {!awaitingCode ? (
            <>
              <div>
                <label htmlFor="u">Логин</label>
                <input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              </div>
              <div>
                <label htmlFor="p">Пароль</label>
                <input
                  id="p"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </>
          ) : (
            <div>
              <label htmlFor="code">Код авторизации</label>
              <input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="4 цифры"
              />
              <p className="field-hint" style={{ marginTop: "0.4rem" }}>
                Код отправлен в Telegram администратору.
              </p>
            </div>
          )}
          {err ? <div className="flash err">{err}</div> : null}
          <div className="row-actions" style={{ marginTop: "0.5rem" }}>
            <button className="primary" type="submit" disabled={loading}>
              {loading ? "Проверка…" : awaitingCode ? "Подтвердить код" : "Войти"}
            </button>
            {awaitingCode ? (
              <button
                className="ghost"
                type="button"
                disabled={loading}
                onClick={() => {
                  setAwaitingCode(false);
                  setCode("");
                  setErr(null);
                }}
              >
                Назад
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
