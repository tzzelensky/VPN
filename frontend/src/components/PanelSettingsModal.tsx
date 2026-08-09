import { useEffect, useMemo, useRef, useState } from "react";
import {
  deletePanelAvatar,
  fetchPanelGeminiApiKey,
  fetchPanelSystemInfo,
  fetchPanelTelegramBotToken,
  importPanelSettings,
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
import AdminModalBackdrop from "./AdminModalBackdrop";
import AvatarCropModal from "./AvatarCropModal";
import SettingsNav from "./panel-settings/SettingsNav";
import BrandTab from "./panel-settings/tabs/BrandTab";
import NavVpnTab from "./panel-settings/tabs/NavVpnTab";
import BotTab from "./panel-settings/tabs/BotTab";
import AppearanceTab from "./panel-settings/tabs/AppearanceTab";
import SystemTab from "./panel-settings/tabs/SystemTab";
import type { MsgState, SettingsTabId } from "./panel-settings/types";

function cloneSettings(s: PanelSettings): PanelSettings {
  return JSON.parse(JSON.stringify(s)) as PanelSettings;
}

export default function PanelSettingsModal({
  open,
  onClose,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { settings, meta, telegram, applyPatch, refresh, avatarUrl } = usePanelSettings();
  const [tab, setTab] = useState<SettingsTabId>("brand");
  const [draft, setDraft] = useState<PanelSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<MsgState>(null);
  const [botTokenEdit, setBotTokenEdit] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [tokenRevealBusy, setTokenRevealBusy] = useState(false);
  const [geminiKeyEdit, setGeminiKeyEdit] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [revealedGeminiKey, setRevealedGeminiKey] = useState<string | null>(null);
  const [geminiRevealBusy, setGeminiRevealBusy] = useState(false);
  const [clearGeminiKey, setClearGeminiKey] = useState(false);
  const [botTest, setBotTest] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<Record<string, unknown> | null>(null);
  const [dragSectionKey, setDragSectionKey] = useState<PanelSectionKey | null>(null);
  const [overSectionKey, setOverSectionKey] = useState<PanelSectionKey | null>(null);
  const [sectionsSavedFlash, setSectionsSavedFlash] = useState(false);
  const [webAppSavedFlash, setWebAppSavedFlash] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const lastSyncedAtRef = useRef(0);
  const flashTimers = useRef<{ sections?: number; webapp?: number }>({});

  function flashSaved(kind: "sections" | "webapp") {
    const setFlash = kind === "sections" ? setSectionsSavedFlash : setWebAppSavedFlash;
    setFlash(true);
    window.clearTimeout(flashTimers.current[kind]);
    flashTimers.current[kind] = window.setTimeout(() => setFlash(false), 1800);
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(flashTimers.current.sections);
      window.clearTimeout(flashTimers.current.webapp);
    };
  }, []);

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
    cloned.vpnDisplay = {
      serverOrder: Array.isArray(cloned.vpnDisplay?.serverOrder) ? [...cloned.vpnDisplay.serverOrder] : [],
      entryOrder: Array.isArray(cloned.vpnDisplay?.entryOrder) ? [...cloned.vpnDisplay.entryOrder] : [],
    };
    cloned.panel.subscriptionBanner = {
      ...{
        enabled: false,
        text: "",
        whitelistText: "",
        telegramUrl: "",
        telegramLinkText: "тех. поддержку",
      },
      ...cloned.panel.subscriptionBanner,
    };
    cloned.telegram = {
      ...cloned.telegram,
      aiAssistantEnabled: cloned.telegram.aiAssistantEnabled !== false,
      geminiModel: cloned.telegram.geminiModel || "gemini-2.5-flash-lite",
    };
    setDraft(cloned);
    setDirty(false);
    setBotTokenEdit("");
    setShowToken(false);
    setRevealedToken(null);
    setGeminiKeyEdit("");
    setClearGeminiKey(false);
    setShowGeminiKey(false);
    setRevealedGeminiKey(null);
    setBotTest(null);
    setAvatarPreview(null);
    setTab("brand");
    setMsg(null);
  }, [open, settings]);

  useEffect(() => {
    if (open && tab === "system") {
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

  function patchDraft(fn: (d: PanelSettings) => PanelSettings) {
    setDraft((prev) => {
      if (!prev) return prev;
      setDirty(true);
      return fn(prev);
    });
  }

  function patchDraftQuiet(fn: (d: PanelSettings) => PanelSettings) {
    setDraft((prev) => (prev ? fn(prev) : prev));
  }

  function reorderSections(from: PanelSectionKey, to: PanelSectionKey) {
    if (from === to) return;
    let nextOrder: PanelSectionKey[] | null = null;
    patchDraftQuiet((d) => {
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
    void applyPatch({ settings: { sectionOrder: nextOrder } })
      .then(() => flashSaved("sections"))
      .catch((e) => {
        setMsg({ type: "err", text: `Не удалось сохранить порядок: ${String(e)}` });
      });
  }

  function requestClose() {
    if (dirty && !window.confirm("Есть несохранённые изменения. Закрыть без сохранения?")) return;
    onClose();
  }

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
      if (clearGeminiKey) payload.clearGeminiApiKey = true;
      else if (geminiKeyEdit.trim()) payload.geminiApiKey = geminiKeyEdit.trim();
      const r = await applyPatch(payload);
      lastSyncedAtRef.current = r.settings.updatedAt;
      setDirty(false);
      setBotTokenEdit("");
      setGeminiKeyEdit("");
      setClearGeminiKey(false);
      setShowGeminiKey(false);
      setRevealedGeminiKey(null);
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

  async function toggleShowGeminiKey() {
    if (showGeminiKey) {
      setShowGeminiKey(false);
      setRevealedGeminiKey(null);
      return;
    }
    if (geminiKeyEdit.trim()) {
      setShowGeminiKey(true);
      return;
    }
    if (!telegram?.geminiApiKeyConfigured || clearGeminiKey) return;
    setGeminiRevealBusy(true);
    try {
      const { geminiApiKey } = await fetchPanelGeminiApiKey();
      setRevealedGeminiKey(geminiApiKey);
      setShowGeminiKey(true);
    } catch (e) {
      setMsg({ type: "err", text: `Не удалось получить Gemini API key: ${String(e)}` });
    } finally {
      setGeminiRevealBusy(false);
    }
  }

  function onToggleWebApp() {
    if (!draft) return;
    const next = !(draft.ui.webAppNewDesign ?? false);
    const ui = { ...draft.ui, webAppNewDesign: next };
    patchDraftQuiet((d) => ({ ...d, ui }));
    void applyPatch({ settings: { ui } })
      .then(() => {
        flashSaved("webapp");
        setMsg({
          type: "ok",
          text: next ? "Новый дизайн WebApp включён." : "Старый дизайн WebApp включён.",
        });
      })
      .catch((e) => setMsg({ type: "err", text: String(e) }));
  }

  if (!open || !draft) return null;

  const avatarDisplaySrc = avatarPreview ?? avatarUrl ?? null;
  const footerMeta = dirty
    ? "Есть несохранённые изменения"
    : msg?.type === "ok"
      ? msg.text
      : msg?.type === "err"
        ? msg.text
        : "Все изменения сохранены";

  return (
    <>
      <AdminModalBackdrop className="panel-settings-backdrop" onClose={requestClose}>
        <div className="modal panel-settings-modal">
          <div className="modal-head panel-settings-head">
            <h2>Настройки панели</h2>
            <button type="button" className="ghost modal-close" onClick={requestClose} aria-label="Закрыть">
              ×
            </button>
          </div>

          <div className="panel-settings-shell">
            <SettingsNav tab={tab} onChange={setTab} />

            <div className="modal-body panel-settings-body">
              {msg ? <div className={`flash ${msg.type === "ok" ? "ok" : "err"}`}>{msg.text}</div> : null}

              {tab === "brand" ? (
                <BrandTab
                  draft={draft}
                  patchDraft={patchDraft}
                  busy={busy}
                  avatarDisplaySrc={avatarDisplaySrc}
                  avatarInputRef={avatarInputRef}
                  onOpenAvatarCrop={() => openAvatarCrop()}
                  onAvatarFile={(f) => void onAvatarFile(f)}
                  onDeleteAvatar={() => {
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
                />
              ) : null}

              {tab === "navVpn" ? (
                <NavVpnTab
                  draft={draft}
                  patchDraft={patchDraft}
                  meta={meta}
                  sectionsOrdered={sectionsOrdered}
                  dragSectionKey={dragSectionKey}
                  overSectionKey={overSectionKey}
                  setDragSectionKey={setDragSectionKey}
                  setOverSectionKey={setOverSectionKey}
                  onReorderSections={reorderSections}
                  sectionsSavedFlash={sectionsSavedFlash}
                />
              ) : null}

              {tab === "bot" ? (
                <BotTab
                  draft={draft}
                  patchDraft={patchDraft}
                  telegram={telegram}
                  busy={busy}
                  botTokenEdit={botTokenEdit}
                  setBotTokenEdit={setBotTokenEdit}
                  showToken={showToken}
                  revealedToken={revealedToken}
                  tokenRevealBusy={tokenRevealBusy}
                  onToggleShowToken={() => void toggleShowBotToken()}
                  geminiKeyEdit={geminiKeyEdit}
                  setGeminiKeyEdit={setGeminiKeyEdit}
                  showGeminiKey={showGeminiKey}
                  revealedGeminiKey={revealedGeminiKey}
                  geminiRevealBusy={geminiRevealBusy}
                  clearGeminiKey={clearGeminiKey}
                  setClearGeminiKey={(v) => {
                    setClearGeminiKey(v);
                    if (v) {
                      setShowGeminiKey(false);
                      setRevealedGeminiKey(null);
                    }
                  }}
                  onToggleShowGemini={() => void toggleShowGeminiKey()}
                  setDirty={setDirty}
                  setMsg={setMsg}
                  botTest={botTest}
                  onTestBot={() => {
                    void (async () => {
                      setBusy(true);
                      setBotTest(null);
                      try {
                        const r = await testTelegramBot(botTokenEdit.trim() || undefined);
                        if (r.ok) {
                          const name = r.username ? `@${r.username}` : r.name ?? "бот";
                          setBotTest({ type: "ok", text: `Бот подключён. ${name} — всё в порядке.` });
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
                  onTestMessage={() => {
                    void (async () => {
                      setBusy(true);
                      try {
                        await save(false);
                        const r = await testTelegramAdminMessage();
                        setMsg(
                          r.ok
                            ? { type: "ok", text: "Тестовое сообщение отправлено." }
                            : { type: "err", text: r.error ?? "Ошибка" },
                        );
                      } catch (e) {
                        setMsg({ type: "err", text: String(e) });
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                />
              ) : null}

              {tab === "appearance" ? (
                <AppearanceTab
                  draft={draft}
                  patchDraft={patchDraft}
                  webAppSavedFlash={webAppSavedFlash}
                  onToggleWebApp={onToggleWebApp}
                />
              ) : null}

              {tab === "system" ? (
                <SystemTab
                  draft={draft}
                  patchDraft={patchDraft}
                  busy={busy}
                  systemInfo={systemInfo}
                  setMsg={setMsg}
                  setDirty={setDirty}
                  setBusy={setBusy}
                  onImport={async (parsed) => {
                    await importPanelSettings(parsed);
                    await refresh();
                  }}
                  onReset={async () => {
                    await resetPanelSettings();
                    await refresh();
                  }}
                  onPasswordChanged={() => {
                    onClose();
                    onLogout();
                    window.location.assign("/login");
                  }}
                />
              ) : null}
            </div>
          </div>

          <div className="panel-settings-footer">
            <div
              className={`panel-settings-footer__meta ${
                dirty ? "is-dirty" : msg?.type === "err" ? "is-err" : msg?.type === "ok" ? "is-ok" : ""
              }`}
            >
              {footerMeta}
            </div>
            <div className="panel-settings-footer__actions">
              <button type="button" className="ghost" disabled={busy} onClick={requestClose}>
                Отменить
              </button>
              <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void save(false)}>
                Применить
              </button>
            </div>
          </div>
        </div>
      </AdminModalBackdrop>
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
