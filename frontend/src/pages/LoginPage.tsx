import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api";

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const nav = useNavigate();
  const [username, setUsername] = useState("tzadmin");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(username, password);
      onSuccess();
      nav("/servers", { replace: true });
    } catch {
      setErr("Неверный логин или пароль.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="panel login-card">
        <div className="brand" style={{ marginBottom: "0.25rem" }}>
          VPN Admin
        </div>
        <p className="sub" style={{ marginBottom: "1rem" }}>
          Вход в панель управления
        </p>
        <form className="stack-sm" onSubmit={onSubmit}>
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
          {err ? <div className="flash err">{err}</div> : null}
          <div className="row-actions" style={{ marginTop: "0.5rem" }}>
            <button className="primary" type="submit" disabled={loading}>
              {loading ? "Вход…" : "Войти"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
