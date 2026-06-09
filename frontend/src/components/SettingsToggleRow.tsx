import { SettingHint } from "./SettingHint";

type Props = {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
};

export default function SettingsToggleRow({ label, hint, on, onToggle }: Props) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row__label">
        <span className="settings-toggle-row__text">{label}</span>
        <SettingHint text={hint} />
      </div>
      <button type="button" className={`toggle ${on ? "on" : ""}`} aria-pressed={on} onClick={onToggle} />
    </div>
  );
}
