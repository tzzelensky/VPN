import { useCallback, useEffect, useRef, useState } from "react";
import { finishDropperSession, type MySubProfileDto } from "../api";
import { drawHeroBack } from "../lib/dropperHero";
import { startDropperAmbient } from "../lib/dropperMusic";

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

function telegramViewportCssSize(): { w: number; h: number } {
  const tg = (
    window as unknown as {
      Telegram?: { WebApp?: { viewportStableHeight?: number; viewportStableWidth?: number } };
    }
  ).Telegram?.WebApp;
  const w = tg?.viewportStableWidth ?? window.visualViewport?.width ?? window.innerWidth;
  const h = tg?.viewportStableHeight ?? window.visualViewport?.height ?? window.innerHeight;
  return { w: Math.max(280, w), h: Math.max(280, h) };
}

const WORLD_W = 320;
const WORLD_H = 8400;
function rowStepForIndex(i: number): number {
  if (i < 5) return 168;
  if (i < 12) return 152;
  return 138;
}
const PLAYER_W = 26;
const PLAYER_H = 34;
const FINISH_ZONE = 110;
/** Высота ряда блоков земли (хитбокс совпадает). */
const EARTH_ROW_H = 22;
/** Пикселей от старта (y≈48) до условия победы (py &gt; WORLD_H−40), при скорости WORLD/travelSec ≈ целевое время полёта. */
const DROP_TRAVEL_PX = WORLD_H - 48 - 40;
/** Сколько секунд пути без рядов препятствий (только свободное падение). */
const DROP_FREE_FALL_SEC = 4;
const DROP_START_COUNTDOWN_SEC = 3;
const DROP_START_COUNTDOWN_MS = DROP_START_COUNTDOWN_SEC * 1000;
const DROP_MAX_HEARTS = 3;
const DROP_GHOST_HITS_AFTER_DAMAGE = 2;

type ObstacleRow = { y: number; gapLeft: number; gapRight: number };

function firstObstacleRowYForFallSpeed(fallSpeed: number): number {
  const capY = WORLD_H - FINISH_ZONE - 40;
  const rawFirstRowY = 48 + fallSpeed * DROP_FREE_FALL_SEC + PLAYER_H + 24;
  return Math.max(200, Math.min(Math.ceil(rawFirstRowY), capY - 300));
}

/** firstRowY — минимальный Y первого ряда блоков (ниже старта на free-fall участок). */
function buildObstacles(seed: number, firstRowY: number): ObstacleRow[] {
  const rnd = mulberry32(seed);
  const rows: ObstacleRow[] = [];
  const capY = WORLD_H - FINISH_ZONE - 40;
  let y = Math.max(200, Math.min(Math.floor(firstRowY), capY - 300));
  let i = 0;
  while (y < WORLD_H - FINISH_ZONE - 40) {
    let gapW: number;
    if (i < 4) {
      gapW = 128 + Math.floor(rnd() * 28);
    } else if (i < 10) {
      gapW = 108 + Math.floor(rnd() * 22);
    } else if (i < 20) {
      gapW = 96 + Math.floor(rnd() * 18);
    } else {
      gapW = 88 + Math.floor(rnd() * 16);
    }
    gapW = Math.min(gapW, WORLD_W - 36);
    const margin = 14;
    const cx = margin + gapW / 2 + rnd() * Math.max(8, WORLD_W - gapW - margin * 2);
    const gapLeft = Math.max(margin, Math.min(cx - gapW / 2, WORLD_W - gapW - margin));
    const gapRight = gapLeft + gapW;
    rows.push({ y, gapLeft, gapRight });
    y += rowStepForIndex(i);
    i += 1;
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

function obstacleHitKind(
  prevAx: number,
  prevAy: number,
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): "side" | "vertical" | null {
  if (!aabbHit(ax, ay, aw, ah, bx, by, bw, bh)) return null;
  const overlapX = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
  const overlapY = Math.min(ay + ah, by + bh) - Math.max(ay, by);
  if (overlapX <= 0 || overlapY <= 0) return null;

  const prevBottom = prevAy + ah;
  const prevTop = prevAy;
  const prevRight = prevAx + aw;
  const prevLeft = prevAx;

  if (prevBottom <= by + 1 || prevTop >= by + bh - 1) return "vertical";
  if (prevRight <= bx + 1 || prevLeft >= bx + bw - 1) return "side";
  return overlapX < overlapY ? "side" : "vertical";
}

type Props = {
  initData: string;
  sessionId: string;
  seed: number;
  targetUserId: number;
  profile: MySubProfileDto;
  onDone: () => void;
  fullscreen?: boolean;
  /** Тренировка: без подарков, результат не в статистику. */
  practiceMode?: boolean;
};

function drawPixelForest(ctx: CanvasRenderingContext2D, viewTop: number, viewBottom: number) {
  const treeSpacing = 44;
  const endCol = Math.ceil(WORLD_W / treeSpacing) + 2;
  for (let col = -1; col < endCol; col++) {
    const baseX = col * treeSpacing + ((col * 17) % 11);
    for (let ty = Math.floor(viewTop / 90) * 90 - 180; ty < viewBottom + 200; ty += 90) {
      const jitter = ((col * 31 + Math.floor(ty / 90) * 13) % 17) - 8;
      const x = baseX + jitter;
      const y = ty + ((col + ty) % 7);
      if (y < -80 || y > WORLD_H + 80) continue;
      ctx.fillStyle = "#1a2d1f";
      ctx.fillRect(x + 10, y + 18, 8, 38);
      ctx.fillStyle = "#2d4a32";
      ctx.fillRect(x + 2, y + 4, 24, 22);
      ctx.fillRect(x + 5, y - 6, 18, 18);
      ctx.fillStyle = "#3d6b42";
      ctx.fillRect(x + 7, y - 2, 14, 12);
      ctx.fillStyle = "#244528";
      ctx.fillRect(x + 4, y + 10, 20, 8);
    }
  }
}

/** Полоса блоков земли с травой сверху (как в референсе). */
function drawEarthBlocksRow(ctx: CanvasRenderingContext2D, worldX: number, worldY: number, totalW: number) {
  if (totalW < 2) return;
  const bw = 13;
  const grassH = 5;
  let cx = worldX;
  const end = worldX + totalW;
  while (cx < end - 0.5) {
    const pieceW = Math.min(bw, end - cx);
    const seed = Math.floor(cx * 0.7 + worldY * 0.03);
    ctx.fillStyle = "#34c67a";
    ctx.fillRect(cx, worldY, pieceW, grassH - 1);
    ctx.fillStyle = "#2a9d5c";
    ctx.fillRect(cx, worldY + grassH - 2, pieceW, 2);
    ctx.fillStyle = "#1e6b40";
    ctx.fillRect(cx, worldY + grassH - 1, pieceW, 1);
    for (let dy = grassH; dy < EARTH_ROW_H; dy++) {
      const n = (seed + dy * 7) % 5;
      const colors = ["#6b5344", "#5c4636", "#4d3b2c", "#5a4330", "#624a38"];
      ctx.fillStyle = colors[n] ?? "#5c4636";
      ctx.fillRect(cx, worldY + dy, pieceW, 1);
    }
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(cx, worldY, 1, EARTH_ROW_H);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(cx + pieceW - 1, worldY + grassH, 1, EARTH_ROW_H - grassH);
    ctx.fillStyle = "#2a1f16";
    ctx.fillRect(cx, worldY + EARTH_ROW_H - 1, pieceW, 1);
    cx += pieceW;
  }
}

export default function DropperGame({
  initData,
  sessionId,
  seed,
  targetUserId,
  profile,
  onDone,
  fullscreen,
  practiceMode = false,
}: Props) {
  const flightDurationSec = Math.max(
    15,
    Math.min(180, Math.floor(Number(profile.dropper.flight_duration_sec) || 40)),
  );
  const flightSpeedMult = Math.max(
    0.25,
    Math.min(4, Math.round((Number(profile.dropper.flight_speed_mult) || 1) * 100) / 100),
  );
  const fallSpeed = (DROP_TRAVEL_PX / flightDurationSec) * flightSpeedMult;
  const effectiveFlightSec = flightDurationSec / flightSpeedMult;
  const targetFlightMsFallback = effectiveFlightSec * 1000;
  const sideHitDeathEnabled = profile.dropper.side_hit_death_enabled !== false;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"playing" | "won" | "lost">("playing");
  const [flightMs, setFlightMs] = useState(0);
  /** Целые секунды до финиша (по пройденному пути). */
  const [countdownSec, setCountdownSec] = useState(() => Math.ceil(flightDurationSec / flightSpeedMult));
  const [startCountdown, setStartCountdown] = useState(DROP_START_COUNTDOWN_SEC);
  const [health, setHealth] = useState(DROP_MAX_HEARTS);
  const [busyGift, setBusyGift] = useState(false);
  const [giftErr, setGiftErr] = useState("");
  const [rewardPickUserId, setRewardPickUserId] = useState(targetUserId);
  const rewardPickUserIdRef = useRef(rewardPickUserId);
  rewardPickUserIdRef.current = rewardPickUserId;

  useEffect(() => {
    setRewardPickUserId(targetUserId);
  }, [sessionId, targetUserId]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const obstaclesRef = useRef(buildObstacles(seed, firstObstacleRowYForFallSpeed(fallSpeed)));
  const playerRef = useRef({ x: WORLD_W / 2 - PLAYER_W / 2, y: 48, targetX: WORLD_W / 2 - PLAYER_W / 2 });
  const camYRef = useRef(0);
  const startTRef = useRef(performance.now());
  const touchRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const reportedRef = useRef(false);
  const fullscreenRef = useRef(!!fullscreen);
  fullscreenRef.current = !!fullscreen;
  const practiceModeRef = useRef(practiceMode);
  practiceModeRef.current = practiceMode;
  const countdownSecRef = useRef(-1);
  const startCountdownRef = useRef(DROP_START_COUNTDOWN_SEC);
  const healthRef = useRef(DROP_MAX_HEARTS);
  const ghostHitsRemainingRef = useRef(0);
  const ghostPassedRowsRef = useRef<Set<number>>(new Set());

  const submitFinish = useCallback(
    async (won: boolean, ms: number, choice?: "gb" | "days") => {
      if (reportedRef.current) return;
      setBusyGift(true);
      setGiftErr("");
      try {
        const rid = rewardPickUserIdRef.current;
        await finishDropperSession({
          init_data: initData,
          session_id: sessionId,
          won,
          flight_ms: Math.round(ms),
          choice,
          ...(won && rid > 0 ? { reward_user_id: rid } : {}),
        });
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
    const stopMusic = startDropperAmbient();

    reportedRef.current = false;
    obstaclesRef.current = buildObstacles(seed, firstObstacleRowYForFallSpeed(fallSpeed));
    playerRef.current = { x: WORLD_W / 2 - PLAYER_W / 2, y: 48, targetX: WORLD_W / 2 - PLAYER_W / 2 };
    camYRef.current = 0;
    startTRef.current = performance.now() + DROP_START_COUNTDOWN_MS;
    touchRef.current = null;
    phaseRef.current = "playing";
    setPhase("playing");
    setFlightMs(0);
    setGiftErr("");
    healthRef.current = DROP_MAX_HEARTS;
    setHealth(DROP_MAX_HEARTS);
    ghostHitsRemainingRef.current = 0;
    ghostPassedRowsRef.current = new Set();
    startCountdownRef.current = DROP_START_COUNTDOWN_SEC;
    setStartCountdown(DROP_START_COUNTDOWN_SEC);
    const cd0 = Math.max(1, Math.ceil(effectiveFlightSec));
    countdownSecRef.current = cd0;
    setCountdownSec(cd0);

    const canvas = canvasRef.current;
    if (!canvas) {
      return () => {
        stopMusic();
      };
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return () => {
        stopMusic();
      };
    }

    let last = performance.now();
    let running = true;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let cssW: number;
      let cssH: number;
      if (fullscreenRef.current) {
        const pad = 16;
        const vv = telegramViewportCssSize();
        cssW = Math.floor(vv.w - pad * 2);
        cssH = Math.floor(vv.h - pad * 2);
      } else {
        cssW = Math.min(400, canvas.parentElement?.clientWidth ?? 320);
        cssH = Math.min(380, Math.floor(window.innerHeight * 0.52));
      }
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

    const onVvResize = () => {
      const r = resize();
      dpr = r.dpr;
      cssW = r.cssW;
      cssH = r.cssH;
      scale = r.scale;
    };
    window.addEventListener("resize", onVvResize);
    window.visualViewport?.addEventListener("resize", onVvResize);

    const loop = () => {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min(0.055, (now - last) / 1000);
      last = now;

      const ph = phaseRef.current;
      const p = playerRef.current;
      const viewHWorld = cssH / scale;

      if (ph === "playing") {
        const tx = touchRef.current ?? p.x + PLAYER_W / 2;
        p.targetX = tx - PLAYER_W / 2;
        const beforeStartMs = startTRef.current - now;
        if (beforeStartMs > 0) {
          const nextStartCountdown = Math.max(1, Math.ceil(beforeStartMs / 1000));
          if (nextStartCountdown !== startCountdownRef.current) {
            startCountdownRef.current = nextStartCountdown;
            setStartCountdown(nextStartCountdown);
          }
        } else {
          if (startCountdownRef.current !== 0) {
            startCountdownRef.current = 0;
            setStartCountdown(0);
          }

          const prevX = p.x;
          const prevY = p.y;
          p.x += (p.targetX - p.x) * Math.min(1, dt * 10);
          p.y += fallSpeed * dt;

          camYRef.current = Math.max(0, Math.min(p.y - viewHWorld * 0.28, WORLD_H - viewHWorld));

          let px = p.x;
          let py = p.y;

          const elapsedMs = now - startTRef.current;
          for (const row of obstaclesRef.current) {
            if (Math.abs(row.y - py) > 260) continue;
            const rowKey = row.y;
            const isGhosting = ghostHitsRemainingRef.current > 0;

            const leftHit = row.gapLeft > 4
              ? obstacleHitKind(prevX, prevY, px, py, PLAYER_W, PLAYER_H, 0, row.y, row.gapLeft, EARTH_ROW_H)
              : null;
            if (leftHit) {
              if (isGhosting) {
                if (!ghostPassedRowsRef.current.has(rowKey)) {
                  ghostPassedRowsRef.current.add(rowKey);
                  ghostHitsRemainingRef.current = Math.max(0, ghostHitsRemainingRef.current - 1);
                }
                break;
              }
              if (leftHit === "side" && !sideHitDeathEnabled) {
                p.x = Math.max(p.x, row.gapLeft);
                p.targetX = Math.max(p.targetX, row.gapLeft);
                px = p.x;
              } else {
                if (leftHit === "side") {
                  p.x = Math.max(p.x, row.gapLeft);
                  p.targetX = Math.max(p.targetX, row.gapLeft);
                  px = p.x;
                } else {
                  p.y = Math.max(48, row.y - PLAYER_H - 6);
                  py = p.y;
                }
                const nextHealth = Math.max(0, healthRef.current - 1);
                healthRef.current = nextHealth;
                setHealth(nextHealth);
                if (nextHealth <= 0) {
                  const ms = elapsedMs;
                  setFlightMs(ms);
                  phaseRef.current = "lost";
                  setPhase("lost");
                  void submitFinish(false, ms);
                } else {
                  ghostHitsRemainingRef.current = DROP_GHOST_HITS_AFTER_DAMAGE;
                  ghostPassedRowsRef.current = new Set();
                }
                break;
              }
            }

            const rightHit = row.gapRight < WORLD_W - 4
              ? obstacleHitKind(
                  prevX,
                  prevY,
                  px,
                  py,
                  PLAYER_W,
                  PLAYER_H,
                  row.gapRight,
                  row.y,
                  WORLD_W - row.gapRight,
                  EARTH_ROW_H,
                )
              : null;
            if (rightHit) {
              if (isGhosting) {
                if (!ghostPassedRowsRef.current.has(rowKey)) {
                  ghostPassedRowsRef.current.add(rowKey);
                  ghostHitsRemainingRef.current = Math.max(0, ghostHitsRemainingRef.current - 1);
                }
                break;
              }
              if (rightHit === "side" && !sideHitDeathEnabled) {
                p.x = Math.min(p.x, row.gapRight - PLAYER_W);
                p.targetX = Math.min(p.targetX, row.gapRight - PLAYER_W);
                px = p.x;
              } else {
                if (rightHit === "side") {
                  p.x = Math.min(p.x, row.gapRight - PLAYER_W);
                  p.targetX = Math.min(p.targetX, row.gapRight - PLAYER_W);
                  px = p.x;
                } else {
                  p.y = Math.max(48, row.y - PLAYER_H - 6);
                  py = p.y;
                }
                const nextHealth = Math.max(0, healthRef.current - 1);
                healthRef.current = nextHealth;
                setHealth(nextHealth);
                if (nextHealth <= 0) {
                  const ms = elapsedMs;
                  setFlightMs(ms);
                  phaseRef.current = "lost";
                  setPhase("lost");
                  void submitFinish(false, ms);
                } else {
                  ghostHitsRemainingRef.current = DROP_GHOST_HITS_AFTER_DAMAGE;
                  ghostPassedRowsRef.current = new Set();
                }
                break;
              }
            }
          }

          if (phaseRef.current === "playing" && py > WORLD_H - 40) {
            const ms = now - startTRef.current;
            setFlightMs(ms);
            phaseRef.current = "won";
            if (practiceModeRef.current) {
              void submitFinish(true, ms);
            } else {
              setPhase("won");
            }
          }

          if (phaseRef.current === "playing") {
            const traveled = Math.max(0, py - 48);
            const remSec = Math.max(0, (DROP_TRAVEL_PX - traveled) / fallSpeed);
            const nextCd = Math.ceil(remSec);
            if (nextCd !== countdownSecRef.current) {
              countdownSecRef.current = nextCd;
              setCountdownSec(nextCd);
            }
          } else if (countdownSecRef.current !== 0) {
            countdownSecRef.current = 0;
            setCountdownSec(0);
          }
        }
      }

      const camY = camYRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0d120f";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.scale(scale, scale);
      ctx.translate(0, -camY);

      const viewTop = camY;
      const viewBottom = camY + viewHWorld;
      ctx.fillStyle = "#152018";
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      drawPixelForest(ctx, viewTop, viewBottom);

      for (const row of obstaclesRef.current) {
        if (row.y < camY - 80 || row.y > camY + viewHWorld + 80) continue;
        if (row.gapLeft > 2) drawEarthBlocksRow(ctx, 0, row.y, row.gapLeft);
        if (WORLD_W - row.gapRight > 2) drawEarthBlocksRow(ctx, row.gapRight, row.y, WORLD_W - row.gapRight);
      }

      const finishY = WORLD_H - 50;
      drawEarthBlocksRow(ctx, 0, finishY, WORLD_W);
      ctx.fillStyle = "#d4a826";
      ctx.fillRect(0, finishY + EARTH_ROW_H, WORLD_W, 4);
      ctx.fillStyle = "#8a6a18";
      for (let i = 0; i < WORLD_W; i += 10) {
        if (i % 20 === 0) ctx.fillRect(i, finishY + EARTH_ROW_H, 5, 4);
      }

      ctx.imageSmoothingEnabled = false;
      const isGhostBlinkVisible = ghostHitsRemainingRef.current <= 0 || Math.floor(now / 110) % 2 === 0;
      if (isGhostBlinkVisible) {
        drawHeroBack(ctx, p.x, p.y, PLAYER_W, PLAYER_H);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      stopMusic();
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("touchstart", onTouch);
      canvas.removeEventListener("touchmove", onTouch);
      canvas.removeEventListener("mousemove", onMouse);
      window.removeEventListener("resize", onVvResize);
      window.visualViewport?.removeEventListener("resize", onVvResize);
    };
  }, [sessionId, seed, submitFinish, fullscreen, practiceMode, fallSpeed, effectiveFlightSec, sideHitDeathEnabled]);

  const rewardSub = profile.subscriptions.find((s) => s.id === rewardPickUserId);
  const subHasGbCap = (rewardSub?.total_gb ?? 0) > 0;
  const canGb = profile.dropper.reward_gb > 0 && subHasGbCap;
  const canDays = profile.dropper.reward_days > 0;
  const multiSubs = profile.subscriptions.length > 1;

  return (
    <div className={`dropper-game-wrap ${fullscreen ? "dropper-game-wrap--fullscreen" : ""}`.trim()}>
      {phase === "playing" ? (
        <div className="dropper-health" aria-label={`Здоровье: ${health} из ${DROP_MAX_HEARTS}`}>
          {Array.from({ length: DROP_MAX_HEARTS }, (_, i) => (
            <span
              key={i}
              className={`dropper-heart ${i < health ? "dropper-heart--full" : "dropper-heart--empty"}`}
              aria-hidden="true"
            />
          ))}
        </div>
      ) : null}
      {phase === "playing" && startCountdown === 0 ? (
        <div className="dropper-countdown" aria-live="polite">
          <span className="dropper-countdown__label">до финиша</span>
          <span className="dropper-countdown__value">{countdownSec}</span>
          <span className="dropper-countdown__unit">сек</span>
        </div>
      ) : null}
      {phase === "playing" && startCountdown > 0 ? (
        <div className="dropper-start-countdown" aria-hidden="true">
          {startCountdown}
        </div>
      ) : null}
      <canvas ref={canvasRef} className="dropper-canvas" />
      {phase === "won" && !practiceMode ? (
        <div className="dropper-overlay dropper-overlay--pixel">
          <p className="dropper-pixel-title">Победа! Выберите подарок</p>
          {multiSubs ? (
            <div className="dropper-reward-sub-field">
              <label className="dropper-reward-sub-label" htmlFor="dropper-reward-sub">
                Начислить на подписку
              </label>
              <select
                id="dropper-reward-sub"
                className="dropper-reward-sub-select"
                value={String(rewardPickUserId)}
                disabled={busyGift}
                onChange={(e) => setRewardPickUserId(Number(e.target.value) || 0)}
              >
                {profile.subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.id} {s.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="dropper-pixel-sub">
              {rewardSub ? `Подписка: #${rewardSub.id} ${rewardSub.name}` : `#${targetUserId}`}
            </p>
          )}
          <div className="dropper-gift-row">
            {canGb ? (
              <button
                type="button"
                className="dropper-gift-btn"
                disabled={busyGift}
                onClick={() => void submitFinish(true, flightMs || targetFlightMsFallback, "gb")}
              >
                +{profile.dropper.reward_gb} ГБ
              </button>
            ) : null}
            {canDays ? (
              <button
                type="button"
                className="dropper-gift-btn"
                disabled={busyGift}
                onClick={() => void submitFinish(true, flightMs || targetFlightMsFallback, "days")}
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
          <p className="dropper-pixel-sub">
            {practiceMode
              ? "Врезались в препятствие. Это тренировка — билет не списан, попробуйте ещё."
              : "Врезались в препятствие. Билет использован."}
          </p>
          <button type="button" className="dropper-gift-btn" onClick={onDone}>
            Закрыть
          </button>
        </div>
      ) : null}
    </div>
  );
}
