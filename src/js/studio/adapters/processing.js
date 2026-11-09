// Studio PROCESSING adapters (nodes/processing.js): Gain, Filter, Pan, Stereo Split, Mixer,
// Drive.
// The adapter contract is the header of adapters/nodes.js.

import { createFilterStage, nodeQ, normalizeFilter } from '../../audio/filters.js';
import { createStereoRouter } from '../../audio/stereo.js';
import { createDriveStage } from '../../audio/drive.js';
import { CLIP_TARGET_TEXT, gainIsUsed, qIsDecibels, qIsUsed } from '../clip-targets.js';
import { CENTS_PER_OCTAVE } from '../../core/music.js';
import { did, free, linearOnly, setParam } from './common.js';
import { CASCADES } from '../nodes/processing.js';

/** filters.js GLIDE_TAU_S: the stage's own parameter glide (not exported there). */
const FILTER_GLIDE_TAU_S = 0.01;
/** filters.js CROSSFADE_S / 3: the bypass crossfade's time constant (a cascaded filter's own). */
const FILTER_XFADE_TAU_S = 0.02 / 3;
/** The filter parameters createFilterStage.update writes together. */
const FILTER_KEYS = Object.freeze(['frequency', 'Q', 'gain']);

/** Why a bypassed node takes no modulation (K022): shown on the edge. */
export const BYPASSED_TEXT = (key) => `${key}: uzel je obejitý (Bypass), modulace nepůsobí.`;

/**
 * K022's generic bypass: with `bypass` on, the node is built as `through(env)` (the audio passes
 * unchanged) instead of itself. `bypass` is structural, so turning it on or off replaces the node
 * and the runtime crossfades the two (spec §45): click-free, as the Filter's own bypass is.
 */
function withBypass(adapter, through) {
  return { ...adapter, structural: [...adapter.structural, 'bypass'],
    create: (env) => (env.params.bypass ? through(env) : adapter.create(env)) };
}

/** One unity gain: the bypassed Gain and Drive. */
function passThrough({ ctx, acct }) {
  const g = acct.track(ctx.createGain());
  return {
    inputs: { audio: g }, outputs: { audio: g }, outputRange: {},
    modTarget: (key) => ({ reason: BYPASSED_TEXT(key) }),
    applyBase() {}, update() {}, stop() {}, dispose() {},
    info: { bypassed: true }, status: 'ready', reason: null,
  };
}

const gainNode = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, acct, params }) {
    const g = acct.track(ctx.createGain());
    g.gain.setValueAtTime(params.gain, ctx.currentTime);
    return {
      inputs: { audio: g },
      outputs: { audio: g },
      outputRange: {},
      modTarget: (key, mapping) => (key === 'gain' ? linearOnly(g.gain)(key, mapping)
        : { reason: `unknown parameter ${key}` }),
      applyBase(b, immediate, owned, w) {
        if (free(owned, 'gain')) {
          setParam(g.gain, b.gain.value, immediate, ctx.currentTime, w, 'gain');
        }
      },
      update() {}, stop() {}, dispose() {},
      info: {},
      status: 'ready',
      reason: null,
    };
  },
};

export const gain = withBypass(gainNode, passThrough);

export const filter = {
  compiler: 'audio/filters.js#createFilterStage',
  // A type change would make createFilterStage crossfade to its second biquad, away from the
  // AudioParams the modulation edges are wired to: rebuild and crossfade at the graph level.
  // A slope change (K022) swaps one biquad for two: rebuilt the same way.
  structural: ['type', 'slope'],
  // createFilterStage.update re-glides frequency, Q and gain for every change, the bypass
  // included, and cannot skip one: with an owned parameter a bypass change rebuilds the node.
  rebuildWhenOwned: ['enabled'],
  create(env) {
    const { ctx, params } = env;
    if (params.slope === '24' && CASCADES.includes(params.type)) {
      if (typeof ctx.createConstantSource === 'function') return cascade(env);
      return { ...singleFilter(env), status: 'degraded',
        reason: '24 dB/oct needs ConstantSourceNode: one biquad (12 dB/oct) plays.' };
    }
    return singleFilter(env);
  },
};

/** One biquad (12 dB/oct, the Filter before K022): unchanged. */
function singleFilter({ ctx, acct, params }) {
  const stage = createFilterStage(ctx, params, { track: acct.track });
  const biquad = stage.node; // never type-switched (see `structural`), so stable
  // The base values last applied: stage.update is always given them, so the stage's own
  // config catches up after a period in which an owner drove one of them.
  let last = { frequency: params.frequency, Q: params.Q, gain: params.gain };
  return {
    inputs: { audio: stage.input },
    outputs: { audio: stage.output },
    outputRange: {},
    modTarget(key, mapping) {
      if (key === 'frequency') {
        return mapping === 'log' ? { param: biquad.detune, scale: CENTS_PER_OCTAVE }
          : { param: biquad.frequency, scale: 1 };
      }
      if (key === 'Q') {
        if (qIsDecibels(params.type)) return { reason: CLIP_TARGET_TEXT.filterQ };
        if (!qIsUsed(params.type)) return { reason: CLIP_TARGET_TEXT.filterQUnused };
        return linearOnly(biquad.Q)(key, mapping);
      }
      if (key === 'gain') {
        if (!gainIsUsed(params.type)) return { reason: CLIP_TARGET_TEXT.filterGain };
        return linearOnly(biquad.gain)(key, mapping);
      }
      return { reason: `unknown parameter ${key}` };
    },
    applyBase(b, immediate, owned, w) {
      last = { frequency: b.frequency.value, Q: b.Q.value, gain: b.gain.value };
      const c = normalizeFilter({ ...stage.config, ...last }, ctx.sampleRate);
      // What reaches the biquad: clamped frequency, Q converted for the node, gain.
      for (const [k, v] of [['frequency', c.frequency], ['Q', nodeQ(c.type, c.Q)],
        ['gain', c.gain]]) if (w && free(owned, k)) w[k] = v;
      if (FILTER_KEYS.every((k) => free(owned, k))) {
        // createFilterStage.update glides (τ 10 ms), clamps to 10 Hz … 0.95 × Nyquist and
        // converts Q for the node (dB for low-/high-pass).
        // A new node is silent until its routes fade in, so the first call may glide too.
        stage.update(last);
      } else {
        // An owner drives one of them: the stage's glide, clamp and Q conversion
        // (filters.js normalizeFilter, nodeQ) on the others only.
        const t = ctx.currentTime;
        if (free(owned, 'frequency')) {
          biquad.frequency.setTargetAtTime(c.frequency, t, FILTER_GLIDE_TAU_S);
        }
        if (free(owned, 'Q')) {
          biquad.Q.setTargetAtTime(nodeQ(c.type, c.Q), t, FILTER_GLIDE_TAU_S);
        }
        if (free(owned, 'gain')) biquad.gain.setTargetAtTime(c.gain, t, FILTER_GLIDE_TAU_S);
      }
      // log edges
      setParam(biquad.detune, b.frequency.cents, immediate, ctx.currentTime, w, 'detune');
    },
    update(changed, owned, w) {
      if (!('enabled' in changed)) return;
      // With an owned parameter the runtime rebuilds the node instead (rebuildWhenOwned).
      if (!FILTER_KEYS.every((k) => free(owned, k))) return;
      stage.update({ ...last, enabled: changed.enabled }); // crossfaded
      did(w, changed, ['enabled'], 'crossfade');
    },
    stop() {},
    dispose() { stage.dispose(); },
    info: { stage },
    status: 'ready',
    reason: null,
  };
}

/**
 * K022 24 dB/oct: two identical biquads in series (low-, high-, band-pass and notch; the other
 * types keep one, nodes/processing.js CASCADES). Frequency, Q, gain and detune are
 * ConstantSourceNode buses both biquads follow, so a modulation edge, an automation lane and the
 * base each move one AudioParam and both stages with it; the values reaching the buses are
 * createFilterStage's (normalizeFilter: 10 Hz … 0.95 × Nyquist; nodeQ). `enabled` crossfades a
 * dry path as createFilterStage does.
 */
function cascade({ ctx, acct, at, params }) {
  const now = ctx.currentTime;
  const sr = ctx.sampleRate;
  let c = normalizeFilter(params, sr);
  const bus = (v) => {
    const k = acct.source(acct.track(ctx.createConstantSource()));
    k.offset.setValueAtTime(v, now);
    k.start(at);
    return k;
  };
  const buses = { frequency: bus(c.frequency), Q: bus(nodeQ(c.type, c.Q)), gain: bus(c.gain),
    detune: bus(0) };
  const input = acct.track(ctx.createGain());
  const output = acct.track(ctx.createGain());
  const dry = acct.track(ctx.createGain());
  const wet = acct.track(ctx.createGain());
  const stages = [acct.track(ctx.createBiquadFilter()), acct.track(ctx.createBiquadFilter())];
  input.connect(dry);
  dry.connect(output);
  input.connect(stages[0]);
  stages[0].connect(stages[1]);
  stages[1].connect(wet);
  wet.connect(output);
  for (const b of stages) {
    b.type = c.type;
    for (const k of ['frequency', 'Q', 'gain', 'detune']) {
      b[k].setValueAtTime(0, now); // the bus carries the value
      buses[k].connect(b[k]);
    }
  }
  wet.gain.setValueAtTime(c.enabled ? 1 : 0, now);
  dry.gain.setValueAtTime(c.enabled ? 0 : 1, now);
  const glide = (k, v) => buses[k].offset.setTargetAtTime(v, ctx.currentTime,
    FILTER_GLIDE_TAU_S);
  return {
    inputs: { audio: input },
    outputs: { audio: output },
    outputRange: {},
    modTarget(key, mapping) {
      if (key === 'frequency') {
        return mapping === 'log' ? { param: buses.detune.offset, scale: CENTS_PER_OCTAVE }
          : { param: buses.frequency.offset, scale: 1 };
      }
      if (key === 'Q') {
        if (qIsDecibels(params.type)) return { reason: CLIP_TARGET_TEXT.filterQ };
        if (!qIsUsed(params.type)) return { reason: CLIP_TARGET_TEXT.filterQUnused };
        return linearOnly(buses.Q.offset)(key, mapping);
      }
      if (key === 'gain') {
        if (!gainIsUsed(params.type)) return { reason: CLIP_TARGET_TEXT.filterGain };
        return linearOnly(buses.gain.offset)(key, mapping);
      }
      return { reason: `unknown parameter ${key}` };
    },
    applyBase(b, immediate, owned, w) {
      c = normalizeFilter({ ...c, frequency: b.frequency.value, Q: b.Q.value,
        gain: b.gain.value }, sr);
      const vals = { frequency: c.frequency, Q: nodeQ(c.type, c.Q), gain: c.gain };
      for (const [k, v] of Object.entries(vals)) {
        if (!free(owned, k)) continue;
        if (immediate) buses[k].offset.setValueAtTime(v, ctx.currentTime);
        else glide(k, v);
        if (w) w[k] = v;
      }
      setParam(buses.detune.offset, b.frequency.cents, immediate, ctx.currentTime, w, 'detune');
    },
    update(changed, owned, w) {
      if (!('enabled' in changed) || changed.enabled === c.enabled) return;
      c = { ...c, enabled: changed.enabled };
      const t = ctx.currentTime;
      for (const [g, v] of [[wet.gain, c.enabled ? 1 : 0], [dry.gain, c.enabled ? 0 : 1]]) {
        g.cancelScheduledValues(t);
        g.setTargetAtTime(v, t, FILTER_XFADE_TAU_S);
      }
      did(w, changed, ['enabled'], 'crossfade');
    },
    stop(t) {
      for (const k of Object.values(buses)) {
        try { k.stop(t); } catch (e) { /* already stopped */ }
      }
    },
    dispose() {},
    info: { stages, slope: 24 },
    status: 'ready',
    reason: null,
  };
}

const panNode = {
  compiler: 'audio/stereo.js#createStereoRouter',
  structural: [],
  create({ ctx, acct, params }) {
    if (typeof ctx.createStereoPanner === 'function') {
      // The engine's dual-voice panner (modulation.js buildDual): equal-power for a mono input,
      // and pan is an AudioParam, so it can be modulated. The input is forced to one channel.
      const input = acct.track(ctx.createGain());
      input.channelCount = 1;
      input.channelCountMode = 'explicit';
      input.channelInterpretation = 'speakers';
      const p = acct.track(ctx.createStereoPanner());
      p.pan.setValueAtTime(params.pan, ctx.currentTime);
      input.connect(p);
      return {
        inputs: { audio: input },
        outputs: { audio: p },
        outputRange: {},
        modTarget: (key, mapping) => (key === 'pan' ? linearOnly(p.pan)(key, mapping)
          : { reason: `unknown parameter ${key}` }),
        applyBase(b, immediate, owned, w) {
          if (free(owned, 'pan')) {
            setParam(p.pan, b.pan.value, immediate, ctx.currentTime, w, 'pan');
          }
        },
        update() {}, stop() {}, dispose() {},
        info: {},
        status: 'ready',
        reason: null,
      };
    }
    // Fallback: createStereoRouter in 'pan' mode with input A only (same equal-power law).
    const router = createStereoRouter(ctx, { mode: 'pan', panA: params.pan, levelB: 0 },
      { track: acct.track });
    return {
      inputs: { audio: router.inputA },
      outputs: { audio: router.output },
      outputRange: {},
      modTarget: () => ({ reason: 'Pan modulation needs StereoPannerNode (not available).' }),
      applyBase(b, immediate, owned, w) {
        router.update({ panA: b.pan.value });
        if (w) w.pan = b.pan.value;
      },
      update() {}, stop() {},
      dispose() { router.dispose(); },
      info: { router },
      status: 'ready',
      reason: null,
    };
  },
};

/** The bypassed Pan: the mono input on both channels, as at Centre; pan has no effect. */
export const pan = withBypass(panNode, (env) => {
  const h = panNode.create({ ...env, params: { ...env.params, pan: 0 } });
  return { ...h, modTarget: (key) => ({ reason: BYPASSED_TEXT(key) }), applyBase() {},
    info: { ...h.info, bypassed: true } };
});

export const stereoSplit = {
  compiler: 'audio/stereo.js#createStereoRouter',
  structural: [],
  create({ ctx, acct, params }) {
    const router = createStereoRouter(ctx, { mode: params.mode, panA: params.panA,
      panB: params.panB, levelA: params.levelA, levelB: params.levelB }, { track: acct.track });
    return {
      inputs: { a: router.inputA, b: router.inputB },
      outputs: { audio: router.output },
      outputRange: {},
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {},
      update(changed, owned, w) { // glides (stereo.js)
        router.update(changed);
        did(w, changed, Object.keys(changed), 'glide');
      },
      stop() {},
      dispose() { router.dispose(); },
      info: { router },
      status: 'ready',
      reason: null,
    };
  },
};

export const mixer = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, acct, params, def }) {
    // The only intentional summing node (§188): one level gain per input into one sum.
    const sum = acct.track(ctx.createGain());
    const inputs = {};
    const levels = {};
    for (const port of def.inputs.filter((p) => p.type === 'AUDIO')) {
      const key = `level${port.id.slice(2)}`;
      const g = acct.track(ctx.createGain());
      g.gain.setValueAtTime(params[key], ctx.currentTime);
      g.connect(sum);
      inputs[port.id] = g;
      levels[key] = g;
    }
    return {
      inputs,
      outputs: { audio: sum },
      outputRange: {},
      modTarget: (key, mapping) => (levels[key] ? linearOnly(levels[key].gain)(key, mapping)
        : { reason: `unknown parameter ${key}` }),
      applyBase(b, immediate, owned, w) {
        for (const [key, g] of Object.entries(levels)) {
          if (free(owned, key)) {
            setParam(g.gain, b[key].value, immediate, ctx.currentTime, w, key);
          }
        }
      },
      update() {}, stop() {}, dispose() {},
      info: {},
      status: 'ready',
      reason: null,
    };
  },
};

const driveNode = {
  compiler: 'audio/drive.js#createDriveStage',
  structural: [],
  create({ ctx, acct, params }) {
    // audio/drive.js: drive gain → tanh WaveShaper (4x) → trim → clip at DRIVE_CLIP (K012).
    const stage = createDriveStage(ctx, params, { track: acct.track });
    return {
      inputs: { audio: stage.input },
      outputs: { audio: stage.output },
      outputRange: {},
      modTarget: (key, mapping) => (key === 'trim' ? linearOnly(stage.trim.gain)(key, mapping)
        : { reason: `${key} is not modulatable` }),
      applyBase(b, immediate, owned, w) {
        // As on every other node: the static trim (the parameter, held at 0..1 by its
        // definition) plus the edges' constant part, never clamped as a sum, so each edge maps
        // its source's full range onto its own span (review of #267, R-2). Whatever the edges
        // add, the clip after the trim bounds the stage's output at DRIVE_CLIP.
        if (free(owned, 'trim')) {
          setParam(stage.trim.gain, b.trim.value, immediate, ctx.currentTime, w, 'trim');
        }
      },
      update(changed, owned, w) {
        if (!('drive' in changed)) return;
        stage.update({ drive: changed.drive }); // glides the drive gain
        did(w, changed, ['drive'], 'glide');
      },
      stop() {},
      dispose() { stage.dispose(); },
      info: { stage },
      status: 'ready',
      reason: null,
    };
  },
};

export const drive = withBypass(driveNode, passThrough);
