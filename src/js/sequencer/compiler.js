// OSCILLA V2 pattern sequencer: compile a sequence model into Web Audio automation.
//
// Every block is resolved into one of the V1 plan topologies (index.html@95dfa81:1689):
//   const  — tone (fixed frequency)
//   steps  — pulse, burst, random (frequency switched while the envelope is at its floor)
//   ramp   — sweep, chirp (linear or exponential frequency ramp)
//   lfo    — siren (carrier frequency moved by a low-frequency oscillator)
//   am     — level modulated by an LFO
//   fm     — carrier frequency modulated by a second oscillator
//   silence — the envelope held at its floor
//
// planSequence() turns the model into a flat, time-sorted list of events (pure, testable). The
// compiler applies exactly those events to one voice graph:
//
//   carrier OscillatorNode -> amp Gain (AM) -> env Gain (block envelopes) -> out Gain (stop fade)
//                                                                         -> destination
//   per siren/FM block: LFO OscillatorNode -> depth Gain -> carrier.frequency
//   per AM block:       LFO OscillatorNode -> depth Gain -> amp.gain
//
// Timing: block boundaries are quantised to whole sample frames of the running context, so a
// boundary is exact to the sample in both AudioContext and OfflineAudioContext. All times are
// on ctx.currentTime; there are no JS timers on the audio path (a timer is used only as a
// cleanup fallback, as in V1).
//
// Click safety: every audible window ramps linearly from GAIN_FLOOR to 1 and back within
// EDGE_S (shortened to a quarter of very short windows). Frequency jumps, AM level changes
// and LFO starts/stops happen only while the envelope is at the floor. Gain is never ramped to
// or set to 0.
//
// Stop: only the out Gain, which carries no automation until then (its value is exactly 1),
// is held and faded. The block schedules keep running underneath the fade and are cancelled
// only after every source has ended. Reason: Chromium renders concurrently with the main
// thread, and a render quantum that meets a param's timeline while the main thread is editing it
// is rendered at the param's last value. Any edit of a ramping param (cancelAndHoldAtTime, a
// computed hold, even a no-op event far in the future) can so freeze one quantum of a ramp: a
// one-sample step of up to a whole edge. The out gain sits at a constant 1, so it is immune.

import {
  clamp,
  isNum,
  safeMaximum,
  normalizeModel,
  mulberry32,
  normalizedToFrequency,
  toNumber,
  SAFE_NYQUIST_FACTOR,
  SEQ_MIN_FREQUENCY,
  PROVISIONAL_SAMPLE_RATE,
  sig,
  WAVEFORMS,
} from './model.js';

// ============================================================ constants

export const GAIN_FLOOR = 0.0001; // from V1 GAIN_FLOOR (index.html@95dfa81:989), -80 dB
export const EDGE_S = 0.003; // block/step edge ramp (2-5 ms band)
export const START_OFFSET_S = 0.02; // from V1 START_OFFSET_S (index.html@95dfa81:991)
export const STOP_RAMP_S = 0.012; // V1 fast release before a new voice (index.html@95dfa81:2190)
export const STOP_PAD_S = 0.01; // V1: sources stop 10 ms after the programmed end (:2321)
const RENDER_QUANTUM = 128; // frames per Web Audio render quantum
// A realtime stop is scheduled this far ahead of the rendered audio, on a render-quantum boundary:
// the engine's SCHEDULE_LEAD_S (src/js/audio/scheduler.js), which its releases use.
export const STOP_LEAD_S = 0.02;
// Bounds for the rendered-time estimate (renderedTimeAtLeast): how far it may run ahead of
// ctx.currentTime in all, how far beyond the real time since the newest clock reading, and how
// long and how many readings are kept.
const MAX_CLOCK_LAG_S = 0.2;
const CLOCK_LAG_SLACK_S = 0.05;
const CLOCK_OBS_MAX_AGE_MS = 2000;
const CLOCK_OBS_COUNT = 16;

// ============================================================ V1 maths

// from V1 lfoShape (index.html@95dfa81:1700)
export function lfoShape(shape, phase) {
  const p = phase - Math.floor(phase);
  if (shape === 'triangle') return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
  return Math.sin(2 * Math.PI * p);
}

// derived from V1 stepsFromFrequencies (index.html@95dfa81:1748): the cap is the block length
// instead of MAX_PROGRAMMED_S, and a step never overruns it.
function stepsWithin(freqs, toneS, gapS, blockS) {
  const steps = [];
  let t = 0;
  for (const f of freqs) {
    if (t >= blockS - 1e-9) break;
    steps.push({ t, dur: Math.min(toneS, blockS - t), f });
    t += toneS + gapS;
  }
  return steps;
}

/** How many tone+gap cycles fit a block (at least one, truncated to the block). */
function fillCount(blockS, toneS, gapS) {
  return Math.max(1, Math.floor((blockS + gapS) / (toneS + gapS) + 1e-9));
}

// ============================================================ timeline (pure)

/**
 * Resolve a model into absolute, frame-quantised block descriptions.
 * Returns { sampleRate, safeMax, duration, frames, blocks, warnings } where each block is
 * { id, index, type, kind, start, end, startFrame, endFrame, windows: [{ start, end }], ... }
 * plus kind-specific fields (freq | f0, f1, curve | steps | center, depth, rate, shape |
 * modFreq, depth). Times are seconds from the sequence start.
 */
export function buildTimeline(model, opts = {}) {
  const sr =
    isNum(opts.sampleRate) && opts.sampleRate > 0 ? opts.sampleRate : PROVISIONAL_SAMPLE_RATE;
  const safeMax = safeMaximum(sr);
  const { model: m, issues } = normalizeModel(model, { sampleRate: sr });
  const warnings = issues.slice();
  const nyquist = sr / 2;
  // V1 buildPlan `cf` (index.html@95dfa81:1800), floor raised to SEQ_MIN_FREQUENCY.
  const cf = (f) => clamp(f, SEQ_MIN_FREQUENCY, safeMax);
  const q = (s) => Math.round(s * sr) / sr;
  const blocks = [];
  let cumMs = 0;
  m.blocks.forEach((b, index) => {
    const startFrame = Math.round((cumMs * sr) / 1000);
    cumMs += b.durationMs;
    const endFrame = Math.round((cumMs * sr) / 1000);
    const start = startFrame / sr;
    const end = endFrame / sr;
    const len = end - start;
    const p = b.params;
    const base = { id: b.id, index, type: b.type, start, end, startFrame, endFrame };
    const whole = len > 0 ? [{ start, end }] : [];
    const stepsBlock = (freqs, toneMs, gapMs) => {
      const local = stepsWithin(freqs, toneMs / 1000, gapMs / 1000, len);
      const steps = [];
      for (const s of local) {
        const s0 = q(start + s.t);
        const s1 = Math.min(end, q(start + s.t + s.dur));
        if (s1 > s0) steps.push({ start: s0, end: s1, f: s.f });
      }
      return {
        ...base,
        kind: 'steps',
        steps,
        windows: steps.map((s) => ({ start: s.start, end: s.end })),
      };
    };
    switch (b.type) {
      case 'silence':
        blocks.push({ ...base, kind: 'silence', windows: [] });
        break;
      case 'tone':
        blocks.push({ ...base, kind: 'const', freq: cf(p.freq), windows: whole });
        break;
      case 'sweep': // V1 sweepUp/sweepDown segment (index.html@95dfa81:1933), start -> end as given
        blocks.push({
          ...base,
          kind: 'ramp',
          f0: cf(p.start),
          f1: cf(p.end),
          curve: p.curve === 'linear' ? 'linear' : 'log',
          windows: whole,
        });
        break;
      case 'chirp': // V1 chirp (index.html@95dfa81:1961)
        blocks.push({
          ...base,
          kind: 'ramp',
          f0: cf(p.start),
          f1: cf(p.end),
          curve: p.ramp === 'linear' ? 'linear' : 'log',
          windows: whole,
        });
        break;
      case 'pulse': {
        // V1 pulse (index.html@95dfa81:1896): pulses fill the block
        const n = fillCount(len, p.pulseMs / 1000, p.pauseMs / 1000);
        blocks.push(stepsBlock(Array(n).fill(cf(p.freq)), p.pulseMs, p.pauseMs));
        break;
      }
      case 'burst': {
        // V1 burst (index.html@95dfa81:1899): fixed onset-to-onset interval
        const burst = p.burstMs;
        const interval = Math.max(burst, p.intervalMs);
        const n = fillCount(len, burst / 1000, (interval - burst) / 1000);
        blocks.push(stepsBlock(Array(n).fill(cf(p.freq)), burst, interval - burst));
        break;
      }
      case 'random': {
        // V1 random (index.html@95dfa81:1909): log-uniform, seeded
        const lo = cf(Math.min(p.min, p.max));
        const hi = cf(Math.max(p.min, p.max));
        const rnd = mulberry32(p.seed);
        const n = fillCount(len, p.toneMs / 1000, p.gapMs / 1000);
        const list = [];
        for (let i = 0; i < n; i++) list.push(hi > lo ? normalizedToFrequency(rnd(), lo, hi) : lo);
        blocks.push(stepsBlock(list, p.toneMs, p.gapMs));
        break;
      }
      case 'siren': {
        // V1 siren (index.html@95dfa81:1970)
        const lo = cf(Math.min(p.min, p.max));
        const hi = cf(Math.max(p.min, p.max));
        blocks.push({
          ...base,
          kind: 'lfo',
          center: (lo + hi) / 2,
          depth: (hi - lo) / 2,
          rate: p.rate,
          shape: p.shape === 'triangle' ? 'triangle' : 'sine',
          windows: whole,
        });
        break;
      }
      case 'am': // V1 am (index.html@95dfa81:1989)
        blocks.push({
          ...base,
          kind: 'am',
          freq: cf(p.freq),
          modFreq: p.modFreq,
          depth: p.depth / 100,
          windows: whole,
        });
        break;
      case 'fm': {
        // V1 fm (index.html@95dfa81:1994), two-sided depth bound
        const carrier = cf(p.freq);
        const maxDepth = Math.max(0, Math.min(carrier - SEQ_MIN_FREQUENCY, safeMax - carrier));
        const depth = Math.min(p.depthHz, maxDepth);
        if (carrier + depth + 2 * p.modFreq > safeMax / SAFE_NYQUIST_FACTOR) {
          warnings.push(
            `Block ${index + 1}: FM sidebands may extend beyond Nyquist and fold back (alias).`,
          );
        }
        blocks.push({
          ...base,
          kind: 'fm',
          freq: carrier,
          modFreq: p.modFreq,
          depth,
          windows: whole,
        });
        break;
      }
      default:
        blocks.push({ ...base, kind: 'silence', windows: [] });
    }
  });
  const frames = Math.round((cumMs * sr) / 1000);
  return {
    sampleRate: sr,
    safeMax,
    nyquist,
    duration: frames / sr,
    frames,
    blocks,
    warnings,
    model: m,
  };
}

/** First frequency a block requests (used to preset the carrier before the block starts). */
function firstFrequency(b) {
  switch (b.kind) {
    case 'const':
    case 'am':
    case 'fm':
      return b.freq;
    case 'ramp':
      return b.f0;
    case 'steps':
      return b.steps.length ? b.steps[0].f : null;
    case 'lfo':
      return b.center;
    default:
      return null;
  }
}

/**
 * Pure event plan for testing, visualisation and the compiler. Returns a time-sorted array of
 *   { t, kind, param, value, ramp, blockId, blockIndex, ...extras }
 * kind 'freq'   param 'frequency'  carrier frequency automation
 * kind 'gain'   param 'envelope'   block envelope automation
 * kind 'am'     param 'amplitude'  AM base level automation
 *   ramp: 'set' (setValueAtTime) | 'linear' | 'exponential' (ramp ending at t)
 * kind 'source' param 'carrier' | 'siren-lfo' | 'am-lfo' | 'fm-mod'
 *   value = oscillator frequency (Hz), ramp = null, action 'start' | 'stop', key (pairs a
 *   start with its stop), shape (oscillator type), depth (modulation gain).
 * t is seconds from the sequence start; block boundaries are whole frames (t * sampleRate is an
 * integer).
 */
export function planSequence(model, sampleRate) {
  return planFromTimeline(buildTimeline(model, { sampleRate }));
}

/** Same as planSequence but from an already-built timeline. */
export function planFromTimeline(tl) {
  const ev = [];
  let order = 0;
  const push = (e) => ev.push({ ...e, _o: order++ });
  const auto = (kind, param, t, value, ramp, b) =>
    push({
      t,
      kind,
      param,
      value,
      ramp,
      blockId: b ? b.id : null,
      blockIndex: b ? b.index : -1,
    });
  if (!tl.blocks.length) return [];
  const firstF = tl.blocks.map(firstFrequency).find((f) => f !== null) ?? SEQ_MIN_FREQUENCY;
  auto('gain', 'envelope', 0, GAIN_FLOOR, 'set', null);
  auto('am', 'amplitude', 0, 1, 'set', null);
  auto('freq', 'frequency', 0, firstF, 'set', null);
  push({
    t: 0,
    kind: 'source',
    param: 'carrier',
    value: firstF,
    ramp: null,
    action: 'start',
    key: 'carrier',
    shape: tl.model.waveform,
    depth: null,
    blockId: null,
    blockIndex: -1,
  });

  for (const b of tl.blocks) {
    // Frequency automation (changes land on the block boundary, where the envelope is at floor).
    switch (b.kind) {
      case 'const':
      case 'am':
      case 'fm':
        auto('freq', 'frequency', b.start, b.freq, 'set', b);
        break;
      case 'lfo':
        auto('freq', 'frequency', b.start, b.center, 'set', b);
        break;
      case 'ramp':
        auto('freq', 'frequency', b.start, b.f0, 'set', b);
        auto('freq', 'frequency', b.end, b.f1, b.curve === 'log' ? 'exponential' : 'linear', b);
        break;
      case 'steps':
        for (const s of b.steps) auto('freq', 'frequency', s.start, s.f, 'set', b);
        break;
      default:
        break;
    }
    // Envelope windows.
    for (const w of b.windows) {
      const edge = Math.min(EDGE_S, (w.end - w.start) / 4);
      auto('gain', 'envelope', w.start, GAIN_FLOOR, 'set', b);
      auto('gain', 'envelope', w.start + edge, 1, 'linear', b);
      auto('gain', 'envelope', w.end - edge, 1, 'set', b);
      auto('gain', 'envelope', w.end, GAIN_FLOOR, 'linear', b);
    }
    // Modulators: started and stopped exactly on the block boundaries.
    const mod = (param, value, shape, depth) => {
      const key = `${b.id}:${param}`;
      const common = {
        kind: 'source',
        param,
        value,
        ramp: null,
        key,
        shape,
        depth,
        blockId: b.id,
        blockIndex: b.index,
      };
      push({ t: b.start, action: 'start', ...common });
      push({ t: b.end, action: 'stop', ...common });
    };
    if (b.kind === 'lfo' && b.end > b.start && b.depth > 0) {
      mod('siren-lfo', b.rate, b.shape, b.depth);
    }
    if (b.kind === 'fm' && b.end > b.start && b.depth > 0)
      mod('fm-mod', b.modFreq, 'sine', b.depth);
    if (b.kind === 'am' && b.end > b.start) {
      // V1 am: base level 1 - depth/2, LFO gain depth/2 (index.html@95dfa81:2269)
      auto('am', 'amplitude', b.start, 1 - b.depth / 2, 'set', b);
      auto('am', 'amplitude', b.end, 1, 'set', b);
      if (b.depth > 0) mod('am-lfo', b.modFreq, 'sine', b.depth / 2);
    }
  }
  push({
    t: tl.duration + STOP_PAD_S,
    kind: 'source',
    param: 'carrier',
    value: null,
    ramp: null,
    action: 'stop',
    key: 'carrier',
    shape: tl.model.waveform,
    depth: null,
    blockId: null,
    blockIndex: -1,
  });
  ev.sort((a, b) => a.t - b.t || a._o - b._o);
  for (const e of ev) delete e._o;
  return ev;
}

// ============================================================ lookup (readout, playhead)

function blockIndexAtTime(blocks, t) {
  // Binary search on start times, after V1 findTimed (index.html@95dfa81:1706).
  let lo = 0;
  let hi = blocks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return -1;
  return t <= blocks[found].end ? found : -1;
}

function stepAt(steps, t) {
  for (const s of steps) if (t >= s.start && t < s.end) return s;
  const last = steps[steps.length - 1];
  return last && t === last.end ? last : null;
}

/** Requested frequency of a resolved block at sequence time t (V1 planFreqAt semantics). */
function blockFreqAt(b, t) {
  const x = t - b.start;
  switch (b.kind) {
    case 'const':
    case 'am':
      return b.freq;
    case 'ramp': {
      // from V1 planFreqAt 'ramps' (index.html@95dfa81:1726)
      const len = b.end - b.start;
      const k = len > 0 ? clamp(x / len, 0, 1) : 1;
      return b.curve === 'log' ? b.f0 * Math.pow(b.f1 / b.f0, k) : b.f0 + (b.f1 - b.f0) * k;
    }
    case 'steps': {
      const s = stepAt(b.steps, t);
      return s ? s.f : null;
    }
    case 'lfo':
      return b.center + b.depth * lfoShape(b.shape, b.rate * x); // V1 planFreqAt 'lfo'
    case 'fm':
      return b.freq + b.depth * Math.sin(2 * Math.PI * b.modFreq * x); // V1 planFreqAt 'fm'
    default:
      return null;
  }
}

/** Programmed relative level 0..1 ignoring edge ramps (V1 planAmpAt semantics). */
function blockAmpAt(b, t) {
  switch (b.kind) {
    case 'silence':
      return 0;
    case 'steps':
      return stepAt(b.steps, t) ? 1 : 0;
    case 'am': // from V1 planAmpAt (index.html@95dfa81:1741)
      return 1 - b.depth / 2 + (b.depth / 2) * Math.sin(2 * Math.PI * b.modFreq * (t - b.start));
    default:
      return 1;
  }
}

/**
 * Precomputed lookup for per-frame use (allocation-free queries).
 * Returns { duration, timeline, blockIndexAt(t), freqAt(t), ampAt(t) }, t in seconds from the
 * sequence start. freqAt returns null in silences, step gaps and outside the sequence.
 */
export function createSequenceLookup(model, opts = {}) {
  const tl = buildTimeline(model, opts);
  const { blocks } = tl;
  return {
    duration: tl.duration,
    timeline: tl,
    blockIndexAt(t) {
      return isNum(t) && t >= 0 ? blockIndexAtTime(blocks, t) : -1;
    },
    freqAt(t) {
      if (!isNum(t) || t < 0) return null;
      const i = blockIndexAtTime(blocks, t);
      return i < 0 ? null : blockFreqAt(blocks[i], t);
    },
    ampAt(t) {
      if (!isNum(t) || t < 0) return 0;
      const i = blockIndexAtTime(blocks, t);
      return i < 0 ? 0 : blockAmpAt(blocks[i], t);
    },
  };
}

/** Requested frequency at t seconds from the sequence start (null in silences and gaps). */
export function freqAt(model, t, opts = {}) {
  return createSequenceLookup(model, opts).freqAt(t);
}

/** Short label of the frequency content of a sequence, for status lines. */
export function describeSequence(model, opts = {}) {
  const tl = buildTimeline(model, opts);
  const n = tl.blocks.length;
  if (!n) return 'Empty sequence';
  return `${n} block${n === 1 ? '' : 's'} · ${sig(tl.duration, 3)} s`;
}

// ============================================================ param recorder + hold

/**
 * Value of an AudioParam automation timeline at time t, with Web Audio semantics for
 * setValueAtTime ('set'), linearRampToValueAtTime ('linear') and exponentialRampToValueAtTime
 * ('exponential'). events: [{ t, value, ramp }] in insertion order (planSequence events of one
 * kind, or a compiled param's log); events at equal times keep insertion order. Before the first
 * event the param has `defaultValue`.
 */
export function automationValueAt(events, t, defaultValue = null) {
  let prev = null;
  let next = null;
  for (const e of events) {
    if (e.t <= t) {
      if (!prev || e.t >= prev.t) prev = e;
    } else if (!next || e.t < next.t) next = e;
  }
  if (!prev) return defaultValue;
  if (!next || next.ramp === 'set' || next.t === prev.t) return prev.value;
  const k = (t - prev.t) / (next.t - prev.t);
  if (next.ramp === 'linear') return prev.value + (next.value - prev.value) * k;
  // Exponential ramps need same-sign, non-zero end points; otherwise the value holds (spec).
  if (!(prev.value * next.value > 0)) return prev.value;
  return prev.value * Math.pow(next.value / prev.value, k);
}

/** AudioParam wrapper that records its schedule (inspection; cleanup cancels it). */
function loggedParam(param, defaultValue) {
  const log = [];
  return {
    param,
    log,
    defaultValue,
    set(v, t) {
      log.push({ t, value: v, ramp: 'set' });
      param.setValueAtTime(v, t);
    },
    linear(v, t) {
      log.push({ t, value: v, ramp: 'linear' });
      param.linearRampToValueAtTime(v, t);
    },
    exponential(v, t) {
      log.push({ t, value: v, ramp: 'exponential' });
      param.exponentialRampToValueAtTime(v, t);
    },
  };
}

// ============================================================ audio clock (realtime stop anchor)

const clockObs = new WeakMap(); // ctx -> [{ ct, perf }], oldest first

function perfNow() {
  const p = globalThis.performance;
  return p && typeof p.now === 'function' ? p.now() : null;
}

/**
 * Record a reading (ctx.currentTime, performance.now()). Called when a voice is compiled and by
 * the editor's per-frame playhead readouts (UI bookkeeping), so a stop has recent readings.
 */
export function observeClock(ctx) {
  if (!ctx || typeof ctx.startRendering === 'function') return;
  const perf = perfNow();
  const ct = ctx.currentTime;
  if (perf === null || !isNum(ct)) return;
  let list = clockObs.get(ctx);
  if (!list) clockObs.set(ctx, (list = []));
  list.push({ ct, perf });
  const tooOld = () => perf - list[0].perf > CLOCK_OBS_MAX_AGE_MS;
  while (list.length > CLOCK_OBS_COUNT || (list.length && tooOld())) list.shift();
}

/**
 * A context time the audio thread has rendered at least up to, for anchoring a realtime stop.
 * ctx.currentTime alone can be stale: Firefox updates it only between tasks (and not at every
 * frame), so a main thread that is late within a task reads a time rendered long ago, and a fade
 * anchored there starts in the past (one or more quanta render unfaded, then the ramp jumps in).
 * Two further estimates, each used only when larger:
 *   - every recent reading advanced by the real time elapsed since (the freshest wins);
 *   - getOutputTimestamp() extrapolated to now plus baseLatency and outputLatency (the output
 *     position plus the latency between rendering and output).
 * An audio clock that stalled since a reading makes the estimate late, never early; so the gain
 * over currentTime is bounded by the real time since the newest reading plus CLOCK_LAG_SLACK_S,
 * and by MAX_CLOCK_LAG_S in all.
 */
function renderedTimeAtLeast(ctx) {
  const ct = ctx.currentTime;
  const now = perfNow();
  if (now === null) return ct;
  let t = ct;
  const list = clockObs.get(ctx) || [];
  for (const o of list) {
    if (now - o.perf <= CLOCK_OBS_MAX_AGE_MS) t = Math.max(t, o.ct + (now - o.perf) / 1000);
  }
  if (typeof ctx.getOutputTimestamp === 'function') {
    try {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const lat = (isNum(ctx.baseLatency) ? ctx.baseLatency : 0) +
          (isNum(ctx.outputLatency) ? ctx.outputLatency : 0);
        t = Math.max(t, ts.contextTime + (now - ts.performanceTime) / 1000 + lat);
      }
    } catch (e) {
      /* no timestamp: currentTime and the readings stand */
    }
  }
  const newest = list.length ? list[list.length - 1].perf : now;
  const bound = Math.min(MAX_CLOCK_LAG_S, Math.max(0, now - newest) / 1000 + CLOCK_LAG_SLACK_S);
  return Math.min(t, ct + bound);
}

// ============================================================ compiler

function defaultTimers() {
  if (typeof globalThis.setTimeout !== 'function') return null;
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * Compile a sequence onto a (realtime or offline) context.
 *   compileSequence(model, ctx, destination, t0, opts?) -> voice
 * opts: { sampleRate (used only when ctx has none), waveform (overrides model.waveform),
 *         onEnded({ stopped }), timers: { setTimeout, clearTimeout } | null,
 *         track(node), source(node) }
 * track/source are the V1 engine's voice-scoped accounting hooks (index.html@95dfa81:2198):
 * track() is called with every node the voice creates (gains and oscillators), source() in
 * addition with every oscillator. Both default to the identity. The voice still cleans up
 * everything itself; the hooks only let an engine count what it owns.
 * t0 is clamped to >= ctx.currentTime and rounded up to a whole frame.
 * voice: { t0, endTime, duration, sampleRate, warnings, timeline, events, stopTime,
 *          stop(atTime?) -> boolean, dispose(), freqAt(ctxTime), blockIndexAt(ctxTime),
 *          ended, stopping, activeSourceCount, activeNodeCount }
 * stop(at?): from `at` (default on a realtime context: STOP_LEAD_S after the audio rendered so
 * far, on a render-quantum boundary; see renderedTimeAtLeast) fades the output gain from its
 * held value 1 to the floor over STOP_RAMP_S without editing the sounding schedules, stops every
 * source after the fade, and cancels the automation and disconnects every node once all
 * sources have ended (a timer fallback covers browsers that drop `ended`).
 * Returns false when the voice already ended or was already stopping.
 */
export function compileSequence(model, ctx, destination, t0, opts = {}) {
  const sr = isNum(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : opts.sampleRate;
  const tl = buildTimeline(model, { sampleRate: sr });
  if (WAVEFORMS.includes(opts.waveform)) tl.model.waveform = opts.waveform;
  const events = planFromTimeline(tl);
  const isOffline = typeof ctx.startRendering === 'function';
  const timers = opts.timers === undefined ? (isOffline ? null : defaultTimers()) : opts.timers;
  const now = ctx.currentTime;
  if (!isOffline) observeClock(ctx);
  const start = Math.ceil(Math.max(toNumber(t0, now), now) * tl.sampleRate - 1e-6) / tl.sampleRate;

  const nodes = [];
  const sources = []; // { node, startAt, stopAt, ended }
  const timerIds = [];
  let ended = false;
  let stopping = false;
  let liveSources = 0;
  let lastStop = start + tl.duration + STOP_PAD_S;
  let endedCalled = false;

  const trackHook = typeof opts.track === 'function' ? opts.track : (n) => n;
  const sourceHook = typeof opts.source === 'function' ? opts.source : (n) => n;
  const track = (n) => {
    nodes.push(n);
    trackHook(n);
    return n;
  };
  const oscillator = () => {
    const n = track(ctx.createOscillator());
    sourceHook(n);
    return n;
  };
  const finish = () => {
    if (ended) return;
    ended = true;
    for (const id of timerIds) {
      try {
        timers.clearTimeout(id);
      } catch (e) {
        /* ignore */
      }
    }
    timerIds.length = 0;
    for (const s of sources) {
      if (!s.ended) {
        s.ended = true;
        liveSources--;
      }
      s.node.removeEventListener?.('ended', s.onEnded);
    }
    // Every source has ended (or been stopped): the remaining automation can never sound.
    for (const lp of logged) {
      try {
        lp.param.cancelScheduledValues(0);
      } catch (e) {
        /* ignore */
      }
    }
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch (e) {
        /* already disconnected */
      }
    }
    nodes.length = 0;
    liveSources = 0;
    if (!endedCalled) {
      endedCalled = true;
      if (typeof opts.onEnded === 'function') {
        try {
          opts.onEnded({ stopped: stopping });
        } catch (e) {
          /* listener errors are theirs */
        }
      }
    }
  };
  const addSource = (node, startAt, stopAt) => {
    const rec = { node, startAt, stopAt, ended: false, onEnded: null };
    rec.onEnded = () => {
      if (rec.ended) return;
      rec.ended = true;
      liveSources--;
      if (liveSources <= 0) finish();
    };
    node.addEventListener('ended', rec.onEnded);
    node.start(startAt);
    node.stop(stopAt);
    liveSources++;
    sources.push(rec);
    return rec;
  };
  const armFallback = () => {
    // after V1 _armFallback (index.html@95dfa81:2388): UI bookkeeping only, never audio timing.
    if (!timers) return;
    const check = () => {
      if (ended) return;
      if (ctx.state === 'closed') {
        finish();
        return;
      }
      if (ctx.state === 'running' && ctx.currentTime >= lastStop + 0.05) {
        finish();
        return;
      }
      if (stopping && ctx.state !== 'running') {
        finish();
        return;
      }
      const wait =
        ctx.state === 'running' ? Math.max(100, (lastStop - ctx.currentTime) * 1000 + 200) : 500;
      timerIds.push(timers.setTimeout(check, wait));
    };
    timerIds.push(
      timers.setTimeout(check, Math.max(100, (lastStop - ctx.currentTime) * 1000 + 250)),
    );
  };

  const voice = {
    t0: start,
    endTime: start + tl.duration,
    duration: tl.duration,
    sampleRate: tl.sampleRate,
    warnings: tl.warnings,
    timeline: tl,
    events,
    stopTime: null,
    get ended() {
      return ended;
    },
    get stopping() {
      return stopping;
    },
    get activeSourceCount() {
      return Math.max(0, liveSources);
    },
    get activeNodeCount() {
      return nodes.length;
    },
    freqAt(time) {
      return lookupFreq(time - start);
    },
    blockIndexAt(time) {
      return isNum(time) ? blockIndexAtTime(tl.blocks, time - start) : -1;
    },
    stop(at) {
      if (ended || stopping) return false;
      // Default on a realtime context: like the engine's releases (AudioEngine._soon), at least
      // STOP_LEAD_S after the audio already rendered and on a render-quantum boundary, so the
      // fade starts on frames the audio thread has not rendered yet even when the main thread is
      // late, and no ramp starts mid-quantum (Firefox anchors such a ramp at the quantum's edge,
      // a step of up to 128 frames of it). An offline context suspended at t is exact.
      let t;
      if (isNum(at)) t = Math.max(at, ctx.currentTime);
      else if (isOffline) t = ctx.currentTime;
      else {
        const q = RENDER_QUANTUM / tl.sampleRate;
        const lead = Math.max(STOP_LEAD_S, 2 * q);
        t = Math.ceil((renderedTimeAtLeast(ctx) + lead) / q - 1e-9) * q;
      }
      if (t >= voice.endTime) return false; // already ending naturally
      stopping = true;
      voice.stopTime = t;
      try {
        // The envelope, frequency and AM schedules are not touched while they sound (see the
        // header): the exact current value of the out gain is 1, held from t and faded.
        out.gain.setValueAtTime(1, t);
        out.gain.linearRampToValueAtTime(GAIN_FLOOR, t + STOP_RAMP_S);
        const stopAt = t + STOP_RAMP_S + STOP_PAD_S;
        for (const s of sources) {
          if (s.ended || s.stopAt <= stopAt) continue;
          try {
            s.node.stop(stopAt);
            s.stopAt = stopAt;
          } catch (e) {
            /* already stopped */
          }
        }
        lastStop = stopAt;
        voice.endTime = Math.min(voice.endTime, t + STOP_RAMP_S);
      } catch (e) {
        voice.dispose();
        return true;
      }
      // A suspended realtime context renders nothing, so its stops would never fire (V1).
      if (!isOffline && ctx.state !== 'running') {
        finish();
        return true;
      }
      for (const id of timerIds) {
        try {
          timers.clearTimeout(id);
        } catch (e) {
          /* ignore */
        }
      }
      timerIds.length = 0;
      armFallback();
      return true;
    },
    dispose() {
      if (ended) return;
      for (const s of sources) {
        if (!s.ended) {
          try {
            s.node.stop();
          } catch (e) {
            /* already stopped */
          }
        }
      }
      finish();
    },
  };

  let lookupFreq = () => null;
  let out = null;
  const logged = [];
  if (!tl.blocks.length || tl.duration <= 0) {
    ended = true;
    endedCalled = true;
    return voice;
  }

  // Graph.
  const carrier = oscillator();
  carrier.type = tl.model.waveform;
  const amp = track(ctx.createGain());
  const env = track(ctx.createGain());
  out = track(ctx.createGain());
  out.gain.setValueAtTime(1, now); // automated from the start; constant until a stop fades it
  carrier.connect(amp);
  amp.connect(env);
  env.connect(out);
  out.connect(destination);
  const fp = loggedParam(carrier.frequency, carrier.frequency.value);
  const ep = loggedParam(env.gain, 1);
  const ap = loggedParam(amp.gain, 1);
  logged.push(fp, ep, ap);
  // Before the first event the params sit at their floor/neutral values.
  ep.set(GAIN_FLOOR, now);
  const targets = { freq: fp, gain: ep, am: ap };
  const pending = new Map();

  for (const e of events) {
    const at = start + e.t;
    if (e.kind !== 'source') {
      const lp = targets[e.kind];
      if (e.ramp === 'set') lp.set(e.value, at);
      else if (e.ramp === 'linear') lp.linear(e.value, at);
      else lp.exponential(e.value, at);
      continue;
    }
    if (e.param === 'carrier') {
      if (e.action === 'start') pending.set('carrier', { node: carrier, at });
      else {
        const p = pending.get('carrier');
        addSource(p.node, p.at, at);
      }
      continue;
    }
    if (e.action === 'start') {
      const lfo = oscillator();
      lfo.type = e.shape;
      lfo.frequency.setValueAtTime(e.value, now);
      const depth = track(ctx.createGain());
      depth.gain.setValueAtTime(e.depth, now);
      lfo.connect(depth);
      depth.connect(e.param === 'am-lfo' ? amp.gain : carrier.frequency);
      pending.set(e.key, { node: lfo, at });
    } else {
      const p = pending.get(e.key);
      if (p) {
        addSource(p.node, p.at, at);
        pending.delete(e.key);
      }
    }
  }
  const lookup = createLookupFromTimeline(tl);
  lookupFreq = (t) => lookup(t);
  armFallback();
  return voice;
}

function createLookupFromTimeline(tl) {
  return (t) => {
    if (!isNum(t) || t < 0) return null;
    const i = blockIndexAtTime(tl.blocks, t);
    return i < 0 ? null : blockFreqAt(tl.blocks[i], t);
  };
}

/**
 * Render a sequence offline (for WAV export and tests).
 *   renderSequenceOffline(model, OfflineCtor, { sampleRate, numberOfChannels = 1, tailS = 0.05,
 *     level = 1, waveform }) -> Promise<{ buffer, voice }>
 * OfflineCtor is passed in (window.OfflineAudioContext) so this module never reaches for a
 * global context. `level` is the output gain (e.g. the UI master gain); it must be > 0.
 */
export async function renderSequenceOffline(model, OfflineCtor, opts = {}) {
  const sr = opts.sampleRate;
  if (!(isNum(sr) && sr > 0)) throw new Error('renderSequenceOffline needs a sampleRate.');
  const channels = Math.max(1, Math.round(toNumber(opts.numberOfChannels, 1, 1, 32)));
  const tl = buildTimeline(model, { sampleRate: sr });
  const tailS = toNumber(opts.tailS, 0.05, 0, 10);
  const length = Math.max(1, Math.ceil((tl.duration + STOP_PAD_S + tailS) * sr));
  let ctx;
  try {
    ctx = new OfflineCtor({ numberOfChannels: channels, length, sampleRate: sr });
  } catch (e) {
    ctx = new OfflineCtor(channels, length, sr);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(toNumber(opts.level, 1, GAIN_FLOOR, 1), 0);
  gain.connect(ctx.destination);
  const voice = compileSequence(model, ctx, gain, 0, { waveform: opts.waveform, timers: null });
  const buffer = await ctx.startRendering();
  voice.dispose();
  try {
    gain.disconnect();
  } catch (e) {
    /* ignore */
  }
  return { buffer, voice };
}
