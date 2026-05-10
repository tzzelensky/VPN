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

const PAL = {
  h: "#5c3d2e",
  H: "#4a3024",
  s: "#f0c9a8",
  S: "#e8b896",
  j: "#3cdd70",
  J: "#2fb85c",
  K: "#259048",
  p: "#3a3d52",
  P: "#2a2d3e",
  b: "#5c4030",
  B: "#3d2a1f",
  w: "#c8eef0",
  x: "#1a1e2e",
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

/** Вид со спины (полёт). */
const BACK: string[] = [
  "....h...H....",
  "...hhhHHh....",
  "..hhhhhhhh...",
  "..hKKKKKKh...",
  "..hKKKKKKh...",
  "..hhhhhhhh...",
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
