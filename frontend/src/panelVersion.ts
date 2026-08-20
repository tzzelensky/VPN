/**
 * Версия панели: major.minor
 * Следующее обновление: 1.1, затем 1.2 и т.д.
 * При крупном релизе поднимайте major (2.0).
 */
export const PANEL_VERSION_MAJOR = 1;
export const PANEL_VERSION_MINOR = 93;

export const PANEL_VERSION = `${PANEL_VERSION_MAJOR}.${PANEL_VERSION_MINOR}`;

export function panelVersionLabel(version = PANEL_VERSION): string {
  return `HSN-v.${version}`;
}

/** Время сборки frontend (ISO), подставляется Vite при build. */
declare const __PANEL_BUILT_AT__: string | undefined;

export function panelBuiltAtMs(): number {
  const raw = typeof __PANEL_BUILT_AT__ !== "undefined" ? __PANEL_BUILT_AT__ : "";
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Date.now();
}
