import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import DecoyShopPage from "../pages/DecoyShopPage";
import { ADMIN_HOME_PATH } from "../homeSearchIndex";

export default function HomeRedirect({ loggedIn }: { loggedIn: boolean }) {
  const nav = useNavigate();

  useEffect(() => {
    if (!loggedIn) return;
    nav(ADMIN_HOME_PATH, { replace: true });
  }, [loggedIn, nav]);

  if (!loggedIn) {
    return <DecoyShopPage />;
  }

  return (
    <div className="login-wrap">
      <div className="muted">Перенаправление…</div>
    </div>
  );
}
