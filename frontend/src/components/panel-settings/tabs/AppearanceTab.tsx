import type { PanelSettings } from "../../../panelSettingsTypes";
import { PANEL_HINTS } from "../../../panelSettingsHints";
import { FieldLabel } from "../../SettingHint";
import SettingsToggleRow from "../../SettingsToggleRow";
import SettingsCard from "../SettingsCard";
import type { PatchDraft } from "../types";

export default function AppearanceTab({
  draft,
  patchDraft,
}: {
  draft: PanelSettings;
  patchDraft: PatchDraft;
}) {
  return (
    <div className="panel-settings-tab-content panel-settings-tab-content--animate">
      <SettingsCard title="Тема и акцент">
        <div className="panel-settings-grid-2">
          <div className="form-field">
            <FieldLabel label="Тема" hint={PANEL_HINTS.theme} />
            <select
              value={draft.ui.theme}
              onChange={(e) =>
                patchDraft((d) => ({
                  ...d,
                  ui: { ...d.ui, theme: e.target.value as PanelSettings["ui"]["theme"] },
                }))
              }
            >
              <option value="system">Системная</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </div>
          <div className="form-field">
            <FieldLabel label="Акцентный цвет" hint={PANEL_HINTS.accent} />
            <select
              value={
                ["blue", "green", "purple", "orange", "red"].includes(String(draft.ui.accentColor))
                  ? draft.ui.accentColor
                  : "custom"
              }
              onChange={(e) => {
                const v = e.target.value;
                patchDraft((d) => ({
                  ...d,
                  ui: { ...d.ui, accentColor: v === "custom" ? "#3d9eff" : v },
                }));
              }}
            >
              <option value="blue">Синий</option>
              <option value="green">Зелёный</option>
              <option value="purple">Фиолетовый</option>
              <option value="orange">Оранжевый</option>
              <option value="red">Красный</option>
              <option value="custom">Свой (hex)</option>
            </select>
            {!["blue", "green", "purple", "orange", "red"].includes(String(draft.ui.accentColor)) ? (
              <input
                value={String(draft.ui.accentColor)}
                onChange={(e) => patchDraft((d) => ({ ...d, ui: { ...d.ui, accentColor: e.target.value } }))}
                placeholder="#3d9eff"
              />
            ) : null}
          </div>
        </div>
        <div className="form-field">
          <FieldLabel label="Часовой пояс" hint={PANEL_HINTS.timezone} />
          <select
            value={
              ["Asia/Yekaterinburg", "Europe/Moscow", "Asia/Yerevan"].includes(draft.ui.timezone)
                ? draft.ui.timezone
                : "Asia/Yekaterinburg"
            }
            onChange={(e) =>
              patchDraft((d) => ({ ...d, ui: { ...d.ui, timezone: e.target.value } }))
            }
          >
            <option value="Asia/Yekaterinburg">Екб</option>
            <option value="Europe/Moscow">МСК</option>
            <option value="Asia/Yerevan">Ереван</option>
          </select>
        </div>
      </SettingsCard>

      <SettingsCard title="Интерфейс">
        <div className="settings-toggle-list">
          <SettingsToggleRow
            label="Показывать подсказки"
            hint={PANEL_HINTS.showHints}
            on={draft.ui.showHints}
            onToggle={() => patchDraft((d) => ({ ...d, ui: { ...d.ui, showHints: !d.ui.showHints } }))}
          />
          <SettingsToggleRow
            label="Отображение Превью WebApp"
            hint={PANEL_HINTS.webAppPreviewEnabled}
            on={draft.ui.webAppPreviewEnabled !== false}
            onToggle={() =>
              patchDraft((d) => ({
                ...d,
                ui: { ...d.ui, webAppPreviewEnabled: !(d.ui.webAppPreviewEnabled !== false) },
              }))
            }
          />
        </div>
      </SettingsCard>
    </div>
  );
}
