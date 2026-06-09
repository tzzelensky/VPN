/** Тихий 8-битный «пад» + лёгкая арпеджио, Web Audio API. */

export function startDropperAmbient(): () => void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return () => {};

    const actx = new AC();
    const master = actx.createGain();
    master.gain.value = 0.045;
    master.connect(actx.destination);

    const pad = actx.createOscillator();
    pad.type = "triangle";
    pad.frequency.value = 98;
    const padG = actx.createGain();
    padG.gain.value = 0.55;
    pad.connect(padG);
    padG.connect(master);

    const pad2 = actx.createOscillator();
    pad2.type = "sine";
    pad2.frequency.value = 147;
    const pad2G = actx.createGain();
    pad2G.gain.value = 0.25;
    pad2.connect(pad2G);
    pad2G.connect(master);

    pad.start();
    pad2.start();

    const arpGain = actx.createGain();
    arpGain.gain.value = 0.12;
    arpGain.connect(master);

    const notes = [196, 247, 294, 330, 392, 330, 294, 247];
    let step = 0;
    let nextAt = actx.currentTime;

    const arpOsc = actx.createOscillator();
    arpOsc.type = "square";
    const arpFilter = actx.createBiquadFilter();
    arpFilter.type = "lowpass";
    arpFilter.frequency.value = 2200;
    arpOsc.connect(arpFilter);
    arpFilter.connect(arpGain);
    arpOsc.start();

    let arpTimer: number | undefined;
    const tick = () => {
      const t = actx.currentTime;
      if (t < nextAt - 0.02) return;
      arpOsc.frequency.setValueAtTime(notes[step % notes.length]!, t);
      step += 1;
      nextAt = t + 0.14;
    };
    arpTimer = window.setInterval(tick, 60);
    tick();

    void actx.resume();

    return () => {
      if (arpTimer) window.clearInterval(arpTimer);
      try {
        pad.stop();
        pad2.stop();
        arpOsc.stop();
      } catch {
        // ignore
      }
      void actx.close();
    };
  } catch {
    return () => {};
  }
}
