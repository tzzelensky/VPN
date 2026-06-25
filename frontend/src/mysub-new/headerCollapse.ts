import type { MySubNavTabId } from "../components/MySubBottomNav";

export type SwipeVisualState = {
  index: number;
  dragPx: number;
  pageWidth: number;
};

export function computeGameHeaderCollapse(
  gameIndex: number,
  tab: MySubNavTabId,
  visual: SwipeVisualState | null,
): number {
  if (gameIndex < 0) return tab === "game" ? 1 : 0;

  if (visual && visual.pageWidth > 0 && visual.dragPx !== 0) {
    const { index, dragPx, pageWidth } = visual;
    const t = Math.min(1, Math.abs(dragPx) / pageWidth);

    if (index === gameIndex) {
      if (dragPx > 0) return Math.max(0, 1 - t);
      return 1;
    }
    if (index === gameIndex - 1 && dragPx < 0) return t;
    return 0;
  }

  if (visual && visual.dragPx === 0) {
    return visual.index === gameIndex ? 1 : 0;
  }

  return tab === "game" ? 1 : 0;
}
