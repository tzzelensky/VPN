import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePanelSettings } from "../panelSettingsContext";
import { isSectionPathVisible } from "../panelNavUtils";
import { ADMIN_HOME_PATH } from "../homeSearchIndex";

function normPath(path: string): string {
  return path.replace(/\/$/, "") || path;
}

export default function SectionGuard({ path, children }: { path: string; children: React.ReactNode }) {
  const panel = usePanelSettings();
  const nav = useNavigate();

  const blocked =
    panel.loaded && panel.settings != null && !isSectionPathVisible(path, panel.settings, panel.meta);

  useEffect(() => {
    if (!blocked) return;
    if (normPath(path) === ADMIN_HOME_PATH) return;
    nav(ADMIN_HOME_PATH, { replace: true, state: { sectionHidden: true } });
  }, [blocked, path, nav]);

  if (!panel.loaded) {
    return <>{children}</>;
  }

  if (!blocked) {
    return <>{children}</>;
  }

  if (normPath(path) === ADMIN_HOME_PATH) {
    return (
      <div className="login-wrap">
        <div className="flash err">
          Раздел скрыт в настройках панели. Откройте настройки (⚙) → вкладка «Разделы».
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="muted">Перенаправление…</div>
    </div>
  );
}
