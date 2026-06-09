/** Звук прокрута рулетки (тики + лёгкий свист), Web Audio API. */

const SPIN_MS = 4200;

function getAudioContext(): AudioContext | null {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return AC ? new AC() : null;
  } catch {
    return null;
  }
}

function playTick(ctx: AudioContext, master: GainNode, volume: number): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(620 + Math.random() * 180, t);
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.045);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + 0.05);
}

/** Запускает звук вращения; возвращает функцию остановки. */
export function playRouletteSpinSound(durationMs = SPIN_MS): () => void {
  const ctx = getAudioContext();
  if (!ctx) return () => {};

  const master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);

  const whoosh = ctx.createOscillator();
  const whooshG = ctx.createGain();
  whoosh.type = "sawtooth";
  whoosh.frequency.setValueAtTime(140, ctx.currentTime);
  whoosh.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + durationMs / 1000);
  whooshG.gain.setValueAtTime(0.0001, ctx.currentTime);
  whooshG.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.12);
  whooshG.gain.linearRampToValueAtTime(0.018, ctx.currentTime + durationMs / 1000 - 0.35);
  whooshG.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
  const whooshFilter = ctx.createBiquadFilter();
  whooshFilter.type = "lowpass";
  whooshFilter.frequency.value = 900;
  whoosh.connect(whooshFilter);
  whooshFilter.connect(whooshG);
  whooshG.connect(master);
  whoosh.start();
  whoosh.stop(ctx.currentTime + durationMs / 1000 + 0.05);

  void ctx.resume();

  const started = performance.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleTick = () => {
    if (stopped) return;
    const elapsed = performance.now() - started;
    if (elapsed >= durationMs) return;
    const progress = elapsed / durationMs;
    const vol = 0.07 * (1 - progress * 0.35);
    playTick(ctx, master, vol);
    const interval = 55 + progress * progress * 380;
    timer = setTimeout(scheduleTick, interval);
  };
  scheduleTick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    try {
      whoosh.stop();
    } catch {
      // ignore
    }
    void ctx.close();
  };
}

export function playRouletteWinChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const master = ctx.createGain();
  master.gain.value = 0.2;
  master.connect(ctx.destination);
  const notes = [523, 659, 784];
  const t0 = ctx.currentTime;
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = t0 + i * 0.09;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(0.12, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + 0.4);
  });
  void ctx.resume();
  setTimeout(() => void ctx.close(), 600);
}
