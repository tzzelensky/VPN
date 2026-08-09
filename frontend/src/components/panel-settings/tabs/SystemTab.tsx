import { useMemo, useState } from "react";
import type { PanelSettings } from "../../../panelSettingsTypes";
import { PANEL_HINTS } from "../../../panelSettingsHints";
import { changeAdminPassword, panelSettingsExportUrl } from "../../../api";
import { usePanelUpdates } from "../../../panelUpdatesContext";
import { FieldLabel } from "../../SettingHint";
import SettingsToggleRow from "../../SettingsToggleRow";
import SettingsCard from "../SettingsCard";
import EnableHttpsModal from "../EnableHttpsModal";
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
  onPasswordChanged,
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
  onPasswordChanged: () => void;
}) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [httpsModalOpen, setHttpsModalOpen] = useState(false);

  const {
    info: updateInfo,
    lastCheckedAt,
    checking,
    applyPhase,
    applyMessage,
    updateAvailable,
    refresh,
    apply,
  } = usePanelUpdates();

  const matchState = useMemo(() => {
    if (!newPassword2) return "idle" as const;
    if (newPassword === newPassword2 && newPassword.length >= 8) return "match" as const;
    if (newPassword === newPassword2) return "match-short" as const;
    return "mismatch" as const;
  }, [newPassword, newPassword2]);

  const canSubmitPassword =
    Boolean(oldPassword) && matchState === "match" && !pwdBusy && !busy;

  const applying = applyPhase !== "idle" && applyPhase !== "error";
  const updateBusy = checking || applying;

  async function submitPassword() {
    if (!canSubmitPassword) return;
    setPwdBusy(true);
    try {
      await changeAdminPassword(oldPassword, newPassword);
      setMsg({ type: "ok", text: "Пароль изменён. Выполняется выход…" });
      setOldPassword("");
      setNewPassword("");
      setNewPassword2("");
      onPasswordChanged();
    } catch (e) {
      const raw = String(e);
      let text = raw;
      if (raw.includes("invalid_old_password")) text = "Неверный текущий пароль.";
      else if (raw.includes("password_too_short")) text = "Новый пароль должен быть не короче 8 символов.";
      else if (raw.includes("password_unchanged")) text = "Новый пароль совпадает со старым.";
      setMsg({ type: "err", text });
    } finally {
      setPwdBusy(false);
    }
  }

  async function onCheckUpdates() {
    setMsg(null);
    const info = await refresh();
    if (!info) {
      setMsg({ type: "err", text: "Не удалось проверить обновления." });
      return;
    }
    setMsg({
      type: info.updateAvailable ? "ok" : info.gitAvailable === false ? "err" : "ok",
      text: info.message ?? (info.updateAvailable ? "Есть обновления." : "Актуально."),
    });
  }

  const phaseSteps = [
    { id: "pulling" as const, label: "Загрузка" },
    { id: "building" as const, label: "Сборка" },
    { id: "restarting" as const, label: "Перезапуск" },
    { id: "done" as const, label: "Готово" },
  ];
  const phaseOrder = ["pulling", "building", "restarting", "done"] as const;
  const activeIdx = phaseOrder.indexOf(applyPhase as (typeof phaseOrder)[number]);

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

      <SettingsCard title="Смена пароля" sub="Логин остаётся прежним">
        <div className="form-field form-field--spaced">
          <FieldLabel label="Текущий пароль" hint="Пароль, которым вы сейчас входите в панель." />
          <input
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            disabled={pwdBusy}
            onChange={(e) => setOldPassword(e.target.value)}
          />
        </div>
        <div className="form-field form-field--spaced">
          <FieldLabel label="Новый пароль" hint="Не меньше 8 символов." />
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            disabled={pwdBusy}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div
          className={`form-field form-field--spaced password-confirm-field password-confirm-field--${matchState}`}
        >
          <FieldLabel label="Повтор нового пароля" hint="Должен совпадать с новым паролем." />
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword2}
            disabled={pwdBusy}
            onChange={(e) => setNewPassword2(e.target.value)}
          />
          {matchState === "match" || matchState === "match-short" ? (
            <p className="password-confirm-hint password-confirm-hint--ok" aria-live="polite">
              {matchState === "match" ? "Пароли совпадают" : "Совпадают, но короче 8 символов"}
            </p>
          ) : null}
          {matchState === "mismatch" ? (
            <p className="password-confirm-hint password-confirm-hint--err" aria-live="polite">
              Пароли не совпадают
            </p>
          ) : null}
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="primary"
            disabled={!canSubmitPassword}
            onClick={() => void submitPassword()}
          >
            {pwdBusy ? "Сохранение…" : "Сменить пароль"}
          </button>
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

      <SettingsCard title="О системе" sub={updateAvailable ? "Доступно обновление панели" : undefined}>
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

        <div className="panel-https-block">
          <div className="panel-https-block__text">
            <strong>HTTPS‑шифрование</strong>
            <p className="field-hint">
              Получить бесплатный сертификат Let's Encrypt и включить https:// для домена панели.
            </p>
          </div>
          <button type="button" className="primary" onClick={() => setHttpsModalOpen(true)}>
            Подключить HTTPS шифрование
          </button>
        </div>

        <div className={`panel-updates-block ${updateAvailable ? "panel-updates-block--available" : ""}`}>
          <div className="panel-updates-head">
            <strong>Обновления</strong>
            <span className="field-hint">
              Автопроверка каждые 30 мин
              {lastCheckedAt
                ? ` · последний раз ${new Date(lastCheckedAt).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
            </span>
          </div>

          <div
            className={`panel-updates-status-card panel-updates-status-card--${
              applyPhase !== "idle" ? applyPhase : updateAvailable ? "available" : checking ? "checking" : "ok"
            }`}
            aria-live="polite"
          >
            {applyPhase !== "idle" ? (
              <>
                <p className="panel-updates-status-card__title">
                  {applyPhase === "done"
                    ? "Обновление завершено"
                    : applyPhase === "error"
                      ? "Ошибка обновления"
                      : "Идёт обновление…"}
                </p>
                <p className="panel-updates-status-card__msg">{applyMessage}</p>
                {applyPhase !== "error" ? (
                  <ol className="panel-updates-steps">
                    {phaseSteps.map((step, idx) => {
                      const done = activeIdx > idx || applyPhase === "done";
                      const current = phaseOrder[idx] === applyPhase;
                      return (
                        <li
                          key={step.id}
                          className={`panel-updates-steps__item${done ? " is-done" : ""}${
                            current ? " is-current" : ""
                          }`}
                        >
                          {step.label}
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </>
            ) : (
              <>
                <p className="panel-updates-status-card__title">
                  {checking
                    ? "Проверяем обновления…"
                    : updateAvailable
                      ? `Доступно обновлений: ${updateInfo?.behindCount ?? "—"}`
                      : updateInfo?.gitAvailable === false
                        ? "Git-обновления недоступны"
                        : "Панель актуальна"}
                </p>
                <p className="panel-updates-status-card__msg">
                  {updateInfo?.message ??
                    (checking ? "Запрос к репозиторию…" : "Нажмите «Проверить», чтобы обновить статус.")}
                  {updateInfo?.gitAvailable && updateInfo.localSha
                    ? ` (${updateInfo.localSha}${
                        updateInfo.remoteSha && updateInfo.updateAvailable
                          ? ` → ${updateInfo.remoteSha}`
                          : ""
                      })`
                    : ""}
                </p>
              </>
            )}
          </div>

          <div className="row-actions">
            <button
              type="button"
              className="ghost"
              disabled={updateBusy}
              onClick={() => void onCheckUpdates()}
            >
              {checking ? "Проверка…" : "Проверить наличие обновлений"}
            </button>
            {updateAvailable && applyPhase === "idle" ? (
              <button type="button" className="primary" disabled={updateBusy} onClick={() => void apply()}>
                Обновить сейчас
              </button>
            ) : null}
          </div>
        </div>

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

      <EnableHttpsModal open={httpsModalOpen} onClose={() => setHttpsModalOpen(false)} />
    </div>
  );
}
