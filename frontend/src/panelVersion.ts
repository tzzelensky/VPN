/**
 * Версия панели: major.minor (две цифры после точки — «сотые»).
 *
 * Обычный bump: minor + 1 (1.93 → 1.94).
 * После 1.99 → 2.00 (не 1.100): major + 1, minor = 0.
 * Явный крупный релиз: major + 1, minor = 0.
 *
 * При каждом деплое на стенд («катай») также обновляй PANEL_LAST_DEPLOY_AT (ISO UTC).
 */
export const PANEL_VERSION_MAJOR = 2;
export const PANEL_VERSION_MINOR = 12;

/** Максимум minor до перехода на следующий major (1.99 → 2.00). */
export const PANEL_VERSION_MINOR_MAX = 99;

/** Время последней выкатки на стенд (ISO UTC). Обновлять вместе с bump версии. */
export const PANEL_LAST_DEPLOY_AT = "2026-09-15T18:43:17.000Z";

export function formatPanelVersion(major: number, minor: number): string {
  const m = Math.max(0, Math.floor(Number(major) || 0));
  const n = Math.max(0, Math.floor(Number(minor) || 0));
  return `${m}.${String(n).padStart(2, "0")}`;
}

export const PANEL_VERSION = formatPanelVersion(PANEL_VERSION_MAJOR, PANEL_VERSION_MINOR);

export function panelVersionLabel(version = PANEL_VERSION): string {
  return `HSN-v.${version}`;
}

/** Время сборки frontend (ISO), подставляется Vite при build — fallback. */
declare const __PANEL_BUILT_AT__: string | undefined;

export function panelLastDeployAtMs(): number {
  const fromConst = Date.parse(PANEL_LAST_DEPLOY_AT);
  if (Number.isFinite(fromConst)) return fromConst;
  const raw = typeof __PANEL_BUILT_AT__ !== "undefined" ? __PANEL_BUILT_AT__ : "";
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Date.now();
}

/** @deprecated используй panelLastDeployAtMs */
export function panelBuiltAtMs(): number {
  return panelLastDeployAtMs();
}
