// Instrument configuration: defaults, value validation and the single validated path that
// presets, links, history and Learn demos go through (V1 oscillaApp.applyConfig).
//
// Extracted from V1 (index.html@a7b7a23, section 8). The component methods applyConfig,
// setFrequency and fitRange became functions over a plain state object `s` (`this.` -> `s.`),
// with the sample-rate dependent limits passed in (inventory K6: before the first gesture the
// provisional 44.1 kHz applies, so the result depends on env.sampleRate). Notifications are
// returned as data ({ level, title, message }) instead of being shown.
//
//   applyConfig(state, cfg, { sampleRate, continuousAllowed, origin })   pure, returns a copy
//   applyConfigTo(s, cfg, origin, env)                                   mutates s in place

import {
  DEFAULT_GAIN, MAX_OUTPUT_GAIN, MAX_PROGRAMMED_S, MIN_FREQUENCY, RANGE_MODES, WAVEFORMS,
} from './constants.js';
import { clamp, deepCopy, isNum, round, toNumber } from './math.js';
import {
  fitRangeMode, formatFrequency, limitsFor, parseFrequency, parseFrequencyList, rangeBounds,
} from './frequency.js';
import {
  DEFAULT_DUAL, DEFAULT_PATTERN_PARAMS, DEFAULT_SWEEP, PATTERN_BY_ID,
} from '../audio/patterns.js';

// V1: defaultInstrumentState, coerceLike, paramDescriptor (index.html@a7b7a23)
export function defaultInstrumentState() {
  return {
    source: 'single', waveform: 'sine', pattern: 'tone', frequency: 440, gainLevel: DEFAULT_GAIN,
    duration: 500, attack: 10, release: 30, rangeMode: 'human', customMin: 100, customMax: 10000, a4: 440,
    pp: deepCopy(DEFAULT_PATTERN_PARAMS), sweep: deepCopy(DEFAULT_SWEEP), dual: deepCopy(DEFAULT_DUAL),
  };
}

/** Validate one value against the type of its default. Returns [ok, value]. */
export function coerceLike(defaultValue, incoming, desc) {
  if (typeof defaultValue === 'number') {
    const n = typeof incoming === 'string' ? Number(incoming) : incoming;
    if (!isNum(n)) return [false, defaultValue];
    const lo = desc && isNum(desc.min) ? desc.min : -Infinity;
    const hi = desc && isNum(desc.max) ? desc.max : Infinity;
    return [n >= lo && n <= hi && (desc && desc.type === 'freq' ? n > 0 : true), clamp(n, lo, hi)];
  }
  if (typeof defaultValue === 'string') {
    if (typeof incoming !== 'string') return [false, defaultValue];
    if (desc && desc.type === 'select') {
      const allowed = desc.options.map((o) => o[0]);
      return allowed.includes(incoming) ? [true, incoming] : [false, defaultValue];
    }
    return [true, incoming.slice(0, 2000)];
  }
  if (typeof defaultValue === 'boolean') return [typeof incoming === 'boolean', !!incoming];
  return [false, defaultValue];
}

export function paramDescriptor(patternId, key) {
  const p = PATTERN_BY_ID[patternId];
  return p ? p.params.find((d) => d.key === key && d.obj === 'pp') : null;
}

/** Keys of the serializable instrument state (defaultInstrumentState). */
export const INSTRUMENT_STATE_KEYS = Object.freeze(Object.keys(defaultInstrumentState()));

/**
 * Editor text fields that setFrequency/applyConfig keep in sync with the instrument state
 * (V1 component fields freqText, freqError, customMinText, customMaxText).
 */
export function defaultEditorFields() {
  return { freqText: '440 Hz', freqError: '', customMinText: '100 Hz', customMaxText: '10.00 kHz' };
}

/** A plain copy of the instrument state plus editor fields of any state-like object. */
export function pickInstrumentState(obj) {
  const out = {};
  for (const k of INSTRUMENT_STATE_KEYS) out[k] = deepCopy(obj[k]);
  const ed = defaultEditorFields();
  for (const k of Object.keys(ed)) out[k] = obj[k] !== undefined ? obj[k] : ed[k];
  return out;
}

// ---------------------------------------------------------------- frequency on a state

/**
 * Set s.frequency, clamped into the current range, and its editor text and message.
 * env: { sampleRate } (null = provisional). Returns false for an invalid frequency.
 */
export function setFrequencyOn(s, value, opts = {}, env = {}) {
  // V1: oscillaApp.setFrequency (index.html@a7b7a23); this.rangeMin/rangeMax/nyquist are
  // computed from s and env.sampleRate.
  const { nyquist, safeMax } = limitsFor(env.sampleRate);
  const range = () => rangeBounds(s, safeMax);
  const f = typeof value === 'string' ? parseFrequency(value).value : value;
  if (!isNum(f) || f <= 0) {
    s.freqError = 'Invalid frequency.';
    return false;
  }
  let v = f;
  let msg = '';
  if (v < range().min) {
    msg = `Below the ${s.rangeMode.toUpperCase()} range minimum (${formatFrequency(range().min)}).`
      + (s.rangeMode !== 'advanced' ? ' Choose ADVANCED range for lower frequencies.' : '');
    v = range().min;
  } else if (v > range().max) {
    msg = v >= nyquist
      ? `At or above the digital Nyquist limit (${formatFrequency(nyquist)}); limited to ${formatFrequency(range().max)}.`
      : `Above the ${s.rangeMode.toUpperCase()} range maximum (${formatFrequency(range().max)}).`;
    v = range().max;
  }
  s.frequency = round(v, 3);
  s.freqText = formatFrequency(s.frequency, true);
  s.freqError = opts.silent ? '' : msg;
  return true;
}

/** Choose the narrowest standard range that contains [lo, hi] (V1 oscillaApp.fitRange). */
export function fitRangeOn(s, lo, hi, env = {}) {
  // V1: oscillaApp.fitRange (index.html@a7b7a23)
  const { safeMax } = limitsFor(env.sampleRate);
  const mode = fitRangeMode(lo, hi, rangeBounds(s, safeMax), safeMax);
  if (mode) s.rangeMode = mode;
}

// ---------------------------------------------------------------- applyConfig

/**
 * The single validated path for presets, links, history and Learn demos, applied to s in place.
 * origin: 'preset' | 'hash' | 'history' | 'learn'. env: { sampleRate, continuousAllowed }.
 * Returns { issues, notices }: the number of rejected values (valid values are applied, invalid
 * ones skipped) and the notifications V1 showed, in order (appended to `notices` when given).
 */
export function applyConfigTo(s, cfg, origin, env = {}, notices = []) {
  // V1: oscillaApp.applyConfig (index.html@a7b7a23); this -> s, this.safeMax -> safeMax,
  // this.continuousAllowed -> env.continuousAllowed, this.notify -> notices.
  const notify = (level, title, message) => notices.push({ level, title, message });
  const { safeMax } = limitsFor(env.sampleRate);
  if (!cfg || typeof cfg !== 'object') return { issues: 1, notices };
  let issues = 0;
  const num = (v, lo, hi) => (isNum(v) && v >= lo && v <= hi ? v : null);
  if (cfg.source !== undefined) {
    if (['single', 'sweep', 'dual'].includes(cfg.source)) s.source = cfg.source; else issues++;
  }
  if (cfg.pattern !== undefined) {
    if (PATTERN_BY_ID[cfg.pattern]) s.pattern = cfg.pattern; else issues++;
  }
  if (cfg.waveform !== undefined) {
    if (WAVEFORMS.includes(cfg.waveform)) s.waveform = cfg.waveform; else issues++;
  }
  for (const [key, lo, hi, prop] of [['duration', 10, 10000, 'duration'], ['attack', 1, 2000, 'attack'],
    ['release', 5, 3000, 'release'], ['gain', 0, MAX_OUTPUT_GAIN, 'gainLevel']]) {
    if (cfg[key] === undefined) continue;
    const v = num(cfg[key], lo, hi);
    if (v == null) issues++; else s[prop] = v;
  }
  if (cfg.a4 !== undefined) {
    const v = num(cfg.a4, 432, 445);
    if (v == null) issues++; else s.a4 = Math.round(v);
  }
  if (cfg.range && typeof cfg.range === 'object') {
    if (RANGE_MODES.some((r) => r.id === cfg.range.mode)) s.rangeMode = cfg.range.mode; else if (cfg.range.mode !== undefined) issues++;
    const lo = num(cfg.range.min, MIN_FREQUENCY, 200000);
    const hi = num(cfg.range.max, MIN_FREQUENCY, 200000);
    if (lo != null && hi != null && hi >= lo * 2) { s.customMin = lo; s.customMax = hi; }
    s.customMinText = formatFrequency(s.customMin);
    s.customMaxText = formatFrequency(s.customMax);
  }
  if (cfg.pp && typeof cfg.pp === 'object') {
    for (const pid of Object.keys(cfg.pp)) {
      const defaults = DEFAULT_PATTERN_PARAMS[pid];
      const incoming = cfg.pp[pid];
      if (!defaults || !incoming || typeof incoming !== 'object') { issues++; continue; }
      for (const key of Object.keys(incoming)) {
        if (!(key in defaults)) { issues++; continue; }
        const desc = paramDescriptor(pid, key);
        const [ok, value] = coerceLike(defaults[key], incoming[key], desc);
        // Frequency lists must parse completely, or the link would only fail at play time.
        const badList = ok && desc && desc.type === 'text' && parseFrequencyList(value).invalid.length > 0;
        if (ok && !badList) {
          s.pp[pid][key] = value;
          // The applied value replaces what the user typed: drop that field's stale error.
          const errId = `pp-${pid}-pp-${key}`;
          if (s.paramErrors && errId in s.paramErrors) {
            const next = { ...s.paramErrors };
            delete next[errId];
            s.paramErrors = next;
          }
        } else issues++;
      }
    }
  }
  const legacyPatternSweep = ['sweepUp', 'sweepDown'].includes(cfg.pattern) && cfg.source !== 'sweep';
  if (legacyPatternSweep && cfg.sweep && typeof cfg.sweep === 'object' && !cfg.pp?.[cfg.pattern]) {
    // Older links and presets stored these patterns' parameters in cfg.sweep.
    for (const key of ['start', 'end', 'durationMs', 'curve']) {
      if (cfg.sweep[key] === undefined) continue;
      const [ok, value] = coerceLike(DEFAULT_PATTERN_PARAMS[cfg.pattern][key], cfg.sweep[key], paramDescriptor(cfg.pattern, key));
      if (ok) s.pp[cfg.pattern][key] = value; else issues++;
    }
  } else if (cfg.sweep && typeof cfg.sweep === 'object') {
    const sw = cfg.sweep;
    for (const key of ['start', 'end']) {
      if (sw[key] === undefined) continue;
      if (sw[key] === 'max') s.sweep[key] = round(safeMax, 2);
      else if (isNum(sw[key]) && sw[key] >= MIN_FREQUENCY) s.sweep[key] = Math.min(sw[key], round(safeMax, 2));
      else issues++;
    }
    if (sw.durationMs !== undefined) { const v = num(sw.durationMs, 20, MAX_PROGRAMMED_S * 1000); if (v == null) issues++; else s.sweep.durationMs = v; }
    if (sw.curve !== undefined) { if (['log', 'linear'].includes(sw.curve)) s.sweep.curve = sw.curve; else issues++; }
    if (sw.direction !== undefined) { if (['up', 'down', 'pingpong'].includes(sw.direction)) s.sweep.direction = sw.direction; else issues++; }
    if (sw.repeat !== undefined) {
      if (['once', 'n'].includes(sw.repeat)) s.sweep.repeat = sw.repeat;
      else if (sw.repeat === 'continuous') s.sweep.repeat = env.continuousAllowed ? 'continuous' : 'once';
      else issues++;
    }
    if (sw.repeatCount !== undefined) { const v = num(sw.repeatCount, 1, 1000); if (v == null) issues++; else s.sweep.repeatCount = Math.round(v); }
  }
  if (cfg.dual && typeof cfg.dual === 'object') {
    const d = cfg.dual;
    for (const side of ['a', 'b']) {
      const o = d[side];
      if (o === undefined) continue;
      if (!o || typeof o !== 'object') { issues++; continue; }
      if (o.freq !== undefined) { if (isNum(o.freq) && o.freq >= MIN_FREQUENCY) s.dual[side].freq = Math.min(o.freq, round(safeMax, 2)); else issues++; }
      if (o.wave !== undefined) { if (WAVEFORMS.includes(o.wave)) s.dual[side].wave = o.wave; else issues++; }
      if (o.gain !== undefined) { const v = num(o.gain, 0, 100); if (v == null) issues++; else s.dual[side].gain = v; }
      if (o.detune !== undefined) { const v = num(o.detune, -1200, 1200); if (v == null) issues++; else s.dual[side].detune = v; }
    }
    for (const key of ['levelA', 'levelB']) {
      if (d[key] === undefined) continue;
      const v = num(d[key], 0, 100);
      if (v == null) issues++; else s.dual[key] = v;
    }
    if (d.stereo !== undefined) s.dual.stereo = !!d.stereo;
    // Binaural mode needs an explicit headphone confirmation in this page view.
    s.dual.binaural = false;
    if (d.binaural && origin !== 'preset') {
      notify('info', 'Binaural mode not restored', 'Confirm headphone use in DUAL OSC to enable the binaural demo.');
    }
  }
  if (cfg.frequency !== undefined) {
    if (isNum(cfg.frequency) && cfg.frequency > 0) {
      const f = Math.min(cfg.frequency, safeMax);
      if (origin !== 'hash' || !(cfg.range && cfg.range.mode)) fitRangeOn(s, f, f, env);
      setFrequencyOn(s, f, { silent: origin !== 'hash' }, env);
    } else {
      issues++;
    }
  }
  return { issues, notices };
}

/**
 * Pure applyConfig: config + sample rate -> normalised state.
 * state: a state-like object (instrument fields + editor fields; defaults when omitted).
 * opts: { sampleRate (null = provisional), continuousAllowed (false), origin ('preset') }.
 * Returns { state, issues, notices }; the input state is not modified.
 */
export function applyConfig(state, cfg, opts = {}) {
  const s = pickInstrumentState(state || { ...defaultInstrumentState(), ...defaultEditorFields() });
  const { issues, notices } = applyConfigTo(s, cfg, opts.origin || 'preset', {
    sampleRate: opts.sampleRate, continuousAllowed: !!opts.continuousAllowed,
  });
  return { state: s, issues, notices };
}

// ---------------------------------------------------------------- gain mapping

/** UI percentage of a logical gain (square-root curve; MAX_OUTPUT_GAIN = 100 %). */
export function gainPctFor(gainLevel) {
  // V1: oscillaApp getter gainPct (index.html@a7b7a23)
  return Math.round(Math.sqrt(gainLevel / MAX_OUTPUT_GAIN) * 100);
}

/** Logical gain for a UI percentage (anything invalid becomes 57 %, the default 0.08). */
export function gainLevelForPct(pct) {
  // V1: oscillaApp.setGainPct (index.html@a7b7a23)
  const p = clamp(toNumber(pct, 57), 0, 100) / 100;
  return round(MAX_OUTPUT_GAIN * p * p, 4);
}

/** LOW / MEDIUM / HIGH label of a UI percentage. */
export function gainLabelFor(pct) {
  // V1: oscillaApp getter gainLabel (index.html@a7b7a23)
  return pct < 60 ? 'LOW' : pct < 80 ? 'MEDIUM' : 'HIGH';
}

/** V2 extension: the logical gain in dB re full scale (-Infinity for 0). */
export function gainLevelDb(gainLevel) {
  return gainLevel > 0 ? 20 * Math.log10(gainLevel) : -Infinity;
}

/** The gain a link may restore: never above the conservative default (V1 restoreFromHash). */
export function capLinkGain(gain) {
  if (isNum(gain) && gain > DEFAULT_GAIN) return { gain: DEFAULT_GAIN, capped: true };
  return { gain, capped: false };
}
