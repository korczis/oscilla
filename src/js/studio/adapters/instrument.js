// Studio adapters of the Synth panel's node types (nodes/instrument.js): Keys, VCO, Ring.
// The adapter contract is the header of adapters/nodes.js. Native Web Audio only, every node
// through acct.track / acct.source; no recurrence and no DelayNode (project.no-silent-feedback).

import { SAFE_NYQUIST_FACTOR } from '../../core/constants.js';
import { buildPeriodicWave, pulseSeries } from '../../audio/additive.js';
import { KEYS_PITCH_RANGE, VCO_SCALES } from '../nodes/instrument.js';
import { UNIPOLAR, did, free, inertHandle, linearOnly, setParam } from './common.js';

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
    const [lo, hi] = KEYS_PITCH_RANGE;
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
      /** Note `note` at velocity `vel` (0-127) from t; glide only between held notes. */
      play(t, note, vel, { legato = false } = {}) {
        const oct = Math.min(hi, Math.max(lo, (note + p.transpose - 69) / 12));
        if (p.glide > 0 && legato) pitch.offset.setTargetAtTime(oct, t, p.glide / 3);
        else pitch.offset.setValueAtTime(oct, t);
        if (vel != null) velocity.offset.setValueAtTime(Math.min(1, vel / 127), t);
        return oct;
      },
      priority: () => p.priority,
      stop(t) {
        for (const n of [pitch, velocity]) { try { n.stop(t); } catch (e) { /* stopped */ } }
      },
      dispose() {},
      info: { keys: true },
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
