// Studio MODULATION adapters (nodes/modulation.js): LFO, Envelope, Random, Step Modulator.
// The adapter contract is the header of adapters/nodes.js.

import { mulberry32 } from '../../audio/noise.js';
import { applyAdsr, forgetParam, holdAt, releaseAt } from '../../audio/envelope.js';
import { CENTS_PER_OCTAVE } from '../../core/music.js';
import { BIPOLAR, UNIPOLAR, did, free, inertHandle, setParam } from './common.js';

/** Control-signal buffer resolution: samples per step of Random / Step Modulator. */
export const CONTROL_STEP_SAMPLES = 480;
/** Values in one Random loop (deterministic for the seed; the sequence repeats after them). */
export const RANDOM_LOOP_VALUES = 64;

export const lfo = {
  compiler: 'audio/modulation.js#buildLfo',
  structural: ['shape'],
  create({ ctx, hooks, acct, at, params }) {
    // buildLfo's modulator: an engine oscillator whose output drives a depth gain into the
    // target parameter (here the depth gain belongs to the modulation edge, §35).
    const osc = acct.source(acct.track(hooks.oscillator(params.shape, params.rate, at)));
    return {
      inputs: {},
      outputs: { control: osc },
      outputRange: { control: BIPOLAR },
      modTarget(key, mapping) {
        if (key !== 'rate') return { reason: `unknown parameter ${key}` };
        return mapping === 'log' ? { param: osc.detune, scale: CENTS_PER_OCTAVE }
          : { param: osc.frequency, scale: 1 };
      },
      applyBase(b, immediate, owned, w) {
        const now = ctx.currentTime;
        if (free(owned, 'rate')) {
          setParam(osc.frequency, Math.max(0.01, b.rate.value), immediate, now, w, 'rate');
        }
        setParam(osc.detune, b.rate.cents, immediate, now, w, 'detune'); // log-mapped edges only
      },
      update() {},
      stop(t) { try { osc.stop(t); } catch (e) { /* already stopped */ } },
      dispose() {},
      info: { oscillator: osc },
      status: 'ready',
      reason: null,
    };
  },
};

const adsrOf = (p) => ({ a: p.attack, d: p.decay, s: p.sustain, r: p.release });

export const envelope = {
  compiler: 'audio/envelope.js#applyAdsr',
  structural: [],
  create({ ctx, acct, at, params }) {
    // envelope.js on a VCA gain (the V1 `env` node) and, for the CONTROL output, on the offset
    // of a ConstantSourceNode (the contour, 0..1). Without a gate edge or timeline events the
    // gate opens when the graph starts and stays open while it plays.
    let adsr = adsrOf(params);
    const vca = acct.track(ctx.createGain());
    applyAdsr(vca.gain, at, adsr);
    let contour = null;
    if (typeof ctx.createConstantSource === 'function') {
      contour = acct.source(acct.track(ctx.createConstantSource()));
      applyAdsr(contour.offset, at, adsr);
      contour.start(at);
    }
    const params2 = () => (contour ? [vca.gain, contour.offset] : [vca.gain]);
    return {
      inputs: { audio: vca },
      outputs: contour ? { audio: vca, control: contour } : { audio: vca },
      outputRange: { control: UNIPOLAR },
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {},
      update(changed, owned, w) { // the next gate
        adsr = adsrOf({ ...params, ...changed });
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
          : { reason: 'This browser has no AudioBufferSourceNode.detune for log-mapped rate.' };
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

export const stepModulator = {
  compiler: 'audio/scheduler.js#scheduleSteps',
  structural: ['steps', 'playback'],
  clock: 'clock',
  create(env) {
    const values = [...env.params.steps];
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
