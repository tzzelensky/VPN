import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { authMe } from "./api";
import GlobalAmbientBackdrop from "./components/GlobalAmbientBackdrop";
import { PanelSettingsProvider } from "./panelSettingsContext";
import { PanelUpdatesProvider } from "./panelUpdatesContext";
import { prefetchUsersInBackground } from "./usersPrefetch";
import { clearUsersListCache } from "./usersListCache";
import SectionGuard from "./components/SectionGuard";
import HomeRedirect from "./components/HomeRedirect";
import LoginPage from "./pages/LoginPage";
import { usePublicSiteMeta } from "./usePublicSiteMeta";
import ServersPage from "./pages/ServersPage";
import UsersPage from "./pages/UsersPage";
import SubscriptionShopPage from "./pages/SubscriptionShopPage";
import CommunicationsPage from "./pages/CommunicationsPage";
import ReferralProgramPage from "./pages/ReferralProgramPage";
import PromoCodesPage from "./pages/PromoCodesPage";
import ConfigVaultPage from "./pages/ConfigVaultPage";
import WhitelistVaultPage from "./pages/WhitelistVaultPage";
import DropperGamePage from "./pages/DropperGamePage";
import ProxiesPage from "./pages/ProxiesPage";
import SupportAppealsPage from "./pages/SupportAppealsPage";
import LogsPage from "./pages/LogsPage";
import DeviceLimitPage from "./pages/DeviceLimitPage";
import DailyGiftPage from "./pages/DailyGiftPage";
import MySubPage from "./pages/MySubPage";

function useSession() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authMe();
        if (!cancelled) setLoggedIn(r.ok);
      } catch {
        if (!cancelled) setLoggedIn(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loggedIn) {
      clearUsersListCache();
      return;
    }
    void prefetchUsersInBackground();
  }, [loggedIn]);

  return { ready, loggedIn, setLoggedIn };
}

function AuthRoute({
  loggedIn,
  path,
  children,
}: {
  loggedIn: boolean;
  path: string;
  children: ReactNode;
}) {
  if (!loggedIn) {
    return <Navigate to="/login" replace />;
  }
  return <SectionGuard path={path}>{children}</SectionGuard>;
}

function TabIndexRedirect({ base, defaultTab }: { base: string; defaultTab: string }) {
  const location = useLocation();
  return (
    <Navigate to={{ pathname: `${base}/${defaultTab}`, search: location.search }} replace />
  );
}

/** Старые URL `/dropper-game` → `/roulette-game`; вкладки dropper/general → roulette. */
function LegacyDropperGameRedirect() {
  const { tab } = useParams();
  const location = useLocation();
  const keep = tab === "roulette" || tab === "tickets" || tab === "reports" ? tab : "roulette";
  return <Navigate to={{ pathname: `/roulette-game/${keep}`, search: location.search }} replace />;
}

function tabbedRoutes(
  base: string,
  defaultTab: string,
  loggedIn: boolean,
  page: ReactNode,
) {
  return (
    <>
      <Route path={base} element={<TabIndexRedirect base={base} defaultTab={defaultTab} />} />
      <Route
        path={`${base}/:tab`}
        element={
          <AuthRoute loggedIn={loggedIn} path={base}>
            {page}
          </AuthRoute>
        }
      />
    </>
  );
}

export default function App() {
  const location = useLocation();
  const path = location.pathname;
  if (path.startsWith("/mysub")) {
    return (
      <Routes>
        <Route path="/mysub" element={<MySubPage />} />
        <Route path="/mysub/:tgId" element={<MySubPage />} />
        <Route path="*" element={<Navigate to="/mysub" replace />} />
      </Routes>
    );
  }

  const siteMeta = usePublicSiteMeta();
  const secretPath = siteMeta?.panelAccessPath ?? null;
  const { ready, loggedIn, setLoggedIn } = useSession();

  if (siteMeta === null || !ready) {
    return (
      <div className="login-wrap">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  const logout = () => setLoggedIn(false);

  return (
    <PanelSettingsProvider enabled={loggedIn}>
      <PanelUpdatesProvider enabled={loggedIn}>
      <GlobalAmbientBackdrop secretLoginPath={secretPath} />
      <Routes>
        <Route path="/login" element={<LoginPage onSuccess={() => setLoggedIn(true)} />} />
        {secretPath ? (
          <Route
            path={`/${secretPath}`}
            element={
              loggedIn ? (
                <Navigate to="/servers" replace />
              ) : (
                <LoginPage onSuccess={() => setLoggedIn(true)} />
              )
            }
          />
        ) : null}
        <Route
          path="/servers"
          element={
            <AuthRoute loggedIn={loggedIn} path="/servers">
              <ServersPage onLogout={logout} />
            </AuthRoute>
          }
        />
        {tabbedRoutes("/users", "active", loggedIn, <UsersPage onLogout={logout} />)}
        {tabbedRoutes("/subscription-shop", "settings", loggedIn, <SubscriptionShopPage onLogout={logout} />)}
        {tabbedRoutes("/communications", "mailings", loggedIn, <CommunicationsPage onLogout={logout} />)}
        <Route
          path="/support-appeals"
          element={
            <AuthRoute loggedIn={loggedIn} path="/support-appeals">
              <SupportAppealsPage onLogout={logout} />
            </AuthRoute>
          }
        />
        {tabbedRoutes("/referral-program", "settings", loggedIn, <ReferralProgramPage onLogout={logout} />)}
        {tabbedRoutes("/promo-codes", "promos", loggedIn, <PromoCodesPage onLogout={logout} />)}
        <Route
          path="/config-vault"
          element={
            <AuthRoute loggedIn={loggedIn} path="/config-vault">
              <ConfigVaultPage onLogout={logout} />
            </AuthRoute>
          }
        />
        {tabbedRoutes("/whitelist-vault", "keys", loggedIn, <WhitelistVaultPage onLogout={logout} />)}
        {tabbedRoutes("/logs", "error", loggedIn, <LogsPage onLogout={logout} />)}
        <Route
          path="/telegram-proxies"
          element={
            <AuthRoute loggedIn={loggedIn} path="/telegram-proxies">
              <ProxiesPage onLogout={logout} />
            </AuthRoute>
          }
        />
        {tabbedRoutes("/roulette-game", "roulette", loggedIn, <DropperGamePage onLogout={logout} />)}
        <Route path="/dropper-game" element={<Navigate to="/roulette-game/roulette" replace />} />
        <Route path="/dropper-game/:tab" element={<LegacyDropperGameRedirect />} />
        {tabbedRoutes("/device-limit", "settings", loggedIn, <DeviceLimitPage onLogout={logout} />)}
        <Route
          path="/daily-gift"
          element={
            <AuthRoute loggedIn={loggedIn} path="/daily-gift">
              <DailyGiftPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route path="/mysub" element={<MySubPage />} />
        <Route path="/mysub/:tgId" element={<MySubPage />} />
        <Route path="/" element={<HomeRedirect loggedIn={loggedIn} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </PanelUpdatesProvider>
    </PanelSettingsProvider>
  );
}
