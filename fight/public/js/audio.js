// All sound is synthesized live, so there are no audio files to ship.
let ctx = null, master = null, noiseBuf = null, wakeUntil = 0;

function setup() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

// Browsers only let a page make sound after a click or key press on that page.
// Phone input arrives over the socket and does not count, so this has to hang
// off real events on the laptop.
function wake() {
  setup();
  if (!ctx || ctx.state === 'running') return;
  wakeUntil = performance.now() + 400; // the sound this same press triggers still plays
  ctx.resume().catch(() => {});
}

// Sounds made while blocked are dropped: the clock is frozen, so they would
// otherwise all fire together on the first click.
const live = () => ctx && (ctx.state === 'running' || performance.now() < wakeUntil);

// `onBlocked(true)` means sound is being held back until someone touches the laptop.
export function init(onBlocked) {
  setup();
  if (!ctx) return;
  const report = () => onBlocked(ctx.state !== 'running');
  ctx.onstatechange = report;
  setTimeout(report, 600); // a context that is allowed to run takes a moment to say so
  for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, wake, true);
  // Safari interrupts audio when the tab loses focus, and it can resume without a press
  const retry = () => { if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {}); };
  document.addEventListener('visibilitychange', retry);
  window.addEventListener('focus', retry);
}

function noise(dur, type, f0, f1, vol, q = 1) {
  if (!live()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f0, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt); flt.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function tone(type, f0, f1, dur, vol) {
  if (!live()) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const hit = (power = 0.5) => {
  noise(0.16, 'lowpass', 2600, 260, 0.55 + power * 0.4);
  tone('sine', 170 + power * 30, 45, 0.2, 0.7 + power * 0.3);
};
export const block = () => { noise(0.08, 'bandpass', 3000, 1500, 0.35, 3); tone('square', 320, 180, 0.07, 0.12); };
export const whoosh = (heavy = 0.5) => noise(0.16 + heavy * 0.08, 'bandpass', 500, 2200, 0.16 + heavy * 0.12, 1.2);
export const special = () => { tone('sawtooth', 180, 900, 0.45, 0.16); noise(0.4, 'bandpass', 600, 3000, 0.2, 2); };
export const boom = () => { noise(0.35, 'lowpass', 1800, 120, 0.6); tone('sine', 120, 35, 0.4, 0.7); };
export const land = (strong = false) => { noise(0.12, 'lowpass', 700, 150, strong ? 0.6 : 0.25); if (strong) tone('sine', 90, 35, 0.2, 0.5); };
export const ko = () => { tone('sine', 90, 28, 1.1, 0.9); noise(0.8, 'lowpass', 900, 80, 0.5); };
export const gong = () => { tone('sine', 196, 190, 1.6, 0.35); tone('sine', 392, 388, 1.2, 0.18); tone('triangle', 590, 585, 0.9, 0.08); };
export const tick = () => tone('square', 880, 880, 0.05, 0.06);
