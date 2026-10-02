// Config export/import ("CONFIG EXPORT" in V2-SPEC-VISUAL-FUNCTIONAL.md). Pure: builds a plain
// JSON document from plain inputs and validates an incoming one. No runtime nodes, no DOM.
//
// Document (version 1):
//   { version: 1, oscillaVersion, sampleRateRequested, mode, source, waveform, frequency, gain,
//     envelope, filter, pattern, sequencer, dualOsc, metadata, additive?, phaseStereo? }
// The instrument part maps 1:1 onto the V1 configuration (url-state.js serializeConfig), so an
// import goes through the same validated path as presets and links (instrument.applyConfig).

export const CONFIG_FILE_VERSION = 1;
export const CONFIG_FILE_KIND = 'oscilla-config';
const SOURCES = ['single', 'sweep', 'dual'];
const WAVES = ['sine', 'square', 'triangle', 'sawtooth'];
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * Build the export document.
 * input: {
 *   oscillaVersion, sampleRate (null before audio), mode (V1 mode id), workspace,
 *   instrument: serializeConfig() output (V1 cfg), envelope: { enabled, a, d, s, r } | null,
 *   filter: { enabled, type, frequency, Q, gain } | null, sequencer: serializeSequence() | null,
 *   additive: { enabled, partials } | null, phaseStereo: { freqA, freqB, phaseDeg, pan, route } | null,
 *   now: Date (metadata.exportedAt), userAgent?: string
 * }
 */
export function buildConfigExport(input) {
  const cfg = input.instrument || {};
  const pid = cfg.pattern;
  return {
    kind: CONFIG_FILE_KIND,
    version: CONFIG_FILE_VERSION,
    oscillaVersion: String(input.oscillaVersion || ''),
    sampleRateRequested: isNum(input.sampleRate) ? input.sampleRate : null,
    mode: input.mode || 'playground',
    source: cfg.source,
    waveform: cfg.waveform,
    frequency: cfg.frequency,
    gain: cfg.gain,
    envelope: {
      attackMs: cfg.attack,
      releaseMs: cfg.release,
      adsr: input.envelope ? {
        enabled: !!input.envelope.enabled,
        a: input.envelope.a, d: input.envelope.d, s: input.envelope.s, r: input.envelope.r,
      } : null,
    },
    filter: input.filter ? {
      enabled: !!input.filter.enabled, type: input.filter.type, frequency: input.filter.frequency,
      Q: input.filter.Q, gain: input.filter.gain,
    } : null,
    pattern: {
      id: pid,
      durationMs: cfg.duration,
      params: cfg.pp && cfg.pp[pid] ? copy(cfg.pp[pid]) : null,
      sweep: cfg.sweep ? copy(cfg.sweep) : null,
      a4: cfg.a4,
      range: cfg.range ? copy(cfg.range) : null,
    },
    sequencer: input.sequencer ? copy(input.sequencer) : null,
    dualOsc: cfg.dual ? copy(cfg.dual) : null,
    additive: input.additive ? {
      enabled: !!input.additive.enabled,
      partials: (input.additive.partials || []).map((p) => ({ n: p.n, gain: p.gain, phase: p.phase })),
    } : null,
    phaseStereo: input.phaseStereo ? copy(input.phaseStereo) : null,
    metadata: {
      app: 'OSCILLA',
      workspace: input.workspace || 'playground',
      exportedAt: input.now instanceof Date ? input.now.toISOString() : null,
      note: 'Digital configuration only; no measurement or calibration data.',
    },
  };
}

/**
 * Validate an import (object or JSON text). Never throws.
 * Returns { ok, errors[], warnings[], instrument (V1 cfg for applyConfig) | null,
 *   envelope, filter, sequencer, additive, phaseStereo, mode }.
 * Structural problems are errors (nothing is applied); out-of-range values inside a valid
 * structure are left to the per-field validators (instrument.applyConfig, the labs, the
 * sequencer's parseSequence), which skip or clamp them and report it.
 */
export function parseConfigImport(input) {
  const errors = [];
  const warnings = [];
  let doc = input;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input);
    } catch (e) {
      return fail([`Not valid JSON: ${e.message}`]);
    }
  }
  if (!isObj(doc)) return fail(['The file does not contain a configuration object.']);
  if (doc.kind !== undefined && doc.kind !== CONFIG_FILE_KIND) {
    return fail([`Unknown file kind "${String(doc.kind).slice(0, 40)}".`]);
  }
  if (doc.version !== CONFIG_FILE_VERSION) {
    return fail([`Unsupported config version ${JSON.stringify(doc.version)} (expected 1).`]);
  }
  if (doc.oscillaVersion !== undefined && typeof doc.oscillaVersion !== 'string') {
    errors.push('oscillaVersion must be a string.');
  }
  if (doc.source !== undefined && !SOURCES.includes(doc.source)) {
    errors.push(`source must be one of ${SOURCES.join(', ')}.`);
  }
  if (doc.waveform !== undefined && !WAVES.includes(doc.waveform)) {
    errors.push(`waveform must be one of ${WAVES.join(', ')}.`);
  }
  if (doc.frequency !== undefined && !(isNum(doc.frequency) && doc.frequency > 0)) {
    errors.push('frequency must be a positive number (Hz).');
  }
  if (doc.gain !== undefined && !(isNum(doc.gain) && doc.gain >= 0)) {
    errors.push('gain must be a non-negative number (logical gain).');
  }
  for (const key of ['envelope', 'filter', 'pattern', 'sequencer', 'dualOsc', 'metadata',
    'additive', 'phaseStereo']) {
    if (doc[key] != null && !isObj(doc[key])) errors.push(`${key} must be an object or null.`);
  }
  if (errors.length) return fail(errors);

  const pattern = doc.pattern || {};
  const instrument = { v: 1 };
  if (doc.source !== undefined) instrument.source = doc.source;
  if (pattern.id !== undefined) instrument.pattern = pattern.id;
  if (doc.waveform !== undefined) instrument.waveform = doc.waveform;
  if (doc.frequency !== undefined) instrument.frequency = doc.frequency;
  if (doc.gain !== undefined) instrument.gain = doc.gain;
  if (pattern.durationMs !== undefined) instrument.duration = pattern.durationMs;
  const env = doc.envelope || {};
  if (env.attackMs !== undefined) instrument.attack = env.attackMs;
  if (env.releaseMs !== undefined) instrument.release = env.releaseMs;
  if (pattern.a4 !== undefined) instrument.a4 = pattern.a4;
  if (isObj(pattern.range)) instrument.range = copy(pattern.range);
  if (isObj(pattern.params) && typeof pattern.id === 'string') {
    instrument.pp = { [pattern.id]: copy(pattern.params) };
  }
  if (isObj(pattern.sweep)) instrument.sweep = copy(pattern.sweep);
  if (isObj(doc.dualOsc)) instrument.dual = copy(doc.dualOsc);

  let envelope = null;
  if (isObj(env.adsr)) {
    const a = env.adsr;
    if (['a', 'd', 's', 'r'].every((k) => isNum(a[k]) && a[k] >= 0) && a.s <= 1) {
      envelope = { enabled: !!a.enabled, adsr: { a: a.a, d: a.d, s: a.s, r: a.r } };
    } else warnings.push('envelope.adsr ignored: a, d, r must be seconds >= 0 and s in 0..1.');
  }
  let filter = null;
  if (isObj(doc.filter)) {
    const f = doc.filter;
    if (FILTER_TYPES.includes(f.type) && isNum(f.frequency) && f.frequency > 0
      && isNum(f.Q) && f.Q > 0 && (f.gain === undefined || isNum(f.gain))) {
      filter = { enabled: !!f.enabled, type: f.type, frequency: f.frequency, Q: f.Q,
        gain: isNum(f.gain) ? f.gain : 0 };
    } else warnings.push('filter ignored: needs type, frequency > 0 and Q > 0.');
  }
  let additive = null;
  if (isObj(doc.additive) && Array.isArray(doc.additive.partials)) {
    const parts = doc.additive.partials;
    if (parts.length <= 256 && parts.every((p) => isObj(p) && Number.isInteger(p.n) && p.n >= 1
      && isNum(p.gain) && p.gain >= 0 && isNum(p.phase))) {
      additive = { enabled: !!doc.additive.enabled, partials: parts.map((p) => ({ ...p })) };
    } else warnings.push('additive ignored: partials must be { n >= 1, gain >= 0, phase }.');
  }
  let phaseStereo = null;
  if (isObj(doc.phaseStereo)) {
    const p = doc.phaseStereo;
    phaseStereo = {};
    for (const k of ['freqA', 'freqB', 'phaseDeg', 'pan']) if (isNum(p[k])) phaseStereo[k] = p[k];
    if (p.route === 'mono' || p.route === 'stereo') phaseStereo.route = p.route;
  }
  return {
    ok: true,
    errors,
    warnings,
    instrument,
    envelope,
    filter,
    sequencer: isObj(doc.sequencer) ? copy(doc.sequencer) : null,
    additive,
    phaseStereo,
    mode: typeof doc.mode === 'string' ? doc.mode : null,
  };

  function fail(list) {
    return {
      ok: false, errors: list, warnings, instrument: null, envelope: null, filter: null,
      sequencer: null, additive: null, phaseStereo: null, mode: null,
    };
  }
}

/** File name for an export: oscilla-<what>-<YYYYMMDD-HHMMSS>.<ext> (local time). */
export function exportFileName(what, ext, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-`
    + `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `oscilla-${what}-${stamp}.${ext}`;
}
