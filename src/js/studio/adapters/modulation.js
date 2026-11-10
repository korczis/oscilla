// Studio MODULATION adapters (nodes/modulation.js): LFO, Envelope, Random, Step Modulator,
// Macro, the step-voltage sequencer (K226).
// The adapter contract is the header of adapters/nodes.js.

import { mulberry32 } from '../../audio/noise.js';
import { applyAdsr, forgetParam, holdAt, releaseAt } from '../../audio/envelope.js';
import { CENTS_PER_OCTAVE } from '../../core/music.js';
import { CLIP_TARGET_TEXT } from '../clip-targets.js';
import { BIPOLAR, UNIPOLAR, did, free, inertHandle, linearOnly, setParam } from './common.js';
import { SVS_ROWS } from '../nodes/modulation.js';
import { svsHeld, svsLength, svsOrder, svsRoleValue, svsUnipolar } from '../step-voltage.js';

/** Why a log-mapped rate edge has no target where the browser lacks detune on a buffer. */
const NO_DETUNE_TEXT = 'This browser has no AudioBufferSourceNode.detune for log-mapped rate.';
/** Control-signal buffer resolution: samples per step of Random / Step Modulator. */
export const CONTROL_STEP_SAMPLES = 480;
/** Values in one Random loop (deterministic for the seed; the sequence repeats after them). */
export const RANDOM_LOOP_VALUES = 64;

/** K229: the morph shape's oscillators, in morph order (0 triangle, 0.5 sawtooth, 1 square). */
export const MORPH_TYPES = Object.freeze(['triangle', 'sawtooth', 'square']);
/** Points of each morph gain curve over the parameter's 0..1. */
export const MORPH_CURVE_SIZE = 65;
/** Why `morph` modulates nothing on an LFO of another shape (the lane policy's own reason). */
const MORPH_SHAPE_TEXT = CLIP_TARGET_TEXT.lfoMorph;
const LFO_NEEDS_CONSTANT_TEXT = 'LFO se synchronizací nebo prolínáním tvaru potřebuje '
  + 'ConstantSourceNode.';
const MORPH_LINEAR_TEXT = 'Prolínání tvaru se moduluje lineárně.';

/** The gains of triangle, sawtooth and square at morph m (0..1): a linear crossfade. */
export function morphGains(m) {
  const x = Math.min(1, Math.max(0, Number(m) || 0));
  return [Math.max(0, 1 - 2 * x), 1 - Math.abs(2 * x - 1), Math.max(0, 2 * x - 1)];
}

/** The three gain curves of the morph, `size` points over m 0..1: point i is m i / (size - 1). */
export function morphCurves(size = MORPH_CURVE_SIZE) {
  const out = MORPH_TYPES.map(() => new Float32Array(size));
  for (let i = 0; i < size; i++) morphGains(i / (size - 1)).forEach((g, k) => { out[k][i] = g; });
  return out;
}

/**
 * A morph curve as a WaveShaper applies it: over its input -1..1. The morph source carries m
 * itself (a lane or an edge writes it in the parameter's unit), so the curve's upper half is the
 * curve over 0..1 and its lower half holds the value at m 0.
 */
const shaperCurve = (curve) => {
  const n = curve.length;
  const out = new Float32Array(2 * n - 1);
  out.fill(curve[0], 0, n - 1);
  out.set(curve, n - 1);
  return out;
};

/**
 * K229: the LFO that restarts its phase on a reset trigger (key sync: plan node `clocked`, a
 * reset edge), or that morphs its shape (shape 'morph'). A voice is its oscillators (one, or the
 * three of the morph) started at its time; clock(t) starts a fresh voice at t and stops the one
 * before at t. Each voice's frequency is the shared rate source (the oscillators' own frequency
 * held at 0), so the rate's base, edges and automation act on every voice, as do the morph
 * source and the depth gain. clockFrom(t) drops the voices from t on and starts one at t.
 */
function resettableLfo({ ctx, hooks, acct, at, params, clocked }) {
  if (typeof ctx.createConstantSource !== 'function') {
    return inertHandle('degraded', LFO_NEEDS_CONSTANT_TEXT);
  }
  const morphing = params.shape === 'morph';
  const types = morphing ? MORPH_TYPES : [params.shape];
  const now0 = ctx.currentTime;
  const depth = acct.track(ctx.createGain());
  depth.gain.setValueAtTime(params.depth ?? 1, now0);
  const constant = (v) => {
    const c = acct.source(acct.track(ctx.createConstantSource()));
    c.offset.setValueAtTime(v, now0);
    return c;
  };
  const rate = constant(hooks.clampFrequency(params.rate));
  const detune = constant(0);
  const morph = morphing ? constant(params.morph ?? 0) : null;
  const shapers = morphing ? morphCurves().map((curve) => {
    const w = acct.track(ctx.createWaveShaper());
    w.curve = shaperCurve(curve);
    morph.connect(w);
    return w;
  }) : [];
  for (const c of [rate, detune, morph]) if (c) c.start(at);
  const voices = [];
  // C1-K229-1: a voice whose oscillators have all ended is retired. The shared sources stop
  // feeding it (rate and detune into its oscillators, each morph shaper into its gain), and it
  // leaves `voices` unless it is still the current (last) one. Before this every reset kept its
  // voice and connections for the whole play (400 resets: 404 voices).
  const retire = (v) => {
    v.oscs.forEach((o, k) => {
      try { rate.disconnect(o.frequency); } catch (e) { /* already disconnected */ }
      try { detune.disconnect(o.detune); } catch (e) { /* already disconnected */ }
      const g = v.gains[k];
      if (g) { try { shapers[k].disconnect(g.gain); } catch (e) { /* already disconnected */ } }
    });
    const i = voices.indexOf(v);
    if (i >= 0 && i !== voices.length - 1) voices.splice(i, 1);
  };
  const voice = (t) => {
    // A current voice that ended before this reset (its stop was reached) was kept as the last
    // one; it goes now, so no ended voice stays held for good (oscilla-04's review).
    const last = voices.at(-1);
    if (last && last.live === 0) voices.pop();
    const v = { start: t, types: [...types], oscs: [], gains: [], live: types.length };
    v.oscs = types.map((type, k) => {
      const o = acct.source(acct.track(hooks.oscillator(type, 1, t)));
      o.frequency.cancelScheduledValues(0);
      o.frequency.setValueAtTime(0, now0);
      rate.connect(o.frequency);
      detune.connect(o.detune);
      o.addEventListener('ended', () => {
        v.live -= 1;
        if (v.live === 0) retire(v);
      });
      if (!morphing) {
        o.connect(depth);
        return o;
      }
      const g = acct.track(ctx.createGain());
      v.gains[k] = g;
      g.gain.setValueAtTime(0, now0);
      shapers[k].connect(g.gain);
      o.connect(g);
      g.connect(depth);
      o.addEventListener('ended', () => {
        try { g.disconnect(); } catch (e) { /* already disconnected */ }
        acct.untrack(g);
      });
      return o;
    });
    voices.push(v);
  };
  const stopVoice = (v, t) => {
    for (const o of v.oscs) { try { o.stop(Math.max(t, v.start)); } catch (e) { /* stopped */ } }
  };
  voice(at);
  const handle = {
    inputs: {},
    outputs: { control: depth },
    outputRange: { control: BIPOLAR },
    modTarget(key, mapping) {
      if (key === 'depth') return linearOnly(depth.gain)(key, mapping);
      if (key === 'morph') {
        if (!morph) return { reason: MORPH_SHAPE_TEXT };
        return mapping === 'log' ? { reason: MORPH_LINEAR_TEXT } : { param: morph.offset, scale: 1 };
      }
      if (key !== 'rate') return { reason: `unknown parameter ${key}` };
      return mapping === 'log' ? { param: detune.offset, scale: CENTS_PER_OCTAVE }
        : { param: rate.offset, scale: 1 };
    },
    applyBase(b, immediate, owned, w) {
      const now = ctx.currentTime;
      if (free(owned, 'rate')) {
        setParam(rate.offset, hooks.clampFrequency(b.rate.value), immediate, now, w, 'rate');
      }
      setParam(detune.offset, b.rate.cents, immediate, now, w, 'detune'); // log-mapped edges only
      if (b.depth && free(owned, 'depth')) {
        setParam(depth.gain, b.depth.value, immediate, now, w, 'depth');
      }
      if (morph && b.morph && free(owned, 'morph')) {
        setParam(morph.offset, b.morph.value, immediate, now, w, 'morph');
      }
    },
    update() {},
    stop(t) {
      for (const v of voices) stopVoice(v, t);
      for (const c of [rate, detune, morph]) {
        if (c) { try { c.stop(t); } catch (e) { /* already stopped */ } }
      }
    },
    dispose() {},
    info: {
      voices: () => voices.map((v) => ({ start: v.start, types: v.types })),
      rate, detune, morph, shapers,
      /** The oscillators and morph gains of the voices still held (what the sources feed). */
      held: () => voices.map((v) => ({ oscs: [...v.oscs], gains: v.gains.filter(Boolean) })),
    },
    status: 'ready',
    reason: null,
  };
  if (clocked) {
    handle.clock = (t) => {
      const last = voices.at(-1);
      if (last.start >= t) return; // a voice starts there already
      stopVoice(last, t);
      voice(t);
    };
    handle.clockFrom = (t) => {
      while (voices.length > 1 && voices.at(-1).start >= t) stopVoice(voices.pop(), 0);
      handle.clock(t);
    };
  }
  return handle;
}

export const lfo = {
  compiler: 'audio/modulation.js#buildLfo',
  structural: ['shape'],
  clock: 'reset', // K229: a reset edge (key sync) makes the node clocked
  create(env) {
    const clocked = !!(env.node && env.node.clocked);
    if (clocked || env.params.shape === 'morph') return resettableLfo({ ...env, clocked });
    return plainLfo(env);
  },
};

/** The LFO without a reset edge and of a fixed shape, as before K229. */
function plainLfo({ ctx, hooks, acct, at, params }) {
  // buildLfo's modulator: an engine oscillator whose output drives a depth gain into the
  // target parameter (here the depth gain belongs to the modulation edge, §35).
  const osc = acct.source(acct.track(hooks.oscillator(params.shape, params.rate, at)));
  // K022: the output's depth (0..1), a gain after the oscillator, modulatable (a Macro on an
  // LFO's depth). The control range stays −1..1: the base is at most 1.
  const depth = acct.track(ctx.createGain());
  depth.gain.setValueAtTime(params.depth ?? 1, ctx.currentTime);
  osc.connect(depth);
  return {
    inputs: {},
    outputs: { control: depth },
    outputRange: { control: BIPOLAR },
    modTarget(key, mapping) {
      if (key === 'depth') return linearOnly(depth.gain)(key, mapping);
      if (key === 'morph') return { reason: MORPH_SHAPE_TEXT };
      if (key !== 'rate') return { reason: `unknown parameter ${key}` };
      return mapping === 'log' ? { param: osc.detune, scale: CENTS_PER_OCTAVE }
        : { param: osc.frequency, scale: 1 };
    },
    applyBase(b, immediate, owned, w) {
      const now = ctx.currentTime;
      // Audio rate (K010): 0.01 Hz … 0.95 × Nyquist of the running context, the engine's own
      // clamp (computeBases lowers the base there first and reports it as limited).
      if (free(owned, 'rate')) {
        setParam(osc.frequency, hooks.clampFrequency(b.rate.value), immediate, now, w, 'rate');
      }
      setParam(osc.detune, b.rate.cents, immediate, now, w, 'detune'); // log-mapped edges only
      if (b.depth && free(owned, 'depth')) {
        setParam(depth.gain, b.depth.value, immediate, now, w, 'depth');
      }
    },
    update() {},
    stop(t) { try { osc.stop(t); } catch (e) { /* already stopped */ } },
    dispose() {},
    info: { oscillator: osc },
    status: 'ready',
    reason: null,
  };
}

// K230: a delay and a hold join the ADSR only when longer than 0 (DADSR / AHDSR).
const adsrOf = (p) => ({ a: p.attack, d: p.decay, s: p.sustain, r: p.release,
  ...(p.delay > 0 ? { delay: p.delay } : {}), ...(p.hold > 0 ? { hold: p.hold } : {}) });

export const envelope = {
  compiler: 'audio/envelope.js#applyAdsr',
  structural: [],
  create({ ctx, acct, at, params, gated = false }) {
    // envelope.js on a VCA gain (the V1 `env` node) and, for the CONTROL output, on the offset
    // of a ConstantSourceNode (the contour, 0..1). Without a gate edge or timeline events the
    // gate opens when the graph starts and stays open while it plays. An envelope its owner
    // gates (`gated`, runtime setOwnedParams) is built closed: gate off at `at`, before the
    // attack, so nothing opens it until its owner's first gate, however late that owner runs
    // (review of #332, V4: a stalled first Arm sounded the attack and a full release).
    let adsr = adsrOf(params);
    const vca = acct.track(ctx.createGain());
    let contour = null;
    if (typeof ctx.createConstantSource === 'function') {
      contour = acct.source(acct.track(ctx.createConstantSource()));
    }
    const params2 = () => (contour ? [vca.gain, contour.offset] : [vca.gain]);
    for (const p of params2()) {
      applyAdsr(p, at, adsr);
      if (gated) releaseAt(p, at, adsr.r); // held at the floor from `at`: no attack, no ramp
    }
    if (contour) contour.start(at);
    return {
      inputs: { audio: vca },
      outputs: contour ? { audio: vca, control: contour } : { audio: vca },
      outputRange: { control: UNIPOLAR },
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {},
      update(changed, owned, w) { // the next gate
        // The runtime hands over only the keys that changed: merge them into the node's
        // current parameters, so a later edit of another key keeps this one (C061).
        params = { ...params, ...changed };
        adsr = adsrOf(params);
        did(w, changed, Object.keys(changed), 'next-gate');
      },
      /** Gate on at t (retriggered from the current value), off after durS (timeline hook). */
      gate(t, durS) {
        for (const p of params2()) {
          applyAdsr(p, t, adsr, 1, { retrigger: true });
          if (durS != null) releaseAt(p, t + durS, adsr.r);
        }
      },
      /** Gate off at t: release from the value the contour has there (timeline hook). */
      release(t) {
        for (const p of params2()) releaseAt(p, t, adsr.r);
      },
      /** Hold the contour at t, dropping everything scheduled after it (timeline edits). */
      hold(t) {
        for (const p of params2()) holdAt(p, t);
      },
      stop(t) { if (contour) { try { contour.stop(t); } catch (e) { /* stopped */ } } },
      dispose() { for (const p of params2()) forgetParam(p); },
      info: { adsr: () => ({ ...adsr }) },
      status: 'ready',
      reason: contour ? null : 'The envelope control output needs ConstantSourceNode.',
    };
  },
};

/**
 * A looping control signal from a buffer of values (Random, Step Modulator): an
 * AudioBufferSourceNode whose playbackRate sets the step rate, so rate modulation is an
 * AudioParam (detune for log-mapped edges). Each value lasts CONTROL_STEP_SAMPLES samples at
 * playbackRate 1, i.e. a reference rate of sampleRate / CONTROL_STEP_SAMPLES steps per second.
 */
function steppedControl({ ctx, acct, at, values, smooth, holdLast, rate }) {
  const per = CONTROL_STEP_SAMPLES;
  const n = values.length;
  const buf = ctx.createBuffer(1, n * per, ctx.sampleRate);
  const data = new Float32Array(n * per);
  for (let i = 0; i < n; i++) {
    const v0 = values[i];
    const v1 = values[(i + 1) % n];
    for (let k = 0; k < per; k++) {
      data[i * per + k] = smooth && !(holdLast && i === n - 1) ? v0 + ((v1 - v0) * k) / per : v0;
    }
  }
  buf.copyToChannel(data, 0);
  const src = acct.source(acct.track(ctx.createBufferSource()));
  src.buffer = buf;
  src.loop = true;
  const refRate = ctx.sampleRate / per;
  if (holdLast) {
    src.loopStart = ((n - 1) * per) / ctx.sampleRate;
    src.loopEnd = (n * per) / ctx.sampleRate;
  }
  src.playbackRate.setValueAtTime(rate / refRate, ctx.currentTime);
  src.start(at);
  return {
    src,
    modTarget(key, mapping) {
      if (key !== 'rate') return { reason: `unknown parameter ${key}` };
      if (mapping === 'log') {
        return src.detune ? { param: src.detune, scale: CENTS_PER_OCTAVE }
          : { reason: NO_DETUNE_TEXT };
      }
      return { param: src.playbackRate, scale: 1 / refRate };
    },
    applyBase(b, immediate, owned, w) {
      const now = ctx.currentTime;
      if (free(owned, 'rate')) {
        setParam(src.playbackRate, Math.max(0, b.rate.value) / refRate, immediate, now);
        if (w) w.rate = Math.max(0, b.rate.value); // in the parameter's unit (Hz)
      }
      if (src.detune) setParam(src.detune, b.rate.cents, immediate, now, w, 'detune'); // log edges
    },
  };
}

/**
 * A clocked control signal (Random, Step Modulator with a clock edge: plan node `clocked`): a
 * ConstantSourceNode whose offset holds step 0 from the start and steps on the transport's
 * triggers, on the audio clock (V272 A2). clock(t, k): the k-th trigger of the playback (k from
 * 0) sets step `stepAt(k)` at t; clockFrom(t, k) drops the steps scheduled from t on and holds
 * step `stepAt(k)` there (an edit re-renders the triggers after it). Rate has no effect.
 */
function clockedControl({ ctx, acct, at, stepAt, name }) {
  if (typeof ctx.createConstantSource !== 'function') {
    return inertHandle('degraded', `A clocked ${name} needs ConstantSourceNode.`);
  }
  const src = acct.source(acct.track(ctx.createConstantSource()));
  src.offset.setValueAtTime(stepAt(0), ctx.currentTime);
  src.start(at);
  return {
    inputs: {},
    outputs: { control: src },
    outputRange: { control: BIPOLAR },
    modTarget: (key) => ({ reason: key === 'rate'
      ? `A clocked ${name} steps on its clock trigger; rate has no effect.`
      : `unknown parameter ${key}` }),
    applyBase() {},
    update() {},
    clock(t, k) { src.offset.setValueAtTime(stepAt(k), t); },
    clockFrom(t, k) {
      src.offset.cancelScheduledValues(t);
      src.offset.setValueAtTime(stepAt(k), t);
    },
    stop(t) { try { src.stop(t); } catch (e) { /* already stopped */ } },
    dispose() {},
    info: { clocked: true },
    status: 'ready',
    reason: null,
  };
}

function controlHandle(sc, info) {
  return {
    inputs: {},
    outputs: { control: sc.src },
    outputRange: { control: BIPOLAR },
    modTarget: sc.modTarget,
    applyBase: sc.applyBase,
    update() {},
    stop(t) { try { sc.src.stop(t); } catch (e) { /* already stopped */ } },
    dispose() {},
    info,
    status: 'ready',
    reason: null,
  };
}

export const random = {
  compiler: 'audio/noise.js#mulberry32',
  structural: ['seed', 'smooth'],
  clock: 'trigger',
  create(env) {
    const rng = mulberry32(env.params.seed);
    const values = Array.from({ length: RANDOM_LOOP_VALUES }, () => rng() * 2 - 1);
    if (env.node && env.node.clocked) {
      // Sample and hold: the seeded loop, one value per trigger (smooth: free-running only).
      return clockedControl({ ...env, name: 'Random',
        stepAt: (k) => values[k % RANDOM_LOOP_VALUES] });
    }
    const sc = steppedControl({ ...env, values, smooth: env.params.smooth, holdLast: false,
      rate: env.params.rate });
    return controlHandle(sc, { values, loopValues: RANDOM_LOOP_VALUES });
  },
};

/**
 * K022 Step quantize: 'semitone' rounds each step to a twelfth (one semitone under a pitch edge
 * that maps 1 to one octave, as the Keys pitch cable does); 'off' keeps the values.
 */
export function quantizeSteps(steps, quantize) {
  return quantize === 'semitone' ? steps.map((v) => Math.round(v * 12) / 12 || 0) : [...steps];
}

export const stepModulator = {
  compiler: 'audio/scheduler.js#scheduleSteps',
  structural: ['steps', 'playback', 'quantize'],
  clock: 'clock',
  create(env) {
    const values = quantizeSteps(env.params.steps, env.params.quantize);
    if (env.node && env.node.clocked) {
      const once = env.params.playback === 'once';
      return clockedControl({ ...env, name: 'Step Modulator',
        stepAt: (k) => values[once ? Math.min(k, values.length - 1) : k % values.length] });
    }
    const sc = steppedControl({ ...env, values, smooth: false,
      holdLast: env.params.playback === 'once', rate: env.params.rate });
    return controlHandle(sc, { values });
  },
};

/** What the step-voltage sequencer's rate says when a clock steps it (K226). */
export const SVS_CLOCKED_RATE_TEXT = 'Krokový sekvencer CV krokuje taktem; Rate nemá vliv.';

/**
 * K226: the step-voltage sequencer. Clocked (a clock edge or a trigger clip: plan node
 * `clocked`), three ConstantSourceNodes hold its rows A, B and C, each set to the step the k-th
 * step taken (k counted from PLAY or the last reset by the transport's fan-out) plays, on the
 * audio clock: clock(t, k) and clockFrom(t, k) as clockedControl's. Free-running (no clock), one
 * three-channel looped buffer of one cycle of steps at its rate, split into the three rows, so a
 * rate edge moves the three together; its TRIGGER outputs fire on clocked steps only.
 */
export const stepVoltageSequencer = {
  compiler: 'audio/scheduler.js#scheduleSteps',
  structural: ['rowA', 'rowB', 'rowC', 'roleA', 'roleB', 'roleC', 'skip', 'length', 'playback'],
  clock: 'clock',
  create(env) {
    const { ctx, acct, at, params } = env;
    const n = svsLength(params);
    // Each row as its role carries it (step-voltage.js svsRoleValue).
    const roles = SVS_ROWS.map(([, , r]) => params[`role${r}`]);
    const rows = SVS_ROWS.map(([key], r) => params[key].slice(0, n)
      .map((v) => svsRoleValue(roles[r], v)));
    const ports = SVS_ROWS.map(([, port]) => port);
    const outputRange = Object.fromEntries(ports.map((p, r) => [p,
      svsUnipolar(roles[r]) ? UNIPOLAR : BIPOLAR]));
    if (env.node && env.node.clocked) {
      if (typeof ctx.createConstantSource !== 'function') {
        return inertHandle('degraded', 'Krokový sekvencer CV s taktem potřebuje '
          + 'ConstantSourceNode.');
      }
      const srcs = rows.map((row) => {
        const src = acct.source(acct.track(ctx.createConstantSource()));
        src.offset.setValueAtTime(row[0], ctx.currentTime);
        src.start(at);
        return src;
      });
      const set = (t, k) => {
        const i = svsHeld(params, k);
        srcs.forEach((src, r) => src.offset.setValueAtTime(rows[r][i], t));
      };
      return {
        inputs: {},
        outputs: Object.fromEntries(ports.map((p, r) => [p, srcs[r]])),
        outputRange,
        modTarget: (key) => ({ reason: key === 'rate' ? SVS_CLOCKED_RATE_TEXT
          : `unknown parameter ${key}` }),
        applyBase() {},
        update() {},
        clock: set,
        clockFrom(t, k) {
          for (const src of srcs) src.offset.cancelScheduledValues(t);
          set(t, k);
        },
        stop(t) {
          for (const src of srcs) { try { src.stop(t); } catch (e) { /* already stopped */ } }
        },
        dispose() {},
        info: { clocked: true, length: n },
        status: 'ready',
        reason: null,
      };
    }
    // Free-running: one cycle of steps per channel (a 'once' run loops its last step).
    const order = svsOrder(params);
    const holdLast = params.playback === 'once';
    const per = CONTROL_STEP_SAMPLES;
    const buf = ctx.createBuffer(rows.length, order.length * per, ctx.sampleRate);
    rows.forEach((row, r) => {
      const data = new Float32Array(order.length * per);
      order.forEach((i, j) => data.fill(row[i], j * per, (j + 1) * per));
      buf.copyToChannel(data, r);
    });
    const src = acct.source(acct.track(ctx.createBufferSource()));
    src.buffer = buf;
    src.loop = true;
    const refRate = ctx.sampleRate / per;
    if (holdLast) {
      src.loopStart = ((order.length - 1) * per) / ctx.sampleRate;
      src.loopEnd = (order.length * per) / ctx.sampleRate;
    }
    src.playbackRate.setValueAtTime(params.rate / refRate, ctx.currentTime);
    const split = acct.track(ctx.createChannelSplitter(rows.length));
    src.connect(split);
    const outs = rows.map((_, r) => {
      const g = acct.track(ctx.createGain());
      split.connect(g, r);
      return g;
    });
    src.start(at);
    return {
      inputs: {},
      outputs: Object.fromEntries(ports.map((p, r) => [p, outs[r]])),
      outputRange,
      modTarget(key, mapping) {
        if (key !== 'rate') return { reason: `unknown parameter ${key}` };
        if (mapping === 'log') {
          return src.detune ? { param: src.detune, scale: CENTS_PER_OCTAVE }
            : { reason: NO_DETUNE_TEXT };
        }
        return { param: src.playbackRate, scale: 1 / refRate };
      },
      applyBase(b, immediate, owned, w) {
        const now = ctx.currentTime;
        if (free(owned, 'rate')) {
          setParam(src.playbackRate, Math.max(0, b.rate.value) / refRate, immediate, now);
          if (w) w.rate = Math.max(0, b.rate.value);
        }
        if (src.detune) setParam(src.detune, b.rate.cents, immediate, now, w, 'detune');
      },
      update() {},
      stop(t) { try { src.stop(t); } catch (e) { /* already stopped */ } },
      dispose() {},
      info: { clocked: false, length: n, order, source: src },
      status: 'ready',
      reason: null,
    };
  },
};

/** Why a Macro has no output where the browser lacks ConstantSourceNode. */
export const MACRO_UNAVAILABLE_TEXT = 'The Macro needs ConstantSourceNode, which this browser '
  + 'lacks.';
/**
 * Points of the Macro's clip curve: 41 points 0.05 apart on [−1, 1], so 0 and 1 are points and
 * the browser's linear interpolation between points is the exact identity on [0, 1].
 */
export const MACRO_CLIP_CURVE_SIZE = 41;

/** The Macro's clip curve: clamp(x, 0, 1), x evenly spaced on [−1, 1]. */
export function macroClipCurve(size = MACRO_CLIP_CURVE_SIZE) {
  const out = new Float32Array(size);
  const mid = (size - 1) / 2;
  for (let i = 0; i < size; i++) out[i] = Math.min(1, Math.max(0, (i - mid) / mid));
  return out;
}

export const macro = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, acct, at, params }) {
    // One ConstantSourceNode: its offset is the value (0..1); the edges scale it (K013). The
    // value is modulatable, so what reaches the offset can leave 0..1; a clip (WaveShaper,
    // oversample 'none', the identity on [0, 1] and 0 or 1 beyond) is the output, so the
    // output stays in the UNIPOLAR range computeBases sizes every outgoing edge from and a
    // downstream frequency keeps its 0.95 × Nyquist headroom (review of #267, R-1).
    if (typeof ctx.createConstantSource !== 'function') {
      return inertHandle('degraded', MACRO_UNAVAILABLE_TEXT);
    }
    const cs = acct.source(acct.track(ctx.createConstantSource()));
    const clip = acct.track(ctx.createWaveShaper());
    clip.curve = macroClipCurve();
    clip.oversample = 'none';
    cs.offset.setValueAtTime(params.value, ctx.currentTime);
    cs.connect(clip);
    cs.start(at);
    return {
      inputs: {},
      outputs: { control: clip },
      outputRange: { control: UNIPOLAR },
      modTarget: (key, mapping) => (key === 'value' ? linearOnly(cs.offset)(key, mapping)
        : { reason: `unknown parameter ${key}` }),
      applyBase(b, immediate, owned, w) {
        if (free(owned, 'value')) {
          setParam(cs.offset, b.value.value, immediate, ctx.currentTime, w, 'value');
        }
      },
      update() {},
      stop(t) { try { cs.stop(t); } catch (e) { /* already stopped */ } },
      dispose() {},
      info: { source: cs, clip },
      status: 'ready',
      reason: null,
    };
  },
};

/**
 * The Clock (K023): no audio node at all. Its TRIGGER output is logical: the timeline compiler
 * plans its ticks (timeline-compiler.js clockItems) and the transport fans each one out along
 * the Clock's trigger edges, as it does a pattern clip's (transport.js fanOut).
 */
export const clock = {
  compiler: 'studio/timeline-compiler.js#compilePass',
  structural: [],
  create() {
    return {
      inputs: {},
      outputs: {},
      outputRange: {},
      modTarget: (key) => ({ reason: `${key}: Clock nemá modulovatelný parametr` }),
      applyBase() {},
      update() {},
      stop() {},
      dispose() {},
      info: { clock: true },
      status: 'ready',
      reason: null,
    };
  },
};
