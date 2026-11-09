// Fixture for tests/browser/instrument-dsp.cjs (K060, K068): bundled with esbuild (IIFE) into one
// classic <script> of a blank page. It builds a Keys -> VCO -> Master Output document through
// the one Studio store (NODE_ADD, EDGE_ADD: the Keys pitch into the VCO pitch over the Synth
// panel's normal, depth 6 octaves, bipolar, linear), runs it on the real Studio runtime and node
// adapters on an OfflineAudioContext (offline.js offlineEngine, as Render WAV does), plays notes
// through the shipped note router (studio/live-notes.js), renders, and returns plain numbers
// measured from the samples; the runner asserts. Channel 0 is the Master Output, channel 1 the
// Keys pitch output itself (the CV, octaves from A4).
//
// K068 (renderNotes): a Keys -> VCO -> Envelope -> Master Output document with the Keys Gate on
// the Envelope's gate and one notes clip on an event track on the Keys node, played by the
// Studio TRANSPORT itself on the OfflineAudioContext with the render length as its look-ahead,
// as offline.js renderStudioOffline plays it (the one compile path, timeline-compiler.js). Its
// channels: 0 the Master Output, 1 the Envelope's contour (each gate onset starts a rise of
// it), 2 the Keys pitch CV. Onsets are measured from the contour: the frame before each rise
// that follows a frame without one. The expected frames are computed here, independently of
// the code under test: baseTime + beats x 60 / tempo (swing on odd grid positions), and the
// probability draws with core/math.js mulberry32 directly. census*: the same document on a
// running AudioContext (the real AudioEngine), so the runner can STOP it with a ratchet
// pending and read the node census once the stop resolves.
//
// K230 (dadsr): the same notes document with the Envelope's delay and hold set, one note held
// past every stage; its contour against the stage times computed here from the parameters.

import { AudioEngine } from '../../../src/js/audio/audio-engine.js';
import { mulberry32 } from '../../../src/js/core/math.js';
import { createIdGenerator, createStudioStore } from '../../../src/js/studio/actions.js';
import { createStudioTransport } from '../../../src/js/studio/transport.js';
import { STUDIO_KIND, normalizeStudio } from '../../../src/js/studio/schema.js';
import { createStudioRuntime } from '../../../src/js/studio/runtime.js';
import { createLiveNotes } from '../../../src/js/studio/live-notes.js';
import { offlineEngine } from '../../../src/js/studio/offline.js';
import {
  PITCH_CLIP_POINTS, PITCH_SPAN_OCT, pitchCeilingOct, vcoBaseHz,
} from '../../../src/js/studio/adapters/instrument.js';
import { RENDER_QUANTUM, SAFE_NYQUIST_FACTOR } from '../../../src/js/core/constants.js';
import { ENVELOPE_FLOOR } from '../../../src/js/audio/envelope.js';

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

// ------------------------------------------------------------------------------ K068: notes

const ADSR = { attack: 0.002, decay: 0.01, sustain: 0.5, release: 0.005 };

/** The K068 document (see the header) at `tempo` with the notes clip `{ notes, grid }`. */
function notesDocument({ tempo = 120, notes, grid = null, glide = 0, beats = 4, adsr = ADSR }) {
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
  const env = add('envelope');
  const out = add('master');
  must(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: keys, key: 'glide', value: glide }), 'glide');
  must(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: vco, params: { waveform: 'sine' } }), 'vco');
  must(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: env, params: adsr }), 'envelope');
  const edge = (from, fp, to, tp, props) => must(st.dispatch({ type: 'EDGE_ADD',
    from: { node: from, port: fp }, to: { node: to, port: tp }, props }), `${fp} edge`);
  edge(keys, 'pitch', vco, 'pitch', { depth: 6, polarity: 'bipolar', mapping: 'linear' });
  edge(keys, 'gate', env, 'gate');
  edge(vco, 'audio', env, 'audio');
  edge(env, 'audio', out, 'audio');
  must(st.dispatch({ type: 'TRANSPORT_SET', tempo }), 'tempo');
  const trackId = must(st.dispatch({ type: 'TRACK_ADD', kind: 'event', target: keys }), 'track')
    .created.tracks[0];
  must(st.dispatch({ type: 'CLIP_ADD', trackId, kind: 'notes', startBeats: 0,
    durationBeats: beats, payload: grid ? { notes, grid } : { notes } }), 'notes clip');
  return { model: st.getModel(), keys, env, store: st };
}

/** A read-only store of one model, as offline.js gives its transport. */
const fixedStore = (model) => ({ getModel: () => model, getRevision: () => 0,
  dispatch: () => ({ ok: false, reason: 'read-only' }) });

/**
 * The frame before each rise of `x` that follows a frame without one: the gate onsets. A rise
 * is more than `eps` per frame: an attack of 2 ms rises some 0.005 a frame at 48 kHz, while the
 * contour's own start (0 to the envelope floor, 1e-4, where the graph starts) does not count.
 */
function onsetFrames(x, eps = 1e-3) {
  const out = [];
  for (let i = 2; i < x.length; i++) {
    if (x[i] - x[i - 1] > eps && !(x[i - 1] - x[i - 2] > eps)) out.push(i - 1);
  }
  return out;
}

/**
 * Render the K068 document offline through the Studio transport (see the header) for
 * `seconds` at `sampleRate`. -> { sampleRate, baseFrame, onsets (frames), contour, cv,
 *    unplayed, spb (seconds per beat) }
 */
async function renderNotes({ sampleRate, seconds = 3, ...doc }) {
  const { model, keys, env } = notesDocument(doc);
  const ctx = new OfflineAudioContext(3, Math.ceil(seconds * sampleRate), sampleRate);
  const merge = ctx.createChannelMerger(3);
  merge.connect(ctx.destination);
  const master = ctx.createGain();
  master.connect(merge, 0, 0);
  const engine = offlineEngine(ctx, master);
  const runtime = createStudioRuntime({ engine });
  const transport = createStudioTransport({ runtime, engine, store: fixedStore(model),
    lookAheadS: seconds });
  const started = transport.start();
  if (!started.ok) throw new Error(`PLAY: ${started.reason}`);
  runtime.nodes.get(env).outputs.control.connect(merge, 0, 1);
  runtime.nodes.get(keys).outputs.pitch.connect(merge, 0, 2);
  const unplayed = transport.debugInfo().unplayed;
  const buf = await ctx.startRendering();
  const sr = buf.sampleRate;
  const contour = buf.getChannelData(1);
  return { sampleRate: sr, baseFrame: Math.round(started.baseTime * sr),
    onsets: onsetFrames(contour), contour, cv: buf.getChannelData(2), unplayed,
    spb: 60 / model.transport.tempo };
}

/** The frame of `beats` into the clip: baseTime + beats x 60 / tempo, on whole frames. */
const frameOf = (r, beats) => r.baseFrame + Math.round(beats * r.spb * r.sampleRate);
/** Each expected frame against its nearest measured onset: [{ beats, want, got, diff }]. */
function against(r, beatsList) {
  return beatsList.map((beats) => {
    const want = frameOf(r, beats);
    let got = null;
    for (const f of r.onsets) if (got === null || Math.abs(f - want) < Math.abs(got - want)) got = f;
    return { beats, want, got, diff: got === null ? null : got - want };
  });
}

/**
 * Sixteenths with swing on the grid, and one off-grid note, at `tempo`: the measured onsets
 * against the computed ones. -> { sampleRate, count, expected, rows, offGrid, interval }
 */
async function swingGrid({ sampleRate, tempo, swing }) {
  const notes = [];
  for (let i = 0; i < 8; i++) notes.push({ at: i * 0.25, note: 60 + i, len: 0.15, vel: 0.8 });
  notes.push({ at: 2.1, note: 72, len: 0.1, vel: 0.8 }); // off the grid: never swung
  const r = await renderNotes({ sampleRate, tempo, notes,
    grid: { stepBeats: 0.25, swing, seed: 0 } });
  const beats = notes.map((x) => x.at + (x.at < 2 && (x.at / 0.25) % 2 === 1 ? swing * 0.25 : 0));
  const rows = against(r, beats);
  const even = rows.filter((x, i) => i < 8 && i % 2 === 0);
  return { sampleRate: r.sampleRate, count: r.onsets.length, expected: beats.length, rows,
    offGrid: rows[8], unplayed: r.unplayed.length,
    // Between two even (unswung) steps: half a beat, in frames, as measured.
    interval: (even[even.length - 1].got - even[0].got) / (even.length - 1) };
}

/** r 3: three onsets inside one note. */
async function ratchet({ sampleRate }) {
  const r = await renderNotes({ sampleRate, notes: [{ at: 1, note: 64, len: 0.75, vel: 0.8,
    r: 3 }] });
  return { sampleRate: r.sampleRate, count: r.onsets.length, rows: against(r, [1, 1.25, 1.5]) };
}

/**
 * A slide into a held note: no gate onset at the slide, and the Keys CV reaching the slide's
 * pitch within Glide of its onset (linear). -> { onsets, rows, arriveFrames, glideFrames, ... }
 */
async function slide({ sampleRate, glide: g = 0.05 }) {
  const r = await renderNotes({ sampleRate, glide: g, notes: [
    { at: 0, note: 60, len: 1, vel: 0.8 }, { at: 1, note: 67, len: 1, vel: 0.8, slide: true }] });
  const t1 = frameOf(r, 1);
  const target = (67 - 69) / 12;
  let arrive = null;
  for (let i = t1; i < r.cv.length; i++) {
    if (Math.abs(1200 * (r.cv[i] - target)) <= 1) { arrive = i; break; }
  }
  const glideFrames = Math.round(g * r.sampleRate);
  const half = r.cv[t1 + Math.round(glideFrames / 2)];
  return { sampleRate: r.sampleRate, count: r.onsets.length, rows: against(r, [0]),
    slideOnsets: r.onsets.filter((f) => Math.abs(f - t1) <= 2).length, arriveFrames:
      arrive === null ? null : arrive - t1, glideFrames,
    centsHalf: 1200 * (half - ((60 + 67) / 2 - 69) / 12) };
}

/**
 * p 0.5 on sixteen notes: two renders with one seed, and one with another. -> { same, differs,
 *    hits (measured steps), want (the steps whose pass-0 draw, ADR 0086's noteDraw re-derived,
 *    is below 0.5) }
 */
async function chance({ sampleRate, seed = 1, other = 2 }) {
  const notes = Array.from({ length: 16 }, (_, i) => ({ at: i * 0.25, note: 60, len: 0.15,
    vel: 0.8, p: 0.5 }));
  const grid = (s) => ({ stepBeats: 0.25, swing: 0, seed: s });
  const a = await renderNotes({ sampleRate, notes, grid: grid(seed) });
  const b = await renderNotes({ sampleRate, notes, grid: grid(seed) });
  const c = await renderNotes({ sampleRate, notes, grid: grid(other) });
  const equal = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  const stepOf = (r) => r.onsets.map((f) => Math.round((f - r.baseFrame) / (0.25 * r.spb
    * r.sampleRate)));
  // Re-derived from ADR 0086's draw, not imported from notes.js: pass 0, note i.
  const mix = (s, i) => (s ^ Math.imul(1, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca77)) >>> 0;
  const want = (s) => notes.map((_, i) => i).filter((i) => mulberry32(mix(s, i))() < 0.5);
  return { sampleRate: a.sampleRate, same: equal(a.contour, b.contour) && equal(a.cv, b.cv),
    differs: !equal(a.contour, c.contour), hits: stepOf(a), want: want(seed),
    otherHits: stepOf(c), otherWant: want(other) };
}

/**
 * K230: one note held past every stage of an Envelope with `delay` and `hold`; the contour's
 * stage starts against the times computed from the parameters (gate + delay: the attack; +
 * attack: the peak; + hold: the decay), and its level through the delay and the hold in dB.
 * -> { sampleRate, want, got (frames), delayMaxDb, holdMinDb }
 */
async function dadsr({ sampleRate, delay, hold }) {
  const adsr = { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.02, delay, hold };
  const r = await renderNotes({ sampleRate, adsr, notes: [{ at: 1, note: 69, len: 1,
    vel: 1 }] });
  const sr = r.sampleRate;
  const c = r.contour;
  const gate = frameOf(r, 1);
  const at = (s) => gate + Math.round(s * sr);
  const want = { attack: at(delay), peak: at(delay + adsr.attack),
    decay: at(delay + adsr.attack + hold) };
  const top = 1 - 1e-4; // the peak, as a float32 linear ramp reaches it
  const first = (from, test) => {
    for (let i = from; i < c.length; i++) if (test(c[i])) return i;
    return null;
  };
  const rise = first(gate, (v) => v > 2 * ENVELOPE_FLOOR);
  const peak = rise === null ? null : first(rise, (v) => v >= top);
  const fall = peak === null ? null : first(peak, (v) => v < top);
  const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
  let delayMax = 0;
  for (let i = gate; i < want.attack; i++) delayMax = Math.max(delayMax, c[i]);
  let holdMin = Infinity;
  for (let i = want.peak + 1; i < want.decay; i++) holdMin = Math.min(holdMin, c[i]);
  return { sampleRate: sr, want, got: { attack: rise === null ? null : rise - 1, peak,
    decay: fall === null ? null : fall - 1 },
  delayMaxDb: want.attack > gate ? db(delayMax) : null,
  holdMinDb: want.decay > want.peak + 1 ? db(holdMin) : null };
}

// The census: the same document on a running AudioContext, stopped with a ratchet pending.
const C = { engine: null, runtime: null, transport: null, done: null, stopAt: null };

async function censusStart() {
  const { store } = notesDocument({ notes: [{ at: 0, note: 60, len: 0.25, vel: 0.8 },
    { at: 1, note: 64, len: 2, vel: 0.8, r: 8 }] });
  C.engine = new AudioEngine();
  if (!C.engine.init()) throw new Error('AudioEngine.init');
  await C.engine.resume();
  C.runtime = createStudioRuntime({ engine: C.engine });
  C.transport = createStudioTransport({ runtime: C.runtime, engine: C.engine, store });
  const started = C.transport.start();
  if (!started.ok) throw new Error(`PLAY: ${started.reason}`);
  // The ratchet plays from beat 1 (0.5 s at 120 BPM), one onset every 0.125 s.
  return { state: C.engine.ctx.state, ratchetAt: started.baseTime + 0.5 };
}
const censusNow = () => C.engine.ctx.currentTime;
function censusStop() {
  C.done = null;
  C.stopAt = censusNow();
  C.transport.stop().then((c) => { C.done = c; });
  return C.stopAt;
}
function censusDone() {
  if (!C.done) return null;
  const keys = C.runtime.debugInfo().notes;
  return { engineNodes: C.engine.activeNodeCount, engineSources: C.engine.activeSourceCount,
    runtimeNodes: C.runtime.debugInfo().runtimeNodeCount,
    noteRecords: C.transport.debugInfo().noteCount, keysLeft: keys.length };
}

window.K = { RATES, track, glide, clampHz, midiHz, swingGrid, ratchet, slide, chance, dadsr,
  censusStart, censusNow, censusStop, censusDone };
