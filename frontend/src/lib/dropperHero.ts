/** Процедурный пиксель-арт герой (сетка 13×17), без внешних спрайтов. */

function grid(ctx: CanvasRenderingContext2D, gw: number, gh: number, cells: string[], palette: Record<string, string>) {
  for (let row = 0; row < gh; row++) {
    const line = cells[row] ?? "";
    for (let col = 0; col < gw; col++) {
      const ch = line[col] ?? " ";
      if (ch === " " || ch === ".") continue;
      ctx.fillStyle = palette[ch] ?? "#f0f";
      ctx.fillRect(col, row, 1, 1);
    }
  }
}

/** Зелёная футболка, голубые штаны, каштановые волосы, бежевая кожа — контраст с тёмно-зелёным фоном. */
const PAL = {
  h: "#6b4423",
  H: "#4a2c12",
  s: "#e8c4a0",
  S: "#d4a574",
  j: "#34d399",
  J: "#10b981",
  K: "#047857",
  p: "#7dd3fc",
  P: "#38bdf8",
  b: "#57534e",
  B: "#3f3f46",
  w: "#bae6fd",
  x: "#1e293b",
} as const;

/** Вид спереди (лобби). */
const FRONT: string[] = [
  "....h...H....",
  "...hhhHHh....",
  "..hhsssshh...",
  "..hSxsxSxh...",
  "..hSxsxSxh...",
  "..hssssssh...",
  "...jjjjjj....",
  "..jjjjjjjj...",
  "..jJjjjjJj...",
  "..jJJJJJJj...",
  "...jjjjjj....",
  "...pppppp....",
  "..pppppppp...",
  "..pppppppp...",
  "..bbbbbbbb...",
  "..bbbbbbbb...",
  "..BB....BB...",
];

/** Вид со спины (полёт): волосы, футболка, голубые штаны. */
const BACK: string[] = [
  "....h...H....",
  "...hhhHHh....",
  "..hhhhhhhh...",
  "..hhhhhhhh...",
  "..hssssssh...",
  "..hssssssh...",
  "...jjjjjj....",
  "..jjjjjjjj...",
  "..jJjjjjJj...",
  "..jJJJJJJj...",
  "...jjjjjj....",
  "...pppppp....",
  "..pppppppp...",
  "..pppppppp...",
  "..bbbbbbbb...",
  "..bbbbbbbb...",
  "..BB....BB...",
];

export function drawHeroFront(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const gw = 13;
  const gh = 17;
  const s = Math.min(w / gw, h / gh);
  const ox = x + (w - gw * s) / 2;
  const oy = y + (h - gh * s);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  grid(ctx, gw, gh, FRONT, PAL as unknown as Record<string, string>);
  ctx.restore();
}

export function drawHeroBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const gw = 13;
  const gh = 17;
  const s = Math.min(w / gw, h / gh);
  const ox = x + (w - gw * s) / 2;
  const oy = y + (h - gh * s);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  grid(ctx, gw, gh, BACK, PAL as unknown as Record<string, string>);
  ctx.restore();
}
