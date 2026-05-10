import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "../api";

export default function DashboardLayout({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  const nav = useNavigate();

  async function doLogout() {
    await logout();
    onLogout();
    nav("/login", { replace: true });
  }

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">Панель управления</div>
        <nav className="nav-tabs">
          <NavLink to="/servers" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Сервера
          </NavLink>
          <NavLink to="/users" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Пользователи
          </NavLink>
          <NavLink
            to="/subscription-shop"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Подписки
          </NavLink>
          <NavLink
            to="/communications"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Коммуникации
          </NavLink>
          <NavLink
            to="/referral-program"
            className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          >
            Реферальная программа
          </NavLink>
          <NavLink to="/promo-codes" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Промокоды
          </NavLink>
          <NavLink to="/dropper-game" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
            Игра
          </NavLink>
        </nav>
        <button type="button" className="ghost" onClick={() => void doLogout()}>
          Выйти
        </button>
      </header>
      {children}
    </div>
  );
}
