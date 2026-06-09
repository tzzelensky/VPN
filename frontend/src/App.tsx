import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { authMe } from "./api";
import { PanelSettingsProvider } from "./panelSettingsContext";
import SectionGuard from "./components/SectionGuard";
import HomeRedirect from "./components/HomeRedirect";
import LoginPage from "./pages/LoginPage";
import ServersPage from "./pages/ServersPage";
import UsersPage from "./pages/UsersPage";
import SubscriptionShopPage from "./pages/SubscriptionShopPage";
import CommunicationsPage from "./pages/CommunicationsPage";
import ReferralProgramPage from "./pages/ReferralProgramPage";
import PromoCodesPage from "./pages/PromoCodesPage";
import ConfigVaultPage from "./pages/ConfigVaultPage";
import WhitelistVaultPage from "./pages/WhitelistVaultPage";
import DropperGamePage from "./pages/DropperGamePage";
import SupportAppealsPage from "./pages/SupportAppealsPage";
import LogsPage from "./pages/LogsPage";
import ExperimentsPage from "./pages/ExperimentsPage";
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

export default function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  if (path.startsWith("/mysub")) {
    return (
      <Routes>
        <Route path="/mysub" element={<MySubPage />} />
        <Route path="/mysub/:tgId" element={<MySubPage />} />
        <Route path="*" element={<Navigate to="/mysub" replace />} />
      </Routes>
    );
  }

  const { ready, loggedIn, setLoggedIn } = useSession();

  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  const logout = () => setLoggedIn(false);

  return (
    <PanelSettingsProvider enabled={loggedIn}>
      <Routes>
        <Route path="/login" element={<LoginPage onSuccess={() => setLoggedIn(true)} />} />
        <Route
          path="/servers"
          element={
            <AuthRoute loggedIn={loggedIn} path="/servers">
              <ServersPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/users"
          element={
            <AuthRoute loggedIn={loggedIn} path="/users">
              <UsersPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/subscription-shop"
          element={
            <AuthRoute loggedIn={loggedIn} path="/subscription-shop">
              <SubscriptionShopPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/communications"
          element={
            <AuthRoute loggedIn={loggedIn} path="/communications">
              <CommunicationsPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/support-appeals"
          element={
            <AuthRoute loggedIn={loggedIn} path="/support-appeals">
              <SupportAppealsPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/referral-program"
          element={
            <AuthRoute loggedIn={loggedIn} path="/referral-program">
              <ReferralProgramPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/promo-codes"
          element={
            <AuthRoute loggedIn={loggedIn} path="/promo-codes">
              <PromoCodesPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/config-vault"
          element={
            <AuthRoute loggedIn={loggedIn} path="/config-vault">
              <ConfigVaultPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/whitelist-vault"
          element={
            <AuthRoute loggedIn={loggedIn} path="/whitelist-vault">
              <WhitelistVaultPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/logs"
          element={
            <AuthRoute loggedIn={loggedIn} path="/logs">
              <LogsPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/experiments"
          element={
            <AuthRoute loggedIn={loggedIn} path="/experiments">
              <ExperimentsPage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route
          path="/dropper-game"
          element={
            <AuthRoute loggedIn={loggedIn} path="/dropper-game">
              <DropperGamePage onLogout={logout} />
            </AuthRoute>
          }
        />
        <Route path="/mysub" element={<MySubPage />} />
        <Route path="/mysub/:tgId" element={<MySubPage />} />
        <Route path="/" element={<HomeRedirect loggedIn={loggedIn} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PanelSettingsProvider>
  );
}
