import { useCallback, useEffect, useRef, useState } from "react";
import { finishDropperSession, type MySubProfileDto } from "../api";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORLD_W = 320;
const WORLD_H = 8400;
const ROW_STEP = 130;
const PLAYER_W = 22;
const PLAYER_H = 32;
const FALL_SPEED = 275;
const FINISH_ZONE = 110;
const TARGET_FLIGHT_MS = 30_000;

type ObstacleRow = { y: number; gapLeft: number; gapRight: number };

function buildObstacles(seed: number): ObstacleRow[] {
  const rnd = mulberry32(seed);
  const rows: ObstacleRow[] = [];
  for (let y = 200; y < WORLD_H - FINISH_ZONE - 40; y += ROW_STEP) {
    const gapW = 72 + Math.floor(rnd() * 18);
    const cx = 40 + rnd() * (WORLD_W - 80);
    const gapLeft = Math.max(8, Math.min(cx - gapW / 2, WORLD_W - gapW - 8));
    const gapRight = gapLeft + gapW;
    rows.push({ y, gapLeft, gapRight });
  }
  return rows;
}

function aabbHit(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

type Props = {
  initData: string;
  sessionId: string;
  seed: number;
  targetUserId: number;
  profile: MySubProfileDto;
  onDone: () => void;
};

export default function DropperGame({ initData, sessionId, seed, targetUserId, profile, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"playing" | "won" | "lost">("playing");
  const [flightMs, setFlightMs] = useState(0);
  const [busyGift, setBusyGift] = useState(false);
  const [giftErr, setGiftErr] = useState("");

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const obstaclesRef = useRef(buildObstacles(seed));
  const playerRef = useRef({ x: WORLD_W / 2 - PLAYER_W / 2, y: 48, targetX: WORLD_W / 2 - PLAYER_W / 2 });
  const camYRef = useRef(0);
  const startTRef = useRef(performance.now());
  const touchRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const reportedRef = useRef(false);

  const submitFinish = useCallback(
    async (won: boolean, ms: number, choice?: "gb" | "days") => {
      if (reportedRef.current) return;
      setBusyGift(true);
      setGiftErr("");
      try {
        await finishDropperSession({ init_data: initData, session_id: sessionId, won, flight_ms: Math.round(ms), choice });
        reportedRef.current = true;
        if (won) onDone();
      } catch (e) {
        const t = e instanceof Error ? e.message : String(e);
        if (t.includes("choice_required")) {
          setGiftErr("Выберите подарок.");
        } else {
          setGiftErr(t.slice(0, 120));
        }
      } finally {
        setBusyGift(false);
      }
    },
    [initData, sessionId, onDone],
  );

  useEffect(() => {
    reportedRef.current = false;
    obstaclesRef.current = buildObstacles(seed);
    playerRef.current = { x: WORLD_W / 2 - PLAYER_W / 2, y: 48, targetX: WORLD_W / 2 - PLAYER_W / 2 };
    camYRef.current = 0;
    startTRef.current = performance.now();
    touchRef.current = null;
    phaseRef.current = "playing";
    setPhase("playing");
    setFlightMs(0);
    setGiftErr("");

    const canvas = canvasRef.current;
    if (!canvas) return () => undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => undefined;

    let last = performance.now();
    let running = true;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = Math.min(400, canvas.parentElement?.clientWidth ?? 320);
      const cssH = Math.min(380, Math.floor(window.innerHeight * 0.52));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      return { dpr, cssW, cssH, scale: cssW / WORLD_W };
    };

    let { dpr, cssW, cssH, scale } = resize();

    const onMove = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      const lx = (clientX - rect.left) / scale;
      touchRef.current = Math.max(PLAYER_W / 2, Math.min(WORLD_W - PLAYER_W / 2, lx));
    };
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) onMove(e.touches[0].clientX);
    };
    const onMouse = (e: MouseEvent) => onMove(e.clientX);
    canvas.addEventListener("touchstart", onTouch, { passive: true });
    canvas.addEventListener("touchmove", onTouch, { passive: true });
    canvas.addEventListener("mousemove", onMouse);

    const ro = new ResizeObserver(() => {
      const r = resize();
      dpr = r.dpr;
      cssW = r.cssW;
      cssH = r.cssH;
      scale = r.scale;
    });
    ro.observe(canvas.parentElement ?? canvas);

    const loop = () => {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min(0.055, (now - last) / 1000);
      last = now;

      const ph = phaseRef.current;
      const p = playerRef.current;

      if (ph === "playing") {
        const tx = touchRef.current ?? p.x + PLAYER_W / 2;
        p.targetX = tx - PLAYER_W / 2;
        p.x += (p.targetX - p.x) * Math.min(1, dt * 10);
        p.y += FALL_SPEED * dt;

        camYRef.current = Math.max(0, Math.min(p.y - cssH * 0.28, WORLD_H - cssH));

        const px = p.x;
        const py = p.y;

        for (const row of obstaclesRef.current) {
          if (Math.abs(row.y - py) > 220) continue;
          const wallH = 18;
          if (row.gapLeft > 4 && aabbHit(px, py, PLAYER_W, PLAYER_H, 0, row.y, row.gapLeft, wallH)) {
            const ms = now - startTRef.current;
            setFlightMs(ms);
            phaseRef.current = "lost";
            setPhase("lost");
            void submitFinish(false, ms);
            break;
          }
          if (row.gapRight < WORLD_W - 4 && aabbHit(px, py, PLAYER_W, PLAYER_H, row.gapRight, row.y, WORLD_W - row.gapRight, wallH)) {
            const ms = now - startTRef.current;
            setFlightMs(ms);
            phaseRef.current = "lost";
            setPhase("lost");
            void submitFinish(false, ms);
            break;
          }
        }

        if (phaseRef.current === "playing" && py > WORLD_H - 75) {
          const ms = now - startTRef.current;
          setFlightMs(ms);
          phaseRef.current = "won";
          setPhase("won");
        }
      }

      const camY = camYRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#070708";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.scale(scale, scale);
      ctx.translate(0, -camY);

      ctx.fillStyle = "#101014";
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);

      for (const row of obstaclesRef.current) {
        if (row.y < camY - 50 || row.y > camY + cssH / scale + 50) continue;
        ctx.fillStyle = "#eaeaea";
        ctx.fillRect(0, row.y, row.gapLeft, 18);
        ctx.fillRect(row.gapRight, row.y, WORLD_W - row.gapRight, 18);
      }

      const finishY = WORLD_H - 55;
      ctx.fillStyle = "#c9a227";
      ctx.fillRect(0, finishY, WORLD_W, 12);
      ctx.fillStyle = "#1a1a1e";
      for (let i = 0; i < 40; i++) {
        if (i % 2 === 0) ctx.fillRect(i * 10, finishY, 5, 12);
      }

      ctx.fillStyle = "#f4f4f4";
      ctx.fillRect(p.x, p.y, PLAYER_W, PLAYER_H);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x, p.y, PLAYER_W, PLAYER_H);
      ctx.fillStyle = "#000";
      ctx.fillRect(p.x + 5, p.y + 8, 4, 4);
      ctx.fillRect(p.x + 13, p.y + 8, 4, 4);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("touchstart", onTouch);
      canvas.removeEventListener("touchmove", onTouch);
      canvas.removeEventListener("mousemove", onMouse);
      ro.disconnect();
    };
  }, [sessionId, seed, submitFinish]);

  const canGb = profile.dropper.reward_gb > 0;
  const canDays = profile.dropper.reward_days > 0;

  return (
    <div className="dropper-game-wrap">
      <canvas ref={canvasRef} className="dropper-canvas" />
      {phase === "won" ? (
        <div className="dropper-overlay dropper-overlay--pixel">
          <p className="dropper-pixel-title">Победа! Выберите подарок</p>
          <p className="dropper-pixel-sub">#{targetUserId}</p>
          <div className="dropper-gift-row">
            {canGb ? (
              <button
                type="button"
                className="dropper-gift-btn"
                disabled={busyGift}
                onClick={() => void submitFinish(true, flightMs || TARGET_FLIGHT_MS, "gb")}
              >
                +{profile.dropper.reward_gb} ГБ
              </button>
            ) : null}
            {canDays ? (
              <button
                type="button"
                className="dropper-gift-btn"
                disabled={busyGift}
                onClick={() => void submitFinish(true, flightMs || TARGET_FLIGHT_MS, "days")}
              >
                +{profile.dropper.reward_days} дн.
              </button>
            ) : null}
          </div>
          {!canGb && !canDays ? <p className="dropper-pixel-sub">Награды не настроены.</p> : null}
          {giftErr ? <p className="dropper-pixel-err">{giftErr}</p> : null}
        </div>
      ) : null}
      {phase === "lost" ? (
        <div className="dropper-overlay dropper-overlay--pixel">
          <p className="dropper-pixel-title">Упс!</p>
          <p className="dropper-pixel-sub">Врезались в препятствие. Билет использован.</p>
          <button type="button" className="dropper-gift-btn" onClick={onDone}>
            Закрыть
          </button>
        </div>
      ) : null}
    </div>
  );
}
