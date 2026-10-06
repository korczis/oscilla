#!/usr/bin/env node
// OSCILLA V3 measurement orchestration in real browsers: MeasurementEngine (engine.js) driving
// the browser io (capture.js) on the V2 AudioEngine, in chromium, firefox and webkit, each from
// file:// AND from a GitHub-Pages-like sub-path (http://127.0.0.1:<port>/oscilla/).
//
//   node tests/browser/v3-measure.cjs [--browsers chromium,firefox,webkit] [--origins file,http]
//                                     (or OSC_BROWSERS=chromium,firefox)
//                                     [--spike] [--long-s 40] [--json out.json]
//
// The application UI does not use these modules yet, so a fixture page is built: an esbuild IIFE
// bundle of a test entry (inline below, like engine-v1port.cjs) inlined into ONE classic
// <script> of a single HTML file, i.e. the same constraints as dist/index.html (no module
// script, worklet from a data: URL). The page exposes window.T with the routines; this runner
// asserts.
//
// Checks per browser and origin (asserted):
//   - capture worklet loads from a data: URL (or the documented ScriptProcessor fallback runs)
//   - TEST CONTEXT digital loopback: a 2 s log sweep (3 repeats) through the master safety
//     chain and a known BiquadFilterNode (low-pass 1 kHz, Q √½) is recovered: transfer magnitude
//     = 20·log10(master gain) + the filter's own getFrequencyResponse() within TOLERANCE_DB over
//     100 Hz-10 kHz (justification at TOLERANCE_DB)
//   - spec §207 / gap G12: the same sweep captured after the master gain only (pre-limiter tap)
//     and after the whole chain (post-chain tap) differ by < G12_TOLERANCE_DB over 20 Hz-18 kHz
//     at the default level (peak 0.02) and at the limit of the transparent range (peak 0.1);
//     18-20 kHz and the loudest allowed peak (1 × master gain 0.25) are reported, not asserted
//   - 0 engine nodes, 0 io nodes/sources/captures/ports and 0 started-but-not-ended
//     AudioBufferSourceNodes (independent instrumentation) after finish and after an abort in
//     the middle of the sweep
//   - the run after that abort starts clean: silent until the limiter's look-ahead has passed
//     and no discontinuity (Firefox replayed the aborted fade tail before feedLimiter)
//   - a capture scheduled after 200 ms of synchronous work in one task is complete (Firefox
//     freezes currentTime for the task; capture.js schedules from a fresh task)
//   - fake microphone (chromium and firefox, http origin, once per browser): the real capture
//     path returns the requested number of frames, the applied-constraints read-back object, and
//     every track is stopped and every node released by cancel() — acoustics are not asserted
// --spike adds the V307 measurements recorded in docs/v3/spike-audioworklet-worker.md: a long
// (--long-s, default 40 s) capture with frame-integrity counts in AudioWorklet mode and a
// ScriptProcessor comparison, loopback lag statistics, data:/blob: worklet and worker loading,
// main-thread vs Worker analysis of 10 s and 20 s sweeps at 48 kHz, node timings and the build
// size impact.
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const zlib = require('node:zlib');
const esbuild = require('esbuild');
const playwright = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BROWSERS = arg('browsers', process.env.OSC_BROWSERS || 'chromium,firefox,webkit').split(',');
const ORIGINS = arg('origins', 'file,http').split(',');
const SPIKE = argv.includes('--spike');
const LONG_S = Number(arg('long-s', '40'));
const JSON_OUT = arg('json', '');
const SRC = path.resolve(__dirname, '..', '..', 'src', 'js');

// Magnitude tolerance of the loopback recovery, dB. Contributions: regularization bias ≤ 0.004 dB
// in band (transfer.js), power averaging over 1/48 octave of a smooth 2nd-order response
// < 0.01 dB, Float32 graph arithmetic and Float32 capture ≈ 1e-6 relative, the limiter/ceiling
// path measured below (G12) ≤ 0.01 dB. The filter reference is the browser's own
// getFrequencyResponse() of the same node type and parameters, so coefficient differences
// between engines cancel. 0.1 dB leaves margin for an engine's internal biquad precision.
const TOLERANCE_DB = 0.1;
const G12_TOLERANCE_DB = 0.05;
// Pure-gain loopback, pre-limiter tap: the capture is g · stimulus in Float32 graph arithmetic.
// g · s computed in double here differs from the Float32 product by ≤ 1 ulp of |s| ≤ 0.25
// (1.5e-8) plus the Float32 rounding of g (≤ 6e-8 relative): ≤ 1e-7. A quantum written at the
// wrong frame leaves an error of the order of the signal itself (≥ 1e-3 over a sweep).
const SAMPLE_EXACT_TOLERANCE = 1e-6;

const LAUNCH = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0,
    'media.autoplay.block-webaudio': false, 'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true } },
  webkit: {},
};

// ------------------------------------------------------------------------------ fixture
const ENTRY = `
import { AudioEngine } from './audio/audio-engine.js';
import { createMeasurementEngine } from './measurement/engine.js';
import { createLoopbackIo, createCaptureIo, workletDataUrl, CAPTURE_WORKLET_SOURCE }
  from './measurement/capture.js';
import { renderStimulus } from './measurement/stimulus.js';
import { checkCapture } from './measurement/capture-checks.js';
import { align } from './measurement/align.js';
import { computeTransfer } from './measurement/transfer.js';
import { computeImpulseResponse } from './measurement/impulse-response.js';

// Independent instrumentation (installed before anything creates nodes): AudioBufferSource
// nodes started and not yet ended, and every getUserMedia stream.
const live = { sources: 0, started: 0, streams: [] };
const oStart = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (...a) {
  live.sources += 1;
  live.started += 1;
  this.addEventListener('ended', () => { live.sources -= 1; }, { once: true });
  return oStart.apply(this, a);
};
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    const s = await gum(c);
    live.streams.push(s);
    return s;
  };
}

const T = { engine: null, io: null, live };
window.T = T;

const db = (x) => 20 * Math.log10(x);
const recipe = (o = {}) => ({
  stimulus: { kind: 'log-sweep', duration: o.seconds || 2, level: o.level || 0.25,
    f1: 20, f2: 20000, fade: 0.01 },
  repeats: o.repeats || 1,
  analysis: { noiseCheckS: o.noiseCheckS == null ? 0.5 : o.noiseCheckS, preRollS: 0.25,
    postRollS: 0.5, gapS: 0.2 },
});

T.start = async () => {
  if (!T.engine) T.engine = new AudioEngine();
  const ok = T.engine.init();
  await T.engine.resume();
  return { ok, state: T.engine.state, sampleRate: T.engine.sampleRate };
};

function setMasterGain(g) {
  const e = T.engine;
  e.gainLevel = g;
  e.master.gain.cancelScheduledValues(0);
  e.master.gain.setValueAtTime(g, e.ctx.currentTime);
}

T.counts = () => {
  const e = T.engine;
  const io = T.io;
  const c = {
    engineNodes: e ? e.activeNodeCount : 0,
    engineSources: e ? e.activeSourceCount : 0,
    ioNodes: io ? io.activeNodeCount : 0,
    ioSources: io ? io.activeSourceCount : 0,
    ioCaptures: io ? io.activeCaptureCount : 0,
    ioPorts: io ? io.openPortCount : 0,
    ioTracks: io ? io.openTrackCount : 0,
    liveBufferSources: live.sources,
    liveTracks: live.streams.reduce((n, s) => n + s.getTracks()
      .filter((t) => t.readyState === 'live').length, 0),
  };
  c.zero = Object.values(c).every((v) => v === 0);
  return c;
};

const SYSTEM = { type: 'biquad', filter: 'lowpass', frequency: 1000, Q: Math.SQRT1_2 };

T.loopback = async (o = {}) => {
  const e = T.engine;
  const gain = o.masterGain != null ? o.masterGain : 0.08;
  setMasterGain(gain);
  const system = o.system || SYSTEM;
  const io = createLoopbackIo({ engine: e, system, tap: o.tap || 'post-chain',
    mode: o.mode || 'auto' });
  T.io = io;
  const states = [];
  const progress = [];
  const eng = createMeasurementEngine({ io, onEvent: (ev) => {
    if (ev.type === 'state') states.push(ev.to);
    else if (ev.type === 'progress') progress.push(ev.overall);
  } });
  const t0 = performance.now();
  let result = null;
  let error = null;
  try {
    result = await eng.measure(recipe(o), { keepRaw: !!o.residual });
  } catch (err) {
    error = { code: err.code, message: err.message };
  }
  const wallMs = performance.now() - t0;
  const out = { states, error, wallMs, mode: io.mode, workletError: io.workletError,
    sampleRate: e.sampleRate, state: eng.state };
  let mono = true;
  for (let i = 1; i < progress.length; i++) if (progress[i] < progress[i - 1]) mono = false;
  out.progress = { count: progress.length, monotonic: mono, last: progress.at(-1) };
  if (result && result.transfer) {
    const tr = result.transfer;
    const chainGain = result.testContext.chainGain;
    let expected = null;
    if (system.type === 'biquad') {
      const ref = e.ctx.createBiquadFilter();
      ref.type = system.filter;
      ref.frequency.value = system.frequency;
      ref.Q.value = system.Q;
      const f = Float32Array.from(tr.frequencies);
      const mag = new Float32Array(f.length);
      const ph = new Float32Array(f.length);
      ref.getFrequencyResponse(f, mag, ph);
      expected = Array.from(mag, (m) => db(chainGain) + db(m));
    } else if (system.type === 'gain') {
      expected = Array.from(tr.frequencies, () => db(chainGain * system.gain));
    }
    let worst = 0;
    let worstAt = null;
    let sum = 0;
    let n = 0;
    if (expected) {
      for (let i = 0; i < tr.frequencies.length; i++) {
        const f = tr.frequencies[i];
        if (f < 100 || f > 10000) continue;
        const d = tr.magnitudeDb[i] - expected[i];
        sum += d;
        n += 1;
        if (Math.abs(d) > Math.abs(worst)) { worst = d; worstAt = f; }
      }
    }
    const sr = result.sampleRate;
    const preF = Math.ceil((0.25 * sr) / 128 - 1e-9) * 128;
    out.result = {
      state: result.state,
      runs: result.runs.length,
      chainGain,
      tap: result.testContext.tap,
      worstDevDb: worst,
      worstAtHz: worstAt,
      meanDevDb: n ? sum / n : null,
      points: n,
      magnitude: o.keepCurve ? Array.from(tr.magnitudeDb) : undefined,
      frequencies: o.keepCurve ? Array.from(tr.frequencies) : undefined,
      at1k: (() => {
        let k = 0;
        for (let i = 0; i < tr.frequencies.length; i++) {
          if (Math.abs(tr.frequencies[i] - 1000) < Math.abs(tr.frequencies[k] - 1000)) k = i;
        }
        return { f: tr.frequencies[k], db: tr.magnitudeDb[k], expected: expected && expected[k] };
      })(),
      // Pipeline delay: where the stimulus was found minus where it was scheduled (frames).
      lags: result.runs.map((r) => r.alignment.lagSamples - preF),
      peakCorrelation: result.runs.map((r) => r.alignment.peakCorrelation),
      integrity: result.runs.map((r) => r.checks.integrity),
      checks: result.captureChecks.map((c) => c.reasons.map((x) => x.code)),
      validRange: tr.validRange,
      analysis: result.timeline.analysis,
      // Sample-exactness of a pure-gain loopback: max |capture[lag + i] − g · stimulus[i]| at
      // the integer lag, with each run's stale-clock corrections. Any misplaced quantum makes
      // it the size of the signal; Float32 arithmetic keeps it near 1e-8.
      // When it is not exact, "departs" says where and how (diagnostic only, never asserted):
      // the first stimulus frame that departs from g · stimulus at the scheduled position
      // (preF, the pre-limiter tap adds no delay) and the whole-quantum shift that fits the rest
      // of the sweep. WebKit CI once delivered a complete capture (no missing frame, no clock
      // correction) whose stimulus paused for one render quantum of silence 16128 frames in and
      // continued 128 frames late (shift +128): the engine run on that capture reproduces the
      // reported lag, maxAbs and 76 Hz deviation to the last digit.
      residual: o.residual && system.type === 'gain' ? result.runs.map((r) => {
        const st = renderStimulus(result.stimulus.spec).samples;
        const lag = Math.round(r.alignment.lagSamples);
        const g = chainGain * system.gain;
        const err = (at, i) => Math.abs(r.raw[at + i] - g * st[i]);
        let m = 0;
        for (let i = 0; i < st.length; i++) {
          const d = err(lag, i);
          if (!(d <= m)) m = d;
        }
        let departs;
        if (!(m <= o.residualTol)) {
          let i0 = 0;
          while (i0 < st.length && err(preF, i0) <= o.residualTol) i0++;
          let fit = { shift: null, maxAbs: Infinity };
          for (let shift = -512; shift <= 512; shift += 128) {
            let e = 0;
            for (let i = Math.min(st.length, i0 + 512); i < st.length; i++) {
              const d = err(preF + shift, i);
              if (!(d <= e)) e = d;
            }
            if (e < fit.maxAbs) fit = { shift, maxAbs: e };
          }
          departs = { atFrame: i0, atS: i0 / sr, shiftAfter: fit.shift, maxAbsAfter: fit.maxAbs };
        }
        return { maxAbs: m, lagFrames: lag, clockCorrections: r.checks.integrity
          && r.checks.integrity.timing ? r.checks.integrity.timing.clockCorrections : null,
        ...(departs ? { departs } : {}) };
      }) : undefined,
      actual: result.timeline.actual,
    };
  } else if (result) {
    // INVALID without a transfer: everything needed to say WHY (printed by the runner).
    const sr = result.sampleRate || e.sampleRate;
    const preF = Math.ceil((0.25 * sr) / 128 - 1e-9) * 128;
    out.result = {
      state: result.state,
      reasons: (result.reasons || []).map((x) => ({ code: x.code, text: x.text,
        run: x.run, value: x.value })),
      runs: (result.runs || []).length,
      frames: (result.runs || []).map((r) => r.frames),
      integrity: (result.runs || []).map((r) => r.checks && r.checks.integrity),
      lags: undefined,
      lagsInvalid: (result.runs || []).map((r) => (r.alignment
        && r.alignment.lagSamples !== null ? r.alignment.lagSamples - preF : null)),
      actual: result.timeline && result.timeline.actual,
    };
  }
  out.diag = io.diagnostics ? io.diagnostics() : null;
  io.dispose();
  return out;
};

T.abortMidSweep = async (o = {}) => {
  const e = T.engine;
  setMasterGain(0.08);
  const io = createLoopbackIo({ engine: e, system: SYSTEM, mode: o.mode || 'auto' });
  T.io = io;
  let eng = null;
  let atAbort = null;
  let fired = null;
  const fire = new Promise((resolve) => { fired = resolve; });
  eng = createMeasurementEngine({ io, onEvent: (ev) => {
    if (ev.type === 'progress' && ev.phase === 'sweep' && ev.phaseFraction > 0.3 && !atAbort) {
      atAbort = { phase: ev.phase, fraction: ev.phaseFraction, counts: T.counts() };
      eng.abort('test-mid-sweep');
      fired();
    }
  } });
  const m = eng.measure(recipe({ seconds: 2, noiseCheckS: 0 })).then(
    () => 'resolved', (err) => err.code);
  await fire;
  const code = await m;
  return { code, state: eng.state, atAbort, after: T.counts() };
};

// The run right after T.abortMidSweep, pure-gain post-chain tap: the frames between the scheduled
// stimulus onset and the end of the limiter's 6 ms look-ahead must be silent (before feedLimiter,
// Firefox replayed the aborted run's fade tail there), and the capture has no discontinuity. The
// look-ahead is a time, so the window is too: 288 frames at 48 kHz, 264 at 44.1 kHz (the CI
// runners' rate), less a margin of 8 frames for the onset rounding.
const LIMITER_LOOKAHEAD_S = 0.006; // DynamicsCompressorNode, every engine
T.afterAbort = async () => {
  const io = createLoopbackIo({ engine: T.engine, system: { type: 'gain', gain: 1 } });
  T.io = io;
  const sr = T.engine.ctx.sampleRate;
  const stim = renderStimulus({ kind: 'log-sweep', duration: 1, level: 0.25, f1: 20, f2: 20000,
    fade: 0.01, sampleRate: sr });
  const cap = await io.runStimulus(stim, { preRollS: 0.25, postRollS: 0.2 });
  const onset = Math.round(cap.preRoll * sr);
  let peak = 0;
  const silent = Math.floor(LIMITER_LOOKAHEAD_S * sr) - 8;
  for (let k = onset; k < onset + silent; k++) peak = Math.max(peak, Math.abs(cap.samples[k]));
  const chk = checkCapture(cap);
  io.dispose();
  return { peakBeforeDelayedOnset: peak, frames: silent, sampleRate: sr,
    discontinuities: chk.discontinuities.length,
    reasons: chk.reasons.map((x) => x.code) };
};

// A window scheduled after busyMs of synchronous work in the same task (Firefox freezes
// currentTime for the whole task): the capture must still be complete (capture.js freshClock).
T.staleClock = async (busyMs = 200) => {
  const io = createLoopbackIo({ engine: T.engine, system: { type: 'gain', gain: 1 } });
  T.io = io;
  const sr = T.engine.ctx.sampleRate;
  const stim = renderStimulus({ kind: 'log-sweep', duration: 1, level: 0.25, f1: 20,
    f2: 20000, fade: 0.01, sampleRate: sr });
  await io.captureNoise(0.1); // input and recorder ready
  await new Promise((r) => setTimeout(r, 50));
  const p0 = performance.now();
  while (performance.now() - p0 < busyMs) { /* synchronous work in this task */ }
  const cap = await io.runStimulus(stim, { preRollS: 0.25, postRollS: 0.2 });
  const i = cap.integrity;
  io.dispose();
  return { missing: i.expectedFrames - i.receivedFrames, discontinuities: i.discontinuities,
    armedAfterStart: i.timing.armedAtFrame - i.timing.startFrame };
};

T.disposeIo = () => { if (T.io) T.io.dispose(); return T.counts(); };

T.micCapture = async () => {
  const io = createCaptureIo({ engine: T.engine });
  T.io = io;
  const facts = await io.preflight();
  const out = { facts: JSON.parse(JSON.stringify(facts)), mode: io.mode };
  try {
    const cap = await io.captureNoise(1.0);
    out.capture = { frames: cap.samples.length, expected: Math.round(1.0 * cap.sampleRate),
      sampleRate: cap.sampleRate, constraints: cap.constraints, device: cap.device,
      integrity: cap.integrity, peak: cap.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) };
  } catch (err) {
    out.error = { code: err.code, message: err.message };
  }
  out.beforeCancel = T.counts();
  io.cancel();
  out.afterCancel = T.counts();
  io.dispose();
  return out;
};

// ---- spike probes
T.loaders = async () => {
  const WORKER = 'self.onmessage = (e) => self.postMessage(e.data * 2);';
  const out = {};
  const tryWorklet = async (url) => {
    try {
      const c = new OfflineAudioContext(1, 128, 48000);
      if (!c.audioWorklet) return 'no audioWorklet';
      await c.audioWorklet.addModule(url);
      return 'ok';
    } catch (err) { return String(err && (err.name || err.message)); }
  };
  const tryWorker = (url) => new Promise((resolve) => {
    try {
      const w = new Worker(url);
      const done = (v) => { w.terminate(); resolve(v); };
      w.onmessage = (e) => done(e.data === 42 ? 'ok' : 'bad reply');
      w.onerror = (e) => { e.preventDefault && e.preventDefault(); done('error event'); };
      w.postMessage(21);
      setTimeout(() => done('timeout'), 3000);
    } catch (err) { resolve(String(err && (err.name || err.message))); }
  });
  out.workletData = await tryWorklet(workletDataUrl());
  out.workletBlob = await tryWorklet(URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE],
    { type: 'application/javascript' })));
  out.workerData = await tryWorker('data:application/javascript,' + encodeURIComponent(WORKER));
  out.workerBlob = await tryWorker(URL.createObjectURL(new Blob([WORKER],
    { type: 'application/javascript' })));
  out.secureContext = window.isSecureContext;
  out.audioWorklet = typeof AudioWorkletNode === 'function';
  return out;
};

T.longCapture = async ({ seconds, mode }) => {
  const e = T.engine;
  const io = createLoopbackIo({ engine: e, system: { type: 'gain', gain: 1 }, mode });
  T.io = io;
  const t0 = performance.now();
  let out;
  try {
    await io.preflight();
    let chunks = 0;
    const cap = await io.captureNoise(seconds, { onChunk: () => { chunks += 1; } });
    out = { mode: io.mode, integrity: cap.integrity, chunks, wallMs: performance.now() - t0,
      bytes: cap.samples.byteLength };
  } catch (err) {
    out = { mode: io.mode, error: { code: err.code, message: err.message } };
  }
  io.dispose();
  return out;
};

function synthCapture(seconds, sr) {
  const st = renderStimulus({ kind: 'log-sweep', sampleRate: sr, duration: seconds, level: 0.25,
    f1: 20, f2: 20000, fade: 0.01 });
  const pre = Math.round(0.5 * sr);
  const y = new Float32Array(pre + st.samples.length + Math.round(1.5 * sr));
  // one-pole low-pass as a stand-in system (cost does not depend on the system)
  let z = 0;
  for (let i = 0; i < st.samples.length; i++) { z += 0.3 * (st.samples[i] - z); y[pre + i] = z; }
  return { st, y };
}

function analyse(st, y, sr) {
  const t = [];
  let t0 = performance.now();
  const a = align(st.samples, y, sr);
  t.push(performance.now() - t0);
  t0 = performance.now();
  computeTransfer({ stimulus: st.samples, captured: y, sampleRate: sr, f1: 20, f2: 20000,
    lagSamples: a.lagSamples });
  t.push(performance.now() - t0);
  t0 = performance.now();
  computeImpulseResponse({ stimulus: st.samples, captured: y, sampleRate: sr, f1: 20, f2: 20000,
    lagSamples: Math.max(0, a.lagSamples) });
  t.push(performance.now() - t0);
  return { alignMs: t[0], transferMs: t[1], irMs: t[2], totalMs: t[0] + t[1] + t[2],
    longestMs: Math.max(...t) };
}

T.analysisMain = ({ seconds, sr }) => {
  const { st, y } = synthCapture(seconds, sr);
  return analyse(st, y, sr);
};

// Main-thread responsiveness while a Worker (data: URL) runs the same analysis: the largest gap
// between MessageChannel heartbeats is the longest main-thread block.
T.analysisWorker = async ({ seconds, sr, workerSource }) => {
  const { st, y } = synthCapture(seconds, sr);
  const w = new Worker('data:application/javascript,' + encodeURIComponent(workerSource));
  const ch = new MessageChannel();
  let last = performance.now();
  let maxGap = 0;
  let beating = true;
  ch.port1.onmessage = () => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    if (beating) ch.port2.postMessage(0);
  };
  const t0 = performance.now();
  const reply = await new Promise((resolve, reject) => {
    w.onmessage = (e) => resolve(e.data);
    w.onerror = (e) => reject(new Error(e.message || 'worker error'));
    const stim = st.samples.slice();
    const cap = y.slice();
    w.postMessage({ stimulus: stim, captured: cap, sampleRate: sr }, [stim.buffer, cap.buffer]);
    ch.port2.postMessage(0);
  });
  beating = false;
  const roundTripMs = performance.now() - t0;
  w.terminate();
  return { ...reply, roundTripMs, mainThreadMaxGapMs: maxGap };
};
`;

const WORKER_ENTRY = `
import { align } from './measurement/align.js';
import { computeTransfer } from './measurement/transfer.js';
import { computeImpulseResponse } from './measurement/impulse-response.js';
self.onmessage = (e) => {
  const { stimulus, captured, sampleRate } = e.data;
  const t0 = performance.now();
  const a = align(stimulus, captured, sampleRate);
  const tr = computeTransfer({ stimulus, captured, sampleRate, f1: 20, f2: 20000,
    lagSamples: a.lagSamples });
  const ir = computeImpulseResponse({ stimulus, captured, sampleRate, f1: 20, f2: 20000,
    lagSamples: Math.max(0, a.lagSamples) });
  self.postMessage({ workerMs: performance.now() - t0, lag: a.lagSamples,
    points: tr.frequencies.length, irLength: ir.samples.length });
};
`;

async function bundle(contents, name, minify = false) {
  const r = await esbuild.build({
    stdin: { contents, resolveDir: SRC, sourcefile: name },
    bundle: true, format: 'iife', write: false, target: 'es2020', logLevel: 'silent', minify,
  });
  return r.outputFiles[0].text;
}

const HTML = (js) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OSCILLA V3 measure fixture</title></head>
<body><button id="start" type="button">start</button>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
<script>document.getElementById('start').addEventListener('click', () => {
  window.T.started = window.T.start(); });</script>
</body></html>`;

function startServer(html) {
  const server = http.createServer((req, res) => {
    if (req.url === '/oscilla/' || req.url === '/oscilla/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ------------------------------------------------------------------------------ runner
let failures = 0;
let passes = 0;
const report = { meta: { date: new Date().toISOString(), node: process.version }, runs: {} };
function check(key, name, ok, detail = '') {
  if (ok) passes += 1; else failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} [${key}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
const f = (x, d = 3) => (x == null || Number.isNaN(x) ? 'null' : Number(x).toFixed(d));
/**
 * Stale-clock corrections of the capture worklet (capture.js CAPTURE_WORKLET_SOURCE): printed
 * whenever a capture window needed one, with the outcome, as evidence that the corrected index
 * yields a complete, valid capture.
 */
function noteClock(key, label, lb) {
  const notes = (lb && lb.diag && lb.diag.clock) || [];
  const armed = notes.filter((x) => x.id >= 0);
  if (armed.length) {
    console.log(`  INFO [${key}] clock: ${label}: ${armed.length} stale currentFrame reading(s) `
      + `corrected inside capture windows (${JSON.stringify(armed.slice(0, 3))}); result `
      + `${lb.result ? lb.result.state : lb.state}`);
  }
  return armed.length;
}

/** Why a loopback produced no transfer: the error, or the INVALID reasons with frame counts. */
function whyNoTransfer(lb) {
  if (!lb) return 'no result';
  if (lb.result && lb.result.points !== undefined) return 'transfer present';
  const r = lb.result || {};
  const parts = [`state ${lb.state}`];
  if (lb.error) parts.push(`error ${lb.error.code}: ${lb.error.message}`);
  if (r.reasons) parts.push(`reasons ${r.reasons.map((x) => `${x.code} (${x.text})`).join('; ')}`);
  if (r.integrity) parts.push(`integrity ${JSON.stringify(r.integrity)}`);
  if (r.frames) parts.push(`frames ${JSON.stringify(r.frames)}`);
  if (r.lagsInvalid) parts.push(`lag ${JSON.stringify(r.lagsInvalid)}`);
  if (r.actual) parts.push(`timeline ${JSON.stringify(r.actual)}`);
  if (lb.diag) parts.push(`io ${JSON.stringify(lb.diag)}`);
  return parts.join(', ');
}
const stats = (xs) => {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
};

async function runOne(browserName, origin, url, workerSource, micDone) {
  const key = `${browserName}/${origin}`;
  const rec = (report.runs[key] = {});
  const browser = await playwright[browserName].launch(LAUNCH[browserName]);
  rec.version = browser.version();
  const context = await browser.newContext();
  if (browserName === 'chromium' && origin === 'http') {
    await context.grantPermissions(['microphone'], { origin: new URL(url).origin })
      .catch(() => {});
  }
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  console.log(`\n${key} (${rec.version})`);
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.click('#start'); // a user gesture for the autoplay policy (WebKit)
    rec.start = await page.evaluate(() => window.T.started);
    check(key, 'AudioContext running', rec.start.state === 'running', JSON.stringify(rec.start));

    rec.loaders = await page.evaluate(() => window.T.loaders());
    console.log(`  INFO [${key}] loaders ${JSON.stringify(rec.loaders)}`);

    // 1. Loopback sweep through the master chain and a known biquad, 3 repeats.
    const lb = (rec.loopback = await page.evaluate(() => window.T.loopback({ seconds: 2,
      repeats: 3 })));
    const r = lb.result || {};
    noteClock(key, 'loopback 3 runs', lb);
    check(key, 'loopback measurement COMPLETE with 3 runs', r.state === 'COMPLETE'
      && r.runs === 3,
    r.state === 'COMPLETE' ? `${lb.state}, ${r.runs} runs` : whyNoTransfer(lb));
    check(key, `capture mode ${lb.mode}`, lb.mode === 'audioworklet'
      || (lb.mode === 'scriptprocessor' && !!lb.workletError),
    lb.workletError ? `worklet: ${lb.workletError}` : 'data: URL worklet');
    check(key, `recovered magnitude = master gain + biquad within ±${TOLERANCE_DB} dB`
      + ' (100 Hz-10 kHz)', r.points > 300 && Math.abs(r.worstDevDb) <= TOLERANCE_DB,
    `worst ${f(r.worstDevDb, 4)} dB at ${f(r.worstAtHz, 0)} Hz, mean ${f(r.meanDevDb, 4)} dB, `
      + `${r.points} points, 1 kHz ${f(r.at1k && r.at1k.db, 3)} vs ${f(r.at1k
        && r.at1k.expected, 3)} dB`);
    check(key, 'no missing frames or discontinuities', (r.integrity || []).every((x) => x
      && x.receivedFrames === x.expectedFrames && x.discontinuities === 0),
    JSON.stringify(r.integrity));
    check(key, 'progress monotonic from the audio clock', lb.progress.monotonic
      && lb.progress.count > 20 && lb.progress.last > 0.99, JSON.stringify(lb.progress));
    if (r.lags) console.log(`  INFO [${key}] pipeline lag frames ${r.lags.map((x) => f(x, 2))
      .join(', ')}; peakCorrelation ${r.peakCorrelation.map((x) => f(x, 4)).join(', ')}; `
      + `analysis ${f(r.analysis && r.analysis.totalMs, 0)} ms (longest step `
      + `${f(r.analysis && r.analysis.longestMs, 0)} ms)`);
    await page.waitForFunction(() => window.T.counts().zero, null, { timeout: 3000 })
      .catch(() => {});
    rec.afterFinish = await page.evaluate(() => window.T.counts());
    check(key, '0 active nodes/sources/captures/ports after finish', rec.afterFinish.zero,
      JSON.stringify(rec.afterFinish));

    // 2. G12: limiter/ceiling effect at measurement levels (pre-limiter vs post-chain tap).
    // Asserted where the decision relies on it: 20 Hz-18 kHz at effective output peaks up to
    // limiterTransparentPeak = 0.1. Above 18 kHz and at the loudest allowed peak (0.25) the
    // deviation is recorded (Firefox's compressor is not transparent there).
    const g12 = (rec.g12 = {});
    const G12_CASES = [['default', 0.25, 0.08, true], ['transparent-limit', 0.4, 0.25, true],
      ['loudest', 1, 0.25, false]];
    for (const [label, level, masterGain, asserted] of G12_CASES) {
      const sys = { type: 'gain', gain: 1 };
      const pre = await page.evaluate((o) => window.T.loopback(o), { seconds: 2, level,
        masterGain, tap: 'pre-limiter', system: sys, noiseCheckS: 0, keepCurve: true,
        residual: true, residualTol: SAMPLE_EXACT_TOLERANCE });
      const post = await page.evaluate((o) => window.T.loopback(o), { seconds: 2, level,
        masterGain, tap: 'post-chain', system: sys, noiseCheckS: 0, keepCurve: true });
      noteClock(key, `G12 ${label} pre-limiter`, pre);
      noteClock(key, `G12 ${label} post-chain`, post);
      const a = pre.result;
      const b = post.result;
      const worstIn = (lo, hi) => {
        let worst = 0;
        let at = null;
        if (!(a && b && a.magnitude && b.magnitude)) return { db: null, at: null };
        for (let i = 0; i < a.frequencies.length; i++) {
          const fr = a.frequencies[i];
          if (fr < lo || fr > hi) continue;
          const d = b.magnitude[i] - a.magnitude[i];
          if (Math.abs(d) > Math.abs(worst)) { worst = d; at = fr; }
        }
        return { db: worst, at };
      };
      const band = worstIn(20, 18000);
      const top = worstIn(18000, 20000);
      g12[label] = { level, masterGain, outputPeak: level * masterGain, band20to18k: band,
        band18kTo20k: top, preVsGainDb: a && a.worstDevDb, postVsGainDb: b && b.worstDevDb,
        lagPre: a && a.lags, lagPost: b && b.lags };
      const detail = `20 Hz-18 kHz worst ${f(band.db, 5)} dB at ${f(band.at, 0)} Hz; 18-20 kHz `
        + `worst ${f(top.db, 3)} dB at ${f(top.at, 0)} Hz; lag pre ${a && a.lags
          && f(a.lags[0], 1)} post ${b && b.lags && f(b.lags[0], 1)} frames`
        + (band.db === null ? `; pre: ${whyNoTransfer(pre)}; post: ${whyNoTransfer(post)}` : '');
      if (asserted) {
        check(key, `G12 ${label} (peak ${f(level * masterGain, 3)}): post-chain − pre-limiter `
          + `< ${G12_TOLERANCE_DB} dB (20 Hz-18 kHz)`, band.db !== null
          && Math.abs(band.db) < G12_TOLERANCE_DB, detail);
      } else {
        console.log(`  INFO [${key}] G12 ${label} (peak ${f(level * masterGain, 3)}): ${detail}`);
      }
      // The pre-limiter tap is the master gain alone: the capture must equal gain × stimulus
      // sample for sample, including captures whose worklet clock needed a correction.
      const res = a && a.residual;
      check(key, `G12 ${label}: pre-limiter capture sample-exact (|capture − g·stimulus| ≤ `
        + `${SAMPLE_EXACT_TOLERANCE})`, !!res && res.every((x) => x.maxAbs
        <= SAMPLE_EXACT_TOLERANCE), res ? JSON.stringify(res) : whyNoTransfer(pre));
    }

    // 3. Abort in the middle of the sweep.
    const ab = (rec.abort = await page.evaluate(() => window.T.abortMidSweep()));
    check(key, 'abort mid-sweep → ABORTED', ab.code === 'ABORTED' && ab.state === 'ABORTED',
      `${ab.code} ${ab.state} at ${ab.atAbort && f(ab.atAbort.fraction, 2)} of the sweep`);
    check(key, 'a source and a capture were active at the abort', ab.atAbort
      && ab.atAbort.counts.liveBufferSources === 1 && ab.atAbort.counts.ioCaptures === 1,
    JSON.stringify(ab.atAbort && ab.atAbort.counts));
    await page.waitForFunction(() => window.T.counts().zero, null, { timeout: 3000 })
      .catch(() => {});
    rec.afterAbort = await page.evaluate(() => window.T.counts());
    check(key, '0 active nodes/sources/captures/ports after abort (after the 10 ms fade)',
      rec.afterAbort.zero, JSON.stringify(rec.afterAbort));
    await page.evaluate(() => window.T.disposeIo());
    const aa = (rec.afterAbortRun = await page.evaluate(() => window.T.afterAbort()));
    check(key, 'run after an abort starts clean (limiter look-ahead not replayed), no '
      + 'discontinuity', aa.peakBeforeDelayedOnset === 0 && aa.discontinuities === 0,
    JSON.stringify(aa));
    const sc = (rec.staleClock = await page.evaluate(() => window.T.staleClock(200)));
    check(key, 'capture scheduled after 200 ms of work in the same task is complete',
      sc.missing === 0 && sc.discontinuities === 0, JSON.stringify(sc));
    await page.evaluate(() => window.T.disposeIo());

    // 4. Fake microphone, once per browser that has one.
    if (origin === 'http' && browserName !== 'webkit' && !micDone.has(browserName)) {
      micDone.add(browserName);
      const mic = (rec.mic = await page.evaluate(() => window.T.micCapture()));
      const c = mic.capture;
      check(key, 'fake mic: capture length = requested frames', c && c.frames === c.expected
        && c.integrity.receivedFrames === c.expected,
      c ? `${c.frames}/${c.expected} frames, mode ${mic.mode}` : JSON.stringify(mic.error));
      const ap = c && c.constraints && c.constraints.applied;
      check(key, 'fake mic: applied constraints read back (object, null when unknown)',
        !!ap && ['echoCancellation', 'noiseSuppression', 'autoGainControl'].every((k) => k in ap
          && (ap[k] === null || typeof ap[k] === 'boolean')), JSON.stringify(ap));
      check(key, 'fake mic: device label only as exposed (string or null)', c
        && (c.device.label === null || typeof c.device.label === 'string'),
      JSON.stringify(c && c.device));
      check(key, 'fake mic: cancel() stops every track and releases every node',
        mic.afterCancel.zero && mic.beforeCancel.liveTracks === 1,
      `before ${JSON.stringify(mic.beforeCancel)} after ${JSON.stringify(mic.afterCancel)}`);
    }

    // 5. Spike measurements.
    if (SPIKE) {
      const sp = (rec.spike = {});
      const lags = [];
      for (let i = 0; i < 2; i++) {
        const x = await page.evaluate(() => window.T.loopback({ seconds: 2, repeats: 3,
          noiseCheckS: 0 }));
        if (x.result && x.result.lags) lags.push(...x.result.lags);
      }
      lags.push(...(r.lags || []));
      sp.lagWorklet = lags.length ? stats(lags) : null;
      const spl = await page.evaluate(() => window.T.loopback({ seconds: 2, repeats: 3,
        noiseCheckS: 0, mode: 'scriptprocessor' }));
      sp.scriptProcessor = { mode: spl.mode, state: spl.state, error: spl.error,
        lags: spl.result && spl.result.lags, worstDevDb: spl.result && spl.result.worstDevDb,
        integrity: spl.result && spl.result.integrity };
      sp.longWorklet = await page.evaluate((o) => window.T.longCapture(o),
        { seconds: LONG_S, mode: 'auto' });
      sp.longScriptProcessor = await page.evaluate((o) => window.T.longCapture(o),
        { seconds: Math.min(LONG_S, 20), mode: 'scriptprocessor' });
      sp.analysis = {};
      for (const seconds of [10, 20]) {
        sp.analysis[`main${seconds}`] = await page.evaluate((o) => window.T.analysisMain(o),
          { seconds, sr: 48000 });
        sp.analysis[`worker${seconds}`] = await page.evaluate((o) => window.T.analysisWorker(o),
          { seconds, sr: 48000, workerSource }).catch((e) => ({ error: e.message }));
      }
      console.log(`  INFO [${key}] spike ${JSON.stringify(sp)}`);
    }
    check(key, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check(key, 'run', false, e.stack || e.message);
  } finally {
    rec.errors = errors;
    await browser.close();
  }
}

async function nodeSpike() {
  const stim = await import(pathToFileURL(path.join(SRC, 'measurement', 'stimulus.js')).href);
  const al = await import(pathToFileURL(path.join(SRC, 'measurement', 'align.js')).href);
  const tf = await import(pathToFileURL(path.join(SRC, 'measurement', 'transfer.js')).href);
  const ir = await import(pathToFileURL(path.join(SRC, 'measurement',
    'impulse-response.js')).href);
  const out = {};
  for (const [seconds, sr] of [[10, 48000], [20, 48000], [10, 96000], [20, 96000]]) {
    const st = stim.renderStimulus({ kind: 'log-sweep', sampleRate: sr, duration: seconds,
      level: 0.25, f1: 20, f2: 20000, fade: 0.01 });
    const pre = Math.round(0.5 * sr);
    const y = new Float32Array(pre + st.samples.length + Math.round(1.5 * sr));
    let z = 0;
    for (let i = 0; i < st.samples.length; i++) { z += 0.3 * (st.samples[i] - z); y[pre + i] = z; }
    const t = [];
    let t0 = performance.now();
    const a = al.align(st.samples, y, sr);
    t.push(performance.now() - t0);
    t0 = performance.now();
    tf.computeTransfer({ stimulus: st.samples, captured: y, sampleRate: sr, f1: 20, f2: 20000,
      lagSamples: a.lagSamples });
    t.push(performance.now() - t0);
    t0 = performance.now();
    ir.computeImpulseResponse({ stimulus: st.samples, captured: y, sampleRate: sr, f1: 20,
      f2: 20000, lagSamples: Math.max(0, a.lagSamples) });
    t.push(performance.now() - t0);
    out[`${seconds}s@${sr / 1000}k`] = { alignMs: t[0], transferMs: t[1], irMs: t[2],
      totalMs: t[0] + t[1] + t[2], longestMs: Math.max(...t), captureBytes: y.byteLength };
  }
  return out;
}

async function sizeSpike() {
  const app = `import './main.js';`;
  const withV3 = `import './main.js';
import * as engine from './measurement/engine.js';
import * as capture from './measurement/capture.js';
window.__v3 = { engine, capture };`;
  const opts = (contents) => ({ stdin: { contents, resolveDir: SRC, sourcefile: 'size.js' },
    bundle: true, format: 'iife', write: false, minify: true, target: 'es2020',
    logLevel: 'silent', external: ['alpinejs', 'p5', 'uplot'], legalComments: 'none' });
  const a = (await esbuild.build(opts(app))).outputFiles[0].contents;
  const b = (await esbuild.build(opts(withV3))).outputFiles[0].contents;
  const gz = (x) => zlib.gzipSync(x, { level: 9 }).length;
  const dist = fs.readFileSync(path.join(SRC, '..', '..', 'dist', 'index.html'));
  return { appRaw: a.length, appGzip: gz(a), withRaw: b.length, withGzip: gz(b),
    deltaRaw: b.length - a.length, deltaGzip: gz(b) - gz(a), distRaw: dist.length,
    distGzip: gz(dist) };
}

(async () => {
  const js = await bundle(ENTRY, 'v3-measure-entry.js');
  const workerSource = await bundle(WORKER_ENTRY, 'v3-worker-entry.js', true);
  const html = HTML(js);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscilla-v3-measure-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html);
  const server = ORIGINS.includes('http') ? await startServer(html) : null;
  const httpUrl = server ? `http://127.0.0.1:${server.address().port}/oscilla/` : null;
  const micDone = new Set();
  try {
    if (SPIKE) {
      report.node = await nodeSpike();
      report.size = await sizeSpike();
      console.log(`INFO node analysis ${JSON.stringify(report.node)}`);
      console.log(`INFO build size ${JSON.stringify(report.size)}`);
    }
    for (const b of BROWSERS) {
      for (const o of ORIGINS) {
        await runOne(b, o, o === 'file' ? pathToFileURL(file).href : httpUrl, workerSource,
          micDone);
      }
    }
  } finally {
    if (server) server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASS'} (${passes} checks passed)`);
  process.exit(failures ? 1 : 0);
})();
