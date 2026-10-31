// Synthesized sound effects (Web Audio) — no audio files.
export class Sfx {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  /** Must be called from a user gesture at least once (iOS unlock). */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp).connect(ctx.destination);
      // small room reverb from a generated impulse
      this.verb = ctx.createConvolver();
      this.verb.buffer = this.impulse(1.4, 3.2);
      this.verbGain = ctx.createGain();
      this.verbGain.gain.value = 0.22;
      this.verb.connect(this.verbGain).connect(this.master);
      this.noiseBuf = this.makeNoise(0.5);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  makeNoise(sec) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  ready() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  out(wet = 0.3) {
    const g = this.ctx.createGain();
    g.connect(this.master);
    if (wet > 0) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      g.connect(s).connect(this.verb);
    }
    return g;
  }

  tone(freq, { t = 0, dur = 0.3, gain = 0.2, type = 'sine', attack = 0.002, dest }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise({ t = 0, dur = 0.06, gain = 0.3, freq = 2000, q = 1, type = 'bandpass', dest }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
  }

  // ------------------------------------------------------------ cues
  tick() {
    if (!this.ready()) return;
    const d = this.out(0.05);
    this.tone(2400, { dur: 0.035, gain: 0.05, type: 'triangle', dest: d });
    this.noise({ dur: 0.012, gain: 0.05, freq: 5000, q: 2, dest: d });
  }

  /** Glassy chime pitched per color. */
  gem(color) {
    if (!this.ready()) return;
    const base = [784, 988, 1175][color] || 880;
    const d = this.out(0.35);
    this.tone(base, { dur: 0.35, gain: 0.07, dest: d });
    this.tone(base * 2.01, { dur: 0.22, gain: 0.03, dest: d });
    this.tone(base * 3.98, { dur: 0.12, gain: 0.012, dest: d });
  }

  /** Metal token landing on lacquered wood or on another token. */
  impact({ onBoard, strength = 1, z = 0 }) {
    if (!this.ready()) return;
    const s = 0.35 + strength * 0.65;
    const d = this.out(0.18);
    if (onBoard) {
      this.tone(150 + Math.random() * 20, { dur: 0.09, gain: 0.45 * s, dest: d });
      this.noise({ dur: 0.05, gain: 0.5 * s, freq: 1400, q: 0.9, dest: d });
      this.noise({ dur: 0.02, gain: 0.25 * s, freq: 4200, q: 1.5, dest: d });
      const f0 = 620 + Math.random() * 60;
      [1, 2.76, 5.4].forEach((m, i) => this.tone(f0 * m, { dur: 0.08 / (i + 1), gain: (0.08 / (i + 1)) * s, dest: d }));
    } else {
      const f0 = 1500 + z * 70 + Math.random() * 90;
      this.noise({ dur: 0.03, gain: 0.35 * s, freq: 3200, q: 1.2, dest: d });
      [1, 2.76, 5.40, 8.93].forEach((m, i) => {
        this.tone(f0 * m, { dur: 0.22 / (1 + i * 0.6), gain: (0.13 / (1 + i)) * s, dest: d });
      });
      this.tone(210, { dur: 0.05, gain: 0.18 * s, dest: d });
    }
  }

  error() {
    if (!this.ready()) return;
    const d = this.out(0.05);
    this.tone(180, { dur: 0.09, gain: 0.16, type: 'square', dest: d });
    this.tone(150, { t: 0.11, dur: 0.12, gain: 0.14, type: 'square', dest: d });
  }

  undo() {
    if (!this.ready()) return;
    const ctx = this.ctx;
    const d = this.out(0.2);
    const o = ctx.createOscillator(), g = ctx.createGain();
    const t0 = ctx.currentTime;
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t0);
    o.frequency.exponentialRampToValueAtTime(380, t0 + 0.18);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o.connect(g).connect(d); o.start(t0); o.stop(t0 + 0.25);
  }

  win() {
    if (!this.ready()) return;
    const d = this.out(0.55);
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone(f, { t: i * 0.09, dur: 1.2, gain: 0.09, dest: d });
      this.tone(f * 2.0, { t: i * 0.09, dur: 0.6, gain: 0.025, dest: d });
    });
    this.tone(261.6, { t: 0.0, dur: 1.6, gain: 0.08, type: 'triangle', dest: d });
  }

  draw() {
    if (!this.ready()) return;
    const d = this.out(0.5);
    [392, 494, 587].forEach((f, i) => this.tone(f, { t: i * 0.12, dur: 0.9, gain: 0.07, dest: d }));
  }

  whoosh() {
    if (!this.ready()) return;
    const d = this.out(0.3);
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(400, t0);
    f.frequency.exponentialRampToValueAtTime(3000, t0 + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    src.connect(f).connect(g).connect(d);
    src.start(t0); src.stop(t0 + 0.55);
  }
}

// ---------------------------------------------------------------- haptics
const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
let iosSwitch = null;
function iosTap() {
  // iOS 18+ Safari plays a system haptic when a <input switch> is toggled.
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export const haptics = {
  enabled: true,
  canVibrate,
  /** kind: 'select' | 'place' | 'error' | 'win' | 'light' */
  fire(kind) {
    if (!this.enabled) return;
    try {
      if (canVibrate) {
        const p = { light: 6, select: 10, place: [14], error: [12, 50, 12], win: [20, 60, 30, 60, 60], undo: 8 }[kind] || 10;
        navigator.vibrate(p);
      } else if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) {
        iosTap();
        if (kind === 'error' || kind === 'win') setTimeout(iosTap, 90);
      }
    } catch { /* ignore */ }
  },
};
