import type { PanelSettings } from "../../../panelSettingsTypes";
import { PANEL_HINTS } from "../../../panelSettingsHints";
import { panelSettingsExportUrl } from "../../../api";
import { FieldLabel } from "../../SettingHint";
import SettingsToggleRow from "../../SettingsToggleRow";
import SettingsCard from "../SettingsCard";
import type { MsgState, PatchDraft } from "../types";

export default function SystemTab({
  draft,
  patchDraft,
  busy,
  systemInfo,
  setMsg,
  setDirty,
  setBusy,
  onImport,
  onReset,
}: {
  draft: PanelSettings;
  patchDraft: PatchDraft;
  busy: boolean;
  systemInfo: Record<string, unknown> | null;
  setMsg: (m: MsgState) => void;
  setDirty: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  onImport: (settings: PanelSettings) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  return (
    <div className="panel-settings-tab-content panel-settings-tab-content--animate">
      <SettingsCard title="Безопасность">
        <div className="settings-toggle-list">
          {(
            [
              ["maskSecrets", "Маскировать секреты в UI"],
              ["confirmDangerousActions", "Подтверждение опасных действий"],
              ["showDiagnosticDetails", "Показывать диагностические данные"],
              ["manualTrafficAdjust", "Регулировка потраченных ГБ на странице пользователей"],
            ] as const
          ).map(([key, label]) => {
            const hintMap: Record<string, string> = {
              maskSecrets: PANEL_HINTS.maskSecrets,
              confirmDangerousActions: PANEL_HINTS.confirmDangerous,
              showDiagnosticDetails: PANEL_HINTS.showDiagnostic,
              manualTrafficAdjust: PANEL_HINTS.manualTrafficAdjust,
            };
            return (
              <SettingsToggleRow
                key={key}
                label={label}
                hint={hintMap[key] ?? ""}
                on={draft.security[key]}
                onToggle={() =>
                  patchDraft((d) => ({
                    ...d,
                    security: { ...d.security, [key]: !d.security[key] },
                  }))
                }
              />
            );
          })}
        </div>
        <div className="form-field form-field--spaced">
          <FieldLabel label="Автовыход из панели" hint={PANEL_HINTS.autoLogout} />
          <select
            value={draft.security.autoLogoutMinutes == null ? "" : String(draft.security.autoLogoutMinutes)}
            onChange={(e) => {
              const v = e.target.value;
              patchDraft((d) => ({
                ...d,
                security: {
                  ...d.security,
                  autoLogoutMinutes: v === "" ? null : Number(v),
                },
              }));
            }}
          >
            <option value="">Никогда</option>
            <option value="15">15 минут бездействия</option>
            <option value="30">30 минут бездействия</option>
            <option value="60">1 час бездействия</option>
            <option value="720">12 часов бездействия</option>
          </select>
        </div>
      </SettingsCard>

      <SettingsCard title="Резервные копии" sub="Экспорт и сброс настроек">
        <p className="field-hint">{PANEL_HINTS.export}</p>
        <div className="row-actions">
          <a className="ghost" href={panelSettingsExportUrl()} download>
            Скачать настройки
          </a>
          <label className="ghost panel-avatar-upload">
            <input
              type="file"
              accept="application/json"
              className="comms-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void (async () => {
                  if (!window.confirm("Применить импортированные настройки?")) return;
                  try {
                    const text = await f.text();
                    const parsed = JSON.parse(text) as PanelSettings;
                    await onImport(parsed);
                    setMsg({ type: "ok", text: "Настройки импортированы." });
                  } catch (err) {
                    setMsg({ type: "err", text: String(err) });
                  }
                })();
              }}
            />
            Импортировать
          </label>
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Вы уверены, что хотите сбросить настройки панели?")) return;
              void (async () => {
                setBusy(true);
                try {
                  await onReset();
                  setDirty(false);
                  setMsg({ type: "ok", text: "Настройки сброшены." });
                } catch (e) {
                  setMsg({ type: "err", text: String(e) });
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Сбросить
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title="О системе">
        {systemInfo ? (
          <ul className="panel-about-list">
            <li>Версия панели: {String(systemInfo.panelVersion ?? "—")}</li>
            <li>Node: {String(systemInfo.nodeVersion ?? "—")}</li>
            <li>Окружение: {String(systemInfo.environment ?? "—")}</li>
            <li>
              Uptime{" "}
              <a
                href="/panel/swagger/admin"
                target="_blank"
                rel="noopener noreferrer"
                className="panel-about-api-link"
                title="Документация API (Swagger)"
              >
                API
              </a>
              : {String(systemInfo.uptimeSec ?? "—")} с
            </li>
            <li>
              Обновление настроек:{" "}
              {systemInfo.settingsUpdatedAt
                ? new Date(Number(systemInfo.settingsUpdatedAt)).toLocaleString("ru-RU")
                : "—"}
            </li>
            <li>
              Telegram:{" "}
              {systemInfo.telegramBotConfigured ? String(systemInfo.telegramBotMasked) : "не настроен"}
            </li>
          </ul>
        ) : (
          <p className="sub">Загрузка…</p>
        )}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            const text = JSON.stringify(systemInfo ?? {}, null, 2);
            void navigator.clipboard.writeText(text);
            setMsg({ type: "ok", text: "Диагностика скопирована." });
          }}
        >
          Скопировать диагностику
        </button>
      </SettingsCard>
    </div>
  );
}
