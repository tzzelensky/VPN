import { SETTINGS_NAV, type SettingsTabId } from "./types";
import { usePanelUpdates } from "../../panelUpdatesContext";

export default function SettingsNav({
  tab,
  onChange,
}: {
  tab: SettingsTabId;
  onChange: (id: SettingsTabId) => void;
}) {
  const { updateAvailable } = usePanelUpdates();

  return (
    <>
      <nav className="panel-settings-nav" aria-label="Разделы настроек">
        {SETTINGS_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`panel-settings-nav__item ${tab === item.id ? "active" : ""}`}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => onChange(item.id)}
          >
            <span className="panel-settings-nav__label">{item.label}</span>
            {item.id === "system" && updateAvailable ? (
              <span className="admin-notify-dot admin-notify-dot--inline" aria-label="Есть обновление" />
            ) : null}
          </button>
        ))}
      </nav>
      <div className="panel-settings-nav-mobile survey-segmented" role="tablist">
        {SETTINGS_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`survey-segmented-btn ${tab === item.id ? "active" : ""}`}
            aria-selected={tab === item.id}
            onClick={() => onChange(item.id)}
          >
            <span className="panel-settings-nav__label">{item.label}</span>
            {item.id === "system" && updateAvailable ? (
              <span className="admin-notify-dot admin-notify-dot--inline" aria-label="Есть обновление" />
            ) : null}
          </button>
        ))}
      </div>
    </>
  );
}
