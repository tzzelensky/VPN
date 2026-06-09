import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePanelSettings } from "../panelSettingsContext";
import { isSectionPathVisible } from "../panelNavUtils";

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
    const target = panel.firstVisiblePath;
    if (normPath(target) === normPath(path)) return;
    if (!isSectionPathVisible(target, panel.settings, panel.meta)) return;
    nav(target, { replace: true, state: { sectionHidden: true } });
  }, [blocked, path, panel.firstVisiblePath, panel.settings, panel.meta, nav]);

  if (!panel.loaded) {
    return <>{children}</>;
  }

  if (!blocked) {
    return <>{children}</>;
  }

  const target = panel.firstVisiblePath;
  if (normPath(target) === normPath(path) || !isSectionPathVisible(target, panel.settings, panel.meta)) {
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
