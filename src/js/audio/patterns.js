// Pattern descriptors, defaults and signal planning. Pure: no Web Audio, no DOM, no globals.
// Extracted from V1 (index.html@36f4b47, section 1 descriptors/defaults and section 6 SIGNAL
// PLANNING), ported to index.html@a7b7a23 (continuous plans, sounding dual frequencies, bounded
// FM, modulation extremes in plan.freqs, limitable finite tone). Moved bodies are unchanged;
// plan.label strings are UI text that history entries store (inventory K13), so they must not
// change.
//
// The sequencer compiler can reuse the descriptors (PATTERNS[].params) and buildPlan.

import {
  MAX_PROGRAMMED_S, MIN_FREQUENCY, OCTAVE_STEP_FREQUENCIES, SAFE_NYQUIST_FACTOR, WAVEFORMS,
} from '../core/constants.js';
import { clamp, isNum, mulberry32, pick, round, sig, toInt, toNumber } from '../core/math.js';
import {
  formatFrequency, normalizedToFrequency, parseFrequencyList,
} from '../core/frequency.js';

// V1: F, MS, INT, HZ, SEL, GLOBAL_FREQ, ENV_PARAMS, SWEEP_PARAMS, PATTERNS, PATTERN_BY_ID,
// PATTERN_GROUPS, DEFAULT_PATTERN_PARAMS, DEFAULT_SWEEP, DEFAULT_DUAL (index.html@a7b7a23)
// Parameter descriptors drive the contextual pattern form. `obj` names where the value
// lives: 'global' (top-level state), 'sweep' (shared sweep config) or 'pp' (per-pattern).
export const F = (key, label, obj = 'pp') => ({ key, label, type: 'freq', obj });
export const MS = (key, label, min, max, obj = 'pp') => ({ key, label, type: 'ms', min, max, obj });
export const INT = (key, label, min, max) => ({ key, label, type: 'int', min, max, obj: 'pp' });
export const HZ = (key, label, min, max) => ({ key, label, type: 'hz', min, max, obj: 'pp' });
export const SEL = (key, label, options, obj = 'pp') => ({ key, label, type: 'select', options, obj });
export const GLOBAL_FREQ = F('frequency', 'Frequency', 'global');
// The Playground sweep patterns keep their own parameters (pp.sweepUp / pp.sweepDown), so a
// pattern preset never rewrites the settings of SWEEP mode.
// Envelope and duration live on the instrument itself (obj 'global'), shared by every pattern.
export const ENV_PARAMS = {
  attack: MS('attack', 'Attack', 1, 2000, 'global'),
  release: MS('release', 'Release', 5, 3000, 'global'),
  duration: MS('duration', 'Duration', 10, 10000, 'global'),
};

export const SWEEP_PARAMS = [
  F('start', 'Start frequency'), F('end', 'End frequency'),
  MS('durationMs', 'Duration', 20, MAX_PROGRAMMED_S * 1000),
  SEL('curve', 'Curve', [['log', 'Logarithmic'], ['linear', 'Linear']]),
];

export const PATTERNS = [
  { id: 'tone', label: 'Continuous tone', group: 'Tones', kind: 'open',
    desc: 'Sustained tone while held. Frequency, waveform and gain respond live.',
    params: [GLOBAL_FREQ, MS('duration', 'Trigger duration', 10, 10000, 'global'), ENV_PARAMS.attack, ENV_PARAMS.release] },
  { id: 'finite', label: 'Finite tone', group: 'Tones', kind: 'finite',
    desc: 'One tone of programmed duration with attack and release ramps.',
    params: [GLOBAL_FREQ, MS('duration', 'Duration', 10, 10000, 'global'),
      MS('attack', 'Attack', 1, 2000, 'global'), MS('release', 'Release', 5, 3000, 'global')] },
  { id: 'pulse', label: 'Pulse', group: 'Rhythmic', kind: 'finite',
    desc: 'Repeated tone pulses separated by pauses.',
    params: [GLOBAL_FREQ, MS('pulseMs', 'Pulse duration', 5, 5000), MS('pauseMs', 'Pause duration', 0, 5000),
      INT('reps', 'Repetitions', 1, 100)] },
  { id: 'burst', label: 'Burst', group: 'Rhythmic', kind: 'finite',
    desc: 'Short tone bursts at a fixed onset-to-onset interval.',
    params: [GLOBAL_FREQ, MS('burstMs', 'Burst duration', 5, 2000), MS('intervalMs', 'Interval (onset to onset)', 10, 10000),
      INT('count', 'Number of bursts', 1, 100)] },
  { id: 'sweepUp', label: 'Sweep up', group: 'Sweeps', kind: 'finite',
    desc: 'Rising sweep from the lower to the higher frequency.', params: SWEEP_PARAMS },
  { id: 'sweepDown', label: 'Sweep down', group: 'Sweeps', kind: 'finite',
    desc: 'Falling sweep from the higher to the lower frequency.', params: SWEEP_PARAMS },
  { id: 'pingpong', label: 'Ping-pong sweep', group: 'Sweeps', kind: 'finite',
    desc: 'Up and down between two frequencies without a gap.',
    params: [F('min', 'Min frequency'), F('max', 'Max frequency'), MS('cycleMs', 'Cycle duration (up + down)', 40, 30000),
      INT('repeats', 'Repeat count', 1, 100), SEL('curve', 'Curve', [['log', 'Logarithmic'], ['linear', 'Linear']])] },
  { id: 'chirp', label: 'Chirp', group: 'Sweeps', kind: 'finite',
    desc: 'A short, fast sweep.',
    params: [F('start', 'Start frequency'), F('end', 'End frequency'), MS('durationMs', 'Chirp duration', 10, 5000),
      SEL('ramp', 'Ramp', [['exponential', 'Exponential'], ['linear', 'Linear']])] },
  { id: 'siren', label: 'Siren', group: 'Modulated', kind: 'open',
    desc: 'Frequency moved between two limits by a low-frequency oscillator.',
    params: [F('min', 'Minimum frequency'), F('max', 'Maximum frequency'), HZ('rate', 'LFO rate (Hz)', 0.05, 20),
      SEL('shape', 'Modulation shape', [['sine', 'Sine'], ['triangle', 'Triangle']])] },
  { id: 'alternating', label: 'Alternating', group: 'Rhythmic', kind: 'finite',
    desc: 'Two frequencies in turn.',
    params: [F('fA', 'Frequency A'), F('fB', 'Frequency B'), MS('toneMs', 'Tone duration', 10, 5000),
      MS('gapMs', 'Gap', 0, 5000), INT('repeats', 'Repeat count (pairs)', 1, 100)] },
  { id: 'wobble', label: 'Wobble', group: 'Modulated', kind: 'open',
    desc: 'Slow sinusoidal frequency deviation around the center frequency.',
    params: [F('frequency', 'Center frequency', 'global'), HZ('depth', 'Depth (± Hz)', 0, 5000), HZ('rate', 'Modulation rate (Hz)', 0.05, 30)] },
  { id: 'am', label: 'AM tremolo', group: 'Modulated', kind: 'open',
    desc: 'Amplitude modulation: the level rises and falls periodically.',
    params: [F('frequency', 'Carrier frequency', 'global'), HZ('modFreq', 'Modulation frequency (Hz)', 0.1, 500),
      INT('depth', 'Modulation depth (%)', 0, 100)] },
  { id: 'fm', label: 'FM', group: 'Modulated', kind: 'open',
    desc: 'Frequency modulation: a second oscillator moves the carrier frequency.',
    params: [F('frequency', 'Carrier frequency', 'global'), HZ('modFreq', 'Modulation frequency (Hz)', 0.1, 2000),
      HZ('depthHz', 'Modulation depth (± Hz)', 0, 10000)] },
  { id: 'random', label: 'Random', group: 'Sequences', kind: 'finite',
    desc: 'Random frequencies, uniformly spread on a logarithmic scale. A new sequence follows each play.',
    params: [F('min', 'Minimum frequency'), F('max', 'Maximum frequency'), MS('toneMs', 'Tone duration', 10, 5000),
      MS('gapMs', 'Gap', 0, 5000), INT('count', 'Count', 1, 200)] },
  { id: 'octave', label: 'Octave steps', group: 'Sequences', kind: 'finite',
    desc: 'Octave steps, by default 125 Hz to 16 kHz; steps above the digital limit are skipped.',
    params: [{ key: 'text', label: 'Steps (Hz)', type: 'text', obj: 'pp' }, MS('toneMs', 'Tone duration', 10, 5000),
      MS('gapMs', 'Gap', 0, 5000)] },
  { id: 'sequence', label: 'User sequence', group: 'Sequences', kind: 'finite',
    desc: 'Your own comma-separated frequencies, e.g. 440, 880, 660, 1.32k.',
    params: [{ key: 'text', label: 'Frequencies', type: 'text', obj: 'pp' }, MS('toneMs', 'Tone duration', 10, 5000),
      MS('gapMs', 'Gap', 0, 5000), INT('repeats', 'Repeats', 1, 50)] },
];
export const PATTERN_BY_ID = Object.fromEntries(PATTERNS.map((p) => [p.id, p]));
export const PATTERN_GROUPS = ['Tones', 'Rhythmic', 'Sweeps', 'Modulated', 'Sequences'];

export const DEFAULT_PATTERN_PARAMS = {
  pulse: { pulseMs: 150, pauseMs: 150, reps: 4 },
  burst: { burstMs: 30, intervalMs: 200, count: 6 },
  sweepUp: { start: 20, end: 20000, durationMs: 10000, curve: 'log' },
  sweepDown: { start: 20, end: 20000, durationMs: 10000, curve: 'log' },
  pingpong: { min: 200, max: 4000, cycleMs: 2000, repeats: 2, curve: 'log' },
  chirp: { start: 2000, end: 8000, durationMs: 300, ramp: 'exponential' },
  siren: { min: 600, max: 1200, rate: 0.5, shape: 'sine' },
  alternating: { fA: 440, fB: 660, toneMs: 250, gapMs: 50, repeats: 4 },
  wobble: { depth: 40, rate: 5 },
  am: { modFreq: 4, depth: 80 },
  fm: { modFreq: 5, depthHz: 60 },
  random: { min: 200, max: 4000, toneMs: 150, gapMs: 50, count: 12, seed: 20261001 },
  octave: { text: OCTAVE_STEP_FREQUENCIES.join(', '), toneMs: 400, gapMs: 100 },
  sequence: { text: '440, 880, 660, 1320', toneMs: 300, gapMs: 50, repeats: 1 },
};
export const DEFAULT_SWEEP = {
  start: 20, end: 20000, durationMs: 10000, curve: 'log', direction: 'up', repeat: 'once', repeatCount: 3,
};
export const DEFAULT_DUAL = {
  a: { freq: 440, wave: 'sine', gain: 100, detune: 0 },
  b: { freq: 442, wave: 'sine', gain: 100, detune: 0 },
  levelA: 80, levelB: 80, stereo: false, binaural: false,
};

// V1: plan types, lfoShape, findTimed, planTime, planFreqAt, planAmpAt, stepsFromFrequencies,
// sweepSegments, summarizeFrequencies, buildPlan (index.html@a7b7a23)
// buildPlan() is pure: it turns UI configuration into a plain "plan" (times in seconds,
// frequencies already clamped below the safe maximum). The engine executes plans; the
// visualizer previews them with planFreqAt(). One plan type per graph topology:
//   const  — one oscillator, fixed frequency (open or finite)
//   steps  — one oscillator, frequency switched while the envelope is at its floor
//   ramps  — one oscillator, frequency ramped (linear or exponential) per segment
//   lfo    — oscillator frequency modulated by a low-frequency oscillator (siren, wobble)
//   am     — oscillator level modulated by an LFO
//   fm     — oscillator frequency modulated by an audio- or sub-audio-rate oscillator
//   dual   — two oscillators, mono mix or stereo split
// kind: 'open' (held / latched / triggered for a duration), 'finite' (programmed end) or
// 'continuous' (a repeating cycle of `period` seconds with no end; the engine schedules it a
// few seconds ahead and tops it up). plan.freqs lists every frequency involved, including
// modulation extremes, so range warnings see what can actually sound.

export function lfoShape(shape, phase) {
  const p = phase - Math.floor(phase);
  if (shape === 'triangle') return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
  return Math.sin(2 * Math.PI * p);
}

export function findTimed(list, t) {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (found < 0) return null;
  const item = list[found];
  return t <= item.t + item.dur ? item : null;
}

/** Time within the plan's own schedule: a continuous plan repeats every plan.period seconds. */
export function planTime(plan, t) {
  return plan.period > 0 ? t % plan.period : t;
}

/** Requested instantaneous frequency of a plan at t seconds after its start; null in gaps. */
export function planFreqAt(plan, t) {
  if (!plan) return null;
  t = planTime(plan, t);
  switch (plan.type) {
    case 'const': case 'am': return plan.freq;
    case 'dual': return plan.a.freq;
    case 'steps': { const s = findTimed(plan.steps, t); return s ? s.f : null; }
    case 'ramps': {
      const s = findTimed(plan.segments, t);
      if (!s) return null;
      const x = s.dur > 0 ? clamp((t - s.t) / s.dur, 0, 1) : 1;
      return s.curve === 'log' ? s.f0 * Math.pow(s.f1 / s.f0, x) : s.f0 + (s.f1 - s.f0) * x;
    }
    case 'lfo': return plan.center + plan.depth * lfoShape(plan.shape, plan.rate * t);
    case 'fm': return plan.freq + plan.depth * Math.sin(2 * Math.PI * plan.modFreq * t);
    default: return null;
  }
}

/** Relative programmed level (0..1) ignoring attack/release ramps. */
export function planAmpAt(plan, t) {
  if (!plan) return 0;
  t = planTime(plan, t);
  if (plan.type === 'am') return 1 - plan.depth / 2 + (plan.depth / 2) * Math.sin(2 * Math.PI * plan.modFreq * t);
  if (plan.type === 'steps') return findTimed(plan.steps, t) ? 1 : 0;
  if (plan.type === 'ramps') return findTimed(plan.segments, t) ? 1 : 0;
  if (plan.kind === 'finite') return t <= plan.dur ? 1 : 0;
  return 1;
}

export function stepsFromFrequencies(freqs, toneS, gapS, repeats, warnings) {
  const steps = [];
  let t = 0;
  outer:
  for (let r = 0; r < repeats; r++) {
    for (const f of freqs) {
      if (t + toneS > MAX_PROGRAMMED_S) {
        warnings.push(`Pattern truncated at ${MAX_PROGRAMMED_S} s.`);
        break outer;
      }
      steps.push({ t, dur: toneS, f });
      t += toneS + gapS;
    }
  }
  return steps;
}

export function sweepSegments(lo, hi, passS, curve, direction, cycles, gapS) {
  const segments = [];
  let t = 0;
  for (let c = 0; c < cycles; c++) {
    if (direction === 'pingpong') {
      segments.push({ t, dur: passS, f0: lo, f1: hi, curve });
      segments.push({ t: t + passS, dur: passS, f0: hi, f1: lo, curve });
      t += 2 * passS;
    } else {
      const up = direction === 'up';
      segments.push({ t, dur: passS, f0: up ? lo : hi, f1: up ? hi : lo, curve });
      t += passS + gapS;
    }
  }
  return segments;
}

export function summarizeFrequencies(values) {
  const out = [];
  for (const v of values) {
    const r = round(v, 2);
    if (!out.includes(r)) out.push(r);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Build a playable plan from a configuration snapshot.
 * env = { safeMax, continuous } — safeMax is the running (or provisional) safe maximum.
 * Returns { ok: true, plan } or { ok: false, error }.
 */
export function buildPlan(cfg, env) {
  const warnings = [];
  const safeMax = env.safeMax;
  const cf = (f, label) => {
    if (!isNum(f) || f <= 0) throw new Error(`${label} is not a valid frequency.`);
    if (f > safeMax) {
      warnings.push(`${label} ${formatFrequency(f)} is above the digital safe maximum; clamped to ${formatFrequency(safeMax)}.`);
      return safeMax;
    }
    return Math.max(MIN_FREQUENCY, f);
  };
  const wave = pick(cfg.waveform, WAVEFORMS, 'sine');
  const sec = (ms, lo, hi) => toNumber(ms, lo * 1000, lo * 1000, hi * 1000) / 1000;
  try {
    if (cfg.source === 'dual') {
      const d = cfg.dual;
      const osc = (o, label) => {
        const detune = toNumber(o.detune, 0, -1200, 1200);
        const ratio = Math.pow(2, detune / 1200);
        // freq is the sounding (detuned, clamped) frequency and detune is 0: the engine plays
        // exactly freq, and planFreqAt / the readouts report what is heard. The requested
        // nominal frequency and cents are kept for reference.
        const sounding = cf(toNumber(o.freq, 440) * ratio, label);
        return { freq: sounding, detune: 0, nominal: sounding / ratio, cents: detune, wave: pick(o.wave, WAVEFORMS, 'sine'), gain: toNumber(o.gain, 100, 0, 100) / 100 };
      };
      const a = osc(d.a, 'Osc A');
      const b = osc(d.b, 'Osc B');
      const plan = {
        type: 'dual', kind: 'open', wave: a.wave, a, b, stereo: !!d.stereo, binaural: !!d.binaural,
        levelA: toNumber(d.levelA, 80, 0, 100) / 100, levelB: toNumber(d.levelB, 80, 0, 100) / 100,
        label: `${d.stereo ? 'Stereo' : 'Mono'} dual ${formatFrequency(a.freq)} + ${formatFrequency(b.freq)}`,
        freqs: [a.freq, b.freq], modulated: false,
      };
      return { ok: true, plan, warnings };
    }

    if (cfg.source === 'sweep') {
      const s = cfg.sweep;
      const f0 = cf(toNumber(s.start, 20), 'Start');
      const f1 = cf(toNumber(s.end, 20000), 'End');
      const lo = Math.min(f0, f1);
      const hi = Math.max(f0, f1);
      const curve = pick(s.curve, ['log', 'linear'], 'log');
      const direction = pick(s.direction, ['up', 'down', 'pingpong'], 'up');
      // A ping-pong cycle is two passes, so one pass may use at most half the programmed cap.
      const passS = sec(s.durationMs, 0.02, direction === 'pingpong' ? MAX_PROGRAMMED_S / 2 : MAX_PROGRAMMED_S);
      const cycleS = direction === 'pingpong' ? 2 * passS : passS + 0.03;
      let cycles = 1;
      let continuous = false;
      if (s.repeat === 'n') cycles = toInt(s.repeatCount, 3, 1, 1000);
      if (s.repeat === 'continuous') {
        if (env.continuous) continuous = true;
        else warnings.push('Continuous repeat needs “Allow continuous playback”; playing once.');
      }
      const maxCycles = Math.max(1, Math.floor(MAX_PROGRAMMED_S / cycleS));
      if (!continuous && cycles > maxCycles) {
        warnings.push(`Repeats limited to ${maxCycles} (${MAX_PROGRAMMED_S} s maximum).`);
        cycles = maxCycles;
      }
      // A continuous repeat is one cycle plus its period; the engine repeats it until stopped.
      const segments = sweepSegments(lo, hi, passS, curve, direction, continuous ? 1 : cycles, 0.03);
      const last = segments[segments.length - 1];
      const arrow = direction === 'pingpong' ? '↔' : '→';
      const [from, to] = direction === 'down' ? [hi, lo] : [lo, hi];
      return {
        ok: true, warnings, plan: {
          type: 'ramps', kind: continuous ? 'continuous' : 'finite', wave, segments,
          dur: continuous ? Infinity : last.t + last.dur, period: continuous ? cycleS : 0,
          envelope: direction === 'pingpong' ? 'whole' : 'segment',
          label: `Sweep ${formatFrequency(from)} ${arrow} ${formatFrequency(to)} · ${curve}`,
          freqs: [from, to], modulated: true,
        },
      };
    }

    const pattern = PATTERN_BY_ID[cfg.pattern] ? cfg.pattern : 'tone';
    const pp = cfg.pp || {};
    const p = { ...DEFAULT_PATTERN_PARAMS[pattern], ...(pp[pattern] || {}) };
    const freq = () => cf(toNumber(cfg.frequency, 440), 'Frequency');
    const label = PATTERN_BY_ID[pattern].label;
    const stepsPlan = (freqs, toneMs, gapMs, repeats) => {
      const steps = stepsFromFrequencies(freqs, sec(toneMs, 0.005, 10), sec(gapMs, 0, 10), repeats, warnings);
      if (!steps.length) throw new Error('The pattern contains no playable steps.');
      const last = steps[steps.length - 1];
      return {
        type: 'steps', kind: 'finite', wave, steps, dur: last.t + last.dur, label,
        freqs: summarizeFrequencies(steps.map((s) => s.f)), modulated: true,
      };
    };
    let plan;
    switch (pattern) {
      case 'tone':
        plan = { type: 'const', kind: 'open', wave, freq: freq(), label, modulated: false };
        plan.freqs = [plan.freq];
        break;
      case 'finite':
        // limitable: the hard safety limit also caps this tone unless continuous playback is allowed.
        plan = { type: 'const', kind: 'finite', wave, freq: freq(), dur: sec(cfg.duration, 0.01, 10), label, modulated: false, limitable: true };
        plan.freqs = [plan.freq];
        break;
      case 'pulse':
        plan = stepsPlan(Array(toInt(p.reps, 4, 1, 100)).fill(freq()), p.pulseMs, p.pauseMs, 1);
        break;
      case 'burst': {
        const burst = toNumber(p.burstMs, 30, 5, 2000);
        const interval = Math.max(burst, toNumber(p.intervalMs, 200, 10, 10000));
        plan = stepsPlan(Array(toInt(p.count, 6, 1, 100)).fill(freq()), burst, interval - burst, 1);
        break;
      }
      case 'alternating':
        plan = stepsPlan([cf(toNumber(p.fA, 440), 'Frequency A'), cf(toNumber(p.fB, 660), 'Frequency B')],
          p.toneMs, p.gapMs, toInt(p.repeats, 4, 1, 100));
        break;
      case 'random': {
        const lo = cf(toNumber(p.min, 200), 'Minimum');
        const hi = cf(toNumber(p.max, 4000), 'Maximum');
        const rnd = mulberry32(toInt(p.seed, 1, 0, 2 ** 31));
        const n = toInt(p.count, 12, 1, 200);
        const list = [];
        for (let i = 0; i < n; i++) list.push(normalizedToFrequency(rnd(), Math.min(lo, hi), Math.max(lo, hi)));
        plan = stepsPlan(list, p.toneMs, p.gapMs, 1);
        break;
      }
      case 'octave': case 'sequence': {
        const parsed = parseFrequencyList(p.text);
        if (parsed.invalid.length) {
          return { ok: false, error: `Sequence contains invalid entries: ${parsed.invalid.slice(0, 5).join(', ')}.` };
        }
        const low = parsed.values.filter((f) => f < MIN_FREQUENCY).length;
        const high = parsed.values.filter((f) => f > safeMax).length;
        const usable = parsed.values.filter((f) => f >= MIN_FREQUENCY && f <= safeMax);
        if (low) warnings.push(`${low} value(s) below ${formatFrequency(MIN_FREQUENCY)} skipped.`);
        if (high) warnings.push(`${high} value(s) above the safe maximum skipped.`);
        if (!usable.length) return { ok: false, error: 'The sequence has no frequencies within the allowed range.' };
        plan = stepsPlan(usable, p.toneMs, p.gapMs, pattern === 'octave' ? 1 : toInt(p.repeats, 1, 1, 50));
        break;
      }
      case 'sweepUp': case 'sweepDown': {
        // Before schema-compatible pattern params existed, these patterns read cfg.sweep.
        const s = pp[pattern] ? p : { ...p, ...(cfg.sweep || {}) };
        const a = cf(toNumber(s.start, 20), 'Start');
        const b = cf(toNumber(s.end, 20000), 'End');
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const up = pattern === 'sweepUp';
        const curve = pick(s.curve, ['log', 'linear'], 'log');
        const segments = [{ t: 0, dur: sec(s.durationMs, 0.02, MAX_PROGRAMMED_S), f0: up ? lo : hi, f1: up ? hi : lo, curve }];
        plan = { type: 'ramps', kind: 'finite', wave, segments, dur: segments[0].dur, envelope: 'segment',
          label: `${label} ${formatFrequency(segments[0].f0)} → ${formatFrequency(segments[0].f1)}`,
          freqs: [segments[0].f0, segments[0].f1], modulated: true };
        break;
      }
      case 'pingpong': {
        const a = cf(toNumber(p.min, 200), 'Min');
        const b = cf(toNumber(p.max, 4000), 'Max');
        const half = sec(p.cycleMs, 0.04, MAX_PROGRAMMED_S) / 2;
        let cycles = toInt(p.repeats, 2, 1, 100);
        const maxCycles = Math.max(1, Math.floor(MAX_PROGRAMMED_S / (2 * half)));
        if (cycles > maxCycles) { warnings.push(`Repeats limited to ${maxCycles}.`); cycles = maxCycles; }
        const segments = sweepSegments(Math.min(a, b), Math.max(a, b), half, pick(p.curve, ['log', 'linear'], 'log'), 'pingpong', cycles, 0);
        const last = segments[segments.length - 1];
        plan = { type: 'ramps', kind: 'finite', wave, segments, dur: last.t + last.dur, envelope: 'whole', label,
          freqs: [Math.min(a, b), Math.max(a, b)], modulated: true };
        break;
      }
      case 'chirp': {
        const a = cf(toNumber(p.start, 2000), 'Start');
        const b = cf(toNumber(p.end, 8000), 'End');
        const curve = p.ramp === 'linear' ? 'linear' : 'log';
        const segments = [{ t: 0, dur: sec(p.durationMs, 0.01, 5), f0: a, f1: b, curve }];
        plan = { type: 'ramps', kind: 'finite', wave, segments, dur: segments[0].dur, envelope: 'segment', label,
          freqs: [a, b], modulated: true, chirp: true };
        break;
      }
      case 'siren': {
        const a = cf(toNumber(p.min, 600), 'Minimum');
        const b = cf(toNumber(p.max, 1200), 'Maximum');
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        plan = { type: 'lfo', kind: 'open', wave, center: (lo + hi) / 2, depth: (hi - lo) / 2,
          rate: toNumber(p.rate, 0.5, 0.05, 20), shape: pick(p.shape, ['sine', 'triangle'], 'sine'),
          label, freqs: [lo, hi], modulated: true };
        break;
      }
      case 'wobble': {
        const center = freq();
        const maxDepth = Math.max(0, Math.min(center - MIN_FREQUENCY, safeMax - center));
        let depth = toNumber(p.depth, 40, 0, 5000);
        if (depth > maxDepth) { warnings.push(`Depth limited to ±${sig(maxDepth, 3)} Hz to stay inside 1 Hz … safe maximum.`); depth = maxDepth; }
        plan = { type: 'lfo', kind: 'open', wave, center, depth, rate: toNumber(p.rate, 5, 0.05, 30), shape: 'sine',
          label, freqs: summarizeFrequencies([center, center - depth, center + depth]), modulated: true, liveCenter: true };
        break;
      }
      case 'am':
        plan = { type: 'am', kind: 'open', wave, freq: freq(), modFreq: toNumber(p.modFreq, 4, 0.1, 500),
          depth: toNumber(p.depth, 80, 0, 100) / 100, label, modulated: true };
        plan.freqs = [plan.freq];
        break;
      case 'fm': {
        const carrier = freq();
        const modFreq = toNumber(p.modFreq, 5, 0.1, 2000);
        let depth = toNumber(p.depthHz, 60, 0, 10000);
        // Bounded on both sides: the instantaneous frequency never passes through zero (no
        // through-zero FM) and never exceeds the safe maximum.
        const maxDepth = Math.max(0, Math.min(safeMax - carrier, carrier - MIN_FREQUENCY));
        if (depth > maxDepth) { warnings.push(`Depth limited to ±${sig(maxDepth, 3)} Hz to stay inside 1 Hz … safe maximum.`); depth = maxDepth; }
        if (carrier + depth + 2 * modFreq > safeMax / SAFE_NYQUIST_FACTOR) {
          warnings.push('Sidebands may extend beyond Nyquist and fold back (alias).');
        }
        plan = { type: 'fm', kind: 'open', wave, freq: carrier, modFreq, depth, label,
          freqs: summarizeFrequencies([carrier, carrier - depth, carrier + depth]), modulated: true };
        break;
      }
      default:
        return { ok: false, error: `Unknown pattern “${pattern}”.` };
    }
    return { ok: true, plan, warnings };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : 'The configuration could not be played.' };
  }
}

// ---------------------------------------------------------------- dual and sweep maths

/** Sounding frequency of a dual-oscillator side: freq · 2^(detune / 1200). */
export function detunedFrequency(side) {
  // V1: oscillaApp getters dualFa, dualFb (index.html@a7b7a23)
  return side.freq * Math.pow(2, side.detune / 1200);
}

/** { fa, fb, delta } of a dual configuration (sounding frequencies and their difference). */
export function dualFrequencies(dual) {
  // V1: oscillaApp getters dualFa, dualFb, dualDelta (index.html@a7b7a23)
  const fa = detunedFrequency(dual.a);
  const fb = detunedFrequency(dual.b);
  return { fa, fb, delta: Math.abs(fa - fb) };
}

/** Octaves spanned by a sweep (start/end as configured, defaults 20 Hz / 20 kHz). */
export function sweepSpanOct(sweep) {
  // V1: oscillaApp getter sweepSpanOct (index.html@a7b7a23)
  const a = toNumber(sweep.start, 20);
  const b = toNumber(sweep.end, 20000);
  return Math.abs(Math.log2(b / a));
}

/** Linear sweep rate in Hz per second. */
export function sweepHzPerSec(sweep) {
  // V1: oscillaApp getter sweepHzPerSec (index.html@a7b7a23)
  return Math.abs(toNumber(sweep.end, 0) - toNumber(sweep.start, 0)) / (sweep.durationMs / 1000);
}

/** Logarithmic sweep rate in octaves per second. */
export function sweepOctPerSec(sweep) {
  // V1: oscillaApp getter sweepOctPerSec (index.html@a7b7a23)
  return sweepSpanOct(sweep) / (sweep.durationMs / 1000);
}
