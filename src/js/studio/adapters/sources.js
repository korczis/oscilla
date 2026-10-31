// Studio SOURCES adapters (nodes/sources.js): Oscillator, Noise, Sweep, Sequence, Microphone.
// The adapter contract is the header of adapters/nodes.js.

import { MIC_UNAVAILABLE_TEXT, closeMicrophone, micErrorMessage, openMicrophone }
  from '../../audio/microphone.js';
import { createNoiseSource } from '../../audio/noise.js';
import { renderStimulus } from '../../measurement/stimulus.js';
import { CENTS_PER_OCTAVE } from '../../core/music.js';
import { did, free, linearOnly, setParam } from './common.js';

/** Fade of a rendered Studio sweep: min(SWEEP_FADE_S, duration / 4) (recipeFromStudio too). */
export const SWEEP_FADE_S = 0.01;

export const oscillator = {
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
      applyBase(b, immediate, owned, w) {
        const now = ctx.currentTime;
        if (free(owned, 'frequency')) {
          setParam(osc.frequency, hooks.clampFrequency(b.frequency.value), immediate, now, w,
            'frequency');
        }
        // detune carries the log-mapped frequency offsets too: an owned detune owns them.
        if (free(owned, 'detune')) {
          setParam(osc.detune, b.detune.value + b.detune.cents + b.frequency.cents, immediate,
            now, w, 'detune');
        }
        if (free(owned, 'level')) setParam(level.gain, b.level.value, immediate, now, w, 'level');
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

export const noise = {
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
      applyBase(b, immediate, owned, w) {
        if (!free(owned, 'level')) return;
        if (immediate) n.output.gain.setValueAtTime(Math.max(1e-4, b.level.value), ctx.currentTime);
        else n.update({ level: b.level.value });
        if (w) w.level = Math.max(1e-4, b.level.value);
      },
      update(changed, owned, w) {
        const next = {};
        if ('color' in changed) next.color = changed.color;
        if ('seed' in changed) next.seed = changed.seed;
        if (Object.keys(next).length) n.update(next); // regenerates and crossfades (noise.js)
        did(w, changed, ['color', 'seed'], 'crossfade');
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

export const sweep = {
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

export const sequence = {
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
      applyBase(b, immediate, owned, w) {
        if (free(owned, 'level')) {
          setParam(bus.gain, b.level.value, immediate, ctx.currentTime, w, 'level');
        }
      },
      update() {}, stop() {}, dispose() {},
      info: { destination: bus, accounting: { track: acct.track, source: acct.source },
        waveform: params.waveform },
      status: 'ready',
      reason: null,
    };
  },
};

/** Why a Microphone node is off; the Inspector's Allow microphone action turns it on. */
export const MIC_OFF_TEXT = 'Microphone input is off. Choose Allow microphone in the Inspector; '
  + 'nothing is recorded or uploaded.';
/** A Microphone whose input track ended by itself. */
export const MIC_ENDED_TEXT = 'The microphone stopped (its permission was withdrawn or the '
  + 'device was disconnected). Choose Allow microphone in the Inspector to open it again.';

export const microphone = {
  compiler: 'audio/microphone.js#openMicrophone',
  structural: [],
  check(params, caps) {
    if (!caps.microphone) return { code: 'mic-unsupported', reason: MIC_UNAVAILABLE_TEXT };
    if (!caps.inputPermission) return { code: 'mic-off', reason: MIC_OFF_TEXT };
    return null;
  },
  create({ ctx, hooks, acct, settled }) {
    const out = acct.track(ctx.createGain());
    let mic = null;
    let disposed = false;
    const settle = () => { if (typeof settled === 'function') settled(handle); };
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
      code: 'mic-pending',
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
      handle.code = handle.reason = null;
      // A track that ends by itself (permission revoked, device unplugged): say so.
      for (const t of m.stream.getTracks()) {
        t.onended = () => {
          if (disposed || mic !== m) return;
          handle.status = 'degraded';
          handle.code = 'mic-ended';
          handle.reason = MIC_ENDED_TEXT;
          settle();
        };
      }
      settle();
    }, (e) => {
      if (disposed) return;
      handle.status = 'degraded';
      handle.code = 'mic-error';
      handle.reason = micErrorMessage(e);
      // The browser refused: the runtime turns the input permission off (runtime.js settled).
      handle.denied = !!e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      settle();
    });
    return handle;
  },
};
