import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { authMe } from "./api";
import LoginPage from "./pages/LoginPage";
import ServersPage from "./pages/ServersPage";
import UsersPage from "./pages/UsersPage";
import SubscriptionShopPage from "./pages/SubscriptionShopPage";
import CommunicationsPage from "./pages/CommunicationsPage";

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

export default function App() {
  const { ready, loggedIn, setLoggedIn } = useSession();

  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage onSuccess={() => setLoggedIn(true)} />} />
      <Route
        path="/servers"
        element={loggedIn ? <ServersPage onLogout={() => setLoggedIn(false)} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/users"
        element={loggedIn ? <UsersPage onLogout={() => setLoggedIn(false)} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/subscription-shop"
        element={
          loggedIn ? <SubscriptionShopPage onLogout={() => setLoggedIn(false)} /> : <Navigate to="/login" replace />
        }
      />
      <Route
        path="/communications"
        element={loggedIn ? <CommunicationsPage onLogout={() => setLoggedIn(false)} /> : <Navigate to="/login" replace />}
      />
      <Route path="/" element={<Navigate to={loggedIn ? "/servers" : "/login"} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
