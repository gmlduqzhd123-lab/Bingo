import { load, store } from './storage.js';

const AU_SAVED = load('bq_audio', {});
export const AU = {
  ctx: null,
  sfx: AU_SAVED.sfx !== false,
  bgm: !!AU_SAVED.bgm,
  bgmStyle: AU_SAVED.bgmStyle === 'calm' ? 'calm' : 'upbeat',
  vol: [0.4, 1, 1.7].includes(+AU_SAVED.vol) ? +AU_SAVED.vol : 1,
  timer: null,
  step: 0
};

export function saveAudio() {
  store('bq_audio', { sfx: AU.sfx, bgm: AU.bgm, bgmStyle: AU.bgmStyle, vol: AU.vol });
}

export const volLabel = () => (AU.vol <= 0.5 ? '🔈 작게' : AU.vol <= 1.1 ? '🔉 보통' : '🔊 크게');

export function ac() {
  if (!AU.ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    AU.ctx = new C();
  }
  if (AU.ctx.state === 'suspended') AU.ctx.resume();
  return AU.ctx;
}

function tone(f, d = 0.12, type = 'square', v = 0.05, delay = 0) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const vol = Math.min(0.6, Math.max(0.0002, v * AU.vol));
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + d + 0.03);
}

function noise(d = 0.5, v = 0.25) {
  const c = ac();
  if (!c) return;
  const buf = c.createBuffer(1, c.sampleRate * d, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const g = c.createGain();
  g.gain.value = Math.min(0.6, v * AU.vol);
  s.connect(f).connect(g).connect(c.destination);
  s.start();
}

const n2f = n => 440 * Math.pow(2, (n - 69) / 12);

const SFX = {
  click() { tone(700, 0.05, 'triangle', 0.035); },
  open() { tone(520, 0.08, 'triangle', 0.045); tone(780, 0.1, 'triangle', 0.045, 0.06); },
  correct() { [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.16, 'triangle', 0.065, k * 0.07)); },
  combo() { [587, 740, 880, 1175, 1480].forEach((f, k) => tone(f, 0.14, 'triangle', 0.06, k * 0.055)); },
  hint() { tone(660, 0.08, 'sine', 0.05); tone(990, 0.14, 'sine', 0.05, 0.07); },
  wrong() { tone(220, 0.2, 'sawtooth', 0.045); tone(165, 0.32, 'sawtooth', 0.045, 0.16); },
  flip() { tone(900, 0.05, 'triangle', 0.06); tone(1250, 0.07, 'triangle', 0.05, 0.05); },
  good() { [784, 988, 1175, 1568].forEach((f, k) => tone(f, 0.13, 'triangle', 0.055, k * 0.065)); },
  bad() { [392, 330, 262].forEach((f, k) => tone(f, 0.18, 'triangle', 0.07, k * 0.12)); },
  coin() { tone(988, 0.07, 'triangle', 0.05); tone(1319, 0.2, 'triangle', 0.05, 0.07); },
  grab() { [440, 554, 659, 880].forEach((f, k) => tone(f, 0.11, 'triangle', 0.05, k * 0.05)); },
  steal() { tone(1200, 0.06, 'sawtooth', 0.038); tone(600, 0.16, 'sawtooth', 0.038, 0.06); },
  bomb() { noise(0.6, 0.35); tone(90, 0.4, 'sine', 0.2); },
  shield() { tone(300, 0.12, 'triangle', 0.08); tone(600, 0.28, 'triangle', 0.06, 0.06); },
  bingo() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, k) => tone(f, 0.18, 'triangle', 0.065, k * 0.085)); },
  gold() { [1047, 1319, 1568, 2093].forEach((f, k) => tone(f, 0.11, 'sine', 0.065, k * 0.06)); },
  tick() { tone(1000, 0.03, 'triangle', 0.035); },
  turn() { tone(660, 0.07, 'triangle', 0.05); tone(880, 0.1, 'triangle', 0.05, 0.08); },
  freeze() { [1568, 1319, 1175, 988].forEach((f, k) => tone(f, 0.1, 'sine', 0.06, k * 0.06)); },
  fanfare() { [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, k) => tone(f, 0.22, 'triangle', 0.065, k * 0.12)); }
};

export function sfx(n) {
  if (!AU.sfx) return;
  try { SFX[n] && SFX[n](); } catch {}
}

export function vibrate(pattern = 25) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {}
}

const MEL_UPBEAT = [72, 0, 76, 79, 76, 0, 74, 72, 69, 0, 72, 74, 76, 0, 0, 0, 72, 0, 76, 79, 81, 0, 79, 76, 74, 0, 76, 74, 72, 0, 0, 0];
const BASS_UPBEAT = [48, 45, 41, 43, 48, 45, 43, 43];
const MEL_CALM = [64, 67, 72, 71, 69, 64, 67, 0, 65, 69, 72, 74, 72, 67, 64, 0];
const BASS_CALM = [48, 45, 41, 43];

let bgmPausedByHide = false;

export function bgmStart() {
  if (AU.timer) return;
  ac();
  bgmPausedByHide = false;
  const intervalMs = AU.bgmStyle === 'calm' ? 360 : 210;
  AU.timer = setInterval(() => {
    if (AU.bgmStyle === 'calm') {
      const n = MEL_CALM[AU.step % MEL_CALM.length];
      if (n) tone(n2f(n), 0.34, 'sine', 0.022);
      if (AU.step % 4 === 0) tone(n2f(BASS_CALM[((AU.step / 4) | 0) % BASS_CALM.length]), 0.65, 'sine', 0.032);
    } else {
      const n = MEL_UPBEAT[AU.step % MEL_UPBEAT.length];
      if (n) tone(n2f(n), 0.18, 'square', 0.015);
      if (AU.step % 4 === 0) tone(n2f(BASS_UPBEAT[((AU.step / 4) | 0) % BASS_UPBEAT.length]), 0.4, 'triangle', 0.048);
    }
    AU.step++;
  }, intervalMs);
}

export function bgmStop() {
  clearInterval(AU.timer);
  AU.timer = null;
}

export function setBgmStyle(style) {
  AU.bgmStyle = style === 'calm' ? 'calm' : 'upbeat';
  saveAudio();
  if (AU.bgm) {
    bgmStop();
    bgmStart();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (AU.timer) { bgmStop(); bgmPausedByHide = true; }
  } else if (bgmPausedByHide && AU.bgm) {
    bgmPausedByHide = false;
    bgmStart();
  }
});

export function isTtsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';
}

export function stopSpeak() {
  try {
    if (isTtsSupported()) window.speechSynthesis.cancel();
  } catch {}
}

export function speakText(text, lang = 'ko-KR') {
  if (!isTtsSupported() || !text) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang;
    u.rate = lang.startsWith('en') ? 0.92 : 1.0;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}
