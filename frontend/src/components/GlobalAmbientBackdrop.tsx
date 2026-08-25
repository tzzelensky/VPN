import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import AmbientBackdrop from "./AmbientBackdrop";

/** Анимированный фон только на странице входа — в панели он вызывал моргание через прозрачные слои. */
export default function GlobalAmbientBackdrop({ secretLoginPath = null }: { secretLoginPath?: string | null }) {
  const { pathname } = useLocation();
  const isLogin = pathname === "/login" || (secretLoginPath != null && pathname === `/${secretLoginPath}`);
  const isAdminApp = !pathname.startsWith("/mysub") && !isLogin;

  useEffect(() => {
    if (pathname.startsWith("/mysub")) {
      document.documentElement.removeAttribute("data-app");
      return;
    }
    document.documentElement.dataset.app = isLogin ? "login" : "admin";
  }, [pathname, isLogin]);

  if (pathname.startsWith("/mysub")) return null;
  if (isAdminApp) return null;

  return <AmbientBackdrop interactive />;
}
