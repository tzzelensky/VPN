import { useState } from "react";
import type { PanelSectionKey, PanelSectionMeta, PanelSettings } from "../../../panelSettingsTypes";
import { PANEL_HINTS } from "../../../panelSettingsHints";
import { normalizeSectionOrder } from "../../../panelNavUtils";
import { SettingHint } from "../../SettingHint";
import VpnDisplaySettingsPanel from "../../VpnDisplaySettingsPanel";
import SettingsCard from "../SettingsCard";
import type { PatchDraft } from "../types";

export default function NavVpnTab({
  draft,
  patchDraft,
  meta,
  sectionsOrdered,
  dragSectionKey,
  overSectionKey,
  setDragSectionKey,
  setOverSectionKey,
  onReorderSections,
  sectionsSavedFlash,
}: {
  draft: PanelSettings;
  patchDraft: PatchDraft;
  meta: PanelSectionMeta[];
  sectionsOrdered: PanelSectionMeta[];
  dragSectionKey: PanelSectionKey | null;
  overSectionKey: PanelSectionKey | null;
  setDragSectionKey: (k: PanelSectionKey | null) => void;
  setOverSectionKey: (k: PanelSectionKey | null) => void;
  onReorderSections: (from: PanelSectionKey, to: PanelSectionKey) => void;
  sectionsSavedFlash: boolean;
}) {
  const [sectionsOpen, setSectionsOpen] = useState(false);

  return (
    <div className="panel-settings-tab-content panel-settings-tab-content--animate">
      <SettingsCard
        title="Разделы меню"
        sub={
          sectionsSavedFlash
            ? "Порядок сохранён"
            : "Перетащите ⋮⋮ — порядок пишется сразу"
        }
        collapsible
        open={sectionsOpen}
        onToggle={() => setSectionsOpen((v) => !v)}
      >
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
                if (dragSectionKey) onReorderSections(dragSectionKey, s.key);
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
            Показать все
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
            Сбросить
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title="Отображение VPN" sub="Порядок серверов в клиенте">
        <VpnDisplaySettingsPanel
          entryOrder={draft.vpnDisplay?.entryOrder ?? []}
          onEntryOrderChange={(keys) =>
            patchDraft((d) => ({
              ...d,
              vpnDisplay: {
                serverOrder: keys
                  .map((k) => /^vless:(\d+)$/.exec(k))
                  .filter(Boolean)
                  .map((m) => Number(m![1])),
                entryOrder: keys,
              },
            }))
          }
        />
      </SettingsCard>
    </div>
  );
}
