// The seam between UI/engine state and the renderers. The instrument writes plain values through
// sync() (the bridge half of V1 oscillaApp.syncViz); renderers read `state` and the analyser
// buffers this bridge hands out. Label strings and harmonic tables are computed here on state
// change, never per frame. Extracted from V1 `viz` (index.html@a7b7a23, section 7).
//
// Changes against V1 (behaviour-neutral, see status/extract.txt):
//   - pull()/outputSpectrum()/micSpectrum()/refreshLabels() read engine.snapshot() only, never
//     engine internals (inventory K3 / risk 3);
//   - readPalette() reads the V2 tokens --osc-* and warns loudly on a fallback (risk 8);
//   - several p5 hosts may attach (attachP5/detachP5); `p5` stays the most recent one (K8).

import {
  DEFAULT_GAIN, PROVISIONAL_SAMPLE_RATE, SAFE_NYQUIST_FACTOR,
} from '../core/constants.js';
import { isNum, sig } from '../core/math.js';
import { formatFrequency, formatMs, formatPeriod, formatWavelength } from '../core/frequency.js';
import { planFreqAt } from '../audio/patterns.js';
import { additiveHarmonicTable, harmonicTable } from './harmonics.js';
import { playgroundVoiceModel } from '../studio/playground-voice.js';
import { projectSignalPath } from '../studio/signal-path-projection.js';

const defaultEnv = () => (typeof window !== 'undefined' ? window : globalThis);

/**
 * Palette roles -> V2 token and built-in fallback (the dark reference values of tokens.css).
 * V1 read --c-surface/line/fg/muted/accent/accent2/warn/danger; those legacy names are still
 * accepted (second lookup) before the fallback applies.
 */
export const PALETTE_TOKENS = Object.freeze({
  bg: ['--osc-surface-0', '--c-surface', [2, 10, 22]],
  grid: ['--osc-border-strong', '--c-line', [27, 42, 59]],
  fg: ['--osc-text', '--c-fg', [243, 246, 249]],
  muted: ['--osc-text-muted', '--c-muted', [148, 169, 189]],
  accent: ['--osc-blue-trace', '--c-accent', [18, 160, 245]],
  accent2: ['--osc-magenta', '--c-accent2', [240, 74, 196]],
  warn: ['--osc-orange', '--c-warn', [252, 173, 56]],
  danger: ['--osc-red', '--c-danger', [247, 47, 53]],
});

/**
 * Parse a CSS colour value into [r, g, b] (0-255), or null. Accepts #rgb, #rrggbb(aa),
 * rgb()/rgba() with commas or spaces (alpha ignored) and V1's bare "r g b" triplets.
 */
export function parseCssColor(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
    const pair = (i) => parseInt(h.slice(i, i + 2), 16);
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map(pair);
    return null;
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  const body = m ? m[1].split('/')[0] : s;
  const parts = body.split(/[\s,]+/).filter(Boolean).slice(0, 3).map(Number);
  if (parts.length === 3 && parts.every(isNum)) return parts.map((v) => Math.round(v));
  return null;
}

export class VisualizationBridge {
  /**
   * engine: AudioEngine (only snapshot() is used); env: window-like object for
   * getComputedStyle/document, setInterval/clearInterval and requestAnimationFrame.
   */
  constructor({ engine = null, env } = {}) {
    this.engine = engine;
    this._env = env || defaultEnv();
    this._snap = {};
    this._p5s = new Set();
    this._paletteWarning = '';
    // V1: viz fields and state (index.html@a7b7a23)
    Object.assign(this, {
    p5: null,
    sketchState: 'not started',
    fps: 0,
    paletteVersion: 0,
    palette: {},
    envHistory: new Float32Array(240),
    envIndex: 0,
    envLevel: 0,
    hidden: false,
    looping: true,
    redrawQueued: 0,
    labelTimer: 0,
    labelledPlan: undefined,
    // Wave layout the sketch chose for the current canvas size ('side' | 'compact'); set on resize,
    // never per frame. The caption reads it through onWaveLayout (V1 index.html@a7b7a23).
    waveLayout: 'side',
    onWaveLayout: null,
    state: {
      vizMode: 'wave', frequency: 440, waveform: 'sine', gain: DEFAULT_GAIN, rangeMin: 20, rangeMax: 20000,
      nyquist: PROVISIONAL_SAMPLE_RATE / 2, safeMax: (PROVISIONAL_SAMPLE_RATE / 2) * SAFE_NYQUIST_FACTOR,
      provisional: true, spectrumScale: 'log', overlays: { regions: true, notes: false, thirds: false },
      plan: null, playing: false, status: 'READY', a4: 440, source: 'single', reducedMotion: false, mic: false, paused: false,
      dual: { fa: 440, fb: 442, la: 0.8, lb: 0.8, stereo: false, waveA: 'sine', waveB: 'sine' },
      // Engine scalars copied by viz.pull() once per frame without allocating: the sketch reads
      // these and the analyser buffers, never the engine object graph.
      live: {
        hasCtx: false, analyser: false, mic: false, sampleRate: 0, voice: false, plan: null,
        elapsed: 0, inst: NaN, refFreq: 440, timeData: null,
      },
      labels: {
        freq: '440 Hz', period: '2.27 ms', wavelength: '0.78 m', note: 'A4', attack: '10 ms', release: '30 ms', gain: '0.080',
        // readouts that change during playback are refreshed by the 100 ms label timer
        realFreq: '440 Hz', realPeriod: '2.27 ms', realWavelength: '0.78 m', realShort1: '', realShort2: '',
        realCompact: '', realWide1: '', realWide2: '', realWide3: '', requested: '', winMs: '',
        nyquist: '', motionSpan: '', motionA: '', motionB: '', beat: '', legendA: '', legendB: '',
        interNote: '', interNoteNarrow: '',
      },
      // V3.1 (V421): the Playground voice as a StudioModel and its Signal Path projection
      // ({ model, annotations, sources }); pathNodes is that projection's stage list.
      signalPath: null,
      pathNodes: [],
      lab: null,
      harm: { list: [], below: 0, total: 0, shown: 0, capped: false, axisMax: 0, summary: '', summaryShort: '', summaryTiny: '' },
      harmB: { list: [], below: 0, total: 0, shown: 0, capped: false, axisMax: 0, summary: '', summaryShort: '', summaryTiny: '' },
    },
    });
  }

  /** Register a p5 instance (p5-host.js does it in setup); `p5` becomes that instance. */
  attachP5(p) {
    this._p5s.add(p);
    this.p5 = p;
  }

  /** Unregister a p5 instance (host destroyed). */
  detachP5(p) {
    this._p5s.delete(p);
    if (this.p5 === p) this.p5 = [...this._p5s].pop() || null;
  }

  /**
   * Read the palette from the V2 design tokens (CSS custom properties on <html>). A missing or
   * unparseable token falls back to the legacy V1 name, then to the built-in dark reference
   * colour, and console.warn names every token that fell back (risk 8: V1 silently fell back to
   * hard-coded light colours).
   */
  readPalette() {
    const e = this._env;
    let cs = null;
    try {
      cs = e.getComputedStyle && e.document ? e.getComputedStyle(e.document.documentElement) : null;
    } catch (err) { cs = null; }
    const missing = [];
    const palette = {};
    for (const [role, [token, legacy, fallback]] of Object.entries(PALETTE_TOKENS)) {
      const read = (name) => (cs ? parseCssColor(cs.getPropertyValue(name)) : null);
      let rgb = read(token);
      if (!rgb) {
        missing.push(token);
        rgb = read(legacy) || fallback;
      }
      palette[role] = rgb;
    }
    this.palette = palette;
    const warning = missing.join(', ');
    if (warning && warning !== this._paletteWarning) {
      console.warn(`[OSCILLA] visualization palette: CSS token(s) ${warning} missing or `
        + 'unparseable; using fallback colours. Is src/styles/tokens.css loaded on <html>?');
    }
    this._paletteWarning = warning;
    this.paletteVersion++;
    this.requestRedraw();
    return missing;
  }

  /** Per-frame copy of engine scalars into state.live. Allocation-free; called by the sketch. */
  pull() {
    // V1: viz.pull (index.html@a7b7a23), reading engine.snapshot() instead of the engine
    const L = this.state.live;
    const S = this.engine ? this.engine.snapshot(this._snap) : NO_ENGINE;
    L.hasCtx = S.hasCtx;
    L.analyser = !!(S.hasCtx && S.analyser && S.timeData);
    L.mic = S.mic;
    L.sampleRate = S.sampleRate;
    L.voice = S.voice;
    L.plan = L.voice ? S.plan : this.state.plan;
    L.elapsed = L.voice ? Math.max(0, S.time - S.t0) : 0;
    const f = L.voice ? planFreqAt(L.plan, L.elapsed) : null;
    L.inst = f == null ? NaN : f;
    if (L.analyser) S.analyser.getFloatTimeDomainData(S.timeData);
    L.timeData = L.analyser ? S.timeData : null;
  }

  /** Fill and return the preallocated output spectrum buffer (null before audio starts). */
  outputSpectrum() {
    const S = this.engine ? this.engine.snapshot(this._snap) : NO_ENGINE;
    if (!S.analyser || !S.freqData) return null;
    S.analyser.getFloatFrequencyData(S.freqData);
    return S.freqData;
  }

  /** Fill and return the preallocated microphone spectrum buffer (null without a microphone). */
  micSpectrum() {
    const S = this.engine ? this.engine.snapshot(this._snap) : NO_ENGINE;
    if (!S.mic) return null;
    S.micAnalyser.getFloatFrequencyData(S.micFreqData);
    return S.micFreqData;
  }

  // V1: viz: refreshLabels (index.html@a7b7a23)
  /** Recompute the label strings that depend on the playing voice. Runs on state change and
   *  every 100 ms while playing — never per frame. */
  refreshLabels() {
    const s = this.state;
    const L = s.live;
    const lb = s.labels;
    this.pull();
    const plan = L.plan;
    if (plan !== this.labelledPlan) {
      this.labelledPlan = plan;
      lb.motionSpan = plan && plan.kind === 'finite' ? `0 … ${sig(plan.dur, 3)} s` : '';
      lb.motionA = plan && plan.type === 'dual' ? `A ${formatFrequency(plan.a.freq)}` : '';
      lb.motionB = plan && plan.type === 'dual' ? `B ${formatFrequency(plan.b.freq)}` : '';
    }
    // reference frequency when idle: the plan's start (sweeps, patterns) or the source frequency
    let ref = s.source === 'dual' ? s.dual.fa : planFreqAt(plan, 0);
    if (ref == null && plan && plan.freqs && plan.freqs.length) ref = plan.freqs[0];
    if (ref == null) ref = s.frequency;
    L.refFreq = ref;
    const gap = L.voice && !isNum(L.inst);
    const f = L.voice ? L.inst : ref;
    const tag = !L.voice && plan && plan.type !== 'const' && plan.type !== 'am' && plan.type !== 'dual' ? ' (start)' : '';
    lb.realFreq = gap ? '— (silent gap)' : formatFrequency(f);
    lb.realPeriod = gap ? '—' : formatPeriod(f);
    lb.realWavelength = gap ? '—' : formatWavelength(f);
    lb.realShort1 = `${lb.realFreq} · T ${lb.realPeriod}`;
    lb.realShort2 = `λ ≈ ${lb.realWavelength}`;
    lb.realCompact = `${lb.realFreq} · T ${lb.realPeriod} · λ ${lb.realWavelength}`;
    lb.realWide1 = `frequency  ${lb.realFreq}${tag}`;
    lb.realWide2 = `period     ${lb.realPeriod}`;
    lb.realWide3 = `wavelength ${lb.realWavelength}`;
    lb.requested = gap ? '' : `requested ${formatFrequency(f)}${tag}`;
    const sr = L.sampleRate || s.nyquist * 2;
    const win = this._snap.timeData ? Math.min(1024, this._snap.timeData.length >> 1) : 1024;
    lb.winMs = `${sig((win / sr) * 1000, 3)} ms`;
    lb.nyquist = `NYQUIST ${formatFrequency(s.nyquist)}${s.provisional && !L.hasCtx ? ' (provisional)' : ''}`;
  }

  /** Start or stop the 100 ms label refresh that follows a playing voice. */
  setLiveLabels(on) {
    const e = this._env;
    if (on && !this.labelTimer) this.labelTimer = e.setInterval(() => this.refreshLabels(), 100);
    if (!on && this.labelTimer) { e.clearInterval(this.labelTimer); this.labelTimer = 0; }
  }

  /** Loop only while something moves: paused, or idle under prefers-reduced-motion, redraws on
   *  change only. */
  updateLoop() {
    // V1: viz.updateLoop (index.html@a7b7a23), over every attached p5 instance
    const ps = [...this._p5s].filter((p) => p && p.canvas);
    if (!ps.length) return;
    const s = this.state;
    // the visible pause toggle and reduced motion (when idle) both stop the loop; a stopped loop
    // still redraws once per state change and on resize
    const want = !this.hidden && !s.paused && !(s.reducedMotion && !s.playing && !s.mic);
    if (want !== this.looping) {
      this.looping = want;
      for (const p of ps) { if (want) p.loop(); else p.noLoop(); }
    }
    this.sketchState = this.hidden ? 'paused (tab hidden)' : want ? 'running'
      : s.paused ? 'paused (animation toggle: redraw on change)' : 'idle (reduced motion: redraw on change)';
    this.requestRedraw();
  }

  /** The wave view's layout for the current canvas size; notifies onWaveLayout on a change. */
  setWaveLayout(layout) {
    // V1: viz.setWaveLayout (index.html@a7b7a23)
    if (layout === this.waveLayout) return;
    this.waveLayout = layout;
    if (this.onWaveLayout) this.onWaveLayout(layout);
  }

  /** One redraw on the next animation frame while the loop is stopped. */
  requestRedraw() {
    // V1: viz.requestRedraw (index.html@a7b7a23), over every attached p5 instance
    if (!this._p5s.size || this.looping || this.hidden || this.redrawQueued) return;
    const e = this._env;
    const raf = typeof e.requestAnimationFrame === 'function'
      ? (fn) => e.requestAnimationFrame(fn) : (fn) => e.setTimeout(fn, 16);
    this.redrawQueued = raf(() => {
      this.redrawQueued = 0;
      if (this.looping) return;
      for (const p of this._p5s) p.redraw();
    });
  }

  /**
   * The bridge half of V1 oscillaApp.syncViz (index.html@a7b7a23): copy the UI state into
   * `state`, then rebuild path nodes, harmonic tables and labels, and refresh the loop.
   * u = instrument.vizInputs(): { vizMode, frequency, waveform, gain, rangeMin, rangeMax,
   * nyquist, safeMax, provisional, spectrumScale, overlays, a4, source, playing, status, dual,
   * dualFa, dualFb, noteText, attack, release, plan (null when invalid), usesGlobal, micActive,
   * paused }.
   */
  sync(u) {
    const s = this.state;
    s.vizMode = u.vizMode;
    s.frequency = u.frequency;
    s.waveform = u.waveform;
    s.gain = u.gain;
    s.rangeMin = u.rangeMin;
    s.rangeMax = u.rangeMax;
    s.nyquist = u.nyquist;
    s.safeMax = u.safeMax;
    s.provisional = u.provisional;
    s.spectrumScale = u.spectrumScale;
    s.overlays.regions = u.overlays.regions;
    s.overlays.notes = u.overlays.notes;
    s.overlays.thirds = u.overlays.thirds;
    s.a4 = u.a4;
    s.source = u.source;
    s.playing = u.playing;
    s.status = u.status;
    const d = u.dual;
    s.dual.fa = u.dualFa;
    s.dual.fb = u.dualFb;
    s.dual.la = (d.levelA / 100) * (d.a.gain / 100);
    s.dual.lb = (d.levelB / 100) * (d.b.gain / 100);
    s.dual.stereo = d.stereo;
    s.dual.waveA = d.a.wave;
    s.dual.waveB = d.b.wave;
    s.labels.freq = formatFrequency(u.frequency);
    s.labels.period = formatPeriod(u.frequency);
    s.labels.wavelength = formatWavelength(u.frequency);
    s.labels.note = u.noteText;
    s.labels.attack = formatMs(u.attack);
    s.labels.release = formatMs(u.release);
    s.labels.gain = u.gain.toFixed(3);
    s.plan = u.plan;
    // V2: the labs that shape the sounding voice (main.js labVizInputs), read on sync only.
    const lab = typeof this.labInputs === 'function' ? this.labInputs(u.plan) : null;
    s.lab = lab;
    // V3.1 (V421, spec §164): the Signal Path renders from a Studio graph — the Playground voice
    // as a StudioModel, projected — not from a topology of its own.
    const voice = playgroundVoiceModel({ plan: u.plan, waveform: u.waveform,
      frequency: u.frequency, gain: u.gain, attackMs: u.attack, releaseMs: u.release, lab });
    const path = projectSignalPath(voice.model, { annotations: voice.annotations });
    s.signalPath = { model: voice.model, annotations: voice.annotations, sources: path.sources };
    s.pathNodes = path.stages;
    const hf = u.source === 'dual' ? s.dual.fa : u.usesGlobal || !u.plan ? u.frequency : u.plan.freqs[0];
    s.harm = lab && lab.additive && u.source !== 'dual'
      ? additiveHarmonicTable(lab.additive, hf, u.nyquist)
      : harmonicTable(u.source === 'dual' ? d.a.wave : u.waveform, hf, u.nyquist);
    s.harmB = harmonicTable(u.source === 'dual' ? d.b.wave : 'sine', u.source === 'dual' ? s.dual.fb : 0, u.nyquist);
    s.mic = u.micActive;
    s.paused = !!u.paused;
    // interference labels (drawn every frame, built here)
    const delta = Math.abs(s.dual.fa - s.dual.fb);
    s.labels.beat = delta > 0.005
      ? `Δf ${sig(delta, 3)} Hz → beat rate ≈ ${sig(delta, 3)} Hz (period ${formatPeriod(delta)})`
      : 'equal frequencies: no beating';
    s.labels.legendA = `A ${formatFrequency(s.dual.fa)}`;
    s.labels.legendB = `B ${formatFrequency(s.dual.fb)}`;
    let note = 'Carriers slowed for display; the envelope moves at the real beat rate.';
    let noteNarrow = 'Envelope moves at the real beat rate.';
    if (delta > 12) {
      note = 'Beat rate above 12 Hz: animation capped; heard as roughness rather than distinct beats.';
      noteNarrow = 'Beat rate > 12 Hz: animation capped.';
    }
    if (u.source !== 'dual') {
      note = 'Showing DUAL OSC settings — open DUAL OSC to play them.';
      noteNarrow = 'Showing DUAL OSC settings.';
    } else if (s.dual.stereo) {
      note = 'Stereo split: each channel carries one tone. Bottom lane: the mathematical sum A+B (mono mix).';
      noteNarrow = 'Stereo: one tone per channel; A+B = mono sum.';
    }
    s.labels.interNote = note;
    s.labels.interNoteNarrow = noteNarrow;
    this.refreshLabels();
    this.setLiveLabels(u.playing);
    this.updateLoop();
  }
}

/** snapshot() stand-in when no engine is attached. */
const NO_ENGINE = Object.freeze({
  hasCtx: false, state: 'not started', time: 0, sampleRate: 0, voice: false, voiceId: 0, t0: 0,
  plan: null, kind: null, playing: false, releasing: false, endTime: Infinity, limited: false,
  analyser: null, timeData: null, freqData: null, mic: false, micAnalyser: null,
  micFreqData: null, activeNodes: 0, activeSources: 0, voices: 0,
});

/** Factory form of `new VisualizationBridge(opts)`. */
export function createVisualizationBridge(opts = {}) {
  return new VisualizationBridge(opts);
}
