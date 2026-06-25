import { useEffect, useMemo, useRef, useState } from "react";
import {
  deletePanelAvatar,
  fetchPanelSystemInfo,
  fetchPanelTelegramBotToken,
  importPanelSettings,
  panelSettingsExportUrl,
  resetPanelSettings,
  testTelegramAdminMessage,
  testTelegramBot,
  uploadPanelAvatar,
  type PanelSettingsPatchPayload,
} from "../api";
import { usePanelSettings } from "../panelSettingsContext";
import { normalizeSectionOrder, orderSectionsMeta } from "../panelNavUtils";
import type { PanelSectionKey, PanelSettings } from "../panelSettingsTypes";
import { readFileAsDataUrl } from "../avatarCrop";
import { PANEL_HINTS } from "../panelSettingsHints";
import AvatarCropModal from "./AvatarCropModal";
import { FieldLabel, SettingHint } from "./SettingHint";
import SettingsToggleRow from "./SettingsToggleRow";

type TabId = "main" | "sections" | "telegram" | "appearance" | "security" | "backup" | "about";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "main", label: "Основное" },
  { id: "sections", label: "Разделы" },
  { id: "telegram", label: "Telegram" },
  { id: "appearance", label: "Внешний вид" },
  { id: "security", label: "Безопасность" },
  { id: "backup", label: "Резервные копии" },
  { id: "about", label: "О системе" },
];

function cloneSettings(s: PanelSettings): PanelSettings {
  return JSON.parse(JSON.stringify(s)) as PanelSettings;
}

export default function PanelSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, meta, telegram, applyPatch, refresh, avatarUrl } = usePanelSettings();
  const [tab, setTab] = useState<TabId>("main");
  const [draft, setDraft] = useState<PanelSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [botTokenEdit, setBotTokenEdit] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [tokenRevealBusy, setTokenRevealBusy] = useState(false);
  const [botTest, setBotTest] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<Record<string, unknown> | null>(null);
  const [dragSectionKey, setDragSectionKey] = useState<PanelSectionKey | null>(null);
  const [overSectionKey, setOverSectionKey] = useState<PanelSectionKey | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const lastSyncedAtRef = useRef(0);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      lastSyncedAtRef.current = 0;
      setAvatarCropOpen(false);
      return;
    }
    if (!settings) return;
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    lastSyncedAtRef.current = settings.updatedAt;
    const cloned = cloneSettings(settings);
    cloned.sectionOrder = normalizeSectionOrder(cloned.sectionOrder ?? settings.sectionOrder);
    cloned.panel.subscriptionBanner = {
      ...{
        enabled: false,
        text: "",
        telegramUrl: "",
        telegramLinkText: "тех. поддержку",
      },
      ...cloned.panel.subscriptionBanner,
    };
    setDraft(cloned);
    setDirty(false);
    setBotTokenEdit("");
    setShowToken(false);
    setRevealedToken(null);
    setBotTest(null);
    setAvatarPreview(null);
    setTab("main");
    setMsg(null);
  }, [open, settings]);

  useEffect(() => {
    if (open && tab === "about") {
      void fetchPanelSystemInfo().then(setSystemInfo).catch(() => setSystemInfo(null));
    }
  }, [open, tab]);

  const visibleCount = useMemo(() => {
    if (!draft) return 0;
    return meta.filter((m) => draft.sections[m.key] !== false).length;
  }, [draft, meta]);

  const sectionsOrdered = useMemo(() => {
    if (!draft) return [];
    return orderSectionsMeta(meta, draft.sectionOrder);
  }, [draft, meta]);

  function reorderSections(from: PanelSectionKey, to: PanelSectionKey) {
    if (from === to) return;
    let nextOrder: PanelSectionKey[] | null = null;
    patchDraft((d) => {
      const order = normalizeSectionOrder(d.sectionOrder);
      const fromIdx = order.indexOf(from);
      const toIdx = order.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return d;
      const next = [...order];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      nextOrder = next;
      return { ...d, sectionOrder: next };
    });
    if (!nextOrder) return;
    void applyPatch({ settings: { sectionOrder: nextOrder } }).catch((e) => {
      setMsg({ type: "err", text: `Не удалось сохранить порядок: ${String(e)}` });
    });
  }

  function patchDraft(fn: (d: PanelSettings) => PanelSettings) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      setDirty(true);
      return next;
    });
  }

  function requestClose() {
    if (dirty && !window.confirm("Есть несохранённые изменения. Закрыть без сохранения?")) return;
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, dirty]);

  async function save(closeAfter: boolean) {
    if (!draft) return;
    if (!draft.panel.title.trim()) {
      setMsg({ type: "err", text: "Название панели не может быть пустым." });
      return;
    }
    if (visibleCount < 1) {
      setMsg({ type: "err", text: "Должен быть виден хотя бы один раздел." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const payload: PanelSettingsPatchPayload = {
        settings: {
          ...draft,
          sectionOrder: normalizeSectionOrder(draft.sectionOrder),
        },
      };
      if (botTokenEdit.trim()) payload.botToken = botTokenEdit.trim();
      const r = await applyPatch(payload);
      lastSyncedAtRef.current = r.settings.updatedAt;
      setDirty(false);
      setBotTokenEdit("");
      setMsg({ type: "ok", text: "Настройки сохранены." });
      if (closeAfter) onClose();
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  function openAvatarCrop(src?: string | null) {
    setAvatarCropSrc(src ?? avatarPreview ?? avatarUrl ?? null);
    setAvatarCropOpen(true);
  }

  async function onAvatarCropSave(dataUrl: string, mime: string) {
    setBusy(true);
    try {
      setAvatarPreview(dataUrl);
      const uploaded = await uploadPanelAvatar(dataUrl, mime);
      setDraft((d) =>
        d
          ? {
              ...d,
              panel: { ...d.panel, avatarPath: uploaded.settings.panel.avatarPath },
              updatedAt: uploaded.settings.updatedAt,
            }
          : d,
      );
      await refresh();
      setAvatarCropOpen(false);
      setMsg({ type: "ok", text: "Аватарка обновлена." });
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onAvatarFile(file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMsg({ type: "err", text: "Исходный файл больше 5 МБ." });
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAvatarCropSrc(dataUrl);
      setAvatarCropOpen(true);
    } catch (e) {
      setMsg({ type: "err", text: String(e) });
    }
  }

  async function toggleShowBotToken() {
    if (showToken) {
      setShowToken(false);
      setRevealedToken(null);
      return;
    }
    if (botTokenEdit.trim()) {
      setShowToken(true);
      return;
    }
    if (!telegram?.botTokenConfigured) return;
    setTokenRevealBusy(true);
    try {
      const { botToken } = await fetchPanelTelegramBotToken();
      setRevealedToken(botToken);
      setShowToken(true);
    } catch (e) {
      setMsg({ type: "err", text: `Не удалось получить токен: ${String(e)}` });
    } finally {
      setTokenRevealBusy(false);
    }
  }

  if (!open || !draft) return null;

  const avatarDisplaySrc = avatarPreview ?? avatarUrl ?? null;

  return (
    <>
    <div className="modal-backdrop panel-settings-backdrop">
      <div className="modal panel-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head panel-settings-head">
          <h2>Настройки панели</h2>
          <button type="button" className="ghost modal-close" onClick={requestClose} aria-label="Закрыть">
            ×
          </button>
        </div>

        <div className="panel-settings-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={`panel-settings-tab ${tab === t.id ? "active" : ""}`}
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body panel-settings-body">
          {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}

          {tab === "main" ? (
            <div className="panel-settings-tab-content">
              <div className="form-field">
                <FieldLabel label="Название панели" hint={PANEL_HINTS.panelTitle} />
                <input
                  value={draft.panel.title}
                  onChange={(e) => patchDraft((d) => ({ ...d, panel: { ...d.panel, title: e.target.value } }))}
                />
              </div>
              <div className="form-field">
                <FieldLabel label="Подпись / описание" hint={PANEL_HINTS.panelSubtitle} />
                <input
                  value={draft.panel.subtitle}
                  onChange={(e) => patchDraft((d) => ({ ...d, panel: { ...d.panel, subtitle: e.target.value } }))}
                />
              </div>
              <div className="form-field">
                <FieldLabel label="Название бренда для сообщений" hint={PANEL_HINTS.brandName} />
                <input
                  value={draft.panel.brandName}
                  onChange={(e) => patchDraft((d) => ({ ...d, panel: { ...d.panel, brandName: e.target.value } }))}
                />
              </div>
              <div className="form-field">
                <FieldLabel label="Подпись в Telegram-сообщениях" hint={PANEL_HINTS.telegramFooter} />
                <textarea
                  className="comms-textarea"
                  rows={3}
                  value={draft.panel.telegramFooter}
                  onChange={(e) => patchDraft((d) => ({ ...d, panel: { ...d.panel, telegramFooter: e.target.value } }))}
                />
              </div>
              <div className="panel-subscription-text-block">
                <SettingsToggleRow
                  label="Текст подписки"
                  hint={PANEL_HINTS.subscriptionBanner}
                  on={draft.panel.subscriptionBanner?.enabled ?? false}
                  onToggle={() =>
                    patchDraft((d) => ({
                      ...d,
                      panel: {
                        ...d.panel,
                        subscriptionBanner: {
                          ...(d.panel.subscriptionBanner ?? {
                            enabled: false,
                            text: "",
                            telegramUrl: "",
                            telegramLinkText: "тех. поддержку",
                          }),
                          enabled: !(d.panel.subscriptionBanner?.enabled ?? false),
                        },
                      },
                    }))
                  }
                />
                {draft.panel.subscriptionBanner?.enabled ? (
                  <div className="panel-subscription-text-fields">
                    <div className="form-field">
                      <FieldLabel label="Текст в Happ / подписке" hint={PANEL_HINTS.subscriptionBannerText} />
                      <textarea
                        className="comms-textarea"
                        rows={5}
                        placeholder={"Нет подключения к интернету? Обновите подписку 🔄\n🪄 = Подключение к RU сайтам без VPN"}
                        value={draft.panel.subscriptionBanner.text}
                        onChange={(e) =>
                          patchDraft((d) => ({
                            ...d,
                            panel: {
                              ...d.panel,
                              subscriptionBanner: { ...d.panel.subscriptionBanner, text: e.target.value },
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="form-field">
                      <FieldLabel label="Ссылка Telegram (поддержка)" hint={PANEL_HINTS.subscriptionBannerTelegram} />
                      <input
                        value={draft.panel.subscriptionBanner.telegramUrl}
                        placeholder="https://t.me/your_support или @username"
                        onChange={(e) =>
                          patchDraft((d) => ({
                            ...d,
                            panel: {
                              ...d.panel,
                              subscriptionBanner: { ...d.panel.subscriptionBanner, telegramUrl: e.target.value },
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="form-field">
                      <FieldLabel label="Текст ссылки" hint={PANEL_HINTS.subscriptionBannerLinkText} />
                      <input
                        value={draft.panel.subscriptionBanner.telegramLinkText}
                        placeholder="тех. поддержку"
                        onChange={(e) =>
                          patchDraft((d) => ({
                            ...d,
                            panel: {
                              ...d.panel,
                              subscriptionBanner: { ...d.panel.subscriptionBanner, telegramLinkText: e.target.value },
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="panel-avatar-block">
                <FieldLabel label="Аватарка / логотип" hint={PANEL_HINTS.avatar} />
                <div className="panel-avatar-row">
                  <button
                    type="button"
                    className="panel-avatar-hit"
                    disabled={busy}
                    title="Изменить аватарку"
                    aria-label="Изменить аватарку"
                    onClick={() => openAvatarCrop()}
                  >
                    {avatarDisplaySrc ? (
                      <img src={avatarDisplaySrc} alt="" className="panel-avatar-preview" />
                    ) : (
                      <div className="panel-avatar-placeholder">{draft.panel.title.slice(0, 2).toUpperCase()}</div>
                    )}
                  </button>
                  <div className="panel-avatar-actions">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="panel-avatar-file-input"
                      onChange={(e) => {
                        void onAvatarFile(e.target.files?.[0] ?? null);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      Загрузить
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        void (async () => {
                          setBusy(true);
                          try {
                            await deletePanelAvatar();
                            await refresh();
                            setAvatarPreview(null);
                            setMsg({ type: "ok", text: "Аватарка удалена." });
                          } catch (e) {
                            setMsg({ type: "err", text: String(e) });
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      Удалить аватарку
                    </button>
                  </div>
                </div>
                <p className="field-hint">PNG, JPG или WebP, до 5 МБ (на сервер отправляется сжатая копия).</p>
              </div>
              <SettingsToggleRow
                label="Режим обслуживания"
                hint={PANEL_HINTS.maintenance}
                on={draft.maintenance.enabled}
                onToggle={() => patchDraft((d) => ({ ...d, maintenance: { enabled: !d.maintenance.enabled } }))}
              />
            </div>
          ) : null}

          {tab === "sections" ? (
            <div className="panel-settings-tab-content">
              <p className="field-hint">{PANEL_HINTS.sectionsIntro}</p>
              <div className="panel-sections-list settings-toggle-list">
                {sectionsOrdered.map((s) => (
                  <div
                    key={s.key}
                    className={[
                      "settings-toggle-row",
                      "settings-toggle-row--section",
                      "panel-sections-row",
                      dragSectionKey === s.key ? "panel-sections-row--dragging" : "",
                      overSectionKey === s.key && dragSectionKey !== s.key ? "panel-sections-row--over" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    draggable
                    onDragStart={() => setDragSectionKey(s.key)}
                    onDragEnd={() => {
                      setDragSectionKey(null);
                      setOverSectionKey(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverSectionKey(s.key);
                    }}
                    onDragLeave={() => {
                      if (overSectionKey === s.key) setOverSectionKey(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragSectionKey) reorderSections(dragSectionKey, s.key);
                      setDragSectionKey(null);
                      setOverSectionKey(null);
                    }}
                  >
                    <button
                      type="button"
                      className="panel-sections-drag"
                      title="Перетащите для смены порядка"
                      aria-label={`Порядок: ${s.label}`}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      ⋮⋮
                    </button>
                    <div className="settings-toggle-row__label settings-toggle-row__label--stack">
                      <div className="form-label-with-hint">
                        <span className="settings-toggle-row__text">{s.label}</span>
                        <SettingHint text={s.description} />
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`toggle ${draft.sections[s.key] !== false ? "on" : ""}`}
                      aria-pressed={draft.sections[s.key] !== false}
                      onClick={() =>
                        patchDraft((d) => ({
                          ...d,
                          sections: { ...d.sections, [s.key]: !(d.sections[s.key] !== false) },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    const all = {} as Record<PanelSectionKey, boolean>;
                    for (const s of meta) all[s.key] = true;
                    patchDraft((d) => ({ ...d, sections: all }));
                  }}
                >
                  Показать все разделы
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    if (!window.confirm("Сбросить видимость разделов к стандартной?")) return;
                    const def = meta.reduce(
                      (acc, s) => {
                        acc[s.key] = true;
                        return acc;
                      },
                      {} as Record<PanelSectionKey, boolean>,
                    );
                    patchDraft((d) => ({
                      ...d,
                      sections: def,
                      sectionOrder: normalizeSectionOrder(meta.map((m) => m.key)),
                    }));
                  }}
                >
                  Сбросить к стандартным
                </button>
              </div>
            </div>
          ) : null}

          {tab === "telegram" ? (
            <div className="panel-settings-tab-content">
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
                    onClick={() => void toggleShowBotToken()}
                  >
                    {tokenRevealBusy ? "…" : showToken ? "Скрыть" : "Показать"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const toCopy =
                        botTokenEdit.trim() || (showToken ? (revealedToken ?? "").trim() : "");
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
                <p className="field-hint">
                  {telegram?.botTokenConfigured
                    ? "Токен настроен. «Показать» загружает полный токен с сервера."
                    : "Токен не задан."}
                </p>
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
              <div className="panel-settings-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      setBotTest(null);
                      try {
                        const r = await testTelegramBot(botTokenEdit.trim() || undefined);
                        if (r.ok) {
                          const name = r.username ? `@${r.username}` : r.name ?? "бот";
                          setBotTest({
                            type: "ok",
                            text: `Бот подключён. ${name} — всё в порядке.`,
                          });
                        } else {
                          setBotTest({
                            type: "err",
                            text: r.error ?? r.message ?? "Ошибка подключения к Telegram.",
                          });
                        }
                      } catch (e) {
                        setBotTest({ type: "err", text: String(e) });
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  Проверить бота
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      try {
                        await save(false);
                        const r = await testTelegramAdminMessage();
                        setMsg(r.ok ? { type: "ok", text: "Тестовое сообщение отправлено." } : { type: "err", text: r.error ?? "Ошибка" });
                      } catch (e) {
                        setMsg({ type: "err", text: String(e) });
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  Отправить тестовое сообщение
                </button>
              </div>
              {botTest ? (
                <div className={`panel-settings-status flash ${botTest.type}`} role="status">
                  {botTest.type === "ok" ? "✓ " : ""}
                  {botTest.text}
                </div>
              ) : null}
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
                    on={draft.telegram[key]}
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
            </div>
          ) : null}

          {tab === "appearance" ? (
            <div className="panel-settings-tab-content">
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
                  value={["blue", "green", "purple", "orange", "red"].includes(String(draft.ui.accentColor)) ? draft.ui.accentColor : "custom"}
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
              <div className="settings-toggle-list">
              <SettingsToggleRow
                label="Компактный режим"
                hint={PANEL_HINTS.compact}
                on={draft.ui.compactMode}
                onToggle={() => patchDraft((d) => ({ ...d, ui: { ...d.ui, compactMode: !d.ui.compactMode } }))}
              />
              <SettingsToggleRow
                label="Показывать подсказки"
                hint={PANEL_HINTS.showHints}
                on={draft.ui.showHints}
                onToggle={() => patchDraft((d) => ({ ...d, ui: { ...d.ui, showHints: !d.ui.showHints } }))}
              />
              <SettingsToggleRow
                label="Новый дизайн WebApp"
                hint={PANEL_HINTS.webAppNewDesign}
                on={draft.ui.webAppNewDesign ?? false}
                onToggle={() => {
                  const next = !(draft.ui.webAppNewDesign ?? false);
                  const ui = { ...draft.ui, webAppNewDesign: next };
                  patchDraft((d) => ({ ...d, ui }));
                  void applyPatch({ settings: { ui } })
                    .then(() =>
                      setMsg({
                        type: "ok",
                        text: next ? "Новый дизайн WebApp включён." : "Старый дизайн WebApp включён.",
                      }),
                    )
                    .catch((e) => setMsg({ type: "err", text: String(e) }));
                }}
              />
              </div>
              <div className="form-field">
                <FieldLabel label="Часовой пояс" hint={PANEL_HINTS.timezone} />
                <input
                  value={draft.ui.timezone}
                  onChange={(e) => patchDraft((d) => ({ ...d, ui: { ...d.ui, timezone: e.target.value } }))}
                  placeholder="Europe/Moscow"
                />
              </div>
            </div>
          ) : null}

          {tab === "security" ? (
            <div className="panel-settings-tab-content">
              <div className="settings-toggle-list">
              {(
                [
                  ["maskSecrets", "Маскировать секреты в UI"],
                  ["confirmDangerousActions", "Подтверждение опасных действий"],
                  ["showDiagnosticDetails", "Показывать диагностические данные"],
                ] as const
              ).map(([key, label]) => {
                const hintMap: Record<string, string> = {
                  maskSecrets: PANEL_HINTS.maskSecrets,
                  confirmDangerousActions: PANEL_HINTS.confirmDangerous,
                  showDiagnosticDetails: PANEL_HINTS.showDiagnostic,
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
            </div>
          ) : null}

          {tab === "backup" ? (
            <div className="panel-settings-tab-content">
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
                          await importPanelSettings(parsed);
                          await refresh();
                          setMsg({ type: "ok", text: "Настройки импортированы." });
                        } catch (err) {
                          setMsg({ type: "err", text: String(err) });
                        }
                      })();
                    }}
                  />
                  Импортировать настройки
                </label>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => {
                    if (!window.confirm("Вы уверены, что хотите сбросить настройки панели?")) return;
                    void (async () => {
                      setBusy(true);
                      try {
                        await resetPanelSettings();
                        await refresh();
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
                  Сбросить настройки панели
                </button>
              </div>
            </div>
          ) : null}

          {tab === "about" ? (
            <div className="panel-settings-tab-content">
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
                  <li>Обновление настроек: {systemInfo.settingsUpdatedAt ? new Date(Number(systemInfo.settingsUpdatedAt)).toLocaleString("ru-RU") : "—"}</li>
                  <li>Telegram: {systemInfo.telegramBotConfigured ? String(systemInfo.telegramBotMasked) : "не настроен"}</li>
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
                Скопировать диагностическую информацию
              </button>
            </div>
          ) : null}
        </div>

        <div className="modal-footer panel-settings-footer">
          <button type="button" className="ghost" disabled={busy} onClick={requestClose}>
            Отменить
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => void save(false)}>
            Применить
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void save(true)}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
    <AvatarCropModal
      open={avatarCropOpen}
      initialSrc={avatarCropSrc}
      busy={busy}
      onClose={() => {
        if (!busy) setAvatarCropOpen(false);
      }}
      onSave={onAvatarCropSave}
    />
    </>
  );
}
