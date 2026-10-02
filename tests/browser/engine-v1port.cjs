#!/usr/bin/env node
// OSCILLA V2 engine test: the V1 audio-engine suite (index.html@a7b7a23, tests/engine.cjs, 77
// checks) run against the V2 modules. The fixture page bundles src/js/audio/audio-engine.js and
// src/js/core/instrument.js with esbuild and mounts the instrument as an Alpine component on
// <body>, with the V1 glue the checks rely on (first-gesture ensureAudio, window keydown/keyup/
// blur, visibilitychange, the syncViz effect, the gainLevel watcher, a .hold-btn with V1's
// pointer handlers) and window.OSCILLA = { engine, buildPlan, planFreqAt, PATTERNS,
// BUILTIN_PRESETS }. Everything below the fixture is V1's test text: the in-page
// instrumentation (oscillator accounting, AudioParam log, frame-indexed AudioWorklet output tap)
// and the same assertions.
//
//   node tests/browser/engine-v1port.cjs                       # chromium and firefox
//   node tests/browser/engine-v1port.cjs --browser firefox     # one browser (or webkit)
//   OSC_BROWSERS=firefox node tests/browser/engine-v1port.cjs  # the same, from the environment (CI)
//
// Resolves esbuild, alpinejs and playwright from app/node_modules, or from NODE_PATH. The
// fixture is written to a temporary directory and opened from file:// like V1's index.html
// (a secure context, so the microphone checks run). Exit code 0 only when every check passes.
'use strict';

const path = require('path');

const fs = require('fs');
const os = require('os');

const args = process.argv.slice(2);
const BROWSERS = args.includes('--browser') ? [args[args.indexOf('--browser') + 1]]
  : (process.env.OSC_BROWSERS || 'chromium,firefox').split(',');
const APP_JS = path.resolve(__dirname, '..', '..', 'src', 'js');
let ENGINE = BROWSERS[0];
let BASE = null; // file:// URL of the built fixture (buildFixture)

// ------------------------------------------------------------------ V2 fixture
const ENTRY = `
import Alpine from 'alpinejs';
import { AudioEngine } from './audio/audio-engine.js';
import { createInstrument } from './core/instrument.js';
import { buildPlan, planFreqAt, PATTERNS } from './audio/patterns.js';
import { BUILTIN_PRESETS } from './data/presets.js';
import { makeAdsrEnvelope } from './audio/voice.js';
import { applyAdsr, releaseAt } from './audio/envelope.js';
import { createFilterStage } from './audio/filters.js';
import { buildPeriodicWave } from './audio/additive.js';

const engine = new AudioEngine();
window.OSCILLA = { engine, buildPlan, planFreqAt, PATTERNS, BUILTIN_PRESETS };
window.Alpine = Alpine;
// V2 extension points, for the section after the V1 checks
window.OSCILLA_V2 = { adsrEnvelope: makeAdsrEnvelope({ applyAdsr, releaseAt }), createFilterStage, buildPeriodicWave };

// V1 isTypingTarget and the modal check, as the UI layer passes them (deps.keyGuard).
function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(el.tagName)) return true;
  const role = el.getAttribute && el.getAttribute('role');
  return ['slider', 'tab', 'radio', 'button', 'switch', 'checkbox', 'menuitem'].includes(role);
}
const keyGuard = (e) => isTypingTarget(e.target instanceof Element ? e.target : document.activeElement)
  || isTypingTarget(document.activeElement)
  || !!document.querySelector('[data-oscilla-modal][aria-modal="true"]');
const compose = (target, src) => Object.defineProperties(target, Object.getOwnPropertyDescriptors(src));

Alpine.data('oscillaApp', () => compose(createInstrument({ engine, keyGuard, env: window }), {
  // The parts of V1 oscillaApp.init the engine checks depend on.
  init() {
    engine.on((type, detail) => this.onEngine(type, detail));
    const firstGesture = () => {
      document.removeEventListener('pointerdown', firstGesture, true);
      document.removeEventListener('keydown', firstGesture, true);
      this.ensureAudio();
    };
    document.addEventListener('pointerdown', firstGesture, { capture: true, passive: true });
    document.addEventListener('keydown', firstGesture, true);
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.releaseHold());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseHold(); });
    Alpine.effect(() => this.syncViz());
    this.$watch('gainLevel', (g) => engine.setMasterGain(g));
    this.initialized = true;
    window.__OSCILLA_READY = true;
  },
}));
Alpine.start();
`;

const HTML = (js) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OSCILLA engine-v1port fixture</title></head>
<body x-data="oscillaApp">
<button type="button" class="hold-btn" style="width:240px;height:84px"
  @pointerdown="holdStart($event)" @pointerup="holdEnd()" @pointercancel="holdEnd()" @lostpointercapture="holdEnd()" @pointerleave="holdLeave($event)"
  @keydown.space.prevent="holdKey($event)" @keyup.space.prevent="holdEnd()" @blur="holdEnd()"
  @keydown.enter.prevent="triggerKey($event)" @contextmenu.prevent>HOLD TO PLAY</button>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>
`;

async function buildFixture() {
  const esbuild = require('esbuild');
  const r = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: APP_JS, sourcefile: 'engine-v1port-entry.js' },
    bundle: true, format: 'iife', write: false, target: 'es2020', logLevel: 'silent',
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-engine-v1port-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, HTML(r.outputFiles[0].text));
  return { url: `file://${file}`, dir, bytes: r.outputFiles[0].text.length };
}
const IGNORED_CONSOLE = [
  /cdn\.tailwindcss\.com should not be used in production/,
  /Use of the (orientation|motion) sensor is deprecated/,
];
const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false, 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } },
  webkit: {},
};
const CAP = 0.25; // MAX_OUTPUT_GAIN

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}${process.env.OSC_VERBOSE && detail ? ` ${detail}` : ''}`); }
  else { failed++; failures.push(`${name} ${detail}`); console.log(`  FAIL ${name} ${detail}`); }
}

// ------------------------------------------------------------------ in-page instrumentation
// Runs before the application (context.addInitScript). Everything it creates is marked
// internal so it never counts as an application node. Exposed as window.__T.
function instrument(opts) {
  opts = opts || {};
  const T = (window.__T = {
    oscs: [], params: [], logParams: false, rec: null, errors: [], streams: [], internal: false,
  });
  if (opts.sr) {
    // Force the context's sample rate (tests Nyquist handling at 22.05 / 32 kHz).
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      const Orig = window[name];
      if (!Orig) continue;
      window[name] = class extends Orig {
        constructor(o) { super(Object.assign({}, o || {}, { sampleRate: opts.sr })); }
      };
    }
  }
  const BAC = window.BaseAudioContext || window.AudioContext;
  const paramInfo = new WeakMap();
  const oscRec = new WeakMap();
  const wrap = (fn, type) => {
    const orig = BAC.prototype[fn];
    if (!orig) return;
    BAC.prototype[fn] = function (...a) {
      const n = orig.apply(this, a);
      if (T.internal) return n;
      for (const k of ['frequency', 'detune', 'gain', 'pan']) {
        if (n[k] instanceof AudioParam) paramInfo.set(n[k], { type, name: k });
      }
      if (type === 'Oscillator') {
        const ctx = this;
        const rec = { started: false, ended: false, startAt: null, stopAt: null, endedAt: null };
        T.oscs.push(rec);
        oscRec.set(n, rec);
        n.addEventListener('ended', () => { rec.ended = true; rec.endedAt = ctx.currentTime; });
      }
      return n;
    };
  };
  wrap('createOscillator', 'Oscillator');
  wrap('createGain', 'Gain');
  wrap('createStereoPanner', 'Panner');
  const SSN = window.AudioScheduledSourceNode;
  const oStart = SSN.prototype.start;
  const oStop = SSN.prototype.stop;
  SSN.prototype.start = function (when = 0, ...r) {
    const rec = oscRec.get(this);
    if (rec) { rec.started = true; rec.startAt = when; }
    return oStart.call(this, when, ...r);
  };
  SSN.prototype.stop = function (when = 0) {
    const rec = oscRec.get(this);
    // stopEff: when the stop takes effect on the audio clock (stop(0) or a past time = now).
    // A later stop() replaces an earlier one only while the node has not stopped yet (Web Audio:
    // the last call wins); a redundant stop() on a stopped node (cleanup) changes nothing.
    if (rec) {
      const now = this.context.currentTime;
      rec.stopAt = when;
      if (rec.stopEff == null || now < rec.stopEff) rec.stopEff = Math.max(when, now);
    }
    return oStop.call(this, when);
  };
  T.liveOscs = () => T.oscs.filter((r) => r.started && !r.ended).length;
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
    const orig = AudioParam.prototype[m];
    AudioParam.prototype[m] = function (...a) {
      const info = paramInfo.get(this);
      if (info && T.logParams) T.params.push({ m, type: info.type, name: info.name, v: a[0], t: a[1] });
      return orig.apply(this, a);
    };
  }
  const vd = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  if (vd && vd.set) {
    Object.defineProperty(AudioParam.prototype, 'value', {
      configurable: true,
      get: vd.get,
      set(v) {
        const info = paramInfo.get(this);
        if (info && T.logParams) T.params.push({ m: 'value', type: info.type, name: info.name, v });
        return vd.set.call(this, v);
      },
    });
  }
  // Keep every microphone stream so the test can check its tracks.
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); T.streams.push(s); return s; };
  }

  // Output tap: the node the application connects to the destination also feeds a recorder.
  const WORKLET = `class Tap extends AudioWorkletProcessor {
    // frame counts quanta independently: under load Chromium can repeat a stale currentFrame.
    constructor() { super(); this.N = 4096; this.L = new Float32Array(this.N); this.R = new Float32Array(this.N); this.n = 0; this.f0 = 0; this.next = -1; }
    flush() { if (this.n) this.port.postMessage({ f: this.f0, L: this.L.slice(0, this.n), R: this.R.slice(0, this.n) }); this.n = 0; }
    process(inputs) {
      const i = inputs[0];
      const frame = this.next < 0 ? currentFrame : Math.max(currentFrame, this.next);
      if (this.n && frame !== this.f0 + this.n) this.flush();
      if (!this.n) this.f0 = frame;
      const L = i && i.length ? i[0] : null;
      const R = i && i.length > 1 ? i[1] : L;
      const len = L ? L.length : 128;
      if (L) { this.L.set(L, this.n); this.R.set(R, this.n); } else { this.L.fill(0, this.n, this.n + len); this.R.fill(0, this.n, this.n + len); }
      this.n += len;
      this.next = frame + len;
      if (this.n + 128 > this.N) this.flush();
      return true;
    }
  }
  registerProcessor('oscilla-tap', Tap);`;
  const oConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = oConnect.call(this, dest, ...rest);
    if (!T.internal && window.AudioDestinationNode && dest instanceof AudioDestinationNode) T.tap(this, this.context);
    return r;
  };
  T.tap = async (src, ctx) => {
    const rec = { ctx, sr: ctx.sampleRate, chunks: [], ready: false, kind: null };
    T.rec = rec;
    const push = (f, L, R) => {
      rec.chunks.push({ f, L, R });
      let total = 0;
      for (let k = rec.chunks.length - 1; k >= 0; k--) {
        total += rec.chunks[k].L.length;
        if (total > rec.sr * 40) { rec.chunks.splice(0, k); break; }
      }
    };
    try {
      if (!ctx.audioWorklet) throw new Error('no AudioWorklet');
      // blob: first; from file:// (opaque origin) some engines only accept a data: URL
      try {
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
      } catch (e) {
        await ctx.audioWorklet.addModule(`data:application/javascript;charset=utf-8,${encodeURIComponent(WORKLET)}`);
      }
      T.internal = true;
      const node = new AudioWorkletNode(ctx, 'oscilla-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      const sink = ctx.createGain();
      T.internal = false;
      sink.gain.value = 0;
      oConnect.call(src, node);
      oConnect.call(node, sink);
      oConnect.call(sink, ctx.destination);
      node.port.onmessage = (e) => push(e.data.f, e.data.L, e.data.R);
      rec.kind = 'worklet';
    } catch (err) {
      // Fallback: ScriptProcessor, placed on the timeline by playbackTime.
      T.internal = true;
      const sp = ctx.createScriptProcessor(1024, 2, 2);
      const sink = ctx.createGain();
      T.internal = false;
      sink.gain.value = 0;
      oConnect.call(src, sp);
      oConnect.call(sp, sink);
      oConnect.call(sink, ctx.destination);
      sp.onaudioprocess = (e) => {
        const b = e.inputBuffer;
        const f = Math.round((e.playbackTime - b.duration) * rec.sr);
        push(f, b.getChannelData(0).slice(), (b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).slice());
      };
      rec.kind = `scriptprocessor (${err.message})`;
    }
    rec.ready = true;
  };
  T.recEnd = () => {
    const r = T.rec;
    if (!r || !r.chunks.length) return 0;
    const c = r.chunks[r.chunks.length - 1];
    return (c.f + c.L.length) / r.sr;
  };
  T.waitRec = (t, maxMs = 3000) => new Promise((res) => {
    const start = Date.now();
    const f = () => (T.recEnd() >= t ? res(true) : Date.now() - start > maxMs ? res(false) : setTimeout(f, 10));
    f();
  });
  /** Contiguous runs of samples within [t0, t1) (context seconds). */
  T.runs = (t0, t1, ch = 'L') => {
    const r = T.rec;
    const out = [];
    if (!r) return out;
    const f0 = Math.round(t0 * r.sr);
    const f1 = Math.round(t1 * r.sr);
    let cur = null;
    for (const c of r.chunks) {
      const a = Math.max(f0, c.f);
      const b = Math.min(f1, c.f + c.L.length);
      if (b <= a) continue;
      const part = c[ch].subarray(a - c.f, b - c.f);
      if (cur && cur.f + cur.parts.reduce((s, p) => s + p.length, 0) === a) cur.parts.push(part);
      else { cur = { f: a, parts: [part] }; out.push(cur); }
    }
    return out.map((x) => {
      const n = x.parts.reduce((s, p) => s + p.length, 0);
      const data = new Float32Array(n);
      let o = 0;
      for (const p of x.parts) { data.set(p, o); o += p.length; }
      return { t: x.f / r.sr, data };
    });
  };
  T.samples = (t0, t1, ch = 'L') => {
    const runs = T.runs(t0, t1, ch);
    return runs.length ? runs.reduce((a, b) => (b.data.length > a.data.length ? b : a)) : { t: t0, data: new Float32Array(0) };
  };
  T.stats = (t0, t1, ch = 'L') => {
    const runs = T.runs(t0, t1, ch);
    let n = 0; let peak = 0; let ss = 0; let maxStep = 0; let stepAt = null;
    for (const run of runs) {
      const x = run.data;
      for (let i = 0; i < x.length; i++) {
        const v = x[i];
        n++;
        if (Math.abs(v) > peak) peak = Math.abs(v);
        ss += v * v;
        if (i) { const d = Math.abs(v - x[i - 1]); if (d > maxStep) { maxStep = d; stepAt = run.t + i / T.rec.sr; } }
      }
    }
    return { n, runs: runs.length, peak, rms: Math.sqrt(ss / Math.max(1, n)), maxStep, stepAt };
  };
  /** Magnitude of frequency f in [t0, t1) (Blackman-Harris window), relative to full scale. */
  T.tone = (t0, t1, f, ch = 'L') => {
    const { data: x } = T.samples(t0, t1, ch);
    const N = x.length;
    const sr = T.rec.sr;
    let re = 0; let im = 0; let wsum = 0;
    for (let i = 0; i < N; i++) {
      const p = (2 * Math.PI * i) / (N - 1);
      const w = 0.35875 - 0.48829 * Math.cos(p) + 0.14128 * Math.cos(2 * p) - 0.01168 * Math.cos(3 * p);
      const ph = (2 * Math.PI * f * i) / sr;
      re += x[i] * w * Math.cos(ph);
      im -= x[i] * w * Math.sin(ph);
      wsum += w;
    }
    return (2 * Math.hypot(re, im)) / Math.max(1e-12, wsum);
  };
}

async function openPage(browser, { hash = '', query = '', instrumentOpts = {}, init = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(instrument, instrumentOpts);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    if (IGNORED_CONSOLE.some((re) => re.test(m.text()))) return;
    problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await page.goto(`${BASE}${query}${hash}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Alpine && window.OSCILLA && window.__OSCILLA_READY, null, { timeout: 20000 });
  await page.waitForTimeout(200);
  return { context, page, problems };
}

// Run fn(app, engine, O, T, arg) in the page; helpers sleep / untilAudio are in scope.
const app = (page, fn, arg) => page.evaluate(([src, a]) => {
  const data = window.Alpine.$data(document.body);
  const prelude = `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const untilAudio = async (t) => { const c = window.OSCILLA.engine.ctx; while (c.currentTime < t) await sleep(3); };
    // Deadline-based teardown probe. Polls until the audio graph is empty or maxS of audio time
    // passed, and reports: after (audio time when the poll SAW it empty), stopAt (the latest
    // time a stop() takes effect on the audio clock for the oscillators live at t0 or started
    // since, relative to t0: the precise teardown time), tick (the largest currentTime step seen: the clock is only
    // observable in steps of one audio callback, 2.9 ms locally, 11.6 ms on the CI runner).
    const gone = async (t0, maxS) => {
      const c = window.OSCILLA.engine.ctx;
      const first = window.__T.oscs.length;
      const liveAtT0 = window.__T.oscs.filter((r) => r.started && !r.ended);
      let tick = 0;
      let last = c.currentTime;
      while (c.currentTime - t0 < maxS && (window.__T.liveOscs() || window.OSCILLA.engine.voices.size)) {
        await sleep(2);
        tick = Math.max(tick, c.currentTime - last);
        last = c.currentTime;
      }
      // the oscillators live at t0 plus any started since (a voice may start asynchronously)
      const live = [...liveAtT0, ...window.__T.oscs.slice(first).filter((r) => r.started)];
      const stops = live.map((r) => (r.stopEff == null ? Infinity : Math.max(r.stopEff, t0) - t0));
      return { after: c.currentTime - t0, stopAt: stops.length ? Math.max(...stops) : 0, tick,
        oscs: window.__T.liveOscs(), voices: window.OSCILLA.engine.voices.size, nodes: window.OSCILLA.engine.activeNodeCount };
    };`;
  return new Function('app', 'engine', 'O', 'T', 'arg', `${prelude} return (${src})(app, engine, O, T, arg);`)(data, window.OSCILLA.engine, window.OSCILLA, window.__T, a);
}, [fn.toString(), arg]);

// Observation margin for teardown checks: the poll in gone() can only see the empty graph at
// the first poll after the audio thread has rendered past the stop, so the observed time lags
// the scheduled one by at most one audio-clock step (one callback: 128 frames locally, 512 at
// 48 kHz on the CI runner; measured per probe as `tick`, capped at 25 ms so a stalled clock
// cannot excuse a late teardown) plus one poll interval (2 ms timer, clamped to ~5 ms).
const POLL_S = 0.005;
const MAX_TICK_S = 0.025;
const observeMargin = (g) => Math.min(g.tick, MAX_TICK_S) + POLL_S;
/**
 * The audio graph torn down within `bound` seconds of audio time: nothing left (oscillators,
 * voices, nodes), every oscillator's stop() taking effect at or before the bound on the audio
 * clock (exact), and the empty graph observed no later than the bound plus the margin above.
 */
const tornDown = (g, bound) => g.oscs === 0 && g.voices === 0 && g.nodes === 0
  && g.stopAt <= bound + 1e-6 && g.after <= bound + observeMargin(g);
/** Ended at `at` +- tol seconds of audio time: scheduled there, and observed no later. */
const endsAt = (g, at, tol) => g.oscs === 0 && Math.abs(g.stopAt - at) < tol
  && g.after <= at + tol + observeMargin(g);

/** Create the context and wait until the tap is recording. */
async function startAudio(page) {
  const ok = await app(page, async (a, e, O, T) => {
    a.ensureAudio();
    const start = Date.now();
    while (!(T.rec && T.rec.ready && T.rec.chunks.length > 2 && e.state === 'running') && Date.now() - start < 6000) await sleep(20);
    return { ready: !!(T.rec && T.rec.ready), chunks: T.rec ? T.rec.chunks.length : 0, kind: T.rec && T.rec.kind, state: e.state };
  });
  if (!(ok.ready && ok.chunks > 2)) throw new Error(`output tap captured no samples: ${JSON.stringify(ok)}`);
  return ok;
}

async function runBrowser() {
  const playwright = require('playwright');
  console.log(`OSCILLA engine test (V2 modules) → ${BASE} (${ENGINE})`);
  const start = { passed, failed };
  const browser = await playwright[ENGINE].launch(LAUNCH[ENGINE]);
  const t0 = Date.now();

  // ------------------------------------------------------------------ accounting, silence, gain cap
  console.log('oscillator accounting and silence');
  {
    const { page, problems, context } = await openPage(browser);
    const tap = await startAudio(page);
    console.log(`  (tap: ${tap.kind}, ${await app(page, (a, e) => e.sampleRate)} Hz)`);
    const r = await app(page, async (a, e, O, T) => {
      const out = {};
      a.setFrequency(440);
      // stop (graceful), with silence after the release
      a.release = 30;
      a.play('hold');
      await sleep(250);
      let tS = e.ctx.currentTime;
      a.stop();
      out.stop = await gone(tS, 0.5);
      await T.waitRec(tS + 0.2);
      out.stopTail = T.stats(tS + 0.02 + 0.03 + 0.03, tS + 0.2).peak;
      // stopNow
      a.play('hold');
      await sleep(200);
      tS = e.ctx.currentTime;
      a.stopNow();
      out.stopNow = await gone(tS, 0.5);
      await T.waitRec(tS + 0.15);
      out.stopNowTail = T.stats(tS + 0.02 + 0.008 + 0.03, tS + 0.15).peak;
      // safety limit (0.5 s) on the audio clock
      a.safetyLimit = 0.5;
      a.play('hold');
      const tL = e.voice.t0;
      out.limit = await gone(tL, 1.5);
      a.holding = false;
      a.safetyLimit = 2;
      // natural end of a programmed pattern
      a.setPattern('pulse');
      a.trigger();
      const tN = e.voice.t0;
      out.natural = await gone(tN, 3);
      out.naturalLen = out.natural.after;
      // mode switch while latched: tone → dual replaces the voice (1 → 2 oscillators)
      a.setPattern('tone');
      a.setContinuous(true);
      a.toggleLatch();
      await sleep(200);
      out.beforeSwitch = T.liveOscs();
      a.setMode('dual');
      await sleep(300);
      out.afterSwitch = { oscs: T.liveOscs(), type: e.voice && e.voice.plan.type, voices: e.voices.size };
      tS = e.ctx.currentTime;
      a.stop();
      out.switchStop = await gone(tS, 0.5);
      a.setContinuous(false);
      a.setMode('playground');
      return out;
    });
    const tail = tornDown;
    check('stop: 0 live oscillators within release + 50 ms', tail(r.stop, 0.03 + 0.05), JSON.stringify(r.stop));
    check('stop: output silent (< 1e-4) 30 ms after the release', r.stopTail < 1e-4, String(r.stopTail));
    check('stopNow: 0 live oscillators within 60 ms', tail(r.stopNow, 0.06), JSON.stringify(r.stopNow));
    check('stopNow: output silent (< 1e-4) 30 ms after the fade', r.stopNowTail < 1e-4, String(r.stopNowTail));
    check('safety limit 0.5 s: 0 oscillators at ≈ 0.5 s (audio clock)', tail(r.limit, 0.56) && r.limit.stopAt > 0.49, JSON.stringify(r.limit));
    check('programmed pattern ends by itself with 0 oscillators', tail(r.natural, 3), JSON.stringify(r.natural));
    check('mode switch while latched replaces the voice (no leftover oscillator)', r.beforeSwitch === 1 && r.afterSwitch.oscs === 2 && r.afterSwitch.type === 'dual', JSON.stringify(r));
    check('mode switch: 0 oscillators after stop', tail(r.switchStop, 0.2), JSON.stringify(r.switchStop));
    check('no console problems (accounting)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  console.log('gain cap');
  {
    const { page, problems, context } = await openPage(browser);
    await startAudio(page);
    const r = await app(page, async (a, e, O, T) => {
      const out = {};
      a.setGainPct(100);
      a.safetyLimit = 5;
      const take = async (setup) => {
        setup();
        await sleep(30);
        a.play('hold');
        const t = e.voice.t0;
        await sleep(450);
        a.stopNow();
        await sleep(80);
        await T.waitRec(t + 0.45);
        return +T.stats(t, t + 0.45).peak.toFixed(4);
      };
      out.square = await take(() => { a.setPattern('tone'); a.setWaveform('square'); a.setFrequency(55); });
      out.am = await take(() => { a.setPattern('am'); a.setWaveform('square'); a.setFrequency(110); a.pp.am.depth = 100; });
      out.dualMono = await take(() => {
        a.setMode('dual');
        Object.assign(a.dual.a, { freq: 220, wave: 'square', gain: 100, detune: 0 });
        Object.assign(a.dual.b, { freq: 220, wave: 'square', gain: 100, detune: 0 });
        a.dual.levelA = 100; a.dual.levelB = 100; a.setStereo(false);
      });
      a.setMode('playground'); a.setPattern('tone'); a.setWaveform('sine'); a.setFrequency(440);
      // rapid retriggers during a long release, measured with the output ceiling bypassed
      // (test-only rewiring) so the check sees the real sum of overlapping voices
      e.trim.disconnect();
      e.trim.connect(e.analyser);
      a.release = 3000;
      await sleep(50);
      const tR = e.ctx.currentTime;
      let maxVoices = 0;
      let maxOscs = 0;
      for (let i = 0; i < 20; i++) {
        a.play('hold');
        await sleep(50);
        a.stop();
        maxVoices = Math.max(maxVoices, e.voices.size);
        maxOscs = Math.max(maxOscs, T.liveOscs());
        await sleep(50);
        maxVoices = Math.max(maxVoices, e.voices.size);
        maxOscs = Math.max(maxOscs, T.liveOscs());
      }
      const tE = e.ctx.currentTime;
      await T.waitRec(tE + 0.05);
      out.retrigger = { peak: +T.stats(tR, tE + 0.05).peak.toFixed(4), maxVoices, maxOscs };
      a.stopNow();
      await sleep(100);
      e.trim.disconnect();
      e.trim.connect(e.ceiling);
      a.release = 30;
      a.setGainPct(Math.round(Math.sqrt(0.08 / 0.25) * 100));
      return out;
    });
    const lim = CAP * 1.05;
    check('100 % square stays under the cap', r.square <= lim && r.square > 0.15, String(r.square));
    check('100 % AM stays under the cap', r.am <= lim && r.am > 0.1, String(r.am));
    check('100 % dual mono (in phase) stays under the cap', r.dualMono <= lim && r.dualMono > 0.1, String(r.dualMono));
    check('20 retriggers with release 3000 ms: peak ≤ cap (ceiling bypassed)', r.retrigger.peak <= lim, JSON.stringify(r.retrigger));
    check('20 retriggers with release 3000 ms: ≤ 2 voices / oscillators', r.retrigger.maxVoices <= 2 && r.retrigger.maxOscs <= 2, JSON.stringify(r.retrigger));
    check('no console problems (gain cap)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ clicks
  console.log('click-free transitions');
  {
    const { page, problems, context } = await openPage(browser);
    await startAudio(page);
    const r = await app(page, async (a, e, O, T) => {
      // ratio = largest one-sample step / largest slope of the playing 110 Hz sine (gain 0.08)
      const f = 110;
      const g = a.gainLevel;
      const slope = (2 * Math.PI * f * g) / e.ctx.sampleRate;
      a.setPattern('tone'); a.setWaveform('sine'); a.setFrequency(f);
      a.attack = 10; a.release = 30;
      const out = {};
      // Three takes per transition, judged by the median: a systematic click shows in every
      // take, while Firefox under heavy CPU load occasionally delivers an automation event tens
      // of milliseconds late (see knowledge/curated/web-audio-scheduling-lateness.md).
      const measure = async (name, fn) => {
        const takes = [];
        for (let k = 0; k < 3; k++) {
          await sleep(60);
          const tA = e.ctx.currentTime;
          await fn();
          await sleep(250);
          const tB = e.ctx.currentTime;
          await T.waitRec(tB);
          const s = T.stats(tA, tB);
          takes.push({ ratio: +(s.maxStep / slope).toFixed(2), n: s.n, stepAtMs: Math.round((s.stepAt - tA) * 1000) });
        }
        const ratios = takes.map((x) => x.ratio).sort((p, q) => p - q);
        out[name] = { ratio: ratios[1], n: Math.min(...takes.map((x) => x.n)), takes };
      };
      await measure('stop', async () => { a.play('hold'); await sleep(250); a.stop(); });
      await measure('escape', async () => { a.play('hold'); await sleep(250); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
      await measure('retrigger', async () => { a.play('hold'); await sleep(200); a.play('hold'); await sleep(200); a.stopNow(); });
      await measure('waveform', async () => {
        a.play('hold'); await sleep(200);
        a.setWaveform('triangle'); await sleep(200);
        a.setWaveform('sine'); await sleep(200);
        a.stopNow();
      });
      a.attack = 500;
      await measure('midAttackStop', async () => { a.play('hold'); await sleep(200); a.stop(); });
      a.attack = 500; a.release = 3000;
      await measure('midAttackEscapeInRelease', async () => {
        a.play('hold'); await sleep(200); a.stop(); await sleep(150);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      a.attack = 10; a.release = 300;
      await measure('midStepRelease', async () => {
        a.setPattern('pulse'); a.pp.pulse.pulseMs = 400; a.pp.pulse.pauseMs = 100;
        a.trigger();
        const t = e.voice.t0;
        await untilAudio(t + 0.3);
        a.stop();
      });
      a.setPattern('tone'); a.attack = 10; a.release = 30;
      return out;
    });
    for (const [k, v] of Object.entries(r)) check(`click ratio ≈ 1 (median of 3 < 3): ${k}`, v.n > 1000 && v.ratio < 3, JSON.stringify(v));
    check('no console problems (clicks)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ Nyquist at the AudioParam level
  for (const sr of [22050, 32000]) {
    console.log(`Nyquist at ${sr} Hz`);
    const { page, problems, context } = await openPage(browser, { instrumentOpts: { sr } });
    const r = await app(page, async (a, e, O, T) => {
      a.ensureAudio();
      const start = Date.now();
      while (e.state !== 'running' && Date.now() - start < 5000) await sleep(20);
      const safe = e.safeMaximum;
      const bad = [];
      let maxF = 0;
      let runs = 0;
      const plans = [];
      const runOne = async (label, setup) => {
        T.params.length = 0;
        T.logParams = true;
        setup();
        await sleep(5);
        const ok = a.play(a.isProgrammed ? 'trigger' : 'hold');
        await sleep(40);
        const v = e.voice;
        if (v) plans.push([label, v.plan]);
        a.stopNow();
        await sleep(30);
        T.logParams = false;
        if (ok) runs++;
        for (const p of T.params) {
          if (p.type === 'Oscillator' && p.name === 'frequency' && p.m !== 'value') {
            maxF = Math.max(maxF, p.v);
            if (!(p.v <= safe + 1e-6)) bad.push(`${label}: ${p.m}(${p.v})`);
          }
          if (p.m === 'exponentialRampToValueAtTime' && !(p.v > 0)) bad.push(`${label}: exp ramp to ${p.v}`);
          if (p.type === 'Gain' && p.name === 'gain' && p.m === 'setValueAtTime' && p.v === 0) bad.push(`${label}: gain setValueAtTime(0)`);
          if (p.type === 'Oscillator' && p.name === 'detune' && p.v !== 0) bad.push(`${label}: detune ${p.v}`);
        }
        // Modulated plans: the extremes reached through a modulation input stay within 0 … safe.
        if (v) {
          const pl = v.plan;
          const c = pl.type === 'lfo' ? pl.center : pl.freq;
          if ((pl.type === 'lfo' || pl.type === 'fm') && !(c + pl.depth <= safe + 1e-6 && c - pl.depth > 0)) bad.push(`${label}: modulation ${c}±${pl.depth}`);
        }
      };
      a.setRangeMode('advanced');
      for (const p of O.PATTERNS) {
        await runOne(`pattern ${p.id}`, () => { a.setMode('playground'); a.setPattern(p.id); a.setFrequency(20000); a.duration = 100; });
      }
      // Extreme requests: everything far above the safe maximum.
      await runOne('fm extreme', () => { a.setPattern('fm'); a.setFrequency(9000); a.pp.fm.depthHz = 10000; });
      await runOne('fm negative', () => { a.setPattern('fm'); a.setFrequency(100); a.pp.fm.depthHz = 5000; });
      await runOne('dual +1200 cents', () => {
        a.setMode('dual');
        Object.assign(a.dual.a, { freq: 15000, detune: 1200 });
        Object.assign(a.dual.b, { freq: 9000, detune: 1200 });
      });
      await runOne('sweep 20 kHz', () => { a.setMode('sweep'); a.sweep.start = 20; a.sweep.end = 20000; a.sweep.durationMs = 200; });
      for (const p of O.BUILTIN_PRESETS) {
        if (a.presetDisabled(p)) continue;
        await runOne(`preset ${p.id}`, () => { a.applyPreset(p); a.duration = 100; });
      }
      return { safe, maxF, bad: bad.slice(0, 12), nBad: bad.length, runs, sr: e.sampleRate };
    });
    check(`${sr} Hz: context runs at the forced rate`, r.sr === sr, JSON.stringify({ sr: r.sr }));
    check(`${sr} Hz: every pattern / preset played`, r.runs > 40, String(r.runs));
    check(`${sr} Hz: oscillator frequencies ≤ 0.95 · Nyquist, exp ramps > 0, no gain set to 0, no detune`, r.nBad === 0 && r.maxF <= r.safe + 1e-6, JSON.stringify(r));
    check(`${sr} Hz: no console problems`, problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ hold edge cases, Escape, revoke
  console.log('hold edge cases, Escape, continuous revoke');
  {
    const { page, problems, context } = await openPage(browser);
    await startAudio(page);
    const out = {};
    for (const kind of ['pointercancel', 'lostpointercapture', 'blur', 'hidden']) {
      const box = await page.locator('.hold-btn').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(200);
      out[kind] = await app(page, async (a, e, O, T, k) => {
        const playing = !!e.voice;
        const btn = document.querySelector('.hold-btn');
        const tS = e.ctx.currentTime;
        if (k === 'pointercancel' || k === 'lostpointercapture') btn.dispatchEvent(new PointerEvent(k, { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
        if (k === 'blur') window.dispatchEvent(new Event('blur'));
        if (k === 'hidden') {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
          delete document.hidden;
        }
        const g = await gone(tS, 0.5);
        return { playing, ...g, release: a.release / 1000 };
      }, kind);
      await page.mouse.up();
      await page.waitForTimeout(100);
    }
    for (const [k, v] of Object.entries(out)) {
      check(`hold ended by ${k}: voice gone within release + 50 ms`, v.playing && tornDown(v, v.release + 0.05), JSON.stringify(v));
    }
    const r = await app(page, async (a, e, O, T) => {
      const res = {};
      a.release = 3000;
      a.play('hold');
      await sleep(300);
      a.stop();
      await sleep(100);
      const tEsc = e.ctx.currentTime;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      res.escape = await gone(tEsc, 1);
      await T.waitRec(tEsc + 0.3);
      res.escapeTail = T.stats(tEsc + 0.1, tEsc + 0.3).peak;
      a.release = 30;
      // continuous permission withdrawn while a latched tone, an unlimited hold and a continuous
      // sweep are playing
      const revoke = async (start) => {
        a.setContinuous(true);
        await start();
        await sleep(300);
        const was = !!e.voice;
        const t = e.ctx.currentTime;
        a.setContinuous(false);
        const g = await gone(t, 1);
        a.holding = false;
        return { was, ...g, status: a.status };
      };
      res.latch = await revoke(async () => { a.setMode('playground'); a.setPattern('tone'); a.toggleLatch(); });
      res.hold = await revoke(async () => { a.play('hold'); });
      res.sweep = await revoke(async () => { a.setMode('sweep'); a.sweep.durationMs = 500; a.setSweepRepeat('continuous'); await sleep(20); a.trigger(); });
      res.sweepRepeat = a.sweep.repeat;
      a.setMode('playground');
      return res;
    });
    check('Escape during a 3000 ms release: 0 nodes within 100 ms', tornDown(r.escape, 0.1), JSON.stringify(r.escape));
    check('Escape during a 3000 ms release: silent afterwards', r.escapeTail < 1e-4, String(r.escapeTail));
    for (const k of ['latch', 'hold', 'sweep']) {
      check(`continuous revoked: ${k} stops within 100 ms`, r[k].was && tornDown(r[k], 0.1), JSON.stringify(r[k]));
    }
    check('continuous revoked: sweep repeat back to once', r.sweepRepeat === 'once', r.sweepRepeat);
    check('no console problems (edge cases)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ measured signal content
  console.log('stereo split, beating, pulse timing');
  {
    const { page, problems, context } = await openPage(browser);
    await startAudio(page);
    const r = await app(page, async (a, e, O, T) => {
      const out = {};
      a.safetyLimit = 5;
      a.setMode('dual');
      Object.assign(a.dual.a, { freq: 440, wave: 'sine', gain: 100, detune: 0 });
      Object.assign(a.dual.b, { freq: 446, wave: 'sine', gain: 100, detune: 0 });
      a.dual.levelA = 80; a.dual.levelB = 80;
      a.setStereo(true);
      await sleep(30);
      a.play('hold');
      let t = e.voice.t0;
      await untilAudio(t + 1.3);
      a.stopNow();
      await T.waitRec(t + 1.25);
      const w = [t + 0.2, t + 1.2];
      const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
      out.stereo = {
        L440: T.tone(...w, 440, 'L'), L446: T.tone(...w, 446, 'L'), R440: T.tone(...w, 440, 'R'), R446: T.tone(...w, 446, 'R'),
      };
      out.stereo.crossL = db(out.stereo.L446 / out.stereo.L440);
      out.stereo.crossR = db(out.stereo.R440 / out.stereo.R446);
      // beating: 440 + 442 mono, RMS every 20 ms over 2 s
      await sleep(100);
      a.dual.b.freq = 442;
      a.setStereo(false);
      await sleep(30);
      a.play('hold');
      t = e.voice.t0;
      await untilAudio(t + 2.3);
      a.stopNow();
      await T.waitRec(t + 2.25);
      const rms = [];
      for (let k = 0; k < 100; k++) rms.push(T.stats(t + 0.2 + k * 0.02, t + 0.22 + k * 0.02).rms);
      const mean = rms.reduce((s, x) => s + x, 0) / rms.length;
      let best = 0; let bestF = 0;
      for (let f = 0.5; f <= 6; f += 0.01) {
        let re = 0; let im = 0;
        for (let k = 0; k < rms.length; k++) { re += (rms[k] - mean) * Math.cos(2 * Math.PI * f * k * 0.02); im += (rms[k] - mean) * Math.sin(2 * Math.PI * f * k * 0.02); }
        const m = Math.hypot(re, im);
        if (m > best) { best = m; bestF = f; }
      }
      out.beat = { f: +bestF.toFixed(2), depth: +(Math.max(...rms) / Math.max(1e-9, Math.min(...rms))).toFixed(1) };
      // pulse 150 / 150 × 4: onsets on the audio clock
      a.setMode('playground');
      a.setPattern('pulse');
      Object.assign(a.pp.pulse, { pulseMs: 150, pauseMs: 150, reps: 4 });
      await sleep(30);
      a.trigger();
      t = e.voice.t0;
      await untilAudio(t + 1.3);
      await T.waitRec(t + 1.25);
      const { t: st, data: x } = T.samples(t - 0.1, t + 1.25);
      let peak = 0;
      for (const v of x) peak = Math.max(peak, Math.abs(v));
      const thr = peak * 0.1;
      const onsets = [];
      let quiet = 0;
      const sr = T.rec.sr;
      for (let i = 0; i < x.length; i++) {
        if (Math.abs(x[i]) < thr) quiet++;
        else { if (quiet > 0.03 * sr) onsets.push(st + i / sr); quiet = 0; }
      }
      out.pulse = { onsets: onsets.map((o) => +(o - t).toFixed(4)), gaps: onsets.slice(1).map((o, i) => +((o - onsets[i]) * 1000).toFixed(2)) };
      a.setPattern('tone');
      a.safetyLimit = 2;
      return out;
    });
    check('stereo split: left carries 440 Hz, right 446 Hz', r.stereo.L440 > 0.02 && r.stereo.R446 > 0.02, JSON.stringify(r.stereo));
    check('stereo split: cross-channel leakage < −40 dB', r.stereo.crossL < -40 && r.stereo.crossR < -40, JSON.stringify(r.stereo));
    check('beating 440 + 442 Hz: level envelope at 2 ± 0.2 Hz', Math.abs(r.beat.f - 2) <= 0.2 && r.beat.depth > 5, JSON.stringify(r.beat));
    check('pulse 150 / 150 × 4: four onsets 300 ± 5 ms apart', r.pulse.gaps.length === 3 && r.pulse.gaps.every((g) => Math.abs(g - 300) <= 5), JSON.stringify(r.pulse));
    check('no console problems (signal content)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ limits and long patterns
  console.log('limit scope and continuous scheduling');
  {
    const { page, problems, context } = await openPage(browser);
    await startAudio(page);
    const r = await app(page, async (a, e, O, T) => {
      const out = {};
      a.safetyLimit = 2;
      a.setPattern('finite');
      a.duration = 10000;
      await sleep(30);
      out.finiteText = a.transportText;
      for (const mode of ['trigger', 'hold']) {
        a.play(mode);
        const t = e.voice.t0;
        out[`finite_${mode}`] = await gone(t, 4);
        a.holding = false;
      }
      a.setMode('sweep');
      Object.assign(a.sweep, { start: 200, end: 2000, durationMs: 10000, repeat: 'once', direction: 'up' });
      await sleep(30);
      out.sweepText = a.transportText;
      a.trigger();
      let t = e.voice.t0;
      out.sweep = await gone(t, 12);
      // continuous sweep, 20 ms passes: scheduled ahead in bounded slices and topped up
      a.setContinuous(true);
      Object.assign(a.sweep, { durationMs: 20, repeat: 'continuous' });
      await sleep(30);
      out.contText = a.transportText;
      T.params.length = 0;
      T.logParams = true;
      const c0 = performance.now();
      a.trigger();
      out.scheduleMs = +(performance.now() - c0).toFixed(1);
      t = e.voice.t0;
      out.initialEvents = T.params.length;
      const horizon = () => Math.max(...T.params.filter((p) => p.name === 'frequency' && p.type === 'Oscillator').map((p) => p.t || 0));
      out.initialAhead = +(horizon() - e.ctx.currentTime).toFixed(2);
      await untilAudio(t + 2.6);
      out.laterAhead = +(horizon() - e.ctx.currentTime).toFixed(2);
      out.contAlive = !!e.voice && T.liveOscs() === 1;
      T.logParams = false;
      a.stopNow();
      out.contStop = await gone(e.ctx.currentTime, 0.3);
      a.setContinuous(false);
      a.setMode('playground');
      a.setPattern('tone');
      a.duration = 500;
      return out;
    });
    for (const m of ['trigger', 'hold']) {
      check(`finite tone 10 s with limit 2 s (${m}) ends ≈ 2 s`, endsAt(r[`finite_${m}`], 2.01, 0.06), JSON.stringify(r[`finite_${m}`]));
    }
    check('transport text states the finite tone is limited', /limited to 2 s/.test(r.finiteText), r.finiteText);
    check('sweep 10 s plays 10 s (patterns exempt from the hold limit)', endsAt(r.sweep, 10.01, 0.06), JSON.stringify(r.sweep));
    check('transport text states patterns are exempt', /exempt from the hold limit/.test(r.sweepText), r.sweepText);
    check('continuous sweep: transport says it repeats until stopped', /until stopped/.test(r.contText), r.contText);
    check('continuous sweep: scheduled ≈ 10 s ahead, not 600 s', r.initialAhead > 8 && r.initialAhead < 12 && r.initialEvents < 2000, JSON.stringify(r));
    check('continuous sweep: topped up while playing', r.laterAhead > 8 && r.contAlive, JSON.stringify(r));
    check('continuous sweep: main-thread scheduling cost < 20 ms', r.scheduleMs < 20, String(r.scheduleMs));
    check('continuous sweep: stop leaves 0 oscillators', r.contStop.oscs === 0, JSON.stringify(r.contStop));
    check('no console problems (limits)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ live changes and plans
  console.log('live changes and plans');
  {
    const { page, problems, context } = await openPage(browser);
    await startAudio(page);
    const r = await app(page, async (a, e, O, T) => {
      const out = {};
      const peakHz = () => {
        e.analyser.getFloatFrequencyData(e.freqData);
        let best = 1;
        for (let i = 2; i < e.freqData.length; i++) if (e.freqData[i] > e.freqData[best]) best = i;
        return Math.round((best * e.ctx.sampleRate) / e.analyser.fftSize);
      };
      a.setContinuous(true);
      a.setFrequency(1000);
      a.toggleLatch();
      await sleep(300);
      a.setPattern('siren');
      Object.assign(a.pp.siren, { min: 300, max: 330, rate: 0.2 });
      await sleep(600);
      out.siren = { type: e.voice && e.voice.plan.type, hz: peakHz(), oscs: T.liveOscs() };
      a.setPattern('tone');
      a.setFrequency(440);
      await sleep(400);
      out.tone = { type: e.voice && e.voice.plan.type, hz: peakHz(), oscs: T.liveOscs() };
      // dual live update with large detune: one glide per oscillator, never above the clamp
      a.setMode('dual');
      Object.assign(a.dual.a, { freq: 1000, detune: 0 });
      await sleep(300);
      T.params.length = 0;
      T.logParams = true;
      Object.assign(a.dual.a, { freq: 2000, detune: -1200 });
      await sleep(200);
      Object.assign(a.dual.a, { freq: 20000, detune: 1200 });
      await sleep(200);
      T.logParams = false;
      const fr = T.params.filter((p) => p.type === 'Oscillator' && p.name === 'frequency');
      out.dual = {
        maxF: Math.max(...fr.map((p) => p.v)), safe: e.safeMaximum,
        detuneCalls: T.params.filter((p) => p.name === 'detune').length,
        planA: e.voice && e.voice.plan.a.freq, instA: O.planFreqAt(e.voice.plan, 0),
      };
      a.stopNow();
      a.setContinuous(false);
      a.setMode('playground');
      await sleep(100);
      // plans: FM never through zero, extremes listed in freqs, dual stores sounding frequency
      const env = { safeMax: 20000, continuous: false };
      const fm = O.buildPlan({ source: 'single', pattern: 'fm', frequency: 100, pp: { fm: { depthHz: 5000, modFreq: 5 } } }, env).plan;
      const wob = O.buildPlan({ source: 'single', pattern: 'wobble', frequency: 1000, pp: { wobble: { depth: 200, rate: 5 } } }, env).plan;
      const dual = O.buildPlan({ source: 'dual', dual: { a: { freq: 440, detune: 1200, wave: 'sine', gain: 100 }, b: { freq: 440, detune: 0, wave: 'sine', gain: 100 }, levelA: 80, levelB: 80 } }, env).plan;
      out.plans = {
        fmDepth: fm.depth, fmFreqs: fm.freqs, wobFreqs: wob.freqs, dualA: dual.a.freq, dualAt: O.planFreqAt(dual, 0.5), dualFreqs: dual.freqs,
      };
      return out;
    });
    check('latched tone → siren pattern: the siren sounds', r.siren.type === 'lfo' && r.siren.hz > 280 && r.siren.hz < 350 && r.siren.oscs === 2, JSON.stringify(r.siren));
    check('siren → tone 440 Hz: the tone sounds', r.tone.type === 'const' && Math.abs(r.tone.hz - 440) < 8 && r.tone.oscs === 1, JSON.stringify(r.tone));
    check('dual live change ±1200 ¢: no oscillator frequency above the clamp, detune unused', r.dual.maxF <= r.dual.safe + 1e-6 && r.dual.detuneCalls === 0, JSON.stringify(r.dual));
    check('dual plan stores the sounding frequency', Math.abs(r.dual.planA - Math.min(r.dual.safe, 40000)) < 1 && r.dual.instA === r.dual.planA, JSON.stringify(r.dual));
    check('FM depth bounded so the frequency never reaches 0 Hz', r.plans.fmDepth <= 99 && Math.min(...r.plans.fmFreqs) >= 1, JSON.stringify(r.plans));
    check('plan.freqs include modulation extremes (wobble, FM)', Math.min(...r.plans.wobFreqs) === 800 && Math.max(...r.plans.wobFreqs) === 1200 && Math.max(...r.plans.fmFreqs) >= 199, JSON.stringify(r.plans));
    check('dual plan: planFreqAt returns the detuned frequency', Math.abs(r.plans.dualA - 880) < 0.01 && Math.abs(r.plans.dualAt - 880) < 0.01 && r.plans.dualFreqs.includes(880), JSON.stringify(r.plans));
    check('no console problems (live changes)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ context lifecycle
  console.log('context lifecycle');
  {
    const { page, problems, context } = await openPage(browser);
    const r = await app(page, async (a, e, O, T) => {
      const out = {};
      // first note at the requested level (no glide from the default)
      a.setGainPct(100);
      a.ensureAudio();
      const start = Date.now();
      while (!(T.rec && T.rec.ready && T.rec.chunks.length > 2 && e.state === 'running') && Date.now() - start < 6000) await sleep(20);
      out.masterAtStart = +e.master.gain.value.toFixed(4);
      a.setGainPct(Math.round(Math.sqrt(0.08 / 0.25) * 100));
      await sleep(150);
      // suspended context the browser will not resume: status is honest and no RELEASING
      // appears on the wall clock
      await e.ctx.suspend();
      e.ctx.resume = () => Promise.resolve();
      a.setPattern('finite');
      a.duration = 300;
      a.trigger();
      out.suspendedStatus = a.status;
      await sleep(600);
      out.suspendedLater = a.status;
      delete e.ctx.resume;
      await e.ctx.resume();
      await sleep(50);
      out.resumedStatus = a.status;
      a.stopNow();
      await sleep(100);
      // a context closed from outside is rebuilt on the next play
      const old = e.ctx;
      await old.close();
      await sleep(100);
      out.afterClose = { ctx: !!e.ctx, voices: e.voices.size };
      a.setPattern('tone');
      const ok = a.play('hold');
      const t = Date.now();
      while (e.state !== 'running' && Date.now() - t < 3000) await sleep(20);
      await sleep(200);
      out.rebuilt = { ok, fresh: e.ctx !== old, state: e.state, voice: !!e.voice, status: a.status };
      a.stopNow();
      await sleep(100);
      out.rebuiltStop = { oscs: T.liveOscs(), nodes: e.activeNodeCount };
      return out;
    });
    check('first note: master starts at the requested level (no glide from 0.08)', Math.abs(r.masterAtStart - 0.25) < 1e-3, JSON.stringify(r));
    check('suspended context: status SUSPENDED, never PLAYING or RELEASING', r.suspendedStatus === 'SUSPENDED' && r.suspendedLater === 'SUSPENDED', JSON.stringify(r));
    check('resumed context: status PLAYING', r.resumedStatus === 'PLAYING', JSON.stringify(r));
    check('closed context: rebuilt and playing on the next play', r.rebuilt.ok && r.rebuilt.fresh && r.rebuilt.state === 'running' && r.rebuilt.voice && r.rebuilt.status === 'PLAYING', JSON.stringify(r));
    check('rebuilt context: 0 oscillators after stop', r.rebuiltStop.oscs === 0 && r.rebuiltStop.nodes === 0, JSON.stringify(r.rebuiltStop));
    check('no console problems (lifecycle)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ microphone
  if (ENGINE !== 'webkit') {
    console.log('microphone');
    const { page, problems, context } = await openPage(browser);
    const r = await app(page, async (a, e, O, T) => {
      const out = {};
      await a.toggleMic();
      out.on = a.micActive && !!e.mic;
      await a.toggleMic();
      out.offTracks = T.streams.flatMap((s) => s.getTracks().map((t) => t.readyState));
      out.off = !a.micActive && !e.mic;
      // device unplugged / permission revoked: the track ends by itself
      await a.toggleMic();
      const s = T.streams[T.streams.length - 1];
      s.getTracks()[0].dispatchEvent(new Event('ended'));
      await sleep(50);
      out.endedClears = !a.micActive && !e.mic && s.getTracks().every((t) => t.readyState === 'ended');
      out.alerts = a.alerts.map((x) => x.title);
      // graph setup throws after permission: every track is stopped, the error is reported
      const orig = AudioContext.prototype.createMediaStreamSource;
      AudioContext.prototype.createMediaStreamSource = () => { throw new Error('test failure'); };
      await a.toggleMic();
      AudioContext.prototype.createMediaStreamSource = orig;
      const s2 = T.streams[T.streams.length - 1];
      out.failTracks = s2.getTracks().map((t) => t.readyState);
      out.failState = { mic: !!e.mic, active: a.micActive };
      return out;
    });
    check('microphone starts', r.on, JSON.stringify(r));
    check('microphone off: every track ended', r.off && r.offTracks.length > 0 && r.offTracks.every((s) => s === 'ended'), JSON.stringify(r));
    check('track ended by the device: MIC ON clears, notice shown', r.endedClears && r.alerts.includes('Microphone stopped'), JSON.stringify(r));
    check('setup failure after permission: tracks stopped, mic off', r.failTracks.every((s) => s === 'ended') && !r.failState.mic && !r.failState.active, JSON.stringify(r));
    check('no console problems (microphone)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // ------------------------------------------------------------------ V2 extension points
  // Not part of V1's suite: the V2 hooks on the ported engine, measured the same way (click
  // ratio from the output tap, oscillator accounting).
  console.log('V2 extension points on the ported engine');
  {
    const { page, problems, context } = await openPage(browser);
    await startAudio(page);
    const r = await app(page, async (a, e, O, T) => {
      const V2 = window.OSCILLA_V2;
      const f = 110;
      const slope = (2 * Math.PI * f * a.gainLevel) / e.ctx.sampleRate;
      a.setPattern('tone'); a.setWaveform('sine'); a.setFrequency(f);
      const plan = a.currentPlan().plan;
      const base = { mode: 'hold', continuous: true, limitS: 2, durationS: 0.5, attackS: 0.01, releaseS: 0.03 };
      const out = {};
      const measure = async (name, fn) => {
        const takes = [];
        for (let k = 0; k < 3; k++) {
          await sleep(60);
          const tA = e.ctx.currentTime;
          const extra = await fn();
          await sleep(250);
          const tB = e.ctx.currentTime;
          await T.waitRec(tB);
          const s = T.stats(tA, tB);
          takes.push({ ratio: +(s.maxStep / slope).toFixed(2), n: s.n, ...(extra || {}) });
        }
        const ratios = takes.map((x) => x.ratio).sort((p, q) => p - q);
        out[name] = { ratio: ratios[1], n: Math.min(...takes.map((x) => x.n)), takes, oscs: T.liveOscs(), nodes: e.activeNodeCount };
      };
      // ADSR (envelope.js through makeAdsrEnvelope), released in the middle of a 500 ms attack
      await measure('adsrMidAttackRelease', async () => {
        e.play(plan, { ...base, adsr: { a: 0.5, d: 0.2, s: 0.6, r: 0.05 }, envelope: V2.adsrEnvelope });
        await sleep(200);
        e.release();
      });
      // filter insert, updated live, then STOP
      await measure('filterInsertStop', async () => {
        e.play(plan, { ...base, inserts: [(ctx, track) => V2.createFilterStage(ctx, { type: 'lowpass', frequency: 2000 }, { track })] });
        await sleep(150);
        e.updateInserts([{ type: 'lowpass', frequency: 600 }]);
        await sleep(150);
        e.stopAll();
      });
      // additive PeriodicWave, then back to the sine with clearPeriodicWave (dip)
      await measure('periodicWaveClear', async () => {
        const wave = V2.buildPeriodicWave(e.ctx, [{ n: 1, gain: 1, phase: 0 }, { n: 2, gain: 0.3, phase: 0 }]).wave;
        e.play(plan, { ...base, periodicWave: wave });
        await sleep(200);
        const cleared = e.clearPeriodicWave();
        await sleep(100);
        const type = e.voice && e.voice.carrier.type;
        e.stopAll();
        return { cleared, type };
      });
      await sleep(200);
      out.final = { oscs: T.liveOscs(), nodes: e.activeNodeCount, voices: e.voices.size };
      return out;
    });
    for (const k of ['adsrMidAttackRelease', 'filterInsertStop', 'periodicWaveClear']) {
      check(`V2 hook click ratio ≈ 1 (median of 3 < 3): ${k}`, r[k].n > 1000 && r[k].ratio < 3, JSON.stringify(r[k]));
    }
    check('V2 periodicWave cleared back to the plan waveform', r.periodicWaveClear.takes.every((x) => x.cleared && x.type === 'sine'), JSON.stringify(r.periodicWaveClear.takes));
    check('V2 hooks: 0 oscillators, nodes and voices afterwards', r.final.oscs === 0 && r.final.nodes === 0 && r.final.voices === 0, JSON.stringify(r.final));
    check('no console problems (V2 hooks)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  await browser.close();
  console.log(`\n[${ENGINE}] ${passed - start.passed} passed, ${failed - start.failed} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

async function main() {
  const fx = await buildFixture();
  BASE = fx.url;
  console.log(`fixture: ${fx.url} (${(fx.bytes / 1024).toFixed(1)} kB bundle)`);
  const summary = [];
  for (const b of BROWSERS) {
    ENGINE = b;
    const before = { passed, failed, failures: failures.length };
    try {
      await runBrowser();
    } catch (e) {
      failed++;
      failures.push(`[${b}] crashed: ${e && e.stack}`);
      console.error(e);
    }
    summary.push(`${b}: ${passed - before.passed} passed, ${failed - before.failed} failed`);
    for (let i = before.failures; i < failures.length; i++) failures[i] = `[${b}] ${failures[i]}`;
  }
  fs.rmSync(fx.dir, { recursive: true, force: true });
  console.log(`\n${summary.join('\n')}`);
  if (failed) {
    console.log(failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

module.exports = { instrument, LAUNCH };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
