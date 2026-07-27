/** Номер сборки панели. Увеличивайте при выкате значимых изменений. */
export const PANEL_VERSION = 123;

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
