import { useEffect, useRef } from "react";
import { drawHeroFront } from "../lib/dropperHero";

export default function DropperLobbyHero() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    drawHeroFront(ctx, 0, 0, w, h);
  }, []);
  return <canvas ref={ref} className="mysub-dropper-lobby-hero" width={56} height={72} aria-hidden />;
}
