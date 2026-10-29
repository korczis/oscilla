// Studio PROCESSING adapters (nodes/processing.js): Gain, Filter, Pan, Stereo Split, Mixer,
// Drive.
// The adapter contract is the header of adapters/nodes.js.

import { createFilterStage, nodeQ, normalizeFilter } from '../../audio/filters.js';
import { createStereoRouter } from '../../audio/stereo.js';
import { createDriveStage } from '../../audio/drive.js';
import { CLIP_TARGET_TEXT, gainIsUsed, qIsDecibels, qIsUsed } from '../clip-targets.js';
import { CENTS_PER_OCTAVE } from '../../core/music.js';
import { did, free, linearOnly, setParam } from './common.js';

/** filters.js GLIDE_TAU_S: the stage's own parameter glide (not exported there). */
const FILTER_GLIDE_TAU_S = 0.01;
/** The filter parameters createFilterStage.update writes together. */
const FILTER_KEYS = Object.freeze(['frequency', 'Q', 'gain']);

export const gain = {
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

export const filter = {
  compiler: 'audio/filters.js#createFilterStage',
  // A type change would make createFilterStage crossfade to its second biquad, away from the
  // AudioParams the modulation edges are wired to: rebuild and crossfade at the graph level.
  structural: ['type'],
  // createFilterStage.update re-glides frequency, Q and gain for every change, the bypass
  // included, and cannot skip one: with an owned parameter a bypass change rebuilds the node.
  rebuildWhenOwned: ['enabled'],
  create({ ctx, acct, params }) {
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
  },
};

export const pan = {
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

export const drive = {
  compiler: 'audio/drive.js#createDriveStage',
  structural: [],
  create({ ctx, acct, params }) {
    // audio/drive.js: drive gain → tanh WaveShaper (4x oversampling) → trim ≤ 1 (K012).
    const stage = createDriveStage(ctx, params, { track: acct.track });
    const trimOf = (v) => Math.min(1, Math.max(0, v));
    return {
      inputs: { audio: stage.input },
      outputs: { audio: stage.output },
      outputRange: {},
      modTarget: (key, mapping) => (key === 'trim' ? linearOnly(stage.output.gain)(key, mapping)
        : { reason: `${key} is not modulatable` }),
      applyBase(b, immediate, owned, w) {
        // The static trim (edge offsets included) is held at 0..1, as createDriveStage holds it.
        if (free(owned, 'trim')) {
          setParam(stage.output.gain, trimOf(b.trim.value), immediate, ctx.currentTime, w,
            'trim');
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
