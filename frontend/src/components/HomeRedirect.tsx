import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { usePanelSettings } from "../panelSettingsContext";

export default function HomeRedirect({ loggedIn }: { loggedIn: boolean }) {
  const panel = usePanelSettings();
  const nav = useNavigate();

  useEffect(() => {
    if (!loggedIn || !panel.loaded) return;
    nav(panel.firstVisiblePath, { replace: true });
  }, [loggedIn, panel.loaded, panel.firstVisiblePath, nav]);

  if (!loggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (!panel.loaded) {
    return (
      <div className="login-wrap">
        <div className="muted">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="muted">Перенаправление…</div>
    </div>
  );
}
