// Drum renders for tests/browser/instrument-dsp.cjs (K071, K072), bundled with its entry
// (instrument-dsp-entry.js). A Percussion engine -> Master Output document built through the one
// Studio store, run on the real Studio runtime and adapters on an OfflineAudioContext
// (offline.js offlineEngine, as Render WAV does); hits are struck on the engine's handle
// (noteOn on the audio clock) and every figure is measured from the rendered samples and
// returned as plain numbers. The expected values are computed here from the recipes' stated
// figures (synth/perc-recipes.js), independently of the adapter: the runner asserts.

import { createIdGenerator, createStudioStore } from '../../../src/js/studio/actions.js';
import { STUDIO_KIND, normalizeStudio } from '../../../src/js/studio/schema.js';
import { createStudioRuntime } from '../../../src/js/studio/runtime.js';
import { offlineEngine } from '../../../src/js/studio/offline.js';
import { PERC_KEYMAP, PERC_VOICES } from '../../../src/js/synth/perc-recipes.js';
import {
  CHOKE_RELEASE_S, VOICE_STOP_MARGIN_S, voicePeak,
} from '../../../src/js/studio/adapters/voices.js';
import { ENVELOPE_FLOOR } from '../../../src/js/audio/envelope.js';
import { RENDER_QUANTUM } from '../../../src/js/core/constants.js';

const T0 = 0.1; // the first hit, after the runtime's start lead and fade-in
/** The note of a voice in the octave the engine plays untransposed (C4 = 60). */
export const noteOf = (id) => 60 + PERC_KEYMAP.indexOf(id);

function documentOf(params) {
  const empty = normalizeStudio({ kind: STUDIO_KIND, schemaVersion: 1,
    graph: { nodes: [], edges: [] } });
  const st = createStudioStore(empty, { idGenerator: createIdGenerator(empty) });
  const must = (r, what) => {
    if (!r.ok) throw new Error(`${what}: ${r.reason}`);
    return r;
  };
  const add = (nodeType) => must(st.dispatch({ type: 'NODE_ADD', nodeType,
    position: { x: 0, y: 0 } }), nodeType).created.nodes[0];
  const perc = add('perc-voice');
  const out = add('master');
  if (Object.keys(params).length) {
    must(st.dispatch({ type: 'NODE_PARAM_SET', nodeId: perc, params }), 'params');
  }
  must(st.dispatch({ type: 'EDGE_ADD', from: { node: perc, port: 'audio' },
    to: { node: out, port: 'audio' } }), 'audio edge');
  return { model: st.getModel(), perc };
}

/** Render `hits` ([t, note, velocity]) on a percussion engine with `params` -> samples. */
async function render({ sampleRate, seconds, params = {}, hits }) {
  const { model, perc } = documentOf(params);
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const runtime = createStudioRuntime({ engine: offlineEngine(ctx, master) });
  const applied = runtime.apply(model, { revision: 1 });
  if (!applied.ok) throw new Error(`apply: ${applied.reason}`);
  const started = runtime.start();
  if (!started.ok) throw new Error(`start: ${started.reason}`);
  const h = runtime.nodes.get(perc);
  const results = hits.map(([t, note, vel]) => h.noteOn(t, note, vel));
  const buf = await ctx.startRendering();
  return { x: buf.getChannelData(0), sampleRate: buf.sampleRate, results };
}

/** RMS in dB of x over [t0, t1). */
function rmsDb(x, sr, t0, t1) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const i1 = Math.min(x.length, Math.round(t1 * sr));
  let s = 0;
  for (let i = i0; i < i1; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-30);
}

/** Rising zero crossings of x from t0 to t1, each interpolated to a time in seconds. */
function crossings(x, sr, t0, t1) {
  const ts = [];
  for (let i = Math.max(1, Math.ceil(t0 * sr)); i < Math.min(x.length, Math.floor(t1 * sr)); i++) {
    if (x[i - 1] < 0 && x[i] >= 0) ts.push((i - 1 + x[i - 1] / (x[i - 1] - x[i])) / sr);
  }
  return ts;
}

/**
 * The decay a hit has, from its log-RMS slope: 5 ms RMS windows from `from` s after the onset
 * while they stay within 50 dB of the first, a least-squares line through dB over time, and the
 * time that line takes to fall 60 dB. -> { t60, windows }
 */
function decayOf(x, sr, onset, from, span) {
  const w = 0.005;
  const pts = [];
  let first = null;
  for (let t = onset + from; t + w < onset + span; t += w) {
    const db = rmsDb(x, sr, t, t + w);
    if (first === null) first = db;
    if (db < first - 50) break;
    pts.push([t + w / 2, db]);
  }
  const n = pts.length;
  if (n < 4) return { t60: null, windows: n };
  const tm = pts.reduce((s, p) => s + p[0], 0) / n;
  const dm = pts.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [t, d] of pts) {
    num += (t - tm) * (d - dm);
    den += (t - tm) ** 2;
  }
  return { t60: -60 / (num / den), windows: n };
}

/**
 * The kick's sweep (K071): the tone layer alone (tone 1 leaves the click out), a long decay so
 * the late periods stay measurable. Each period between rising crossings is compared with the
 * mean of the stated law over it: f(t) = hz x (toHz / hz)^(t / sweepS) up to sweepS, toHz after.
 * -> { rows: [{ at, ratio }], atSweep, endHz, toHz }
 */
export async function kickSweep({ sampleRate }) {
  const L = PERC_VOICES.kick.layers[0];
  const { x, sampleRate: sr } = await render({ sampleRate, seconds: T0 + 0.6,
    params: { tone: 1, kickDecay: 4 }, hits: [[T0, noteOf('kick'), 127]] });
  const r = L.toHz / L.hz;
  const cycles = (t) => (t <= L.sweepS ? (L.hz * L.sweepS / Math.log(r)) * (r ** (t / L.sweepS) - 1)
    : (L.hz * L.sweepS / Math.log(r)) * (r - 1) + L.toHz * (t - L.sweepS));
  const ts = crossings(x, sr, T0 + 0.0005, T0 + 0.4).map((t) => t - T0);
  const rows = [];
  for (let k = 1; k < ts.length; k++) {
    const law = (cycles(ts[k]) - cycles(ts[k - 1])) / (ts[k] - ts[k - 1]);
    rows.push({ at: ts[k - 1], hz: 1 / (ts[k] - ts[k - 1]), law, ratio: 1 / (ts[k] - ts[k - 1])
      / law });
  }
  const after = rows.filter((p) => p.at >= L.sweepS);
  return { sampleRate: sr, rows, toHz: L.toHz, hz: L.hz, sweepS: L.sweepS,
    endHz: after.length ? after[0].hz : null };
}

/** Which layer measures a voice's stated decay: the longest, with `tone` leaving the others
 *  out where the voice mixes tone and noise (the kick's tone, the snare's noise). */
const ISOLATE = { kick: { tone: 1 }, snare: { tone: 0 } };

/** Every voice's decay to -60 dB rel against its stated one (the longest layer's). */
export async function decays({ sampleRate }) {
  const rows = [];
  let sr = sampleRate;
  for (const v of Object.values(PERC_VOICES)) {
    const stated = Math.max(...v.layers.map((l) => l.decayS));
    const last = (v.layers.find((l) => l.bursts) || { bursts: [[0]] }).bursts.at(-1)[0];
    const out = await render({ sampleRate, seconds: T0 + last + stated + 0.05,
      params: ISOLATE[v.id] || {}, hits: [[T0, noteOf(v.id), 127]] });
    sr = out.sampleRate;
    const d = decayOf(out.x, sr, T0 + last, 0.01, stated);
    rows.push({ id: v.id, stated, t60: d.t60, windows: d.windows });
  }
  return { sampleRate: sr, rows };
}

/**
 * The choke (K071): an open hat at T0, a closed hat at its level 0 (silent, still in group 1)
 * at T0 + 0.1. The choked render over the free one, frame by frame where the free one is above
 * 1 % of its peak, is the open hat's envelope from the hit on (the two renders are the same
 * samples before it). -> the frame it starts to fall, its largest value after the hit (a jump
 * would pass 1), its largest fall in one frame against the release ramp's own first fall (an
 * exponential ramp from the voice's level to the envelope floor over CHOKE_RELEASE_S), its
 * value one quantum after the release time against that floor, and the first frame from which
 * the choked render stays below -120 dBFS (its sources stopped, the high-pass rung out).
 */
export async function choke({ sampleRate }) {
  const hit = T0 + 0.1;
  const seconds = hit + 0.06;
  const params = { hatClosedLevel: 0 };
  const free = await render({ sampleRate, seconds, params,
    hits: [[T0, noteOf('hatOpen'), 127]] });
  const cut = await render({ sampleRate, seconds, params,
    hits: [[T0, noteOf('hatOpen'), 127], [hit, noteOf('hatClosed'), 127]] });
  const sr = free.sampleRate;
  const h = Math.round(hit * sr);
  let peak = 0;
  const q = RENDER_QUANTUM; // the hat's peak over two quanta around the hit
  for (let i = h - 2 * q; i < h + 2 * q; i++) peak = Math.max(peak, Math.abs(free.x[i]));
  const env = [];
  for (let i = h - q / 2; i < h + Math.round(0.02 * sr); i++) {
    if (Math.abs(free.x[i]) > 0.01 * peak) env.push([i - h, cut.x[i] / free.x[i]]);
  }
  const before = Math.max(...env.filter(([k]) => k < 0).map(([, e]) => Math.abs(e - 1)));
  const after = env.filter(([k]) => k >= 0);
  const start = (after.find(([, e]) => e < 0.999) || [null])[0];
  const maxAfter = Math.max(...after.map(([, e]) => e));
  let worst = 0;
  for (let j = 1; j < after.length; j++) {
    const [k0, e0] = after[j - 1];
    const [k1, e1] = after[j];
    if (k1 === k0 + 1) worst = Math.max(worst, e0 - e1);
  }
  const releaseFrames = CHOKE_RELEASE_S * sr;
  const floor = ENVELOPE_FLOOR / voicePeak(4, 127); // the floor relative to the voice's level
  const rampStep = 1 - floor ** (1 / releaseFrames);
  const late = after.filter(([k]) => k >= releaseFrames + RENDER_QUANTUM);
  const atRelease = late.length ? Math.max(...late.map(([, e]) => Math.abs(e))) : null;
  let silentFrom = null;
  for (let i = cut.x.length - 1; i >= h; i--) { // below -120 dBFS: the filter's ring included
    if (Math.abs(cut.x[i]) > 1e-6) break;
    silentFrom = i - h;
  }
  return { sampleRate: sr, quantum: RENDER_QUANTUM, start, maxAfter, worst, rampStep, floor,
    atRelease, releaseFrames, silentFrom, stopFrames: (CHOKE_RELEASE_S + VOICE_STOP_MARGIN_S) * sr,
    before, measured: env.length };
}

/** The velocity law (K071, restated to midi/notes.js): RMS of the kick at velocity 64 and 127. */
export async function velocity({ sampleRate }) {
  const at = async (vel) => {
    const { x, sampleRate: sr } = await render({ sampleRate, seconds: T0 + 0.2,
      params: { tone: 1 }, hits: [[T0, noteOf('kick'), vel]] });
    return { db: rmsDb(x, sr, T0, T0 + 0.1), sr };
  };
  const hi = await at(127);
  const lo = await at(64);
  return { sampleRate: hi.sr, db: lo.db - hi.db, law: 40 * Math.log10(64 / 127) };
}

/** The clap's burst onsets (K072): the first frame of each burst above 1 % of the hit's peak
 *  after at least 1 ms below 0.1 % of it, in frames from the hit, and the stated ones. */
export async function clapOnsets({ sampleRate }) {
  const { x, sampleRate: sr } = await render({ sampleRate, seconds: T0 + 0.1,
    hits: [[T0, noteOf('clap'), 127]] });
  const h = Math.round(T0 * sr);
  let peak = 0;
  for (let i = h; i < h + Math.round(0.05 * sr); i++) peak = Math.max(peak, Math.abs(x[i]));
  const quiet = Math.round(0.001 * sr);
  const onsets = [];
  let still = quiet;
  for (let i = h - quiet; i < h + Math.round(0.04 * sr); i++) {
    const a = Math.abs(x[i]);
    if (a > 0.01 * peak && still >= quiet) onsets.push(i - h);
    still = a < 0.001 * peak ? still + 1 : (a > 0.01 * peak ? 0 : still);
  }
  const bursts = PERC_VOICES.clap.layers[0].bursts;
  return { sampleRate: sr, onsets, want: bursts.map(([on]) => Math.round(on * sr)) };
}

/** Each tom's fundamental after its sweep (K072), from rising crossings over 80 ms. */
export async function toms({ sampleRate }) {
  const rows = [];
  let sr = sampleRate;
  for (const id of ['tomLow', 'tomMid', 'tomHigh']) {
    const L = PERC_VOICES[id].layers[0];
    const out = await render({ sampleRate, seconds: T0 + L.sweepS + 0.15,
      params: { [`${id}Decay`]: 4 }, hits: [[T0, noteOf(id), 127]] });
    sr = out.sampleRate;
    const ts = crossings(out.x, sr, T0 + L.sweepS + 0.005, T0 + L.sweepS + 0.085);
    const hz = ts.length > 2 ? (ts.length - 1) / (ts.at(-1) - ts[0]) : null;
    rows.push({ id, hz, want: L.toHz, periods: ts.length - 1 });
  }
  return { sampleRate: sr, rows };
}

/** The FM blip's first sideband against its carrier (K072): Goertzel magnitudes at the carrier
 *  and carrier + modulator over 40 ms (a whole number of periods of both), Hann-windowed. */
export async function blip({ sampleRate }) {
  const L = PERC_VOICES.blip.layers[0];
  const { x, sampleRate: sr } = await render({ sampleRate, seconds: T0 + 0.1,
    hits: [[T0, noteOf('blip'), 127]] });
  const i0 = Math.round((T0 + 0.002) * sr);
  const n = Math.round(0.04 * sr);
  const mag = (f) => {
    let re = 0;
    let im = 0;
    for (let k = 0; k < n; k++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
      const ph = (2 * Math.PI * f * k) / sr;
      re += x[i0 + k] * w * Math.cos(ph);
      im -= x[i0 + k] * w * Math.sin(ph);
    }
    return Math.hypot(re, im);
  };
  const c = L.hz;
  const m = L.hz * L.ratio;
  return { sampleRate: sr, db: 20 * Math.log10(mag(c + m) / mag(c)), index: L.index,
    carrier: c, modulator: m };
}
