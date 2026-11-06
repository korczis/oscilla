// Fixture for tests/browser/instrument-dsp.cjs (K060): bundled with esbuild (IIFE) into one
// classic <script> of a blank page. It builds a Keys -> VCO -> Master Output document through
// the one Studio store (NODE_ADD, EDGE_ADD: the Keys pitch into the VCO pitch over the Synth
// panel's normal, depth 6 octaves, bipolar, linear), runs it on the real Studio runtime and node
// adapters on an OfflineAudioContext (offline.js offlineEngine, as Render WAV does), plays notes
// through the shipped note router (studio/live-notes.js), renders, and returns plain numbers
// measured from the samples; the runner asserts. Channel 0 is the Master Output, channel 1 the
// Keys pitch output itself (the CV, octaves from A4).

import { createIdGenerator, createStudioStore } from '../../../src/js/studio/actions.js';
import { STUDIO_KIND, normalizeStudio } from '../../../src/js/studio/schema.js';
import { createStudioRuntime } from '../../../src/js/studio/runtime.js';
import { createLiveNotes } from '../../../src/js/studio/live-notes.js';
import { offlineEngine } from '../../../src/js/studio/offline.js';
import {
  PITCH_CLIP_POINTS, PITCH_SPAN_OCT, pitchCeilingOct, vcoBaseHz,
} from '../../../src/js/studio/adapters/instrument.js';
import { RENDER_QUANTUM, SAFE_NYQUIST_FACTOR } from '../../../src/js/core/constants.js';

/** The rates the renders request; every figure reads the rendered buffer's own sampleRate. */
// timing-allow: the OfflineAudioContext render rates the criterion names (44.1 and 48 kHz)
const RATES = [44100, 48000];
const T0 = 0.1; // the first note, after the runtime's start lead and fade-in

/** The document: Keys (glide) -> VCO (sine, scale) -> Master Output, through the store. */
function documentOf({ scale = '8', glide = 0 }) {
  const empty = normalizeStudio({ kind: STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = createStudioStore(empty, { idGenerator: createIdGenerator(empty) });
  const must = (r, what) => {
    if (!r.ok) throw new Error(`${what}: ${r.reason}`);
    return r;
  };
  const add = (nodeType) => must(st.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } }), nodeType).created.nodes[0];
  const keys = add('keys');
  const vco = add('vco');
  const out = add('master');
  must(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: keys, key: 'glide', value: glide }),
    'glide');
  must(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: vco, params: { waveform: 'sine',
    scale } }), 'vco');
  must(st.dispatch({ type: 'EDGE_ADD', from: { node: keys, port: 'pitch' },
    to: { node: vco, port: 'pitch' },
    props: { depth: 6, polarity: 'bipolar', mapping: 'linear' } }), 'pitch edge');
  must(st.dispatch({ type: 'EDGE_ADD', from: { node: vco, port: 'audio' },
    to: { node: out, port: 'audio' } }), 'audio edge');
  return { model: st.getModel(), keys, vco };
}

/**
 * Render `events` ([t, 'on' | 'off', note]) on the document at `sampleRate` for `seconds`.
 * -> { audio, cv, sampleRate, results, runtime: debugInfo after scheduling }
 */
async function render({ sampleRate, seconds, scale, glide, events }) {
  const { model, keys } = documentOf({ scale, glide });
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const merge = ctx.createChannelMerger(2);
  merge.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(merge, 0, 0);
  const engine = offlineEngine(ctx, master);
  const runtime = createStudioRuntime({ engine });
  const applied = runtime.apply(model, { revision: 1 });
  if (!applied.ok) throw new Error(`apply: ${applied.reason}`);
  const started = runtime.start();
  if (!started.ok) throw new Error(`start: ${started.reason}`);
  const h = runtime.nodes.get(keys);
  h.outputs.pitch.connect(merge, 0, 1); // the CV probe, beside the edge it already feeds
  const live = createLiveNotes({ getModel: () => model, handleOf: (id) => runtime.nodes.get(id) });
  const results = events.map(([at, kind, note]) => live.event(keys, { kind, note,
    velocity: 100, at }));
  const debug = runtime.debugInfo();
  const buf = await ctx.startRendering();
  return { audio: buf.getChannelData(0), cv: buf.getChannelData(1), sampleRate: buf.sampleRate,
    results, debug, keys };
}

/**
 * The frequency of a sine between t0 and t1 from its rising zero crossings, each placed by
 * linear interpolation between the two samples around it: the period is the least-squares
 * slope of the crossing times over their index, so the interpolation error of each crossing
 * (largest near Nyquist, a few samples per period) averages out instead of entering through
 * the first and the last. -> { hz, periods } (hz null with fewer than 3 crossings)
 */
function zeroCrossingHz(x, sr, t0, t1) {
  const i0 = Math.max(1, Math.ceil(t0 * sr));
  const i1 = Math.min(x.length, Math.floor(t1 * sr));
  const ts = [];
  for (let i = i0; i < i1; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) ts.push((i - 1 + x[i - 1] / (x[i - 1] - x[i])) / sr);
  }
  const n = ts.length;
  if (n < 3) return { hz: null, periods: n - 1 };
  const km = (n - 1) / 2;
  const tm = ts.reduce((s, t) => s + t, 0) / n;
  let num = 0;
  let den = 0;
  for (let k = 0; k < n; k++) {
    num += (k - km) * (ts[k] - tm);
    den += (k - km) ** 2;
  }
  return { hz: den / num, periods: n - 1 };
}

const cents = (hz, ref) => (hz ? 1200 * Math.log2(hz / ref) : null);
const midiHz = (n) => 440 * 2 ** ((n - 69) / 12);
/** The VCO's clamp: the highest pitch-clip grid point at or below 0.95 x Nyquist (adapter). */
function clampHz(scale, sr) {
  const mid = (PITCH_CLIP_POINTS - 1) / 2;
  const ceil = pitchCeilingOct(vcoBaseHz(scale), sr);
  const knee = (Math.floor((ceil / PITCH_SPAN_OCT) * mid + 1e-9) / mid) * PITCH_SPAN_OCT;
  return vcoBaseHz(scale) * 2 ** knee;
}

/**
 * Notes held one after another (non-legato: each released before the next), each long enough
 * for `periods` of its expected frequency and at least `minS`; measured over the segment less a
 * settle time at its start. -> [{ note, expected, hz, cents, periods }]
 */
async function track({ notes, scale = '8', sampleRate, periods = 40, minS = 0.08 }) {
  const ceiling = clampHz(scale, sampleRate);
  const exact = (n) => vcoBaseHz(scale) / 440 * midiHz(n);
  const expectedOf = (n) => Math.min(exact(n), ceiling);
  const settle = 0.01;
  const segs = [];
  let t = T0;
  for (const note of notes) {
    const len = Math.max(minS, periods / expectedOf(note)) + 2 * settle;
    segs.push({ note, t0: t, t1: t + len });
    t += len;
  }
  const events = segs.flatMap((s) => [[s.t0, 'on', s.note], [s.t1, 'off', s.note]]);
  const r = await render({ sampleRate, seconds: t + 0.05, scale, glide: 0, events });
  const stated = (r.debug.notes || []).find((x) => x.id === r.keys);
  return { sampleRate: r.sampleRate, clampHz: ceiling, stated: stated ? stated.clamp : null,
    nyquist95: (SAFE_NYQUIST_FACTOR * r.sampleRate) / 2,
    refused: r.results.filter((x) => !x.ok).map((x) => x.reason),
    rows: segs.map((s) => {
      const m = zeroCrossingHz(r.audio, r.sampleRate, s.t0 + settle, s.t1 - settle);
      const expected = expectedOf(s.note);
      return { note: s.note, expected, exact: exact(s.note), hz: m.hz,
        cents: cents(m.hz, expected), periods: m.periods };
    }) };
}

/**
 * A legato glide of `glide` s from `from` to `to` (both held), at sampleRate: the Keys CV and
 * the VCO frequency around t + glide. -> { quantumS, cvAt: [{ dt, cents }], hzAfter, ... }
 */
async function glide({ from = 57, to = 69, glide: g = 0.1, sampleRate }) {
  const t = T0 + 0.3;
  const r = await render({ sampleRate, seconds: t + g + 0.4, scale: '8', glide: g,
    events: [[T0, 'on', from], [t, 'on', to]] });
  const sr = r.sampleRate;
  const q = RENDER_QUANTUM / sr;
  const target = (to - 69) / 12;
  const cvAt = (time) => r.cv[Math.min(r.cv.length - 1, Math.round(time * sr))];
  const centsOff = (time) => 1200 * (cvAt(time) - target);
  // Where the CV first comes within one cent of the target, from t on.
  let arrive = null;
  for (let i = Math.round(t * sr); i < r.cv.length; i++) {
    if (Math.abs(1200 * (r.cv[i] - target)) <= 1) { arrive = i / sr; break; }
  }
  const half = 1200 * (cvAt(t + g / 2) - ((from + to) / 2 - 69) / 12);
  const after = zeroCrossingHz(r.audio, sr, t + g + q, t + g + q + 0.1);
  const before = zeroCrossingHz(r.audio, sr, T0 + 0.05, t - 0.01);
  return { sampleRate: sr, quantumS: q, glideS: g, startS: t, arriveS: arrive,
    arriveLateS: arrive === null ? null : arrive - (t + g),
    centsAtGlide: centsOff(t + g), centsAtGlidePlusQuantum: centsOff(t + g + q),
    centsAtHalfFromMidpoint: half,
    hzAfter: after.hz, centsAfter: cents(after.hz, midiHz(to)),
    centsBefore: cents(before.hz, midiHz(from)) };
}

window.K = { RATES, track, glide, clampHz, midiHz };
