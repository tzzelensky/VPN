import { useState, type RefObject } from "react";
import type { PanelSettings } from "../../../panelSettingsTypes";
import { PANEL_HINTS } from "../../../panelSettingsHints";
import { FieldLabel } from "../../SettingHint";
import SettingsToggleRow from "../../SettingsToggleRow";
import SettingsCard from "../SettingsCard";
import type { PatchDraft } from "../types";

export default function BrandTab({
  draft,
  patchDraft,
  busy,
  avatarDisplaySrc,
  avatarInputRef,
  onOpenAvatarCrop,
  onAvatarFile,
  onDeleteAvatar,
}: {
  draft: PanelSettings;
  patchDraft: PatchDraft;
  busy: boolean;
  avatarDisplaySrc: string | null;
  avatarInputRef: RefObject<HTMLInputElement | null>;
  onOpenAvatarCrop: () => void;
  onAvatarFile: (file: File | null) => void;
  onDeleteAvatar: () => void;
}) {
  const [identityOpen, setIdentityOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [decoyOpen, setDecoyOpen] = useState(false);
  const decoy = draft.panel.decoyShop;

  return (
    <div className="panel-settings-tab-content panel-settings-tab-content--animate">
      <SettingsCard
        title="Идентичность"
        sub="Название и тексты в панели и боте"
        collapsible
        open={identityOpen}
        onToggle={() => setIdentityOpen((v) => !v)}
      >
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
          <FieldLabel label="Ключевое слово отзыва (вход с витрины)" hint={PANEL_HINTS.shopReviewKeyword} />
          <input
            value={draft.panel.shopReviewKeyword ?? ""}
            placeholder="Секретное слово"
            autoComplete="off"
            onChange={(e) =>
              patchDraft((d) => ({ ...d, panel: { ...d.panel, shopReviewKeyword: e.target.value } }))
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Публичная витрина"
        sub="Тексты для браузеров на / и /goods"
        collapsible
        open={decoyOpen}
        onToggle={() => setDecoyOpen((v) => !v)}
      >
        <p className="field-hint" style={{ marginTop: 0 }}>
          {PANEL_HINTS.decoyShop}
        </p>
        <div className="panel-settings-grid-2">
          <div className="form-field">
            <FieldLabel label="Title (вкладка браузера)" hint="" />
            <input
              value={decoy?.title ?? ""}
              onChange={(e) =>
                patchDraft((d) => ({
                  ...d,
                  panel: { ...d.panel, decoyShop: { ...d.panel.decoyShop, title: e.target.value } },
                }))
              }
            />
          </div>
          <div className="form-field">
            <FieldLabel label="Бренд (заголовок)" hint="" />
            <input
              value={decoy?.brand ?? ""}
              onChange={(e) =>
                patchDraft((d) => ({
                  ...d,
                  panel: { ...d.panel, decoyShop: { ...d.panel.decoyShop, brand: e.target.value } },
                }))
              }
            />
          </div>
        </div>
        <div className="form-field">
          <FieldLabel label="Подзаголовок" hint="" />
          <input
            value={decoy?.tagline ?? ""}
            onChange={(e) =>
              patchDraft((d) => ({
                ...d,
                panel: { ...d.panel, decoyShop: { ...d.panel.decoyShop, tagline: e.target.value } },
              }))
            }
          />
        </div>
        <div className="form-field">
          <FieldLabel label="Вступление (абзацы через пустую строку)" hint="" />
          <textarea
            className="comms-textarea"
            rows={4}
            value={(decoy?.intro ?? []).join("\n\n")}
            onChange={(e) =>
              patchDraft((d) => ({
                ...d,
                panel: {
                  ...d.panel,
                  decoyShop: {
                    ...d.panel.decoyShop,
                    intro: e.target.value
                      .split(/\n\s*\n/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                },
              }))
            }
          />
        </div>
        <div className="form-field">
          <FieldLabel label="Товары (имя | описание | цена — по строке)" hint="" />
          <textarea
            className="comms-textarea"
            rows={5}
            value={(decoy?.items ?? [])
              .map((i) => `${i.name} | ${i.description} | ${i.price}`)
              .join("\n")}
            onChange={(e) =>
              patchDraft((d) => ({
                ...d,
                panel: {
                  ...d.panel,
                  decoyShop: {
                    ...d.panel.decoyShop,
                    items: e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line) => {
                        const [name, description, price] = line.split("|").map((x) => x.trim());
                        return {
                          name: name || "Товар",
                          description: description || "",
                          price: price || "",
                        };
                      }),
                  },
                },
              }))
            }
          />
        </div>
        <div className="form-field">
          <FieldLabel label="Примечание" hint="" />
          <input
            value={decoy?.note ?? ""}
            onChange={(e) =>
              patchDraft((d) => ({
                ...d,
                panel: { ...d.panel, decoyShop: { ...d.panel.decoyShop, note: e.target.value } },
              }))
            }
          />
        </div>
        <div className="form-field">
          <FieldLabel label="Подвал" hint="" />
          <input
            value={decoy?.footer ?? ""}
            onChange={(e) =>
              patchDraft((d) => ({
                ...d,
                panel: { ...d.panel, decoyShop: { ...d.panel.decoyShop, footer: e.target.value } },
              }))
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Логотип" sub="Аватар в сайдбаре панели">
        <div className="panel-avatar-block">
          <div className="panel-avatar-row">
            <button
              type="button"
              className="panel-avatar-hit"
              disabled={busy}
              title="Изменить аватарку"
              aria-label="Изменить аватарку"
              onClick={onOpenAvatarCrop}
            >
              {avatarDisplaySrc ? (
                <img src={avatarDisplaySrc} alt="" className="panel-avatar-preview" />
              ) : (
                <div className="panel-avatar-placeholder">{draft.panel.title.slice(0, 2).toUpperCase()}</div>
              )}
            </button>
            <div className="panel-avatar-actions">
              <input
                ref={avatarInputRef as RefObject<HTMLInputElement>}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="panel-avatar-file-input"
                onChange={(e) => {
                  onAvatarFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <button type="button" className="ghost" disabled={busy} onClick={() => avatarInputRef.current?.click()}>
                Загрузить
              </button>
              <button type="button" className="ghost danger" disabled={busy} onClick={onDeleteAvatar}>
                Удалить
              </button>
            </div>
          </div>
          <p className="field-hint">PNG, JPG или WebP, до 5 МБ.</p>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Подписка и обслуживание"
        collapsible
        open={subscriptionOpen}
        onToggle={() => setSubscriptionOpen((v) => !v)}
      >
        <div className="panel-subscription-text-block">
          <div className="settings-toggle-list">
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
                        whitelistText: "",
                        telegramUrl: "",
                        telegramLinkText: "тех. поддержку",
                      }),
                      enabled: !(d.panel.subscriptionBanner?.enabled ?? false),
                    },
                  },
                }))
              }
            />
          </div>
          {draft.panel.subscriptionBanner?.enabled ? (
            <div className="panel-subscription-text-fields">
              <div className="form-field">
                <FieldLabel label="Текст в Happ / подписке" hint={PANEL_HINTS.subscriptionBannerText} />
                <textarea
                  className="comms-textarea"
                  rows={4}
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
                <FieldLabel label="Текст для белых списков (Happ)" hint={PANEL_HINTS.subscriptionBannerWhitelistText} />
                <textarea
                  className="comms-textarea"
                  rows={3}
                  placeholder={"🪄 Белые списки подключены — обновите подписку 🔄"}
                  value={draft.panel.subscriptionBanner.whitelistText ?? ""}
                  onChange={(e) =>
                    patchDraft((d) => ({
                      ...d,
                      panel: {
                        ...d.panel,
                        subscriptionBanner: {
                          ...d.panel.subscriptionBanner,
                          whitelistText: e.target.value,
                        },
                      },
                    }))
                  }
                />
              </div>
              <div className="panel-settings-grid-2">
                <div className="form-field">
                  <FieldLabel label="Ссылка Telegram" hint={PANEL_HINTS.subscriptionBannerTelegram} />
                  <input
                    value={draft.panel.subscriptionBanner.telegramUrl}
                    placeholder="https://t.me/… или @username"
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
            </div>
          ) : null}
        </div>
        <div className="settings-toggle-list">
          <SettingsToggleRow
            label="Режим обслуживания"
            hint={PANEL_HINTS.maintenance}
            on={draft.maintenance.enabled}
            onToggle={() => patchDraft((d) => ({ ...d, maintenance: { enabled: !d.maintenance.enabled } }))}
          />
        </div>
      </SettingsCard>
    </div>
  );
}
