// Fixture for tests/browser/v31-studio-transport.cjs: bundled with esbuild (IIFE) into one
// classic <script> of a single file:// page. It reuses the Studio audio fixture
// (v31-studio-audio-entry.js: node/connection/source instrumentation, the frame-indexed output
// tap on engine.analyser, T.start, T.counts, T.until) and adds the transport routines. Every
// routine returns plain numbers; the runner asserts. Waiting is on the audio clock (T.until).
//
// Two taps. engine.analyser (the audio fixture's) is what reaches the destination: it lies after
// the engine's limiter, a DynamicsCompressorNode whose look-ahead delays everything by 6 ms
// (measured: 288 frames at 48 kHz in chromium, firefox and webkit) and which in firefox also
// lags the first few ms after silence. The Studio's clock is therefore measured on a second
// tap at engine.master, the head of the safety chain where the Studio's Master Output bus
// enters it (the same worklet processor, created as fixture-internal: it is not counted).

import './v31-studio-audio-entry.js';
import { adsrEvents, valueAtTime } from '../../../src/js/audio/envelope.js';
import { nodeQ } from '../../../src/js/audio/filters.js';
import { automationValueAt } from '../../../src/js/sequencer/compiler.js';
import { createIdGenerator, createStudioStore } from '../../../src/js/studio/actions.js';
import { STUDIO_XFADE_S } from '../../../src/js/studio/compiler.js';
import { compileTimeline } from '../../../src/js/studio/timeline-compiler.js';
import { REFERENCE_TEMPLATE_ID, templateModel } from '../../../src/js/studio/templates/index.js';
import { createStudioTransport } from '../../../src/js/studio/transport.js';

const T = window.T;
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

/** Amplitude of the component at f Hz (Goertzel, Hann window, amplitude-corrected). */
function amplitudeAt(data, f, sr) {
  const n = data.length;
  const w = (2 * Math.PI * f) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    wsum += h;
    const s0 = data[i] * h + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const re = s1 - s2 * Math.cos(w);
  const im = s2 * Math.sin(w);
  return (2 * Math.sqrt(re * re + im * im)) / wsum;
}

function rms(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, data.length));
}

const window_ = (t0, t1) => Float32Array.from(T.samples(t0, t1));

/** |H(f)| of a reference biquad (the browser's own response for the same settings). */
function biquadMag(type, fc, qLinear, f) {
  const ref = T.engine.ctx.createBiquadFilter();
  ref.type = type;
  ref.frequency.value = fc;
  ref.Q.value = nodeQ(type, qLinear);
  const mag = new Float32Array(1);
  const ph = new Float32Array(1);
  ref.getFrequencyResponse(Float32Array.of(f), mag, ph);
  return mag[0];
}

// ---------------------------------------------------------------- pre-limiter tap
const pre = { node: null, chunks: [], end: 0, waiters: [] };

function installPreTap() {
  if (pre.node) return;
  const ctx = T.engine.ctx;
  T.probe.internal = true;
  try {
    pre.node = new AudioWorkletNode(ctx, 'oscilla-studio-tap', { numberOfInputs: 1,
      numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const sink = ctx.createGain();
    sink.gain.value = 0;
    T.engine.master.connect(pre.node);
    pre.node.connect(sink);
    sink.connect(ctx.destination);
  } finally {
    T.probe.internal = false;
  }
  pre.node.port.onmessage = (e) => {
    pre.chunks.push({ f: e.data.f, L: e.data.L });
    if (pre.chunks.length > 2000) pre.chunks.shift();
    pre.end = (e.data.f + e.data.L.length) / ctx.sampleRate;
    pre.waiters = pre.waiters.filter((w) => {
      if (pre.end < w.t) return true;
      w.resolve(true);
      return false;
    });
  };
}

const preUntil = (t) => (pre.end >= t ? Promise.resolve(true)
  : new Promise((resolve) => pre.waiters.push({ t, resolve })));

function preWindow(t0, t1) {
  const sr = T.engine.ctx.sampleRate;
  const f0 = Math.round(t0 * sr);
  const f1 = Math.round(t1 * sr);
  const out = new Float32Array(Math.max(0, f1 - f0));
  for (const c of pre.chunks) {
    const a = Math.max(f0, c.f);
    const b = Math.min(f1, c.f + c.L.length);
    if (b > a) out.set(c.L.subarray(a - c.f, b - c.f), a - f0);
  }
  return out;
}

// ---------------------------------------------------------------- detector
// RMS envelope in DETECT_STEP_S windows from b − 0.05 to b + 3.3 against −40 dB of the Tone's
// level (b + 0.3 … b + 0.7): onset = start of the first window above, end = end of the last
// window above, dip = the quietest window in b + 1 ± 0.02 s; beforeDb = the peak before b.
// fineDip / fineEnd: the same in FINE_STEP_S windows on a grid from b (boundary ± 10 ms,
// end ± 10 ms), fine enough to tell a one-render-quantum (2.67 ms) shift.
const DETECT_STEP_S = 0.002;
const FINE_STEP_S = 0.0005;
const DETECT_FROM_S = -0.05;
const DETECT_DB = -40;
const REF_WINDOW = [0.3, 0.7];

function detect(get, b) {
  const env = [];
  for (let t = b + DETECT_FROM_S; t < b + 3.3; t += DETECT_STEP_S) {
    env.push([t, rms(get(t, t + DETECT_STEP_S))]);
  }
  const ref = rms(get(b + REF_WINDOW[0], b + REF_WINDOW[1]));
  const thr = ref * 10 ** (DETECT_DB / 20);
  const first = env.find(([, v]) => v > thr);
  const last = [...env].reverse().find(([, v]) => v > thr);
  const dip = env.filter(([t]) => t > b + 0.98 && t < b + 1.02)
    .reduce((m, x) => (x[1] < m[1] ? x : m), [0, Infinity]);
  let peakBefore = 0;
  for (const x of get(b + DETECT_FROM_S, b)) peakBefore = Math.max(peakBefore, Math.abs(x));
  // Fine: FINE_STEP_S windows on a grid from b, around the boundary and the end.
  const fine = (from, to) => {
    const out = [];
    for (let n = Math.round(from / FINE_STEP_S); n * FINE_STEP_S < to; n++) {
      const t = b + n * FINE_STEP_S;
      out.push([t, rms(get(t, t + FINE_STEP_S))]);
    }
    return out;
  };
  const fineDip = fine(0.99, 1.01).reduce((m, x) => (x[1] < m[1] ? x : m), [0, Infinity]);
  const fineLast = fine(2.99, 3.01).reverse().find(([, v]) => v > thr);
  return { ref, onset: first ? first[0] - b : null,
    end: last ? last[0] + DETECT_STEP_S - b : null, dip: dip[0] - b, dipDb: db(dip[1] / ref),
    fineDip: fineDip[0] - b, fineEnd: fineLast ? fineLast[0] + FINE_STEP_S - b : null,
    beforeDb: db(peakBefore / ref) };
}

/**
 * Where the detector must find the Tone's onset (§212: the clip starts where its voice envelope
 * leaves the floor, at baseTime), derived from the documented start ramps, all of which begin at
 * baseTime because runtime.start's crossfade time is the transport anchor:
 *   - every AUDIO route on the path OSC → … → MASTER and the Master Output bus ramp linearly
 *     0 → 1 over STUDIO_XFADE_S (runtime crossfade, adapters/ramp.js);
 *   - the Envelope (no gate edge: opened at the graph start) runs its ADSR from the floor
 *     (audio/envelope.js adsrEvents: linear attack, exponential decay to the sustain);
 *   - the clip's voice envelope leaves GAIN_FLOOR at the clip start and reaches 1 after EDGE_S
 *     (its compiled plan, sequencer/compiler.js, evaluated with automationValueAt);
 *   - the sawtooth through the low-pass at the automated + LFO cutoff (the browser's own biquad
 *     response, harmonic k at 1/k).
 * The predicted window RMS goes through the measurement's window grid and threshold. The product
 * rises like t^6 from baseTime (four ramps × the attack × the edge): the first window above
 * −40 dB starts 6 ms after baseTime at 48 kHz although nothing sounds before baseTime.
 */
function predictedOnset(model, cutoff, Q, sr) {
  const nodeOf = (id) => model.graph.nodes.find((n) => n.id === id);
  const walk = (id, n) => { // audio routes from the oscillator to the Master
    if (nodeOf(id).type === 'master') return n;
    for (const e of model.graph.edges) {
      if (e.from.node !== id || e.from.port !== 'audio' || e.to.port !== 'audio') continue;
      const r = walk(e.to.node, n + 1);
      if (r !== null) return r;
    }
    return null;
  };
  const routes = walk('osc-1', 0);
  const ramps = routes + 1; // + the Master Output bus fade
  const p = nodeOf('env-1').params;
  const adsr = adsrEvents(0, { a: p.attack, d: p.decay, s: p.sustain, r: p.release });
  const tl = compileTimeline(model, { sampleRate: sr, baseTime: 0 });
  const voiceEnv = tl.items[0].events.filter((e) => e.kind === 'gain')
    .map((e) => ({ t: e.time, value: e.value, ramp: e.ramp }));
  const gainAt = (t) => (t < 0 ? 0 : Math.min(1, t / STUDIO_XFADE_S) ** ramps
    * valueAtTime(adsr, t) * automationValueAt(voiceEnv, t, 0));
  // Filtered sawtooth RMS at cutoff c (common factors cancel against the reference).
  const K = Math.floor((0.5 * sr) / 220);
  const harmonics = Float32Array.from({ length: K }, (_, i) => 220 * (i + 1));
  const sawRms = (c) => {
    const f = T.engine.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = c;
    f.Q.value = nodeQ('lowpass', Q);
    const mag = new Float32Array(K);
    f.getFrequencyResponse(harmonics, mag, new Float32Array(K));
    let s = 0;
    for (let k = 0; k < K; k++) s += (mag[k] / (k + 1)) ** 2;
    return Math.sqrt(s);
  };
  let refSq = 0;
  let n = 0;
  for (let t = REF_WINDOW[0]; t < REF_WINDOW[1]; t += 0.01, n++) {
    refSq += (gainAt(t) * sawRms(cutoff(t))) ** 2;
  }
  const thr = Math.sqrt(refSq / n) * 10 ** (DETECT_DB / 20);
  for (let t = DETECT_FROM_S; t < 0.05; t += DETECT_STEP_S) {
    const f0 = Math.round(t * sr);
    const f1 = Math.round((t + DETECT_STEP_S) * sr);
    let sq = 0;
    for (let f = f0; f < f1; f++) sq += gainAt(f / sr) ** 2;
    if (Math.sqrt(sq / (f1 - f0)) * sawRms(cutoff(Math.max(0, t))) > thr) {
      return { onset: t, routes, ramps };
    }
  }
  return { onset: null, routes, ramps };
}

async function settle(transport) {
  const now = T.engine.ctx.currentTime;
  await T.until(now + 2, () => T.runtime.debugInfo().pendingCleanups === 0
    && T.probe.sources.size === 0 && !transport.playing);
  return T.counts();
}

/**
 * The Basic Synth template (OSC → ADSR → FILTER → MASTER, LFO → cutoff, Tone 0-1 s, Sweep
 * 1-3 s, cutoff automation 500 Hz → 8 kHz) played by the transport:
 *   onset / boundary / end of the clips on the audio clock (2 ms RMS windows) on both taps,
 *   with the onset the start ramps predict (predictedOnset),
 *   the pattern-played oscillator (no free-running 220 Hz carrier inside the sweep),
 *   the 8th-harmonic ratio of the Tone clip at 0.15 s and 0.85 s against the browser's own
 *   biquad response at the predicted cutoff (automation × LFO), and the counts after STOP.
 */
T.basicSynth = async () => {
  const sr = T.engine.ctx.sampleRate;
  installPreTap();
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  let claims = 0;
  const transport = createStudioTransport({ runtime: T.runtime, engine: T.engine, store,
    onClaimOutput: () => { claims += 1; } });
  const started = transport.start();
  if (!started.ok) throw new Error(`start: ${started.reason}`);
  const b = started.baseTime;
  await T.until(b + 3.4);
  await preUntil(b + 3.4);
  const peak = T.counts();
  // The Studio's clock (pre-limiter) and what reaches the destination (post-limiter).
  const studio = detect(preWindow, b);
  const out = detect(window_, b);
  const ref = out.ref;
  const tail = rms(window_(b + 3.1, b + 3.3));
  // Inside the sweep at clip time 1.0 s (440 Hz): the free-running carrier (220 Hz) is gone.
  const mid = window_(b + 1.95, b + 2.05);
  const sweepAt = { f440: amplitudeAt(mid, 440, sr), f220: amplitudeAt(mid, 220, sr) };
  // Cutoff over the Tone clip: automation 500·16^(t/3), LFO ±1 octave at 0.5 Hz (sine, phase 0
  // at the graph start b): cutoff(t) = 500·16^(t/3)·2^sin(πt).
  const node = (id) => model.graph.nodes.find((n) => n.id === id);
  const Q = node('filter-1').params.Q;
  const cutoff = (t) => 500 * 16 ** (t / 3) * 2 ** Math.sin(Math.PI * t);
  const predicted = predictedOnset(model, cutoff, Q, sr);
  const ratioAt = (t) => {
    const w = window_(b + t - 0.025, b + t + 0.025);
    return db(amplitudeAt(w, 8 * 220, sr) / amplitudeAt(w, 220, sr));
  };
  const expectedRatio = (t) => db(biquadMag('lowpass', cutoff(t), Q, 8 * 220)
    / biquadMag('lowpass', cutoff(t), Q, 220)) - db(8); // sawtooth: harmonic k at 1/k
  const spectrum = { early: ratioAt(0.15), late: ratioAt(0.85),
    expectedEarly: expectedRatio(0.15), expectedLate: expectedRatio(0.85) };
  const skippedLate = transport.debugInfo().skippedLate;
  const done = transport.stop();
  const atStop = T.engine.ctx.currentTime;
  await T.until(atStop + 0.2);
  const counts = await done;
  const stopped = await settle(transport);
  // PLAY → STOP → PLAY: no growth.
  const cycles = [];
  for (let i = 0; i < 3; i++) {
    const r = transport.start();
    await T.until(r.baseTime + 1.5);
    const p = T.counts();
    const d = transport.stop();
    await T.until(T.engine.ctx.currentTime + 0.2);
    await d;
    cycles.push({ peak: p, after: await settle(transport) });
  }
  const strip = ({ ref: _ref, ...d }) => d;
  return { b, claims, peak, skippedLate, studio: strip(studio), out: strip(out), predicted,
    detectStepS: DETECT_STEP_S, fineStepS: FINE_STEP_S, tailDb: db(tail / ref), sweepAt,
    spectrum, counts, stopped, cycles, debug: transport.debugInfo().unplayed };
};
