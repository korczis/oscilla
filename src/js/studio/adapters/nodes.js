// Studio node adapters (spec §41-§42, §170-§171, §186-§190, §240): one adapter per registry node
// type, each naming the registry `compiler` key it implements and building the node ONLY from
// the existing V1/V2/V3 builders (AudioEngine helpers, createFilterStage, createStereoRouter,
// createNoiseSource, applyAdsr/releaseAt, renderStimulus, openMicrophone,
// createAnalyserReader, createRtaAverager). Studio is orchestration: no DSP is re-implemented
// here. Every node is created through `acct.track` / `acct.source` (engine accounting).
//
// adapter = { compiler, structural: [paramKey], check?(params, caps) -> reason | null,
//             create(env) -> handle }
// env     = { ctx, hooks, acct: { track, source }, now, at, params, node, def, options }
// handle  = { inputs: { portId: AudioNode }, outputs: { portId: AudioNode },
//             outputRange: { portId: [lo, hi] }        control signal range (default [-1, 1]),
//             modTarget(key, mapping) -> { param: AudioParam, scale } | { reason },
//             applyBase(base, immediate)  base = { key: { value, cents } } for modulatable keys
//                                         (value in the parameter's unit incl. edge offsets,
//                                         cents from log-mapped edges),
//             update(changed)             live change of non-modulatable, non-structural keys,
//             stop(at)                    sources stop at `at` (the route fades end before it),
//             dispose()                   the builder's own dispose (the runtime then
//                                         disconnects and untracks every tracked node),
//             info, status: 'ready' | 'degraded' | 'offline-only' | 'data' | 'pending',
//             reason }
// `structural` keys cannot change on a running node (OscillatorNode.type, a filter type that
// would swap the biquad the modulation is wired to, a sweep's whole schedule, ...): the
// runtime builds a replacement node and crossfades to it (spec §45).
//
// Degraded nodes (§171) are explicit handles with a reason, never exceptions: Microphone
// without getUserMedia (file:// in some browsers) or before permission, Recorder (offline
// only), a missing ConstantSourceNode / StereoPannerNode feature.

import { MIC_UNAVAILABLE_TEXT, closeMicrophone, hasMicrophoneApi, micErrorMessage, openMicrophone }
  from '../../audio/microphone.js';
import { createFilterStage } from '../../audio/filters.js';
import { createStereoRouter } from '../../audio/stereo.js';
import { createNoiseSource, mulberry32 } from '../../audio/noise.js';
import { applyAdsr, forgetParam, releaseAt } from '../../audio/envelope.js';
import { renderStimulus } from '../../measurement/stimulus.js';
import { createAnalyserReader } from '../../analysis/analyser.js';
import { createRamp } from './ramp.js';
import { createRtaAverager } from '../../measurement/rta.js';

/** Glide of a parameter change: the engine's live-update time constant (updateLive, τ 15 ms). */
export const PARAM_TAU_S = 0.015;
/** Control-signal buffer resolution: samples per step of Random / Step Modulator. */
export const CONTROL_STEP_SAMPLES = 480;
/** Values in one Random loop (deterministic for the seed; the sequence repeats after them). */
export const RANDOM_LOOP_VALUES = 64;
/** Fade of a rendered Studio sweep: min(SWEEP_FADE_S, duration / 4) (recipeFromStudio too). */
export const SWEEP_FADE_S = 0.01;
const CENTS_PER_OCTAVE = 1200;

const BIPOLAR = Object.freeze([-1, 1]);
const UNIPOLAR = Object.freeze([0, 1]);

function setParam(param, value, immediate, now) {
  if (immediate) param.setValueAtTime(value, now);
  else param.setTargetAtTime(value, now, PARAM_TAU_S);
}

const linearOnly = (param) => (key, mapping) => (mapping === 'log'
  ? { reason: `${key} has no logarithmic modulation input` } : { param, scale: 1 });

/** A handle with no audio nodes (degraded, offline-only or analysis data). */
export function inertHandle(status, reason, info = {}) {
  return {
    inputs: {}, outputs: {}, outputRange: {},
    modTarget: (key) => ({ reason: reason || `${key} is not available` }),
    applyBase() {}, update() {}, stop() {}, dispose() {},
    info, status, reason,
  };
}

// ---------------------------------------------------------------- sources

const oscillator = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: ['waveform'],
  create({ ctx, hooks, acct, at, params }) {
    // The engine's own oscillator factory: frequency clamped to 0.95 × Nyquist, started at `at`.
    const osc = acct.source(acct.track(hooks.oscillator(params.waveform, params.frequency, at)));
    const level = acct.track(ctx.createGain());
    level.gain.setValueAtTime(params.level, ctx.currentTime);
    osc.connect(level);
    return {
      inputs: {},
      outputs: { audio: level },
      outputRange: {},
      modTarget(key, mapping) {
        if (key === 'frequency') {
          return mapping === 'log' ? { param: osc.detune, scale: CENTS_PER_OCTAVE }
            : { param: osc.frequency, scale: 1 };
        }
        if (key === 'detune') return linearOnly(osc.detune)(key, mapping);
        if (key === 'level') return linearOnly(level.gain)(key, mapping);
        return { reason: `unknown parameter ${key}` };
      },
      applyBase(b, immediate) {
        const now = ctx.currentTime;
        setParam(osc.frequency, hooks.clampFrequency(b.frequency.value), immediate, now);
        setParam(osc.detune, b.detune.value + b.detune.cents + b.frequency.cents, immediate,
          now);
        setParam(level.gain, b.level.value, immediate, now);
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

const noise = {
  compiler: 'audio/noise.js#createNoiseSource',
  structural: [],
  create({ ctx, acct, at, params }) {
    const n = createNoiseSource(ctx, { color: params.color, seed: params.seed,
      level: params.level, track: acct.track, source: acct.source });
    n.start(at);
    return {
      inputs: {},
      outputs: { audio: n.output },
      outputRange: {},
      modTarget: (key, mapping) => (key === 'level' ? linearOnly(n.output.gain)(key, mapping)
        : { reason: `unknown parameter ${key}` }),
      applyBase(b, immediate) {
        if (immediate) n.output.gain.setValueAtTime(Math.max(1e-4, b.level.value), ctx.currentTime);
        else n.update({ level: b.level.value });
      },
      update(changed) {
        const next = {};
        if ('color' in changed) next.color = changed.color;
        if ('seed' in changed) next.seed = changed.seed;
        if (Object.keys(next).length) n.update(next); // regenerates and crossfades (noise.js)
      },
      stop(t) { n.stop(t); }, // noise.js fades 20 ms from t, then stops its buffer source
      dispose() { n.dispose(); },
      info: { noise: n },
      status: 'ready',
      reason: null,
    };
  },
};

/**
 * The exact digital stimulus when measurement/stimulus.js can render the sweep (logarithmic,
 * 1-30 s, start < end), else null. The audio output then plays those very samples, so the
 * REFERENCE output and the sound are identical (§191).
 */
function sweepStimulus(params, sampleRate) {
  if (params.curve !== 'log' || !(params.level > 0) || !(params.start < params.end)) return null;
  if (params.duration < 1 || params.duration > 30) return null;
  try {
    return renderStimulus({ kind: 'log-sweep', sampleRate, duration: params.duration,
      level: params.level, f1: params.start, f2: params.end,
      fade: Math.min(SWEEP_FADE_S, params.duration / 4) });
  } catch (e) {
    return null;
  }
}

const sweep = {
  compiler: 'audio/patterns.js#buildPlan',
  structural: ['start', 'end', 'duration', 'curve', 'level'],
  create({ ctx, hooks, acct, at, params }) {
    const out = acct.track(ctx.createGain());
    let src;
    let reference = null;
    let referenceReason = null;
    const stim = sweepStimulus(params, ctx.sampleRate);
    if (stim) {
      // measurement/stimulus.js renderStimulus, played as the capture PlaybackSession does.
      const buf = ctx.createBuffer(1, stim.samples.length, ctx.sampleRate);
      buf.copyToChannel(stim.samples, 0);
      src = acct.source(acct.track(ctx.createBufferSource()));
      src.buffer = buf;
      src.connect(out);
      src.start(at);
      reference = stim;
    } else {
      // The engine's ramp plan topology (patterns.js 'ramps'): one oscillator, frequency ramp,
      // linear level fades in and out.
      referenceReason = 'An exact digital reference exists only for logarithmic 1-30 s sweeps '
        + 'with start below end (measurement/stimulus.js).';
      const fade = Math.min(SWEEP_FADE_S, params.duration / 4);
      src = acct.source(acct.track(hooks.oscillator('sine', params.start, at)));
      const f1 = hooks.clampFrequency(params.start);
      const f2 = hooks.clampFrequency(params.end);
      src.frequency.setValueAtTime(f1, at);
      const end = at + params.duration;
      if (params.curve === 'log') src.frequency.exponentialRampToValueAtTime(f2, end);
      else src.frequency.linearRampToValueAtTime(f2, at + params.duration);
      const env = acct.track(ctx.createGain());
      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(params.level, at + fade);
      env.gain.setValueAtTime(params.level, at + params.duration - fade);
      env.gain.linearRampToValueAtTime(0, at + params.duration);
      src.connect(env);
      env.connect(out);
      src.stop(at + params.duration + 0.01);
    }
    return {
      inputs: {},
      outputs: { audio: out },
      outputRange: {},
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {}, update() {},
      stop(t) { try { src.stop(t); } catch (e) { /* already stopped */ } },
      dispose() {},
      info: { startTime: at, endTime: at + params.duration, reference, referenceReason },
      status: 'ready',
      reason: null,
    };
  },
};

const sequence = {
  compiler: 'sequencer/compiler.js#compileSequence',
  structural: [],
  create({ ctx, acct, params }) {
    // The sequencer compiles pattern clips into this bus: compileSequence(model, ctx,
    // info.destination, t0, { track, source }) with info.accounting (the timeline issue).
    const bus = acct.track(ctx.createGain());
    bus.gain.setValueAtTime(params.level, ctx.currentTime);
    return {
      inputs: {},
      outputs: { audio: bus },
      outputRange: {},
      modTarget: (key, mapping) => (key === 'level' ? linearOnly(bus.gain)(key, mapping)
        : { reason: `unknown parameter ${key}` }),
      applyBase(b, immediate) { setParam(bus.gain, b.level.value, immediate, ctx.currentTime); },
      update() {}, stop() {}, dispose() {},
      info: { destination: bus, accounting: { track: acct.track, source: acct.source },
        waveform: params.waveform },
      status: 'ready',
      reason: null,
    };
  },
};

const microphone = {
  compiler: 'audio/microphone.js#openMicrophone',
  structural: [],
  check(params, caps) {
    if (!caps.microphone) return MIC_UNAVAILABLE_TEXT;
    if (!caps.inputPermission) {
      return 'Microphone input is off. Allow it from the Microphone node; nothing is recorded or '
        + 'uploaded.';
    }
    return null;
  },
  create({ ctx, hooks, acct }) {
    const out = acct.track(ctx.createGain());
    let mic = null;
    let disposed = false;
    const handle = {
      inputs: {},
      outputs: { audio: out },
      outputRange: {},
      modTarget: (key) => ({ reason: `${key} is not modulatable` }),
      applyBase() {}, update() {}, stop() {},
      dispose() {
        disposed = true;
        if (mic) closeMicrophone(mic);
        mic = null;
      },
      info: { analyser: null },
      status: 'pending',
      reason: 'Waiting for microphone permission.',
    };
    openMicrophone(ctx, hooks.navigator.mediaDevices).then((m) => {
      if (disposed) { closeMicrophone(m); return; }
      mic = m;
      acct.track(m.source);
      acct.track(m.analyser);
      m.source.connect(out); // analysis only: validation keeps it away from Master Output
      handle.info.analyser = m.analyser;
      handle.status = 'ready';
      handle.reason = null;
    }, (e) => {
      handle.status = 'degraded';
      handle.reason = micErrorMessage(e);
    });
    return handle;
  },
};

// ---------------------------------------------------------------- modulation

const lfo = {
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
      applyBase(b, immediate) {
        const now = ctx.currentTime;
        setParam(osc.frequency, Math.max(0.01, b.rate.value), immediate, now);
        setParam(osc.detune, b.rate.cents, immediate, now);
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

const envelope = {
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
      update(changed) { adsr = adsrOf({ ...params, ...changed }); }, // next gate
      /** Gate on at t (retriggered from the current value), off after durS (timeline hook). */
      gate(t, durS) {
        for (const p of params2()) {
          applyAdsr(p, t, adsr, 1, { retrigger: true });
          if (durS != null) releaseAt(p, t + durS, adsr.r);
        }
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
    applyBase(b, immediate) {
      const now = ctx.currentTime;
      setParam(src.playbackRate, Math.max(0, b.rate.value) / refRate, immediate, now);
      if (src.detune) setParam(src.detune, b.rate.cents, immediate, now);
    },
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

const random = {
  compiler: 'audio/noise.js#mulberry32',
  structural: ['seed', 'smooth'],
  create(env) {
    const rng = mulberry32(env.params.seed);
    const values = Array.from({ length: RANDOM_LOOP_VALUES }, () => rng() * 2 - 1);
    const sc = steppedControl({ ...env, values, smooth: env.params.smooth, holdLast: false,
      rate: env.params.rate });
    return controlHandle(sc, { values, loopValues: RANDOM_LOOP_VALUES });
  },
};

const stepModulator = {
  compiler: 'audio/scheduler.js#scheduleSteps',
  structural: ['steps', 'playback'],
  create(env) {
    const values = [...env.params.steps];
    const sc = steppedControl({ ...env, values, smooth: false,
      holdLast: env.params.playback === 'once', rate: env.params.rate });
    return controlHandle(sc, { values });
  },
};

// ---------------------------------------------------------------- processing

const gain = {
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
      applyBase(b, immediate) { setParam(g.gain, b.gain.value, immediate, ctx.currentTime); },
      update() {}, stop() {}, dispose() {},
      info: {},
      status: 'ready',
      reason: null,
    };
  },
};

const filter = {
  compiler: 'audio/filters.js#createFilterStage',
  // A type change would make createFilterStage crossfade to its second biquad, away from the
  // AudioParams the modulation edges are wired to: rebuild and crossfade at the graph level.
  structural: ['type'],
  create({ ctx, acct, params }) {
    const stage = createFilterStage(ctx, params, { track: acct.track });
    const biquad = stage.node; // never type-switched (see `structural`), so stable
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
          if (params.type === 'lowpass' || params.type === 'highpass') {
            return { reason: 'Low-/high-pass Q is a dB AudioParam in Web Audio; a linear Q '
              + 'modulation would be mis-scaled, so it is not applied.' };
          }
          return linearOnly(biquad.Q)(key, mapping);
        }
        if (key === 'gain') return linearOnly(biquad.gain)(key, mapping);
        return { reason: `unknown parameter ${key}` };
      },
      applyBase(b, immediate) {
        // createFilterStage.update glides (τ 10 ms), clamps to 10 Hz … 0.95 × Nyquist and
        // converts Q for the node (dB for low-/high-pass).
        // A new node is silent until its routes fade in, so the first call may glide too.
        stage.update({ frequency: b.frequency.value, Q: b.Q.value, gain: b.gain.value });
        setParam(biquad.detune, b.frequency.cents, immediate, ctx.currentTime);
      },
      update(changed) {
        if ('enabled' in changed) stage.update({ enabled: changed.enabled }); // crossfaded
      },
      stop() {},
      dispose() { stage.dispose(); },
      info: { stage },
      status: 'ready',
      reason: null,
    };
  },
};

const pan = {
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
        applyBase(b, immediate) { setParam(p.pan, b.pan.value, immediate, ctx.currentTime); },
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
      applyBase(b) { router.update({ panA: b.pan.value }); },
      update() {}, stop() {},
      dispose() { router.dispose(); },
      info: { router },
      status: 'ready',
      reason: null,
    };
  },
};

const stereoSplit = {
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
      update(changed) { router.update(changed); }, // glides (stereo.js)
      stop() {},
      dispose() { router.dispose(); },
      info: { router },
      status: 'ready',
      reason: null,
    };
  },
};

const mixer = {
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
      applyBase(b, immediate) {
        for (const [key, g] of Object.entries(levels)) {
          setParam(g.gain, b[key].value, immediate, ctx.currentTime);
        }
      },
      update() {}, stop() {}, dispose() {},
      info: {},
      status: 'ready',
      reason: null,
    };
  },
};

// ---------------------------------------------------------------- output

const master = {
  compiler: 'audio/audio-engine.js#AudioEngine',
  structural: [],
  create({ ctx, hooks, acct, params, options }) {
    // The Studio bus feeds engine.master — the head of the existing safety chain (master gain
    // ≤ MAX_OUTPUT_GAIN → limiter → trim → ceiling → analyser → destination). It is the only
    // Studio node connected outside the Studio graph; nothing reaches ctx.destination directly.
    const out = hooks.masterInput();
    if (!out) throw new Error('The engine has no master output chain.');
    const bus = acct.track(ctx.createGain());
    const ramp = createRamp(bus.gain, 0, ctx.currentTime, ctx.sampleRate);
    bus.connect(out);
    if (options.masterLevel !== 'ignore') hooks.setMasterLevel(params.level);
    return {
      inputs: { audio: bus },
      outputs: {},
      outputRange: {},
      modTarget: () => ({ reason: 'The master level is neither automatable nor modulatable.' }),
      applyBase() {},
      update(changed) {
        if ('level' in changed && options.masterLevel !== 'ignore') {
          hooks.setMasterLevel(changed.level); // engine.setMasterGain: clamped and smoothed
        }
      },
      /** Fade the whole Studio output (start, stop, Master removal). */
      fade(target, at, dur) { return ramp.to(target, at, dur); },
      stop() {},
      dispose() {},
      info: { bus, chainInput: out },
      status: 'ready',
      reason: null,
    };
  },
};

const recorder = {
  compiler: 'audio/offline-renderer.js#renderToWav',
  structural: [],
  check: () => 'Recorder/Export renders offline (audio/offline-renderer.js); it has no realtime '
    + 'node.',
  create: () => inertHandle('offline-only', null),
};

// ---------------------------------------------------------------- analysis (side-chains)

function analyserTap({ ctx, acct, params, fftSize = 8192, smoothing = 0.55, extra = {} }) {
  // A tap is an AnalyserNode with no output: it observes the edge's copy of the signal and
  // never alters the audio path (§190). Analysers are pulled by the browser without a
  // destination connection (as the engine's microphone analyser already relies on).
  const analyser = acct.track(ctx.createAnalyser());
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothing;
  analyser.minDecibels = -140;
  analyser.maxDecibels = 0;
  const reader = createAnalyserReader(analyser, { sampleRate: ctx.sampleRate });
  return {
    inputs: { audio: analyser },
    outputs: {},
    outputRange: {},
    modTarget: (key) => ({ reason: `${key} is not modulatable` }),
    applyBase() {},
    update(changed) {
      if ('fftSize' in changed) { analyser.fftSize = changed.fftSize; reader.sync(); }
      if ('smoothing' in changed) analyser.smoothingTimeConstant = changed.smoothing;
    },
    stop() {}, dispose() {},
    info: { analyser, reader, params: { ...params }, ...extra },
    status: 'ready',
    reason: null,
  };
}

const scope = {
  compiler: 'analysis/analyser.js#createAnalyserReader',
  structural: [],
  create: (env) => analyserTap({ ...env, fftSize: env.params.fftSize }),
};
const spectrum = {
  compiler: 'analysis/analyser.js#createAnalyserReader',
  structural: [],
  create: (env) => analyserTap({ ...env, fftSize: env.params.fftSize,
    smoothing: env.params.smoothing }),
};
const spectrogram = {
  compiler: 'analysis/spectrogram.js#createSpectrogram',
  structural: [],
  // The view binds createSpectrogram(canvas, ...) to this analyser; the runtime has no canvas.
  create: (env) => analyserTap({ ...env,
    extra: { view: 'analysis/spectrogram.js#createSpectrogram' } }),
};
const meter = {
  compiler: 'analysis/analyser.js#createAnalyserReader',
  structural: [],
  create: (env) => analyserTap({ ...env, fftSize: 2048 }),
};
const rta = {
  compiler: 'measurement/rta.js#createRtaAverager',
  structural: ['averaging', 'peakHold'],
  create: (env) => analyserTap({ ...env, extra: { averager: createRtaAverager({
    mode: env.params.averaging, peakHold: env.params.peakHold }) } }),
};

// ---------------------------------------------------------------- measurement

const capture = {
  compiler: 'measurement/capture-checks.js#checkCapture',
  structural: [],
  create({ ctx, acct }) {
    // Attach point for the measurement io (capture.js records from here, §106); a side-chain
    // input with no output, so it never alters the audio path.
    const tap = acct.track(ctx.createGain());
    return { ...inertHandle('ready', null, { tap }), inputs: { audio: tap } };
  },
};

const dataNode = (compiler) => ({
  compiler,
  structural: [],
  data: true,
  // ANALYSIS data (captures, profiles, results) flows through the measurement engine, not
  // through Web Audio: the runtime only records the bindings (runtime.dataEdges).
  create: () => inertHandle('data', null),
});

/** Adapter per registry node type; `compiler` must equal the registry definition's key. */
export const NODE_ADAPTERS = Object.freeze({
  oscillator, noise, sweep, sequence, microphone,
  lfo, envelope, random, 'step-modulator': stepModulator,
  gain, filter, pan, 'stereo-split': stereoSplit, mixer,
  scope, spectrum, spectrogram, meter, rta,
  master, recorder,
  capture,
  calibration: dataNode('calibration/interpolate.js#applyFrequencyCorrection'),
  'transfer-analyzer': dataNode('measurement/transfer.js#computeTransfer'),
  'measurement-result': dataNode('experiments/schema.js#withResults'),
});
