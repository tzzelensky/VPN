import { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { logout } from "../api";
import { isAdminMobileShell } from "../adminMobile";
import { clearUsersListCache } from "../usersListCache";

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: "/servers", label: "Сервера" },
  { to: "/users", label: "Пользователи" },
  { to: "/subscription-shop", label: "Подписки" },
  { to: "/communications", label: "Коммуникации" },
  { to: "/referral-program", label: "Реферальная программа" },
  { to: "/promo-codes", label: "Промокоды" },
  { to: "/dropper-game", label: "Игра" },
];

export default function DashboardLayout({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  const nav = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileShell, setMobileShell] = useState(() => isAdminMobileShell());

  useEffect(() => {
    setMobileShell(isAdminMobileShell());
    const mq = window.matchMedia("(max-width: 960px)");
    const onMq = () => setMobileShell(isAdminMobileShell());
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileShell) return;
    document.documentElement.classList.add("admin-mobile-app");
    return () => document.documentElement.classList.remove("admin-mobile-app");
  }, [mobileShell]);

  async function doLogout() {
    setDrawerOpen(false);
    await logout();
    clearUsersListCache();
    onLogout();
    nav("/login", { replace: true });
  }

  const navLinks = (
    <>
      {NAV_ITEMS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
          onClick={() => setDrawerOpen(false)}
        >
          {label}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className={`layout ${mobileShell ? "layout--mobile-shell" : ""}`.trim()}>
      <header className="topbar">
        {mobileShell ? (
          <button
            type="button"
            className="admin-menu-btn"
            aria-label="Открыть меню"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <span className="admin-menu-btn-icon" aria-hidden />
          </button>
        ) : null}
        <div className="brand">Панель управления</div>
        {!mobileShell ? <nav className="nav-tabs">{navLinks}</nav> : null}
        {!mobileShell ? (
          <button type="button" className="ghost" onClick={() => void doLogout()}>
            Выйти
          </button>
        ) : null}
      </header>

      {mobileShell && drawerOpen ? (
        <div
          className="admin-drawer-backdrop"
          role="presentation"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      {mobileShell ? (
        <aside className={`admin-drawer ${drawerOpen ? "admin-drawer--open" : ""}`.trim()} aria-hidden={!drawerOpen}>
          <div className="admin-drawer-head">
            <span className="admin-drawer-title">Разделы</span>
            <button
              type="button"
              className="ghost admin-drawer-close"
              aria-label="Закрыть меню"
              onClick={() => setDrawerOpen(false)}
            >
              ×
            </button>
          </div>
          <nav className="admin-drawer-nav">{navLinks}</nav>
          <div className="admin-drawer-footer">
            <button type="button" className="primary admin-drawer-logout" onClick={() => void doLogout()}>
              Выйти
            </button>
          </div>
        </aside>
      ) : null}

      <main className="layout-main">{children}</main>
    </div>
  );
}
