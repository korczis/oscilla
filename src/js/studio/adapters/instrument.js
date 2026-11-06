// Studio adapters of the Synth panel's node types (nodes/instrument.js): Keys, VCO, Ring.
// The adapter contract is the header of adapters/nodes.js. Native Web Audio only, every node
// through acct.track / acct.source; no recurrence and no DelayNode (project.no-silent-feedback).

import { SAFE_NYQUIST_FACTOR } from '../../core/constants.js';
import { buildPeriodicWave, pulseSeries } from '../../audio/additive.js';
import { KEYS_PITCH_RANGE, VCO_SCALES, xyDegree } from '../nodes/instrument.js';
import {
  PARAM_TAU_S, UNIPOLAR, did, free, inertHandle, linearOnly, setParam,
} from './common.js';

/** Octaves the VCO pitch clip spans each way (its WaveShaper input is pitch / span). */
export const PITCH_SPAN_OCT = 8;
/** Points of the pitch clip curve: 2·2048 + 1, so the grid holds 0 and steps of 1/2048. */
export const PITCH_CLIP_POINTS = 4097;
/** Partials of the pulse PeriodicWave (the browser band-limits it to the playing frequency). */
export const PULSE_PARTIALS = 256;
export const NEEDS_CONSTANT_SOURCE = 'needs ConstantSourceNode, which this browser lacks.';

/** A VCO's frequency at pitch 0: A4 × 2^octave of its scale (8' = 440 Hz). */
export const vcoBaseHz = (scale) => 440 * 2 ** (VCO_SCALES[scale] ?? 0);

/** Octaves above `baseHz` up to 0.95 × Nyquist of `sampleRate`. */
export const pitchCeilingOct = (baseHz, sampleRate) => Math.log2(
  (SAFE_NYQUIST_FACTOR * sampleRate) / 2 / baseHz);

/**
 * The pitch clip: x (pitch / PITCH_SPAN_OCT) on an even grid over [−1, 1], the identity up to
 * the largest grid point at or below `ceilOct` / span and held there above. The browser's
 * linear interpolation between grid points is then the exact identity below that point, so
 * the pitch tracks exactly and never asks for more than 0.95 × Nyquist.
 */
export function pitchClipCurve(ceilOct, size = PITCH_CLIP_POINTS, span = PITCH_SPAN_OCT) {
  const mid = (size - 1) / 2;
  const knee = Math.floor((ceilOct / span) * mid + 1e-9) / mid;
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = Math.min((i - mid) / mid, knee);
  return out;
}

const hasConstant = (ctx) => typeof ctx.createConstantSource === 'function';
const started = (acct, node, at) => {
  acct.source(acct.track(node));
  node.start(at);
  return node;
};

/**
 * The pitch schedule of a Keys node as written (K060, owner decision 'Linear glide in exact
 * time'): segments { t0, v0, t1, v1 }, a step when t1 === t0, else a linear ramp. Kept by the
 * adapter itself because Firefox lacks cancelAndHoldAtTime: a glide cut by a new note is held
 * at its value computed from this record (project.audio-engine-discipline v2).
 *   createPitchSchedule(param, v0) -> { to(t, v, glide) -> value at t, valueAt(t), last() }
 */
export function createPitchSchedule(param, v0 = 0) {
  let segs = [{ t0: 0, v0, t1: 0, v1: v0 }];
  const valueAt = (t) => {
    let s = segs[0];
    for (const x of segs) if (x.t0 <= t) s = x;
    if (t >= s.t1 || s.t1 === s.t0) return s.v1;
    return s.v0 + ((s.v1 - s.v0) * Math.max(0, t - s.t0)) / (s.t1 - s.t0);
  };
  return {
    valueAt,
    last: () => segs[segs.length - 1],
    /** From t: a step to v (glide 0), or a linear ramp that arrives at v at exactly t + glide. */
    to(t, v, glide = 0) {
      const from = valueAt(t);
      const cut = segs.find((x) => x.t0 < t && t < x.t1);
      segs = segs.filter((x) => x.t0 < t);
      param.cancelScheduledValues(t);
      // A ramp in progress keeps its course up to t: its start event is still in place, so a
      // ramp to its own value at t is the schedule it had (with its end cancelled alone, the
      // parameter would hold the start value from the start).
      if (cut) {
        param.linearRampToValueAtTime(from, t);
        cut.t1 = t;
        cut.v1 = from;
      }
      if (glide > 0) {
        param.setValueAtTime(from, t);
        param.linearRampToValueAtTime(v, t + glide);
        segs.push({ t0: t, v0: from, t1: t + glide, v1: v });
      } else {
        param.setValueAtTime(v, t);
        segs.push({ t0: t, v0: v, t1: t, v1: v });
      }
      if (segs.length > 8) segs = segs.slice(-8);
      return from;
    },
  };
}

/** The note clamp, as the card, the Inspector help and debugInfo state it. */
export const KEYS_CLAMP_TEXT = (hz) => `A pitch played from Keys is clamped at `
  + `${SAFE_NYQUIST_FACTOR} × Nyquist${hz ? ` (${Math.round(hz)} Hz here)` : ''}: a VCO holds `
  + 'it at its pitch grid point at or below that, less than 5 cents under, and every note '
  + 'below the clamp tracks exactly.';

export const keys = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, acct, at, params }) {
    // Two ConstantSources: the pitch (octaves from A4) and the velocity (0..1). The gate is a
    // logical TRIGGER output: studio/live-notes.js fans a note out along its edges.
    if (!hasConstant(ctx)) return inertHandle('degraded', `Keys ${NEEDS_CONSTANT_SOURCE}`);
    let p = { ...params };
    const pitch = started(acct, ctx.createConstantSource(), at);
    const velocity = started(acct, ctx.createConstantSource(), at);
    pitch.offset.setValueAtTime(0, ctx.currentTime);
    velocity.offset.setValueAtTime(0, ctx.currentTime);
    const sched = createPitchSchedule(pitch.offset, 0);
    const [lo, hi] = KEYS_PITCH_RANGE;
    const clampHz = (SAFE_NYQUIST_FACTOR * ctx.sampleRate) / 2;
    let note = null;
    let gate = { open: false, at: null };
    return {
      inputs: {},
      outputs: { pitch, velocity },
      outputRange: { pitch: KEYS_PITCH_RANGE, velocity: UNIPOLAR },
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {},
      update(changed, owned, w) {
        p = { ...p, ...changed };
        did(w, changed, Object.keys(changed), 'next-note');
      },
      /**
       * Note `n` at velocity `vel` (0-127) from t. Legato with Glide > 0: a linear ramp that
       * reaches the note at exactly t + Glide; otherwise a step at t.
       */
      play(t, n, vel, { legato = false } = {}) {
        const oct = Math.min(hi, Math.max(lo, (n + p.transpose - 69) / 12));
        sched.to(t, oct, legato && p.glide > 0 ? p.glide : 0);
        if (vel != null) velocity.offset.setValueAtTime(Math.min(1, vel / 127), t);
        note = n;
        return oct;
      },
      /** The gate the note router (live-notes.js) opened or closed at t. */
      gateAt(t, open) {
        gate = { open: !!open, at: t };
      },
      priority: () => p.priority,
      // The range is the interval between Key low and Key high in either order (#447 F1: an
      // inverted pair refused every note), the same interval the card names.
      keyRange: () => {
        const a = p.keyLow ?? 0;
        const b = p.keyHigh ?? 127;
        return a <= b ? [a, b] : [b, a];
      },
      /** debugInfo: the note, the pitch now and its target, the gate and the clamp. */
      noteState() {
        const s = sched.last();
        return { note, pitch: sched.valueAt(ctx.currentTime), target: s.v1, arrives: s.t1,
          gate: gate.open, gateAt: gate.at, clampHz, clamp: KEYS_CLAMP_TEXT(clampHz) };
      },
      stop(t) {
        for (const n of [pitch, velocity]) { try { n.stop(t); } catch (e) { /* stopped */ } }
      },
      dispose() {},
      info: { keys: true, clampHz },
      status: 'ready',
      reason: null,
    };
  },
};

export const vco = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: ['waveform', 'width', 'scale'],
  create({ ctx, hooks, acct, at, params }) {
    // osc ← detune ← ×9600 ← clip ← ×1/8 ← (cv: pitch + fm, in octaves) + (tune / 1200).
    if (!hasConstant(ctx)) return inertHandle('degraded', `The VCO ${NEEDS_CONSTANT_SOURCE}`);
    const base = vcoBaseHz(params.scale);
    const pulse = params.waveform === 'pulse';
    const osc = acct.source(acct.track(hooks.oscillator(pulse ? 'sine' : params.waveform, base,
      at)));
    let peak = 1;
    if (pulse) {
      const pw = buildPeriodicWave(ctx, pulseSeries(params.width / 100, PULSE_PARTIALS));
      if (pw.wave) osc.setPeriodicWave(pw.wave);
      peak = pw.outputPeak;
    }
    const cv = started(acct, ctx.createConstantSource(), at);
    const tune = started(acct, ctx.createConstantSource(), at);
    const tuneScale = acct.track(ctx.createGain());
    const pre = acct.track(ctx.createGain());
    const clip = acct.track(ctx.createWaveShaper());
    const post = acct.track(ctx.createGain());
    tuneScale.gain.value = 1 / 1200;
    pre.gain.value = 1 / PITCH_SPAN_OCT;
    clip.oversample = 'none';
    clip.curve = pitchClipCurve(pitchCeilingOct(base, ctx.sampleRate));
    post.gain.value = 1200 * PITCH_SPAN_OCT;
    tune.connect(tuneScale).connect(pre);
    cv.connect(pre).connect(clip).connect(post).connect(osc.detune);
    cv.offset.setValueAtTime(params.pitch + params.fm, ctx.currentTime);
    tune.offset.setValueAtTime(params.tune, ctx.currentTime);
    const pitchOf = (key, mapping) => linearOnly(cv.offset)(key, mapping);
    return {
      inputs: {},
      outputs: { audio: osc },
      outputRange: {},
      modTarget(key, mapping) {
        if (key === 'pitch' || key === 'fm') return pitchOf(key, mapping);
        if (key === 'tune') return linearOnly(tune.offset)(key, mapping);
        return { reason: `unknown parameter ${key}` };
      },
      applyBase(b, immediate, owned, w) {
        const now = ctx.currentTime;
        if (free(owned, 'pitch') && free(owned, 'fm')) {
          setParam(cv.offset, b.pitch.value + b.fm.value, immediate, now, w, 'pitch');
        }
        if (free(owned, 'tune')) setParam(tune.offset, b.tune.value, immediate, now, w, 'tune');
      },
      update() {},
      stop(t) {
        for (const n of [osc, cv, tune]) { try { n.stop(t); } catch (e) { /* stopped */ } }
      },
      dispose() {},
      info: { oscillator: osc, baseHz: base, peak, ceilingOct: pitchCeilingOct(base,
        ctx.sampleRate) },
      status: 'ready',
      reason: null,
    };
  },
};

/** Ring: gain base and modulator scale of a mode, so out = c·(base + scale·m). */
export const ringLaw = (mode, depth) => (mode === 'am' ? { base: 1 - depth / 2, scale: depth / 2 }
  : { base: 0, scale: 1 });

export const ring = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, acct, params }) {
    // The carrier passes a GainNode whose gain the modulator drives (an AudioParam input).
    const vca = acct.track(ctx.createGain());
    const mod = acct.track(ctx.createGain());
    const law = ringLaw(params.mode, params.depth);
    vca.gain.setValueAtTime(law.base, ctx.currentTime);
    mod.gain.setValueAtTime(law.scale, ctx.currentTime);
    mod.connect(vca.gain);
    let p = { ...params };
    return {
      inputs: { carrier: vca, modulator: mod },
      outputs: { audio: vca },
      outputRange: {},
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {},
      update(changed, owned, w) {
        p = { ...p, ...changed };
        const l = ringLaw(p.mode, p.depth);
        const now = ctx.currentTime;
        setParam(vca.gain, l.base, false, now);
        setParam(mod.gain, l.scale, false, now);
        did(w, changed, ['mode', 'depth'], 'glide');
      },
      stop() {},
      dispose() {},
      info: {},
      status: 'ready',
      reason: null,
    };
  },
};

export const xyPad = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, acct, at, params }) {
    // Three ConstantSources (X, Y, the quantised pitch); the gate is a logical TRIGGER output
    // that studio/live-notes.js fans out along its edges, as the Keys gate.
    if (!hasConstant(ctx)) return inertHandle('degraded', `The XY pad ${NEEDS_CONSTANT_SOURCE}`);
    let p = { ...params };
    const [x, y, pitch] = [0, 1, 2].map(() => started(acct, ctx.createConstantSource(), at));
    for (const n of [x, y, pitch]) n.offset.setValueAtTime(0, ctx.currentTime);
    return {
      inputs: {},
      outputs: { x, y, pitch },
      outputRange: { x: UNIPOLAR, y: UNIPOLAR, pitch: KEYS_PITCH_RANGE },
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {},
      update(changed, owned, w) {
        p = { ...p, ...changed };
        did(w, changed, Object.keys(changed), 'next-note');
      },
      /** The pad at (fx, fy) from t: X and Y glide (τ 15 ms, no click), the pitch steps. */
      move(t, fx, fy, { legato = false } = {}) {
        const cx = Math.min(1, Math.max(0, Number(fx) || 0));
        const cy = Math.min(1, Math.max(0, Number(fy) || 0));
        const d = xyDegree(cx, p);
        x.offset.setTargetAtTime(cx, t, PARAM_TAU_S);
        y.offset.setTargetAtTime(cy, t, PARAM_TAU_S);
        if (p.glide > 0 && legato) pitch.offset.setTargetAtTime(d.pitch, t, p.glide / 3);
        else pitch.offset.setValueAtTime(d.pitch, t);
        return { ...d, x: cx, y: cy };
      },
      stop(t) {
        for (const n of [x, y, pitch]) { try { n.stop(t); } catch (e) { /* stopped */ } }
      },
      dispose() {},
      info: { pad: true },
      status: 'ready',
      reason: null,
    };
  },
};
