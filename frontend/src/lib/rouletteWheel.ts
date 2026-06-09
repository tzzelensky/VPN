/** Геометрия рулетки: сектора и поворот под указатель сверху. */

export function segmentAngle(segmentCount: number): number {
  return segmentCount > 0 ? 360 / segmentCount : 0;
}

/** Центр сектора index (0 = сверху, по часовой). */
export function sectorCenterDeg(index: number, segmentCount: number): number {
  const a = segmentAngle(segmentCount);
  return index * a + a / 2;
}

export function wheelGradientCss(colors: string[]): string {
  const n = colors.length;
  if (n === 0) return "#334155";
  const a = segmentAngle(n);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const start = i * a;
    const mid = start + a * 0.55;
    const end = (i + 1) * a;
    const c = colors[i]!;
    parts.push(`${c} ${start}deg ${mid}deg`);
    parts.push(`color-mix(in srgb, ${c} 72%, #000) ${mid}deg ${end}deg`);
  }
  return `conic-gradient(${parts.join(", ")})`;
}

/** Поворот колеса, чтобы центр сектора prizeIndex оказался под указателем сверху. */
export function rotationForPrizeIndex(
  currentRotation: number,
  prizeIndex: number,
  segmentCount: number,
  extraTurns = 5,
): number {
  const center = sectorCenterDeg(prizeIndex, segmentCount);
  const targetMod = (360 - center) % 360;
  const currentMod = ((currentRotation % 360) + 360) % 360;
  let delta = targetMod - currentMod;
  if (delta <= 0) delta += 360;
  return currentRotation + extraTurns * 360 + delta;
}

/** CSS transform для подписи на секторе. */
export function labelTransformCss(index: number, segmentCount: number, radiusPx: number): string {
  const angle = sectorCenterDeg(index, segmentCount);
  return `rotate(${angle}deg) translateY(-${radiusPx}px) rotate(${-angle}deg)`;
}
