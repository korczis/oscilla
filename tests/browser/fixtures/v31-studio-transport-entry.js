// Fixture for tests/browser/v31-studio-transport.cjs: bundled with esbuild (IIFE) into one
// classic <script> of a single file:// page. It reuses the Studio audio fixture
// (v31-studio-audio-entry.js: node/connection/source instrumentation, the frame-indexed output
// tap on engine.analyser, T.start, T.counts, T.until) and adds the transport routines. Every
// routine returns plain numbers; the runner asserts. Waiting is on the audio clock (T.until).

import './v31-studio-audio-entry.js';
import { nodeQ } from '../../../src/js/audio/filters.js';
import { createIdGenerator, createStudioStore } from '../../../src/js/studio/actions.js';
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

async function settle(transport) {
  const now = T.engine.ctx.currentTime;
  await T.until(now + 2, () => T.runtime.debugInfo().pendingCleanups === 0
    && T.probe.sources.size === 0 && !transport.playing);
  return T.counts();
}

/**
 * The Basic Synth template (OSC → ADSR → FILTER → MASTER, LFO → cutoff, Tone 0-1 s, Sweep
 * 1-3 s, cutoff automation 500 Hz → 8 kHz) played by the transport:
 *   onsets / boundaries / end of the clips on the audio clock (10 ms RMS windows),
 *   the pattern-played oscillator (no free-running 220 Hz carrier inside the sweep),
 *   the 8th-harmonic ratio of the Tone clip at 0.15 s and 0.85 s against the browser's own
 *   biquad response at the predicted cutoff (automation × LFO), and the counts after STOP.
 */
T.basicSynth = async () => {
  const sr = T.engine.ctx.sampleRate;
  const model = templateModel(REFERENCE_TEMPLATE_ID);
  const store = createStudioStore(model, { idGenerator: createIdGenerator(model) });
  let claims = 0;
  const transport = createStudioTransport({ runtime: T.runtime, engine: T.engine, store,
    onClaimOutput: () => { claims += 1; } });
  const started = transport.start();
  if (!started.ok) throw new Error(`start: ${started.reason}`);
  const b = started.baseTime;
  await T.until(b + 3.4);
  const peak = T.counts();
  // RMS envelope in 2 ms windows from b − 0.05 to b + 3.3.
  const step = 0.002;
  const env = [];
  for (let t = b - 0.05; t < b + 3.3; t += step) env.push([t, rms(window_(t, t + step))]);
  const ref = rms(window_(b + 0.3, b + 0.7));
  const thr = ref * 10 ** (-40 / 20);
  const first = env.find(([, v]) => v > thr);
  const last = [...env].reverse().find(([, v]) => v > thr);
  const dip = env.filter(([t]) => t > b + 0.98 && t < b + 1.02)
    .reduce((m, x) => (x[1] < m[1] ? x : m), [0, Infinity]);
  const tail = rms(window_(b + 3.1, b + 3.3));
  // Inside the sweep at clip time 1.0 s (440 Hz): the free-running carrier (220 Hz) is gone.
  const mid = window_(b + 1.95, b + 2.05);
  const sweepAt = { f440: amplitudeAt(mid, 440, sr), f220: amplitudeAt(mid, 220, sr) };
  // Cutoff over the Tone clip: automation 500·16^(t/3), LFO ±1 octave at 0.5 Hz (sine, phase 0
  // at the graph start b): cutoff(t) = 500·16^(t/3)·2^sin(πt).
  const node = (id) => model.graph.nodes.find((n) => n.id === id);
  const Q = node('filter-1').params.Q;
  const cutoff = (t) => 500 * 16 ** (t / 3) * 2 ** Math.sin(Math.PI * t);
  const ratioAt = (t) => {
    const w = window_(b + t - 0.025, b + t + 0.025);
    return db(amplitudeAt(w, 8 * 220, sr) / amplitudeAt(w, 220, sr));
  };
  const expectedRatio = (t) => db(biquadMag('lowpass', cutoff(t), Q, 8 * 220)
    / biquadMag('lowpass', cutoff(t), Q, 220)) - db(8); // sawtooth: harmonic k at 1/k
  const spectrum = { early: ratioAt(0.15), late: ratioAt(0.85),
    expectedEarly: expectedRatio(0.15), expectedLate: expectedRatio(0.85) };
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
  return { b, claims, peak, onset: first ? first[0] - b : null, end: last ? last[0] + step - b
    : null, dip: dip[0] - b, dipDb: db(dip[1] / ref), tailDb: db(tail / ref), sweepAt,
  spectrum, counts, stopped, cycles, debug: transport.debugInfo().unplayed };
};
