// Fixture for the offline checks of tests/browser/synth-engines.cjs (review of #332): bundled
// with esbuild (IIFE) into one classic <script> of a blank page. It builds the real Synth engine
// adapters (NODE_ADAPTERS, the registry's defaults) exactly as the compiler does, on an
// OfflineAudioContext, plays notes on them through the handle (noteOn / noteOff), renders, and
// returns plain numbers measured from the samples; the runner asserts.

import { NODE_ADAPTERS } from '../../../src/js/studio/adapters/nodes.js';
import { NODE_REGISTRY } from '../../../src/js/studio/registry.js';
import { percNote } from '../../../src/js/synth/perc-recipes.js';

// The rate these renders request; every measure reads the rendered buffer's own sampleRate.
// timing-allow: the OfflineAudioContext render rate these renders request
const SR = 48000;

const defaults = (type) => Object.fromEntries(NODE_REGISTRY.get(type).params
  .map((p) => [p.key, p.default]));

/**
 * The adapter on a fresh OfflineAudioContext, its output into the destination. With
 * `channels: 2` the output is channel 0 and channel 1 is `drive`, a gain the caller feeds.
 */
function build(type, params = {}, { seconds = 2, sampleRate = SR, channels = 1 } = {}) {
  const ctx = new OfflineAudioContext(channels, Math.round(seconds * sampleRate), sampleRate);
  const acct = { track: (n) => n, source: (n) => n, untrack() {} };
  const oscillators = [];
  const hooks = {
    ctx,
    clampFrequency: (f) => Math.min((ctx.sampleRate / 2) * 0.95, f),
    oscillator(t, f, at) {
      const o = ctx.createOscillator();
      o.type = t;
      o.frequency.setValueAtTime(this.clampFrequency(f), ctx.currentTime);
      o.start(at);
      oscillators.push(o);
      return o;
    },
  };
  const p = { ...defaults(type), ...params };
  const h = NODE_ADAPTERS[type].create({ ctx, hooks, acct, at: 0, now: 0, params: p,
    node: { id: 'n1', type, params: p }, def: NODE_REGISTRY.get(type) });
  let drive = null;
  if (channels === 2) {
    const merge = ctx.createChannelMerger(2);
    drive = ctx.createGain();
    if (h.outputs && h.outputs.audio) h.outputs.audio.connect(merge, 0, 0);
    drive.connect(merge, 0, 1);
    merge.connect(ctx.destination);
  } else if (h.outputs && h.outputs.audio) h.outputs.audio.connect(ctx.destination);
  return { ctx, h, p, oscillators, drive };
}

/**
 * Render `type` with `params`, playing `events` ([t, 'on', note, velocity] | [t, 'off', note]
 * | [t, 'allOff']) -> { data, sampleRate, results } (results: what each event returned).
 */
async function render(type, params, events, opts = {}) {
  const { ctx, h } = build(type, params, opts);
  const results = events.map(([t, kind, note, vel]) => (kind === 'on'
    ? h.noteOn(t, note, vel == null ? 127 : vel) : kind === 'off' ? h.noteOff(t, note)
      : h.allOff(t, true)));
  const buf = await ctx.startRendering();
  return { data: buf.getChannelData(0), sampleRate: buf.sampleRate, results };
}

const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
function peakOf(data, i0 = 0, i1 = data.length) {
  let p = 0;
  for (let i = i0; i < i1; i++) p = Math.max(p, Math.abs(data[i]));
  return p;
}
function rmsOf(data, i0 = 0, i1 = data.length) {
  let s = 0;
  for (let i = i0; i < i1; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, i1 - i0));
}
const at = (sr, t) => Math.max(0, Math.round(t * sr));

/** RMS envelope in dB: windows of `win` s every `hop` s, from t0 -> [[t, dB]]. */
function envelope(data, sr, { win = 0.01, hop = 0.0025, t0 = 0 } = {}) {
  const out = [];
  const w = at(sr, win);
  for (let i = at(sr, t0); i + w <= data.length; i += at(sr, hop)) {
    out.push([(i + w / 2) / sr, db(rmsOf(data, i, i + w))]);
  }
  return out;
}

/** Least-squares slope (dB/s) of the envelope points between `hi` and `lo` dB below its peak. */
function decaySlope(env, { hi = -10, lo = -45, after = 0 } = {}) {
  const top = Math.max(...env.map((p) => p[1]));
  const tTop = env.find((p) => p[1] === top)[0];
  const end = env.findIndex((p) => p[0] > Math.max(tTop, after) && p[1] < top + lo);
  const pts = env.filter((p, i) => p[0] > Math.max(tTop, after) && (end < 0 || i < end)
    && p[1] <= top + hi && p[1] >= top + lo);
  const n = pts.length;
  if (n < 4) return { slope: NaN, points: n, top };
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0)
    / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  return { slope, points: n, top };
}

/** |DFT| at f of a Hann-windowed slice (amplitude-normalised). */
function amplitudeAt(x, f, sr) {
  const n = x.length;
  const w = (2 * Math.PI * f) / sr;
  let re = 0;
  let im = 0;
  let ws = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    ws += h;
    re += x[i] * h * Math.cos(w * i);
    im -= x[i] * h * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / ws;
}

/** The strongest line within ±range cents of f0 in a slice, in cents from f0. */
function lineCents(x, f0, sr, range = 300) {
  const amp = (c) => amplitudeAt(x, f0 * 2 ** (c / 1200), sr);
  let best = -range;
  let bestA = -1;
  for (let c = -range; c <= range; c += 4) {
    const a = amp(c);
    if (a > bestA) { bestA = a; best = c; }
  }
  for (const step of [1, 0.25, 0.05]) {
    const from = best;
    for (let c = from - 4 * step; c <= from + 4 * step; c += step) {
      const a = amp(c);
      if (a > bestA) { bestA = a; best = c; }
    }
  }
  return { cents: best, amp: bestA };
}

window.E = {
  defaults,

  /** The voice a key plays and its longest layer's decay (the recipe the face prints). */
  percVoice: (note) => {
    const { voice } = percNote(note);
    return { id: voice.id, decayS: Math.max(...voice.layers.map((l) => l.decayS)) };
  },

  /** The peak of `notes` held at velocity `vel` from 0.01 s, over `seconds`. */
  async peak(type, params, notes, { vel = 127, seconds = 1, sampleRate = SR } = {}) {
    const r = await render(type, params, notes.map((n) => [0.01, 'on', n, vel]),
      { seconds, sampleRate });
    return { peak: peakOf(r.data), rms: rmsOf(r.data, at(r.sampleRate, seconds / 2)),
      results: r.results.map((x) => (x && typeof x === 'object' ? x.dropped || 0 : x)) };
  },

  /** A one-shot's decay: the envelope slope from `hi` to `lo` dB below its peak, after `after`. */
  async decay(note, params = {}, { win = 0.01, hi = -10, lo = -45, after = 0,
    seconds = 3 } = {}) {
    const r = await render('perc-voice', params, [[0.05, 'on', note, 127]], { seconds });
    const env = envelope(r.data, r.sampleRate, { win, hop: win / 4 });
    const fit = decaySlope(env, { hi, lo, after: 0.05 + after });
    return { ...fit, peak: peakOf(r.data) };
  },

  /** FM: the line nearest the note in each window [t0, t1] s, in cents from the note. */
  async pitch(params, note, windows, { seconds = 3 } = {}) {
    const r = await render('fm-voice', { sustain: 1, ...params }, [[0, 'on', note, 127]],
      { seconds });
    const f0 = 440 * 2 ** ((note - 69) / 12);
    return windows.map(([t0, t1]) => ({ t0, t1,
      ...lineCents(r.data.subarray(at(r.sampleRate, t0), at(r.sampleRate, t1)), f0,
        r.sampleRate) }));
  },

  /**
   * FM: the pitch of operator 1 (a carrier in every algorithm) from what drives it (review of
   * #332, round 3). Every connection into its frequency is mirrored into a second rendered
   * channel, so the render holds the deviation in Hz the oscillator integrates. A window's
   * offset is that deviation's 0 Hz line: its mean under a Hann window of a whole number of the
   * note's periods (`periods`, at least 0.3 s), which nulls every line at a multiple of the
   * note. Windows start every `hop` s from `from` s -> [{ t0, t1, hz, cents }].
   */
  async drive(params, note, { from = 0.05, to = 2.9, hop = 0.05, seconds = 3 } = {}) {
    const { ctx, h, p, oscillators, drive } = build('fm-voice', { sustain: 1, ...params },
      { seconds, channels: 2 });
    const proto = AudioNode.prototype;
    const connect = proto.connect;
    proto.connect = function mirrored(dest, ...rest) {
      const r = connect.call(this, dest, ...rest);
      if (oscillators[0] && dest === oscillators[0].frequency) connect.call(this, drive);
      return r;
    };
    try { h.noteOn(0, note, 127); } finally { proto.connect = connect; }
    const buf = await ctx.startRendering();
    const x = buf.getChannelData(1);
    const sr = buf.sampleRate;
    const f0 = 440 * 2 ** ((note - 69) / 12);
    const f1 = f0 * p.ratio1;
    const len = Math.max(2, Math.ceil(0.3 * f0)) / f0;
    const out = [];
    for (let t0 = from; t0 + len <= to + 1e-9; t0 += hop) {
      let s = 0;
      let ws = 0;
      for (let i = Math.ceil(t0 * sr); i / sr <= t0 + len; i++) {
        const w = Math.sin((Math.PI * (i / sr - t0)) / len) ** 2;
        s += w * x[i];
        ws += w;
      }
      const hz = s / ws;
      out.push({ t0: +t0.toFixed(3), t1: +(t0 + len).toFixed(3), hz,
        cents: 1200 * Math.log2((f1 + hz) / f1) });
    }
    return out;
  },

  /** Wavetable: the steady RMS (dB) and the peak of one held note at each morph. */
  async morph(bank, morphs, { note = 57, type = 'wavetable-voice' } = {}) {
    const out = [];
    for (const m of morphs) {
      const r = await render(type, { bank, morph: m, sustain: 1, attack: 0.001 },
        [[0, 'on', note, 127]], { seconds: 0.5 });
      out.push({ m, rmsDb: db(rmsOf(r.data, at(r.sampleRate, 0.2))),
        peak: peakOf(r.data, at(r.sampleRate, 0.05)) });
    }
    return out;
  },

  /** The mean (DC) and peak of a held note's steady state. */
  async dc(type, params, note = 57) {
    const r = await render(type, { sustain: 1, ...params }, [[0, 'on', note, 127]],
      { seconds: 1.5 });
    const i0 = at(r.sampleRate, 0.8);
    let s = 0;
    for (let i = i0; i < r.data.length; i++) s += r.data[i];
    return { mean: s / (r.data.length - i0), peak: peakOf(r.data, i0) };
  },

  /** A held note retriggered at `tr`: the held RMS before it and the lowest RMS after it. */
  async retrigger(type, params, { note = 60, tr = 1.2, seconds = 2.2 } = {}) {
    const r = await render(type, { sustain: 1, ...params }, [[0, 'on', note, 100],
      [tr, 'on', note, 100]], { seconds });
    const env = envelope(r.data, r.sampleRate, { win: 0.02, hop: 0.005 });
    const held = env.filter((p) => p[0] > tr - 0.2 && p[0] < tr - 0.02);
    const after = env.filter((p) => p[0] > tr && p[0] < seconds - 0.05);
    return { held: Math.min(...held.map((p) => p[1])), min: Math.min(...after.map((p) => p[1])),
      results: r.results.map((x) => (x && typeof x === 'object' ? { ...x } : x)) };
  },

  /**
   * An open hat at 0.05 s, a closed hat at `t`: seconds from `t` until the sound is 40 dB below
   * its level just before it (Infinity when it never is within the render).
   */
  async choke(params = {}, { t = 0.15 } = {}) {
    const r = await render('perc-voice', params, [[0.05, 'on', 70, 127], [t, 'on', 66, 127]],
      { seconds: 1.5 });
    const env = envelope(r.data, r.sampleRate, { win: 0.004, hop: 0.001 });
    const before = env.filter((p) => p[0] > t - 0.012 && p[0] < t - 0.002);
    const level = before.reduce((s, p) => s + p[1], 0) / before.length;
    const hit = env.find((p) => p[0] > t && p[1] <= level - 40);
    return { level, fallS: hit ? hit[0] - t : Infinity };
  },

  /** A ringing one-shot cut by all-off at `t`: the RMS 50 ms later re its level before. */
  async allOff(note, params = {}, { t = 0.15 } = {}) {
    const r = await render('perc-voice', params, [[0.05, 'on', note, 127], [t, 'allOff']],
      { seconds: 1 });
    return { before: db(rmsOf(r.data, at(r.sampleRate, t - 0.03), at(r.sampleRate, t))),
      after: db(rmsOf(r.data, at(r.sampleRate, t + 0.05), at(r.sampleRate, t + 0.08))) };
  },
};
