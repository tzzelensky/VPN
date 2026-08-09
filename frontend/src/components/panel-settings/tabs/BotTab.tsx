import { useState } from "react";
import type { PanelSettings, TelegramButtonColors } from "../../../panelSettingsTypes";
import type { PanelSettingsResponse } from "../../../panelSettingsTypes";
import { PANEL_HINTS } from "../../../panelSettingsHints";
import { FieldLabel } from "../../SettingHint";
import SettingsToggleRow from "../../SettingsToggleRow";
import SettingsCard from "../SettingsCard";
import type { MsgState, PatchDraft } from "../types";

const BUTTON_COLOR_KEYS: Array<[keyof TelegramButtonColors, string]> = [
  ["menuHome", "« В меню"],
  ["menuSubscription", "Подписка"],
  ["menuPay", "Оплата подписки"],
  ["menuBuyGb", "Докупить ГБ"],
  ["menuBuyDevice", "Купить устройство"],
  ["menuAdminClients", "Клиенты"],
  ["deleteSubscription", "Удалить подписку"],
  ["createNewSubscription", "Создать новую подписку"],
  ["pickSubscription", "Выбор готовой подписки"],
  ["comboOffer", "Спец-предложение (комбо)"],
  ["applyPromo", "Применить промокод"],
  ["buyWhitelist", "Купить белые списки"],
  ["sendAppeal", "Отправить обращение"],
  ["askAi", "Спросить AI"],
  ["inviteFriend", "Пригласить друга"],
];

export default function BotTab({
  draft,
  patchDraft,
  telegram,
  busy,
  botTokenEdit,
  setBotTokenEdit,
  showToken,
  revealedToken,
  tokenRevealBusy,
  onToggleShowToken,
  geminiKeyEdit,
  setGeminiKeyEdit,
  showGeminiKey,
  revealedGeminiKey,
  geminiRevealBusy,
  clearGeminiKey,
  setClearGeminiKey,
  onToggleShowGemini,
  setDirty,
  setMsg,
  botTest,
  onTestBot,
  onTestMessage,
}: {
  draft: PanelSettings;
  patchDraft: PatchDraft;
  telegram: PanelSettingsResponse["telegram"] | null;
  busy: boolean;
  botTokenEdit: string;
  setBotTokenEdit: (v: string) => void;
  showToken: boolean;
  revealedToken: string | null;
  tokenRevealBusy: boolean;
  onToggleShowToken: () => void;
  geminiKeyEdit: string;
  setGeminiKeyEdit: (v: string) => void;
  showGeminiKey: boolean;
  revealedGeminiKey: string | null;
  geminiRevealBusy: boolean;
  clearGeminiKey: boolean;
  setClearGeminiKey: (v: boolean) => void;
  onToggleShowGemini: () => void;
  setDirty: (v: boolean) => void;
  setMsg: (m: MsgState) => void;
  botTest: { type: "ok" | "err"; text: string } | null;
  onTestBot: () => void;
  onTestMessage: () => void;
}) {
  const [colorsOpen, setColorsOpen] = useState(false);

  return (
    <div className="panel-settings-tab-content panel-settings-tab-content--animate">
      <SettingsCard title="Доступ" sub="Токен бота, Gemini и админы">
        <div className="form-field">
          <FieldLabel label="Telegram Bot Token" hint={PANEL_HINTS.botToken} />
          <div className="panel-token-row">
            <input
              type={showToken || !telegram?.botTokenConfigured ? "text" : "password"}
              value={
                botTokenEdit
                  ? botTokenEdit
                  : telegram?.botTokenConfigured
                    ? showToken
                      ? (revealedToken ?? "")
                      : "••••••••••••••••"
                    : ""
              }
              placeholder={telegram?.botTokenConfigured ? "Оставьте пустым, чтобы не менять" : "Введите новый токен"}
              onChange={(e) => {
                setBotTokenEdit(e.target.value);
                setDirty(true);
              }}
            />
            <button
              type="button"
              className="ghost"
              disabled={(!telegram?.botTokenConfigured && !botTokenEdit) || tokenRevealBusy}
              onClick={onToggleShowToken}
            >
              {tokenRevealBusy ? "…" : showToken ? "Скрыть" : "Показать"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const toCopy = botTokenEdit.trim() || (showToken ? (revealedToken ?? "").trim() : "");
                if (!toCopy) {
                  setMsg({ type: "err", text: "Нажмите «Показать», чтобы скопировать токен, или введите новый." });
                  return;
                }
                void navigator.clipboard.writeText(toCopy);
                setMsg({ type: "ok", text: "Скопировано в буфер обмена." });
              }}
            >
              Копировать
            </button>
          </div>
        </div>

        <div className="form-field">
          <FieldLabel label="Gemini API Key" hint={PANEL_HINTS.geminiApiKey} />
          <div className="panel-token-row">
            <input
              type={showGeminiKey || (!telegram?.geminiApiKeyConfigured && !clearGeminiKey) ? "text" : "password"}
              value={
                clearGeminiKey
                  ? ""
                  : geminiKeyEdit
                    ? geminiKeyEdit
                    : telegram?.geminiApiKeyConfigured
                      ? showGeminiKey
                        ? (revealedGeminiKey ?? "")
                        : "••••••••••••••••"
                      : ""
              }
              placeholder={
                clearGeminiKey
                  ? "Ключ будет удалён после сохранения"
                  : telegram?.geminiApiKeyConfigured
                    ? "Оставьте пустым, чтобы не менять"
                    : "Вставьте API key Gemini"
              }
              disabled={clearGeminiKey}
              onChange={(e) => {
                setClearGeminiKey(false);
                setGeminiKeyEdit(e.target.value);
                setDirty(true);
              }}
            />
            <button
              type="button"
              className="ghost"
              disabled={
                clearGeminiKey ||
                ((!telegram?.geminiApiKeyConfigured || clearGeminiKey) && !geminiKeyEdit) ||
                geminiRevealBusy
              }
              onClick={onToggleShowGemini}
            >
              {geminiRevealBusy ? "…" : showGeminiKey ? "Скрыть" : "Показать"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const toCopy = geminiKeyEdit.trim() || (showGeminiKey ? (revealedGeminiKey ?? "").trim() : "");
                if (!toCopy) {
                  setMsg({ type: "err", text: "Нажмите «Показать», чтобы скопировать ключ, или введите новый." });
                  return;
                }
                void navigator.clipboard.writeText(toCopy);
                setMsg({ type: "ok", text: "Скопировано в буфер обмена." });
              }}
            >
              Копировать
            </button>
            {telegram?.geminiApiKeyConfigured && !clearGeminiKey ? (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setClearGeminiKey(true);
                  setGeminiKeyEdit("");
                  setDirty(true);
                }}
              >
                Очистить
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-toggle-list">
          <SettingsToggleRow
            label="AI-помощник в боте"
            hint={PANEL_HINTS.aiAssistantEnabled}
            on={draft.telegram.aiAssistantEnabled !== false}
            onToggle={() =>
              patchDraft((d) => ({
                ...d,
                telegram: {
                  ...d.telegram,
                  aiAssistantEnabled: d.telegram.aiAssistantEnabled === false,
                },
              }))
            }
          />
        </div>

        <div className="panel-settings-grid-2">
          <div className="form-field">
            <FieldLabel label="Модель Gemini" hint={PANEL_HINTS.geminiModel} />
            <select
              value={draft.telegram.geminiModel || "gemini-2.5-flash-lite"}
              onChange={(e) =>
                patchDraft((d) => ({
                  ...d,
                  telegram: { ...d.telegram, geminiModel: e.target.value },
                }))
              }
            >
              <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
              <option value="gemini-flash-latest">gemini-flash-latest</option>
            </select>
          </div>
          <div className="form-field">
            <FieldLabel label="Telegram Admin ID" hint={PANEL_HINTS.adminIds} />
            <input
              value={draft.telegram.adminIds.join(", ")}
              onChange={(e) => {
                const ids = e.target.value
                  .split(/[,;\s]+/)
                  .map((x) => Math.floor(Number(x)))
                  .filter((n) => Number.isFinite(n) && n > 0);
                patchDraft((d) => ({ ...d, telegram: { ...d.telegram, adminIds: ids } }));
              }}
              placeholder="404740026"
            />
          </div>
        </div>

        <div className="panel-settings-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onTestBot}>
            Проверить бота
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={onTestMessage}>
            Тестовое сообщение
          </button>
        </div>
        {botTest ? (
          <div className={`panel-settings-status flash ${botTest.type}`} role="status">
            {botTest.type === "ok" ? "✓ " : ""}
            {botTest.text}
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard title="Уведомления" sub="2FA и оповещения админам">
        <div className="settings-toggle-list">
          <SettingsToggleRow
            label="Двухфакторная аутентификация"
            hint={PANEL_HINTS.login2faEnabled}
            on={draft.telegram.login2faEnabled !== false}
            onToggle={() =>
              patchDraft((d) => ({
                ...d,
                telegram: {
                  ...d.telegram,
                  login2faEnabled: d.telegram.login2faEnabled === false,
                },
              }))
            }
          />
          {(
            [
              ["adminClientsButtonEnabled", "Показывать кнопку «Клиенты» у админов"],
              ["notifyNewUsers", "Уведомлять о новых пользователях"],
              ["notifyBroadcastErrors", "Уведомлять об ошибках рассылок"],
              ["notifySurveyResponses", "Уведомлять о новых ответах на опросы"],
              ["notifyServerErrors", "Уведомлять об ошибках серверов"],
              ["testMode", "Тестовый режим Telegram"],
            ] as const
          ).map(([key, label]) => {
            const hintMap: Record<string, string> = {
              adminClientsButtonEnabled: PANEL_HINTS.adminClientsButtonEnabled,
              notifyNewUsers: PANEL_HINTS.notifyNewUsers,
              notifyBroadcastErrors: PANEL_HINTS.notifyBroadcastErrors,
              notifySurveyResponses: PANEL_HINTS.notifySurveyResponses,
              notifyServerErrors: PANEL_HINTS.notifyServerErrors,
              testMode: PANEL_HINTS.testMode,
            };
            return (
              <SettingsToggleRow
                key={key}
                label={label}
                hint={hintMap[key] ?? ""}
                on={Boolean(draft.telegram[key])}
                onToggle={() =>
                  patchDraft((d) => ({
                    ...d,
                    telegram: { ...d.telegram, [key]: !d.telegram[key] },
                  }))
                }
              />
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Цвета кнопок"
        sub="HEX для inline-кнопок бота"
        collapsible
        open={colorsOpen}
        onToggle={() => setColorsOpen((v) => !v)}
      >
        <p className="field-hint">{PANEL_HINTS.telegramButtonColors}</p>
        <div className="panel-tg-button-colors panel-tg-button-colors--grid">
          {BUTTON_COLOR_KEYS.map(([key, label]) => (
            <label key={key} className="panel-tg-color-row">
              <span className="panel-tg-color-label">{label}</span>
              <input
                type="color"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(draft.telegram.buttonColors?.[key] ?? "")
                    ? (draft.telegram.buttonColors[key] as string)
                    : "#3390ec"
                }
                onChange={(e) => {
                  const hex = e.target.value.toLowerCase();
                  patchDraft((d) => ({
                    ...d,
                    telegram: {
                      ...d.telegram,
                      buttonColors: { ...d.telegram.buttonColors, [key]: hex },
                    },
                  }));
                }}
              />
              <input
                className="panel-tg-color-hex"
                value={draft.telegram.buttonColors?.[key] ?? ""}
                onChange={(e) => {
                  let v = e.target.value.trim();
                  if (v && !v.startsWith("#")) v = `#${v}`;
                  patchDraft((d) => ({
                    ...d,
                    telegram: {
                      ...d.telegram,
                      buttonColors: { ...d.telegram.buttonColors, [key]: v },
                    },
                  }));
                }}
                placeholder="#3390ec"
                spellCheck={false}
              />
            </label>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}
