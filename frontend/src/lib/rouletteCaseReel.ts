/** Геометрия горизонтальной ленты (CS case opening). */

export const CASE_ITEM_WIDTH = 96;
export const CASE_ITEM_GAP = 10;
export const CASE_STRIDE = CASE_ITEM_WIDTH + CASE_ITEM_GAP;
/** Повторов ленты достаточно для длинного спина + запас. */
export const CASE_REPEATS = 24;
/** В каком цикле держим ленту в покое (середина). */
export const CASE_IDLE_CYCLE = 4;

export function caseCycleWidth(prizeCount: number): number {
  return Math.max(1, prizeCount) * CASE_STRIDE;
}

export function caseOffsetForSlot(slot: number, viewportWidth: number, jitter = 0): number {
  const center = viewportWidth / 2;
  const itemCenter = slot * CASE_STRIDE + CASE_ITEM_WIDTH / 2;
  const jitterPx = Math.max(-0.22, Math.min(0.22, jitter)) * CASE_ITEM_WIDTH;
  return center - itemCenter - jitterPx;
}

export function caseIdleOffset(prizeCount: number, viewportWidth: number, prizeIndex = 0): number {
  const n = Math.max(1, prizeCount);
  const idx = ((prizeIndex % n) + n) % n;
  const slot = CASE_IDLE_CYCLE * n + idx;
  return caseOffsetForSlot(slot, viewportWidth, 0);
}

/**
 * Сдвигает offset в «домашний» диапазон около idle-цикла без визуального скачка
 * (разница кратна ширине одного цикла призов).
 */
export function wrapCaseOffsetToIdle(offset: number, prizeCount: number, viewportWidth: number): number {
  const cycleW = caseCycleWidth(prizeCount);
  if (cycleW <= 0) return offset;
  const idle = caseIdleOffset(prizeCount, viewportWidth, 0);
  let next = offset;
  // Прокрутка влево уменьшает offset — возвращаем на цикл вверх
  while (next < idle - cycleW) next += cycleW;
  while (next > idle + cycleW * 0.5) next -= cycleW;
  return next;
}

/**
 * Цель спина: ближайший слот нужного приза минимум на `minCycles` циклов впереди текущей позиции.
 */
export function caseSpinTargetOffset(
  currentOffset: number,
  prizeIndex: number,
  prizeCount: number,
  viewportWidth: number,
  minCycles = 5,
  jitter = 0,
): number {
  const n = Math.max(1, prizeCount);
  const idx = ((prizeIndex % n) + n) % n;
  const cycleW = caseCycleWidth(n);
  const minTravel = Math.max(cycleW * Math.max(3, minCycles), CASE_STRIDE * 8);
  const jitterClamped = Math.max(-0.22, Math.min(0.22, jitter));
  const C = viewportWidth / 2 - CASE_ITEM_WIDTH / 2 - jitterClamped * CASE_ITEM_WIDTH;
  // offset(slot) = C - slot * STRIDE  =>  slot = (C - offset) / STRIDE
  const minSlot = Math.ceil((C - currentOffset + minTravel) / CASE_STRIDE);
  let slot = Math.ceil((minSlot - idx) / n) * n + idx;
  if (slot < minSlot) slot += n;
  // Не выходим за последнюю треть ленты
  const maxSlot = (CASE_REPEATS - 2) * n + idx;
  if (slot > maxSlot) {
    // Сначала вернёмся в idle (вызывающий код должен wrap'нуть), затем цель в безопасной зоне
    slot = Math.min(maxSlot, (CASE_IDLE_CYCLE + Math.max(3, minCycles)) * n + idx);
  }
  return caseOffsetForSlot(slot, viewportWidth, jitterClamped);
}
