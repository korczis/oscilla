// OSCILLA V1 freeze vectors: the representative input set and how each output is computed.
// Shared by `node extract.cjs --golden` (writes golden.json) and freeze.test.cjs (re-runs and
// compares). Groups follow V2 spec §5. Every case is deterministic: Date.now and Math.random are
// fixed inside the vm context, timers never fire on their own, and Web Audio is a recording mock.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { loadOscilla, makeMockAudio, MemoryStorage, FIXED_NOW } = require('./extract.cjs');

// ------------------------------------------------------------------ encoding

const ARRAY_DIGEST_OVER = 64;

/** Host-realm, JSON-safe encoding: NaN/±Infinity/undefined/functions/typed arrays survive. */
function enc(v) {
  if (v === undefined) return { $u: 1 };
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number') {
    if (Number.isNaN(v)) return { $n: 'NaN' };
    if (v === Infinity) return { $n: 'Infinity' };
    if (v === -Infinity) return { $n: '-Infinity' };
    return v === 0 ? 0 : v; // -0 is not part of the contract
  }
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'function') return { $fn: v.name || 'anonymous' };
  if (ArrayBuffer.isView(v)) return { $typed: Object.prototype.toString.call(v).slice(8, -1), length: v.length };
  const tag = Object.prototype.toString.call(v);
  if (tag === '[object Set]') return { $set: [...v].map(enc) };
  if (tag === '[object Map]') return { $map: [...v].map(([k, x]) => [enc(k), enc(x)]) };
  if (Array.isArray(v)) {
    const a = v.map(enc);
    return a.length > ARRAY_DIGEST_OVER ? digestArray(a) : a;
  }
  const out = {};
  for (const k of Object.keys(v)) out[k] = enc(v[k]);
  return out;
}

/** Long arrays (e.g. a 600 s continuous sweep) are frozen as length + head + tail + hash. */
function digestArray(a) {
  const canon = JSON.stringify(a, (k, x) => (typeof x === 'number' ? Number(x.toPrecision(12)) : x));
  return {
    $len: a.length,
    $head: a.slice(0, 6),
    $tail: a.slice(-3),
    $sha256: crypto.createHash('sha256').update(canon).digest('hex').slice(0, 32),
  };
}

// ------------------------------------------------------------------ case registry

function makeRegistry() {
  const cases = [];
  const ids = new Set();
  const add = (group, name, input, run) => {
    let id = `${group}/${name}`;
    if (id.length > 180) id = `${id.slice(0, 160)}…#${crypto.createHash('sha1').update(id).digest('hex').slice(0, 8)}`;
    let k = 2;
    const base = id;
    while (ids.has(id)) id = `${base}#${k++}`;
    ids.add(id);
    cases.push({ id, group, input, run });
  };
  /** A direct call of a top-level function: fn(...args) in the shared pure context. */
  const call = (group, fn, args, post = (x) => x) => {
    add(group, `${fn}(${JSON.stringify(enc(args)).slice(1, -1)})`, { fn, args }, (E) => post(E.g[fn](...args), E));
  };
  return { cases, add, call };
}

// ------------------------------------------------------------------ shared helpers

const SR = [22050, 32000, 44100, 48000, 88200, 96000];
const safeMaxOf = (sr) => (sr / 2) * 0.95;

function planSummary(res) {
  if (!res) return null;
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, warnings: res.warnings, plan: res.plan };
}

function appState(app) {
  return {
    source: app.source, pattern: app.pattern, waveform: app.waveform, frequency: app.frequency,
    freqText: app.freqText, freqError: app.freqError, gainLevel: app.gainLevel, duration: app.duration,
    attack: app.attack, release: app.release, rangeMode: app.rangeMode, customMin: app.customMin,
    customMax: app.customMax, a4: app.a4, mode: app.mode, continuousAllowed: app.continuousAllowed,
    pp: app.pp, sweep: app.sweep, dual: app.dual, loadedLabel: app.loadedLabel,
  };
}

const alertList = (app) => app.alerts.map((a) => [a.level, a.title, a.message]);

/** Apply a small scripted configuration to a fresh app (see URL cases). */
function configure(app, steps) {
  for (const [method, ...args] of steps) {
    if (method === 'set') {
      const [pathStr, value] = args;
      const keys = pathStr.split('.');
      let o = app;
      for (const k of keys.slice(0, -1)) o = o[k];
      o[keys[keys.length - 1]] = value;
    } else {
      app[method](...args);
    }
  }
  return app;
}

// ------------------------------------------------------------------ the vectors

function defineCases() {
  const R = makeRegistry();
  const { add, call } = R;

  // ============================================================ helpers
  for (const a of [[5, 0, 10], [-1, 0, 10], [11, 0, 10], [NaN, 0, 10], [Infinity, 0, 10]]) call('helpers', 'clamp', a);
  for (const v of [0, -0, 1.5, NaN, Infinity, '1', null, undefined]) call('helpers', 'isNum', [v]);
  for (const a of [['12', 0], [' 12 ', 0], ['', 7], ['   ', 7], ['abc', 7], [NaN, 7], [Infinity, 7], [5, 0, 1, 3],
    [-5, 0, 1, 3], [null, 9], [true, 9], ['1e3', 0], ['0x10', 0]]) call('helpers', 'toNumber', a);
  for (const a of [['2.5', 0, 0, 10], [2.4, 0, 0, 10], [-2.5, 0, -10, 10], ['x', 3, 0, 10], [99, 3, 0, 10]]) call('helpers', 'toInt', a);
  for (const a of [['sine', ['sine', 'square'], 'x'], ['laser', ['sine', 'square'], 'sine'], [undefined, ['a'], 'a']]) call('helpers', 'pick', a);
  for (const a of [[1.005, 2], [2.675, 2], [1234.5678, 3], [0.1 + 0.2, 2], [-1.005, 2], [440, 0]]) call('helpers', 'round', a);
  for (const a of [[2.2727, 3], [50, 3], [0.000123456, 3], [123456, 3], [1.5, 4], [999.95, 3], [0.1 + 0.2, 3]]) call('helpers', 'sig', a);
  for (const seed of [0, 1, 20261001, 2 ** 31, 4294967295]) {
    add('helpers', `mulberry32(${seed})x8`, { seed }, (E) => { const r = E.g.mulberry32(seed); return Array.from({ length: 8 }, () => r()); });
  }
  for (const s of ['', 'hello', '{"pp":{"fm":{"modFreq":7}}}', 'Δf ≈ 440 Hz · λ', '???>>>', '\u0000x']) {
    add('helpers', `base64Url(${JSON.stringify(s)})`, { s }, (E) => {
      const e = E.g.base64UrlEncode(s);
      return { encoded: e, decoded: E.g.base64UrlDecode(e) };
    });
  }
  for (const s of ['eyJhIjoxfQ', 'eyJhIjoxfQ==', '%%%notbase64', '']) {
    add('helpers', `base64UrlDecode(${JSON.stringify(s)})`, { s }, (E) => {
      try { return { ok: true, value: E.g.base64UrlDecode(s) }; } catch (e) { return { ok: false, error: e.name }; }
    });
  }
  add('helpers', 'deepCopy(nested)', null, (E) => {
    const src = { a: [1, { b: 2 }], c: 'x', d: undefined, e: NaN };
    const c = E.g.deepCopy(src);
    return { copy: c, distinct: c !== src && c.a !== src.a };
  });

  // ============================================================ frequency parser
  const parseInputs = [440, 0, -5, NaN, Infinity, 1e3, 0.5, '440', '440Hz', '440hz', '440 Hz', '440 hertz', ' 440 ',
    '00440', '1k', '1K', '1khz', '1 kHz', '1 k Hz', '1.5 kHz', '1.5k', '15.5k', '15500', '20 kHz', '20000', '2 kilohertz',
    '.5', '0.5', '0', '0.0', '0k', '-1', '-440', 'abc', '', '   ', '1e3', '1,5k', '1.5.5', 'A4', 'C#5', '440hzz',
    'k', 'hz', '１２', '440 Hz!', 'a very long input string that should be cut in the error message',
    null, undefined, true, [440], {}];
  for (const v of parseInputs) call('frequency.parse', 'parseFrequency', [v]);
  for (const t of ['440, 880, 660, 1.32k', '440;880 660', '440\n880\t660', '', null, undefined, 'a, 440, b',
    '1k,,2k', '  ', '0, 440, -5', '20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000',
    '8x0, 440', 12345]) {
    call('frequency.parse', 'parseFrequencyList', [t]);
  }

  // ============================================================ formatting
  const fmtIn = [0, -1, NaN, Infinity, -Infinity, 'abc', '440', 0.001, 0.004, 0.005, 1, 19.999, 20, 82.41, 261.625,
    261.63, 440, 999.994, 999.995, 999.999, 1000, 1234.5, 15500, 20000, 20947.5, 22050, 22800, 1e6];
  for (const f of fmtIn) for (const precise of [false, true]) call('frequency.format', 'formatFrequency', [f, precise]);
  for (const f of [NaN, 0, 0.5, 1, 20, 31.5, 63, 500, 999, 999.5, 1000, 1250, 15500, 20000, 50000, -20]) call('frequency.format', 'formatFrequencyShort', [f]);
  for (const ms of [NaN, 0, 1, 10, 333.333, 999, 999.9, 1000, 1500, 30000, -5]) call('frequency.format', 'formatMs', [ms]);
  for (const c of [NaN, 0, 1, -1, 50, -50, 'x', 0.4]) call('frequency.format', 'formatCents', [c]);

  // ============================================================ period + wavelength
  for (const f of [0, -1, NaN, 'x', 0.5, 1, 2, 20, 100, 440, 1000, 1e3 + 0.1, 15500, 20000, 1e6]) call('frequency.period', 'formatPeriod', [f]);
  for (const f of [0, -1, NaN, 1, 20, 100, 343, 440, 686, 1000, 3430, 10000, 15500, 20000, 34300, 100000]) call('frequency.wavelength', 'formatWavelength', [f]);
  add('frequency.wavelength', 'SPEED_OF_SOUND', null, (E) => E.g.SPEED_OF_SOUND);

  // ============================================================ log mapping
  const ranges = [[20, 20000], [1, 22800], [10, 20947.5], [8000, 22800], [100, 10000]];
  for (const [lo, hi] of ranges) {
    for (const f of [lo, hi, Math.sqrt(lo * hi), lo / 2, hi * 2, 440, 1000]) call('frequency.logmap', 'frequencyToNormalized', [f, lo, hi]);
    for (const v of [0, 0.25, 0.5, 0.75, 1, -0.5, 1.5]) call('frequency.logmap', 'normalizedToFrequency', [v, lo, hi]);
  }
  for (const a of [[0, 20, 20000], [-1, 20, 20000], [NaN, 20, 20000], [440, 0, 20000], [440, 20000, 20], [440, 20, 20], [440, -20, 20000]]) {
    call('frequency.logmap', 'frequencyToNormalized', a);
  }
  for (const a of [[NaN, 20, 20000], ['0.5', 20, 20000], [0.5, 0, 100], [0.5, 100, 100], [0.5, -1, 100], [0.5, 100, 10]]) {
    call('frequency.logmap', 'normalizedToFrequency', a);
  }
  add('frequency.logmap', 'roundtrip-20-20000', null, (E) => {
    const out = [];
    for (const f of [20, 31.5, 100, 440, 632.4555320336759, 1000, 4000, 15500, 20000]) {
      const n = E.g.frequencyToNormalized(f, 20, 20000);
      out.push([f, n, E.g.normalizedToFrequency(n, 20, 20000)]);
    }
    return out;
  });

  // ============================================================ musical notes
  for (const f of [440, 261.63, 880, 27.5, 4186.01, 1, 20000]) for (const a4 of [440, 432]) call('music', 'frequencyToMidi', [f, a4]);
  for (const m of [0, 21, 60, 69, 69.5, 108, 127, -12]) for (const a4 of [440, 445]) call('music', 'midiToFrequency', [m, a4]);
  for (const m of [-13, -1, 0, 11, 12, 59.5, 60, 69, 69.4, 69.5, 69.6, 127, 128]) call('music', 'midiToName', [m]);
  for (const f of [440, 261.63, 261.6256, 82.41, 27.5, 4186, 445, 452.89, 466.16, 1, 20000, 0, -1, NaN]) {
    for (const a4 of [440, 432]) call('music', 'nearestNote', [f, a4]);
  }
  call('music', 'nearestNote', [440, 0]);
  for (const n of ['A4', 'C4', 'C#5', 'Db5', 'Bb3', 'B#3', 'Cb4', 'E2', 'A-1', 'C-1', 'G9', 'C10', 'a4', 'H4', 'A', 'A4 ', ' A4',
    '440', '', 'E#4', 'Fb4', 'C##4', null]) {
    for (const a4 of [440, 432]) call('music', 'noteToFrequency', [n, a4]);
  }
  add('music', 'NOTE_BUTTONS->frequency', null, (E) => E.g.NOTE_BUTTONS.map((n) => [n, E.g.noteToFrequency(n, 440)]));

  // ============================================================ region mapping
  for (const f of [0, -5, NaN, 1, 19.999, 20, 59.9, 60, 249.99, 250, 500, 2000, 4000, 6000, 12000, 15500, 16000, 19999, 20000,
    20000.01, 22050, Infinity]) {
    call('region', 'regionFor', [f], (r) => ({ label: r.label, short: r.short }));
  }

  // ============================================================ Nyquist checks
  for (const sr of [null, ...SR]) {
    add('nyquist', `app-derived@${sr}`, { sr }, (E) => {
      const app = E.newApp({ sampleRate: sr });
      const ranges = {};
      for (const m of ['human', 'high', 'custom', 'advanced']) {
        app.rangeMode = m;
        ranges[m] = [app.rangeMin, app.rangeMax];
      }
      app.rangeMode = 'human';
      const repr = {};
      for (const f of [1000, app.safeMax - 1, app.safeMax + 1, app.nyquist, app.nyquist + 1]) {
        app.planFreqs = [f];
        repr[String(f)] = app.representability;
      }
      return {
        provisional: app.provisional, effectiveSampleRate: app.effectiveSampleRate, nyquist: app.nyquist, safeMax: app.safeMax, ranges, repr,
      };
    });
    add('nyquist', `setFrequency-clamp@${sr}`, { sr }, (E) => {
      const out = {};
      for (const mode of ['human', 'high', 'advanced']) {
        for (const f of [0.5, 10, 440, 20000, 30000, sr ? sr / 2 : 22050, '1.5 kHz', 'abc', -3]) {
          const app = E.newApp({ sampleRate: sr });
          app.rangeMode = mode;
          const ok = app.setFrequency(f);
          out[`${mode}:${f}`] = { ok, frequency: app.frequency, freqText: app.freqText, freqError: app.freqError };
        }
      }
      return out;
    });
    add('nyquist', `presetDisabled@${sr}`, { sr }, (E) => {
      const app = E.newApp({ sampleRate: sr });
      return E.g.BUILTIN_PRESETS.filter((p) => app.presetDisabled(p)).map((p) => [p.id, app.presetDisabledReason(p)]);
    });
  }
  for (const sr of SR) {
    add('nyquist', `buildPlan-clamp@${sr}`, { sr }, (E) => {
      const env = { safeMax: safeMaxOf(sr), continuous: false };
      const out = {};
      for (const f of [440, safeMaxOf(sr), safeMaxOf(sr) + 0.01, sr / 2, 40000]) {
        out[String(f)] = planSummary(E.g.buildPlan({ source: 'single', pattern: 'tone', waveform: 'sine', frequency: f }, env));
      }
      return out;
    });
    add('nyquist', `engine-getters@${sr}`, { sr }, () => {
      const audio = makeMockAudio({ sampleRate: sr });
      const E = loadOscilla({ audio });
      const eng = new E.g.AudioEngine();
      const before = { sampleRate: eng.sampleRate, nyquist: eng.nyquist, safeMaximum: eng.safeMaximum, state: eng.state };
      eng.init();
      return { before, after: { sampleRate: eng.sampleRate, nyquist: eng.nyquist, safeMaximum: eng.safeMaximum, state: eng.state } };
    });
  }

  // ============================================================ presets (data + application)
  for (const name of ['BUILTIN_PRESETS', 'PRESET_CATEGORIES', 'REFERENCE_NOTES', 'LEARN_TOPICS', 'PATTERNS', 'PATTERN_GROUPS',
    'DEFAULT_PATTERN_PARAMS', 'DEFAULT_SWEEP', 'DEFAULT_DUAL', 'FREQUENCY_REGIONS', 'RANGE_MODES', 'APP_MODES', 'VIZ_MODES',
    'WAVEFORMS', 'WAVEFORM_LABELS', 'NOTE_NAMES', 'NOTE_BUTTONS', 'THIRD_OCTAVE_FREQUENCIES', 'OCTAVE_STEP_FREQUENCIES',
    'SPECTRUM_MARKERS', 'STORAGE_KEYS', 'SAFETY_LIMIT_OPTIONS', 'ENV_PARAMS']) {
    add('presets.data', name, null, (E) => E.g[name]);
  }
  add('presets.data', 'scalar-constants', null, (E) => {
    const o = {};
    for (const k of ['APP_VERSION', 'SPEED_OF_SOUND', 'SAFE_NYQUIST_FACTOR', 'PROVISIONAL_SAMPLE_RATE', 'MIN_FREQUENCY', 'MAX_OUTPUT_GAIN',
      'DEFAULT_GAIN', 'GAIN_FLOOR', 'START_OFFSET_S', 'MAX_PROGRAMMED_S', 'CONTINUOUS_SCHEDULE_S', 'HISTORY_MAX',
      'PRESET_SCHEMA_VERSION', 'LIMITER_THRESHOLD_DB', 'LIMITER_RATIO', 'HARMONIC_FLOOR_DB', 'HARMONIC_LIST_CAP']) o[k] = E.g[k];
    return o;
  });
  add('presets.data', 'defaultInstrumentState', null, (E) => E.g.defaultInstrumentState());
  add('presets.data', 'BUILTIN_PRESETS-ids-unique', null, (E) => {
    const ids = E.g.BUILTIN_PRESETS.map((p) => p.id);
    return { count: ids.length, unique: new Set(ids).size, byCat: E.g.PRESET_CATEGORIES.map((c) => [c.id, E.g.BUILTIN_PRESETS.filter((p) => p.cat === c.id).length]) };
  });
  // every built-in preset through the single validated path, at two sample rates
  for (const sr of [44100, 48000]) {
    add('presets.apply', `all-builtin@${sr}`, { sr }, (E) => {
      const out = {};
      for (const p of E.g.BUILTIN_PRESETS) {
        const app = E.newApp({ sampleRate: sr });
        const issues = app.applyConfig(p.cfg, 'preset');
        const res = app.currentPlan();
        out[p.id] = {
          issues, disabled: app.presetDisabled(p), max: app.presetMaxFrequency(p.cfg), describe: app.describeConfig(p.cfg),
          config: app.serializeConfig(),
          plan: res.ok ? { type: res.plan.type, kind: res.plan.kind, label: res.plan.label, freqs: res.plan.freqs, dur: res.plan.dur } : res.error,
          warnings: res.ok ? res.warnings : null,
        };
      }
      return out;
    });
  }
  add('presets.apply', 'learn-demos@48000', { sr: 48000 }, (E) => {
    const out = {};
    for (const t of E.g.LEARN_TOPICS) {
      const app = E.newApp({ sampleRate: 48000 });
      app.runDemo(t);
      const res = app.currentPlan();
      out[t.id] = {
        source: app.source, vizMode: app.vizMode, loadedLabel: app.loadedLabel, isProgrammed: app.isProgrammed,
        plan: res.ok ? { type: res.plan.type, kind: res.plan.kind, label: res.plan.label, freqs: res.plan.freqs } : res.error,
        alerts: alertList(app),
      };
    }
    return out;
  });
  add('presets.apply', 'binaural-requires-confirmation', null, (E) => {
    const p = E.g.BUILTIN_PRESETS.find((x) => x.id === 'du-binaural');
    const app = E.newApp({ sampleRate: 48000 });
    app.openModal = () => {}; // no DOM: record intent only
    app.closeModal = () => {};
    app.loadPreset(p);
    const pending = { binaural: app.dual.binaural, pending: !!app.pendingPreset };
    app.confirmHeadphones();
    return { pending, confirmed: { binaural: app.dual.binaural, stereo: app.dual.stereo, source: app.source, a: app.dual.a.freq, b: app.dual.b.freq } };
  });

  // ============================================================ pattern plan generation
  const patternIds = ['tone', 'finite', 'pulse', 'burst', 'sweepUp', 'sweepDown', 'pingpong', 'chirp', 'siren', 'alternating',
    'wobble', 'am', 'fm', 'random', 'octave', 'sequence'];
  for (const sr of [22050, 44100, 48000]) {
    for (const pid of patternIds) {
      add('plan.build', `${pid}@${sr}`, { pid, sr }, (E) => {
        const st = E.g.defaultInstrumentState();
        return planSummary(E.g.buildPlan({ ...st, pattern: pid }, { safeMax: safeMaxOf(sr), continuous: false }));
      });
    }
    add('plan.build', `sweep-default@${sr}`, { sr }, (E) => {
      const st = E.g.defaultInstrumentState();
      return planSummary(E.g.buildPlan({ ...st, source: 'sweep' }, { safeMax: safeMaxOf(sr), continuous: false }));
    });
    add('plan.build', `dual-default@${sr}`, { sr }, (E) => {
      const st = E.g.defaultInstrumentState();
      return planSummary(E.g.buildPlan({ ...st, source: 'dual' }, { safeMax: safeMaxOf(sr), continuous: false }));
    });
  }
  const S48 = { safeMax: safeMaxOf(48000), continuous: false };
  const edge = [
    ['tone-freq-0', { source: 'single', pattern: 'tone', frequency: 0 }],
    ['tone-freq-negative', { source: 'single', pattern: 'tone', frequency: -1 }],
    ['tone-freq-NaN-falls-back-440', { source: 'single', pattern: 'tone', frequency: NaN }],
    ['tone-freq-string', { source: 'single', pattern: 'tone', frequency: '1000' }],
    ['tone-freq-0.5-raised-to-1', { source: 'single', pattern: 'tone', frequency: 0.5 }],
    ['unknown-pattern-is-tone', { source: 'single', pattern: 'laser', frequency: 440 }],
    ['unknown-waveform-is-sine', { source: 'single', pattern: 'tone', waveform: 'laser', frequency: 440 }],
    ['finite-duration-clamped-low', { source: 'single', pattern: 'finite', frequency: 440, duration: 1 }],
    ['finite-duration-clamped-high', { source: 'single', pattern: 'finite', frequency: 440, duration: 60000 }],
    ['pulse-reps-200', { source: 'single', pattern: 'pulse', frequency: 1000, pp: { pulse: { pulseMs: 150, pauseMs: 150, reps: 200 } } }],
    ['burst-interval-below-burst', { source: 'single', pattern: 'burst', frequency: 1000, pp: { burst: { burstMs: 300, intervalMs: 100, count: 3 } } }],
    ['pulse-truncated-at-30s', { source: 'single', pattern: 'pulse', frequency: 1000, pp: { pulse: { pulseMs: 5000, pauseMs: 5000, reps: 10 } } }],
    ['sequence-invalid', { source: 'single', pattern: 'sequence', pp: { sequence: { text: '440, 8x0, abc', toneMs: 300, gapMs: 50, repeats: 1 } } }],
    ['sequence-all-above-max', { source: 'single', pattern: 'sequence', pp: { sequence: { text: '30000, 40000', toneMs: 300, gapMs: 50, repeats: 1 } } }],
    ['sequence-some-below-1hz', { source: 'single', pattern: 'sequence', pp: { sequence: { text: '0.5, 440', toneMs: 300, gapMs: 50, repeats: 2 } } }],
    ['sequence-empty', { source: 'single', pattern: 'sequence', pp: { sequence: { text: '', toneMs: 300, gapMs: 50, repeats: 1 } } }],
    ['sequence-repeats-50', { source: 'single', pattern: 'sequence', pp: { sequence: { text: '440, 880', toneMs: 100, gapMs: 0, repeats: 50 } } }],
    ['third-octave-at-48k', { source: 'single', pattern: 'sequence', pp: { sequence: { text: '20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000', toneMs: 250, gapMs: 50, repeats: 1 } } }],
    ['sweepUp-legacy-cfg.sweep', { source: 'single', pattern: 'sweepUp', sweep: { start: 100, end: 1000, durationMs: 500, curve: 'linear' } }],
    ['sweepDown-own-pp', { source: 'single', pattern: 'sweepDown', pp: { sweepDown: { start: 200, end: 2000, durationMs: 800, curve: 'log' } } }],
    ['sweepUp-end-above-max', { source: 'single', pattern: 'sweepUp', pp: { sweepUp: { start: 100, end: 40000, durationMs: 800, curve: 'log' } } }],
    ['pingpong-repeats-capped', { source: 'single', pattern: 'pingpong', pp: { pingpong: { min: 200, max: 4000, cycleMs: 10000, repeats: 100, curve: 'linear' } } }],
    ['chirp-linear', { source: 'single', pattern: 'chirp', pp: { chirp: { start: 8000, end: 2000, durationMs: 50, ramp: 'linear' } } }],
    ['siren-swapped-limits-triangle', { source: 'single', pattern: 'siren', pp: { siren: { min: 1200, max: 600, rate: 50, shape: 'triangle' } } }],
    ['wobble-depth-limited-low', { source: 'single', pattern: 'wobble', frequency: 30, pp: { wobble: { depth: 100, rate: 5 } } }],
    ['wobble-depth-limited-high', { source: 'single', pattern: 'wobble', frequency: 22700, pp: { wobble: { depth: 1000, rate: 5 } } }],
    ['am-depth-0', { source: 'single', pattern: 'am', frequency: 440, pp: { am: { modFreq: 4, depth: 0 } } }],
    ['fm-depth-limited', { source: 'single', pattern: 'fm', frequency: 20000, pp: { fm: { modFreq: 5, depthHz: 10000 } } }],
    ['fm-alias-warning', { source: 'single', pattern: 'fm', frequency: 15000, pp: { fm: { modFreq: 2000, depthHz: 5000 } } }],
    ['random-seed-1', { source: 'single', pattern: 'random', pp: { random: { min: 200, max: 4000, toneMs: 150, gapMs: 50, count: 5, seed: 1 } } }],
    ['random-swapped-bounds', { source: 'single', pattern: 'random', pp: { random: { min: 4000, max: 200, toneMs: 150, gapMs: 50, count: 5, seed: 7 } } }],
    ['alternating-above-max', { source: 'single', pattern: 'alternating', pp: { alternating: { fA: 440, fB: 30000, toneMs: 250, gapMs: 50, repeats: 2 } } }],
    ['octave-default-text', { source: 'single', pattern: 'octave' }],
    ['sweep-down', { source: 'sweep', sweep: { start: 20, end: 20000, durationMs: 2000, curve: 'log', direction: 'down', repeat: 'once' } }],
    ['sweep-pingpong-n3', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 1000, curve: 'linear', direction: 'pingpong', repeat: 'n', repeatCount: 3 } }],
    ['sweep-n-capped', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 5000, curve: 'log', direction: 'up', repeat: 'n', repeatCount: 1000 } }],
    ['sweep-pingpong-pass-cap-15s', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 30000, curve: 'log', direction: 'pingpong', repeat: 'once' } }],
    ['sweep-start-gt-end', { source: 'sweep', sweep: { start: 5000, end: 50, durationMs: 1000, curve: 'log', direction: 'up', repeat: 'once' } }],
    ['sweep-end-max-string', { source: 'sweep', sweep: { start: 12000, end: 'max', durationMs: 4000, curve: 'log', direction: 'up', repeat: 'once' } }],
    ['sweep-bad-enums', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 'x', curve: 'cubic', direction: 'sideways', repeat: 'once' } }],
    ['dual-detune-clamp', { source: 'dual', dual: { a: { freq: 22000, wave: 'square', gain: 100, detune: 1200 }, b: { freq: 440, wave: 'laser', gain: 150, detune: -2400 }, levelA: 120, levelB: -5, stereo: 1, binaural: 0 } }],
    ['dual-invalid-freq', { source: 'dual', dual: { a: { freq: -1, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80 } }],
  ];
  for (const [name, cfg] of edge) add('plan.build', `edge:${name}`, { cfg }, (E) => planSummary(E.g.buildPlan(cfg, S48)));

  // ============================================================ pattern frequency progression
  const progression = [
    ['pulse', { source: 'single', pattern: 'pulse', frequency: 1000 }],
    ['burst', { source: 'single', pattern: 'burst', frequency: 1000 }],
    ['alternating', { source: 'single', pattern: 'alternating' }],
    ['sweepUp-log', { source: 'single', pattern: 'sweepUp', pp: { sweepUp: { start: 20, end: 20000, durationMs: 10000, curve: 'log' } } }],
    ['sweepDown-linear', { source: 'single', pattern: 'sweepDown', pp: { sweepDown: { start: 100, end: 1100, durationMs: 1000, curve: 'linear' } } }],
    ['pingpong', { source: 'single', pattern: 'pingpong' }],
    ['chirp', { source: 'single', pattern: 'chirp' }],
    ['siren-sine', { source: 'single', pattern: 'siren' }],
    ['siren-triangle', { source: 'single', pattern: 'siren', pp: { siren: { min: 600, max: 1200, rate: 0.5, shape: 'triangle' } } }],
    ['wobble', { source: 'single', pattern: 'wobble', frequency: 1000 }],
    ['am', { source: 'single', pattern: 'am', frequency: 440 }],
    ['fm', { source: 'single', pattern: 'fm', frequency: 1000 }],
    ['random', { source: 'single', pattern: 'random' }],
    ['octave', { source: 'single', pattern: 'octave' }],
    ['sequence', { source: 'single', pattern: 'sequence' }],
    ['finite', { source: 'single', pattern: 'finite', frequency: 440, duration: 500 }],
    ['tone', { source: 'single', pattern: 'tone', frequency: 440 }],
    ['sweep-pingpong-n2', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 1000, curve: 'log', direction: 'pingpong', repeat: 'n', repeatCount: 2 } }],
    ['sweep-up-n2-gap', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 1000, curve: 'log', direction: 'up', repeat: 'n', repeatCount: 2 } }],
    ['dual', { source: 'dual', dual: { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 446, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80 } }],
  ];
  for (const [name, cfg] of progression) {
    add('plan.progression', name, { cfg }, (E) => {
      const st = E.g.defaultInstrumentState();
      const res = E.g.buildPlan({ ...st, ...cfg, pp: { ...st.pp, ...(cfg.pp || {}) } }, S48);
      if (!res.ok) return { error: res.error };
      const plan = res.plan;
      const span = plan.kind === 'finite' ? plan.dur : 4;
      const out = [];
      for (let i = 0; i <= 40; i++) {
        const t = (span * i) / 40;
        out.push([t, E.g.planFreqAt(plan, t), E.g.planAmpAt(plan, t)]);
      }
      out.push([span + 0.5, E.g.planFreqAt(plan, span + 0.5), E.g.planAmpAt(plan, span + 0.5)]);
      out.push([-0.1, E.g.planFreqAt(plan, -0.1), E.g.planAmpAt(plan, -0.1)]);
      return out;
    });
  }
  call('plan.progression', 'planFreqAt', [null, 0]);
  call('plan.progression', 'planAmpAt', [null, 0]);
  call('plan.progression', 'planFreqAt', [{ type: 'weird' }, 0]);
  for (const shape of ['sine', 'triangle', 'other']) {
    add('plan.progression', `lfoShape(${shape})`, { shape }, (E) => [-0.25, 0, 0.1, 0.25, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 7.5].map((p) => [p, E.g.lfoShape(shape, p)]));
  }
  for (const shape of ['sine', 'triangle', 'sawtooth', 'square']) {
    add('plan.progression', `waveSample(${shape})`, { shape }, (E) => [-0.25, 0, 0.1, 0.25, 0.4999, 0.5, 0.6, 0.75, 0.9, 1, 3.3].map((p) => [p, E.g.waveSample(shape, p)]));
  }
  add('plan.progression', 'findTimed', null, (E) => {
    const list = [{ t: 0, dur: 0.1, f: 1 }, { t: 0.2, dur: 0.1, f: 2 }, { t: 0.4, dur: 0, f: 3 }];
    return [-0.01, 0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.35, 0.4, 0.41].map((t) => [t, E.g.findTimed(list, t)]);
  });
  call('plan.progression', 'findTimed', [[], 0]);
  add('plan.progression', 'stepsFromFrequencies', null, (E) => {
    const w = [];
    const steps = E.g.stepsFromFrequencies([440, 880, 660], 0.3, 0.05, 2, w);
    const w2 = [];
    const capped = E.g.stepsFromFrequencies([440], 7, 1, 10, w2);
    return { steps, warnings: w, capped: capped.length, cappedWarnings: w2 };
  });
  for (const a of [[100, 1000, 1, 'log', 'up', 2, 0.03], [100, 1000, 1, 'linear', 'down', 1, 0], [100, 1000, 0.5, 'log', 'pingpong', 2, 0.03], [100, 1000, 1, 'log', 'up', 0, 0]]) {
    call('plan.progression', 'sweepSegments', a);
  }
  call('plan.progression', 'summarizeFrequencies', [[440, 440.001, 880, 880.004, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);

  // ============================================================ dual calculations
  const duals = [
    ['440+442', { a: { freq: 440, detune: 0 }, b: { freq: 442, detune: 0 } }],
    ['440+440', { a: { freq: 440, detune: 0 }, b: { freq: 440, detune: 0 } }],
    ['440+440.004', { a: { freq: 440, detune: 0 }, b: { freq: 440.004, detune: 0 } }],
    ['440+440-detune+100c', { a: { freq: 440, detune: 0 }, b: { freq: 440, detune: 100 } }],
    ['1000+1002', { a: { freq: 1000, detune: 0 }, b: { freq: 1002, detune: 0 } }],
    ['stereo-6Hz', { a: { freq: 440, detune: 0 }, b: { freq: 446, detune: 0 }, stereo: true }],
    ['stereo-40Hz', { a: { freq: 440, detune: 0 }, b: { freq: 480, detune: 0 }, stereo: true }],
    ['stereo-binaural-6Hz', { a: { freq: 440, detune: 0 }, b: { freq: 446, detune: 0 }, stereo: true, binaural: true }],
    ['detune-both', { a: { freq: 440, detune: -50 }, b: { freq: 440, detune: 50 } }],
  ];
  for (const [name, d] of duals) {
    add('dual', name, { d }, (E) => {
      const app = E.newApp({ sampleRate: 48000 });
      app.source = 'dual';
      app.mode = 'dual';
      Object.assign(app.dual.a, d.a);
      Object.assign(app.dual.b, d.b);
      if (d.stereo !== undefined) app.dual.stereo = d.stereo;
      if (d.binaural !== undefined) app.dual.binaural = d.binaural;
      const res = app.currentPlan();
      return {
        dualFa: app.dualFa, dualFb: app.dualFb, dualDelta: app.dualDelta, beatText: app.beatText,
        stereoBinauralCondition: app.stereoBinauralCondition, requestedText: app.requestedText,
        metricFrequency: app.metricFrequency, representability: app.representability, plan: planSummary(res),
      };
    });
  }
  add('dual', 'nudge-slider-stereo', null, (E) => {
    const app = E.newApp({ sampleRate: 48000 });
    const out = {};
    app.nudgeDual('a', 1); out.nudgeA = app.dual.a.freq;
    app.nudgeDual('b', -1e6); out.nudgeBfloor = app.dual.b.freq;
    out.sliderA = app.dualSlider('a');
    app.setDualSlider('a', 500); out.afterSlider500 = app.dual.a.freq;
    app.setDualFreq('b', '30k'); out.setB30k = [app.dual.b.freq, app.paramErrors['dual-b']];
    app.setDualFreq('b', 'abc'); out.setBabc = [app.dual.b.freq, app.paramErrors['dual-b']];
    app.dual.binaural = true; app.setStereo(false); out.stereoOff = [app.dual.stereo, app.dual.binaural];
    return out;
  });

  // ============================================================ harmonics
  for (const w of ['sine', 'triangle', 'sawtooth', 'square', 'other']) {
    call('harmonics', 'harmonicLimit', [w]);
    for (const n of [0, 1, 2, 3, 999, 1000]) call('harmonics', 'partialCount', [w, n]);
    for (const f of [0, 20, 100, 220, 440, 1000, 5000, 8000, 15000, 20000, 25000]) {
      for (const ny of [24000, 22050, 11025]) call('harmonics', 'harmonicTable', [w, f, ny]);
    }
  }
  call('harmonics', 'harmonicTable', ['square', 440, 0]);
  call('harmonics', 'harmonicTable', ['square', NaN, 24000]);

  // ============================================================ visualization bridge (syncViz)
  const vizCfgs = [
    ['default', []],
    ['fm', [['setPattern', 'fm'], ['setFrequency', 1500]]],
    ['siren', [['setPattern', 'siren']]],
    ['am', [['setPattern', 'am']]],
    ['sequence', [['setPattern', 'sequence']]],
    ['sweep-mode', [['setMode', 'sweep']]],
    ['dual-mode', [['setMode', 'dual']]],
    ['dual-stereo-14Hz', [['setMode', 'dual'], ['set', 'dual.b.freq', 454], ['setStereo', true]]],
    ['square-5k', [['setWaveform', 'square'], ['setFrequency', 5000]]],
    ['invalid-sequence', [['setPattern', 'sequence'], ['set', 'pp.sequence.text', '440, 8x0']]],
  ];
  for (const [name, steps] of vizCfgs) {
    add('viz.bridge', `syncViz:${name}`, { steps }, (E) => {
      const app = configure(E.newApp({ sampleRate: 48000 }), steps);
      app.syncViz();
      const s = E.g.viz.state;
      return {
        app: { planError: app.planError, planWarnings: app.planWarnings, planFreqs: app.planFreqs, planSummary: app.planSummary, vizMode: app.vizMode },
        state: {
          vizMode: s.vizMode, frequency: s.frequency, rangeMin: s.rangeMin, rangeMax: s.rangeMax, nyquist: s.nyquist, safeMax: s.safeMax,
          provisional: s.provisional, source: s.source, dual: s.dual, labels: s.labels, pathNodes: s.pathNodes,
          harm: s.harm, harmB: s.harmB, refFreq: s.live.refFreq, planType: s.plan && s.plan.type,
        },
      };
    });
  }

  // ============================================================ UI-derived mappings (gain, sweep rates, readouts)
  for (const pct of [0, 10, 25, 50, 57, 60, 75, 80, 90, 100, -10, 150, 'abc', '42']) {
    add('ui.mapping', `setGainPct(${JSON.stringify(pct)})`, { pct }, (E) => {
      const app = E.newApp();
      app.setGainPct(pct);
      return { gainLevel: app.gainLevel, gainPct: app.gainPct, gainLabel: app.gainLabel };
    });
  }
  for (const s of [
    { start: 20, end: 20000, durationMs: 10000 }, { start: 100, end: 8000, durationMs: 6000 },
    { start: 20000, end: 20, durationMs: 10000, direction: 'down' }, { start: 200, end: 800, durationMs: 1000, direction: 'pingpong' },
  ]) {
    add('ui.mapping', `sweep-readouts:${JSON.stringify(s)}`, { s }, (E) => {
      const app = E.newApp({ sampleRate: 48000 });
      Object.assign(app.sweep, s);
      const r = { spanOct: app.sweepSpanOct, hzPerSec: app.sweepHzPerSec, octPerSec: app.sweepOctPerSec, readout: app.sweepReadout, bar: app.sweepBarStyle, sliderStart: app.sweepSlider('start') };
      app.setSweepRate('oct', 2); r.afterOct2 = app.sweep.durationMs;
      app.setSweepRate('hz', 1000); r.afterHz1000 = app.sweep.durationMs;
      app.setSweepDuration('0.001'); r.durationLow = [app.sweep.durationMs, app.paramErrors['sweep-duration']];
      app.setSweepDuration('99'); r.durationHigh = [app.sweep.durationMs, app.paramErrors['sweep-duration']];
      return r;
    });
  }
  for (const [name, steps] of [
    ['tone-440', []], ['tone-15.5k', [['setFrequency', 15500]]], ['sweepUp', [['setPattern', 'sweepUp']]],
    ['dual', [['setMode', 'dual']]], ['noteMode-A4-445', [['set', 'noteMode', true], ['setA4', 445], ['setNote', 'C5']]],
    ['custom-range', [['setRangeMode', 'custom'], ['setCustomBound', 'min', '200'], ['setCustomBound', 'max', '300']]],
    ['step-ops', [['stepOctave', 1], ['stepSemitone', -1], ['stepCents', 10], ['stepHz', -10]]],
  ]) {
    add('ui.mapping', `readouts:${name}`, { steps }, (E) => {
      const app = configure(E.newApp({ sampleRate: 48000 }), steps);
      app.syncViz(); // fills planFreqs like the reactive effect would
      return {
        frequency: app.frequency, readoutText: app.readoutText, readoutRegion: app.readoutRegion, noteText: app.noteText,
        periodText: app.periodText, wavelengthText: app.wavelengthText, requestedText: app.requestedText,
        durationText: app.durationText, transportText: app.transportText, mapMarkerPct: app.mapMarkerPct,
        mapRangeStyle: app.mapRangeStyle, mapRegions: app.mapRegions, mapTicks: app.mapTicks, hints: app.hints,
        topicExample: app.topicExample, showLow: app.showLowWarning, showHigh: app.showHighWarning,
        showUltra: app.showUltrasonicNote, showHarm: app.showHarmonicWarning, rangeError: app.rangeError,
        range: [app.rangeMode, app.rangeMin, app.rangeMax, app.customMin, app.customMax],
      };
    });
  }
  // coerceLike + paramDescriptor: the validation path for pattern parameters from links/presets
  for (const [d, inc, pid, key] of [
    [440, '880', 'alternating', 'fA'], [440, 0, 'alternating', 'fA'], [440, -1, 'alternating', 'fA'], [150, 99999, 'pulse', 'pulseMs'],
    [150, 'x', 'pulse', 'pulseMs'], ['log', 'linear', 'pingpong', 'curve'], ['log', 'cubic', 'pingpong', 'curve'], ['log', 5, 'pingpong', 'curve'],
    ['440', 'x'.repeat(2500), 'sequence', 'text'], [true, 'yes', null, null], [true, false, null, null], [{}, {}, null, null],
  ]) {
    add('ui.mapping', `coerceLike(${JSON.stringify([d, typeof inc === 'string' && inc.length > 20 ? `${inc.length} chars` : inc, pid, key])})`, { d, pid, key }, (E) => {
      const desc = pid ? E.g.paramDescriptor(pid, key) : undefined;
      const r = E.g.coerceLike(d, inc, desc);
      return { ok: r[0], value: typeof r[1] === 'string' && r[1].length > 50 ? `${r[1].length} chars` : r[1], desc };
    });
  }

  // ============================================================ URL state
  const urlConfigs = [
    ['default', []],
    ['fm-1500-mod7-continuous', [['setPattern', 'fm'], ['setFrequency', 1500], ['set', 'pp.fm.modFreq', 7], ['setContinuous', true]]],
    ['sweep-mode', [['setMode', 'sweep'], ['set', 'sweep.start', 100], ['set', 'sweep.direction', 'pingpong']]],
    ['dual-binaural', [['setMode', 'dual'], ['set', 'dual.binaural', true], ['set', 'dual.stereo', true]]],
    ['custom-range-a4', [['setRangeMode', 'custom'], ['setCustomBound', 'min', '200'], ['setCustomBound', 'max', '5k'], ['setA4', 432]]],
    ['gain-high', [['setGainPct', 100]]],
    ['sequence-unicode-free', [['setPattern', 'sequence'], ['set', 'pp.sequence.text', '440, 554.37, 659.26']]],
    ['learn-mode', [['setMode', 'learn']]],
    ['sweep-continuous-allowed', [['setContinuous', true], ['setMode', 'sweep'], ['setSweepRepeat', 'continuous']]],
  ];
  for (const [name, steps] of urlConfigs) {
    add('url.state', `serialize:${name}`, { steps }, (E) => {
      const app = configure(E.newApp({ sampleRate: 48000 }), steps);
      const hash = app.serializeHash();
      const q = new URLSearchParams(hash);
      const x = q.get('x');
      return { config: app.serializeConfig(), hash, x: x ? JSON.parse(E.g.base64UrlDecode(x)) : null };
    });
    add('url.state', `roundtrip:${name}`, { steps }, (E) => {
      const src = configure(E.newApp({ sampleRate: 48000 }), steps);
      const hash = src.serializeHash();
      E.ctx.location.hash = `#${hash}`;
      const dst = E.newApp({ sampleRate: 48000 });
      dst.restoreFromHash();
      E.ctx.location.hash = '';
      return { equal: dst.serializeHash() === hash, after: dst.serializeHash(), state: appState(dst), alerts: alertList(dst) };
    });
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const hashes = [
    ['empty', ''],
    ['no-v-no-f', '#m=dual'],
    ['minimal-f', '#f=1000'],
    ['malformed', '#v=1&f=abc&w=laser&x=%%%notbase64'],
    ['bad-values', '#v=1&s=laser&p=nope&w=sine&f=-5&g=9&d=0&a=99999&r=1&rm=wide'],
    ['gain-capped', '#v=1&f=440&g=0.25'],
    ['gain-low-kept', '#v=1&f=440&g=0.01'],
    ['above-provisional-max', '#v=1&s=single&p=tone&f=23000&rm=advanced'],
    ['continuous-repeat', `#v=1&m=sweep&s=sweep&x=${b64({ sweep: { start: 20, end: 20000, durationMs: 10000, curve: 'log', direction: 'up', repeat: 'continuous', repeatCount: 3 } })}`],
    ['binaural-in-link', `#v=1&m=dual&s=dual&x=${b64({ dual: { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 446, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80, stereo: true, binaural: true } })}`],
    ['extra-array', `#v=1&f=440&x=${b64([1, 2])}`],
    ['extra-unknown-pattern-keys', `#v=1&s=single&p=fm&x=${b64({ pp: { fm: { modFreq: 7, bogus: 1 }, nope: { a: 1 } } })}`],
    ['extra-bad-sequence', `#v=1&s=single&p=sequence&x=${b64({ pp: { sequence: { text: '440, 8x0' } } })}`],
    ['legacy-sweepUp-in-sweep', `#v=1&s=single&p=sweepUp&x=${b64({ sweep: { start: 300, end: 3000, durationMs: 700, curve: 'linear' } })}`],
    ['custom-range-rm-wins', `#v=1&f=1000&rm=custom&x=${b64({ range: { mode: 'human', min: 300, max: 3000 } })}`],
    ['custom-range-invalid-octave', `#v=1&f=1000&rm=custom&x=${b64({ range: { mode: 'custom', min: 300, max: 500 } })}`],
    ['a4-out-of-range', `#v=1&f=440&x=${b64({ a4: 500 })}`],
    ['unknown-mode', '#v=1&m=nowhere&f=440'],
    ['continuous-key-ignored', '#v=1&f=440&continuousAllowed=true&c=1'],
  ];
  for (const sr of [null, 48000]) {
    for (const [name, h] of hashes) {
      add('url.state', `restore:${name}@${sr}`, { hash: h, sr }, (E) => {
        E.ctx.location.hash = h;
        const app = E.newApp({ sampleRate: sr });
        app.restoreFromHash();
        E.ctx.location.hash = '';
        return {
          state: appState(app), alerts: alertList(app), pendingHashConfig: app.pendingHashConfig,
          binaural: app.dual.binaural, continuousAllowed: app.continuousAllowed,
        };
      });
    }
  }

  // ============================================================ storage schema + migration
  const meta = { id: 'p1', name: 'Fixed', created: 1700000000000 };
  for (const [name, cfg] of [
    ['single-tone', { source: 'single', pattern: 'tone', waveform: 'sine', frequency: 440, gain: 0.08, duration: 500, attack: 10, release: 30, range: { mode: 'human' } }],
    ['single-fm-pp', { source: 'single', pattern: 'fm', frequency: 1500, pp: { fm: { modFreq: 7, depthHz: 60 } } }],
    ['sweep', { source: 'sweep', sweep: { start: 20, end: 20000, durationMs: 10000, curve: 'log', direction: 'up', repeat: 'once', repeatCount: 3 } }],
    ['dual', { source: 'dual', dual: { a: { freq: 440 }, b: { freq: 442 } } }],
    ['empty', {}],
    ['range-not-object', { range: 'human' }],
  ]) call('storage', 'presetRecord', [meta, cfg]);
  call('storage', 'newPresetId', []);
  const v1 = { version: 1, id: 'keep', name: 'Kept', created: 1, cfg: { source: 'single', pattern: 'tone', frequency: 880 } };
  for (const [name, p] of [
    ['v0-1k-square', { name: 'Legacy 1k square', frequency: '1k', waveform: 'square' }],
    ['v0-bad-frequency', { name: 'x', frequency: 'abc' }],
    ['v0-numeric-padded-name', { name: '  padded name  ', frequency: 440, waveform: 'laser' }],
    ['v1-kept', v1],
    ['v1-no-cfg', { version: 1, name: 'n' }],
    ['v1-cfg-string', { version: 1, name: 42, cfg: 'not a config' }],
    ['v99-future', { version: 99, id: 'future', name: 'From the future', cfg: { source: 'single' } }],
    ['empty-name', { version: 1, name: '', cfg: {} }],
    ['long-name', { version: 1, name: 'N'.repeat(80), cfg: {} }],
    ['id-not-string', { version: 1, id: 5, name: 'n', cfg: {} }],
    ['created-not-number', { version: 1, id: 'a', name: 'n', created: 'yesterday', cfg: {} }],
    ['null', null], ['string', 'preset'], ['array', []],
  ]) {
    add('storage', `migratePreset:${name}`, { p }, (E) => E.newApp().migratePreset(p));
  }
  const stored = [
    ['absent', undefined],
    ['wrapped-v1', JSON.stringify({ version: 1, presets: [v1] })],
    ['bare-array', JSON.stringify([v1, { name: 'Legacy', frequency: '2k' }])],
    ['mixed-with-invalid', JSON.stringify({ version: 1, presets: [{ name: 'Legacy 1k square', frequency: '1k', waveform: 'square' }, { version: 1, name: 42, cfg: 'not a config' }, { version: 99, id: 'future', name: 'From the future', cfg: {} }] })],
    ['malformed-json', '{not json'],
    ['object-without-presets', JSON.stringify({ version: 1 })],
    ['number', '42'],
  ];
  for (const [name, raw] of stored) {
    add('storage', `loadCustomPresets:${name}`, { raw }, () => {
      const local = new MemoryStorage(raw === undefined ? {} : { 'oscilla.presets': raw });
      const E = loadOscilla({ local });
      const app = E.newApp();
      const list = app.loadCustomPresets();
      return { presets: list, alerts: alertList(app) };
    });
  }
  add('storage', 'save-delete-persist', null, () => {
    const local = new MemoryStorage();
    const E = loadOscilla({ local });
    const app = E.newApp({ sampleRate: 48000 });
    app.openModal = () => {}; app.closeModal = () => {};
    app.setFrequency(1234);
    app.openSave();
    const suggested = app.saveName;
    app.saveName = '';
    app.savePreset();
    const emptyErr = app.saveError;
    app.saveName = '  Test preset  ';
    app.savePreset();
    const afterSave = JSON.parse(local.dump()['oscilla.presets']);
    const id = app.customPresets[0].id;
    app.requestDelete(id);
    const armed = app.pendingDelete;
    app.requestDelete(id);
    return { suggested, emptyErr, afterSave, armed, afterDelete: JSON.parse(local.dump()['oscilla.presets']), presetTab: app.presetTab, alerts: alertList(app) };
  });
  add('storage', 'blocked-storage', null, () => {
    const local = new MemoryStorage({}, { throwing: true });
    const session = new MemoryStorage({}, { throwing: true });
    const E = loadOscilla({ local, session });
    const app = E.newApp();
    const r = {
      localAvailable: E.g.localStore.available(), sessionAvailable: E.g.sessionStore.available(),
      get: E.g.localStore.get('oscilla.theme'), set: E.g.localStore.set('k', 'v'), remove: E.g.localStore.remove('k'),
      readJSON: E.g.readJSON(E.g.localStore, 'oscilla.presets', 'fallback'),
      loaded: app.loadCustomPresets(), history: app.loadHistory(), persist: app.persistPresets(),
    };
    app.collapseSafety();
    r.alerts = alertList(app);
    return r;
  });
  for (const [name, raw] of [
    ['absent', undefined], ['malformed', '[{'], ['not-array', '{"a":1}'],
    ['mixed', JSON.stringify([{ ts: 1, cfg: {}, freqs: [440] }, { ts: 'x', cfg: {}, freqs: [] }, { ts: 2, cfg: null, freqs: [] }, { ts: 3, cfg: {}, freqs: 'no' }, null])],
    ['over-cap', JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ ts: i, cfg: {}, freqs: [i] })))],
  ]) {
    add('storage', `loadHistory:${name}`, { raw }, () => {
      const session = new MemoryStorage(raw === undefined ? {} : { 'oscilla.history': raw });
      const E = loadOscilla({ session });
      return E.newApp().loadHistory();
    });
  }
  add('storage', 'addHistory-dedupe-cap', null, () => {
    const session = new MemoryStorage();
    const E = loadOscilla({ session });
    const app = E.newApp({ sampleRate: 48000 });
    const plan = () => app.currentPlan().plan;
    app.addHistory(plan());
    app.addHistory(plan()); // same label + cfg → replaces, no duplicate
    const afterDup = app.history.length;
    for (let i = 0; i < 55; i++) { app.setFrequency(100 + i); app.addHistory(plan()); }
    const stored = JSON.parse(session.dump()['oscilla.history']);
    const first = app.history[0];
    app.clearHistory();
    return { afterDup, length: stored.length, first, newestFreq: first.freqs, cleared: session.dump() };
  });
  add('storage', 'safety-notice-session-key', null, () => {
    const session = new MemoryStorage();
    const E = loadOscilla({ session });
    const app = E.newApp();
    app.collapseSafety();
    return { session: session.dump(), collapsed: app.safetyCollapsed };
  });
  add('storage', 'serializeConfig-never-carries-runtime-flags', null, (E) => {
    const app = E.newApp({ sampleRate: 48000 });
    app.setContinuous(true); app.latched = true; app.playing = true; app.dual.binaural = true; app.source = 'dual';
    const cfg = app.serializeConfig();
    const hash = app.serializeHash();
    const x = JSON.parse(E.g.base64UrlDecode(new URLSearchParams(hash).get('x')));
    return { keys: Object.keys(cfg), dualBinauralInConfig: cfg.dual.binaural, dualBinauralInHash: x.dual.binaural, hasContinuous: /continu/i.test(JSON.stringify(cfg) + hash) };
  });

  // ============================================================ continuous-play safety
  for (const continuous of [false, true]) {
    for (const durationMs of [10000, 1000, 20]) {
      add('safety.continuous', `sweep-continuous(perm=${continuous},dur=${durationMs})`, { continuous, durationMs }, (E) => planSummary(E.g.buildPlan(
        { source: 'sweep', sweep: { start: 20, end: 20000, durationMs, curve: 'log', direction: 'up', repeat: 'continuous' } },
        { safeMax: safeMaxOf(48000), continuous },
      )));
      add('safety.continuous', `pingpong-continuous(perm=${continuous},dur=${durationMs})`, { continuous, durationMs }, (E) => {
        const r = E.g.buildPlan(
          { source: 'sweep', sweep: { start: 20, end: 20000, durationMs, curve: 'log', direction: 'pingpong', repeat: 'continuous' } },
          { safeMax: safeMaxOf(48000), continuous },
        );
        return r.ok ? { segments: r.plan.segments.length, dur: r.plan.dur, warnings: r.warnings } : r;
      });
    }
  }
  add('safety.continuous', 'app-gating', null, (E) => {
    const app = E.newApp({ sampleRate: 48000 });
    const out = {};
    app.setSweepRepeat('continuous'); out.lockedRepeat = [app.sweep.repeat, alertList(app).length];
    app.applyConfig({ sweep: { repeat: 'continuous' } }, 'preset'); out.applyWithoutPerm = app.sweep.repeat;
    app.setContinuous(true);
    app.applyConfig({ sweep: { repeat: 'continuous' } }, 'preset'); out.applyWithPerm = app.sweep.repeat;
    app.syncViz(); out.durationTextAllowed = app.durationText; out.transportAllowed = app.transportText;
    app.setContinuous(false); out.afterRevoke = [app.continuousAllowed, app.sweep.repeat];
    app.setMode('playground'); app.syncViz(); out.durationTextLimited = app.durationText; out.transportLimited = app.transportText;
    for (const lim of [0.5, 5]) { app.safetyLimit = lim; out[`durationText@${lim}`] = app.durationText; }
    return out;
  });

  // ============================================================ AudioEngine stop semantics (mock AudioContext)
  const engineCaseIn = (group, name, mockOpts, script) => add(group, name, { mockOpts }, () => {
    const audio = makeMockAudio(mockOpts);
    const E = loadOscilla({ audio });
    const eng = new E.g.AudioEngine();
    const events = [];
    eng.on((type, d) => events.push([type, d]));
    const snaps = [];
    const snap = (label, extra = {}) => snaps.push({
      label, t: eng.ctx ? eng.ctx.currentTime : null, nodes: eng.activeNodeCount, sources: eng.activeSourceCount,
      voices: eng.voices.size, voice: eng.voice ? eng.voice.id : null,
      releasing: eng.voice ? eng.voice.releasing : null, endTime: eng.voice ? eng.voice.endTime : null, ...extra,
    });
    const sr = (mockOpts && mockOpts.sampleRate) || 48000;
    const env = { safeMax: safeMaxOf(sr), continuous: true };
    const st = E.g.defaultInstrumentState();
    const plan = (cfg, e = env) => {
      const r = E.g.buildPlan({ ...st, ...cfg, pp: { ...st.pp, ...(cfg.pp || {}) } }, e);
      if (!r.ok) throw new Error(r.error);
      return r.plan;
    };
    const opt = (o = {}) => ({ mode: 'hold', continuous: true, limitS: 2, durationS: 0.5, attackS: 0.01, releaseS: 0.03, ...o });
    const result = script({ eng, E, snap, plan, opt, advance: (t) => eng.ctx.advance(t) }) || {};
    return { ...result, events, snaps, graph: eng.ctx ? eng.ctx.trace() : null, invariants: engineInvariants(eng, sr) };
  });
  const engineCase = (name, mockOpts, script) => engineCaseIn('engine.stop', name, mockOpts, script);

  engineCase('init-output-chain', {}, ({ eng }) => {
    const ok = eng.init();
    return { ok, again: eng.init(), trim: eng.trim.gain.value, timeData: eng.timeData.length, freqData: eng.freqData.length };
  });
  engineCase('init-without-AudioContext', { none: true }, ({ eng, E }) => {
    delete E.ctx.AudioContext;
    return { supported: E.g.AudioEngine.isSupported(), ok: eng.init(), lastError: eng.lastError };
  });
  engineCase('const-hold-release-running', {}, ({ eng, snap, plan, opt, advance }) => {
    const info = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    snap('playing', { info });
    advance(0.5);
    const rel = eng.release();
    snap('released', { rel });
    advance(0.5 + 0.03 + 0.01);
    snap('after-stop');
  });
  engineCase('const-hold-release-in-attack-no-cancelAndHold', { cancelAndHold: false }, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ attackS: 0.05 }));
    advance(0.045); // inside the 50 ms linear attack (t0 = 0.02)
    snap('mid-attack');
    eng.release();
    snap('released');
    advance(1);
    snap('after');
  });
  engineCase('const-hold-release-in-release-ramp-no-cancelAndHold', { cancelAndHold: false }, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'finite', frequency: 440, duration: 1000 }), opt({ mode: 'trigger', releaseS: 0.3 }));
    advance(0.9); // inside the programmed exponential release (t0 + 1.0 - 0.3 … t0 + 1.0)
    eng.release();
    snap('released');
    advance(2);
    snap('after');
  });
  engineCase('finite-tone-natural-end', {}, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'finite', frequency: 1000, duration: 1000 }), opt({ mode: 'trigger' }));
    snap('playing');
    advance(1.0);
    snap('before-end');
    advance(1.04);
    snap('after-end');
    return { lateRelease: eng.release() };
  });
  engineCase('release-after-programmed-end-is-noop', {}, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'finite', frequency: 1000, duration: 100 }), opt({ mode: 'trigger' }));
    advance(0.129); // endTime = 0.02 + 0.1 + 0.01 = 0.13 → now >= endTime - 0.002
    const r = eng.release();
    snap('late');
    advance(0.14);
    snap('natural-end');
    return { release: r };
  });
  engineCase('release-on-suspended-context-frees-now', { state: 'suspended' }, ({ eng, snap, plan, opt }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    snap('playing');
    const r = eng.release();
    snap('released');
    return { release: r };
  });
  engineCase('play-stop-play-x20', {}, ({ eng, snap, plan, opt, advance }) => {
    let t = 0;
    let maxNodes = 0;
    const ids = [];
    for (let i = 0; i < 20; i++) {
      const info = eng.play(plan({ pattern: i % 2 ? 'am' : 'tone', frequency: 440 + i }), opt());
      ids.push(info.id);
      maxNodes = Math.max(maxNodes, eng.activeNodeCount);
      t += 0.1; advance(t);
      eng.release(i % 3 === 0);
      t += 0.1; advance(t);
    }
    snap('end');
    return { ids, maxNodes };
  });
  engineCase('play-while-playing-releases-previous', {}, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    advance(0.3);
    eng.play(plan({ pattern: 'pulse', frequency: 1000 }), opt({ mode: 'trigger' }));
    snap('overlap');
    advance(0.35);
    snap('previous-freed');
    eng.stopAll();
    snap('stopAll');
    advance(1);
    snap('after');
  });
  engineCase('hold-limited-by-safety', {}, ({ eng, snap, plan, opt, advance }) => {
    const info = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ continuous: false, limitS: 0.5 }));
    snap('playing', { info });
    advance(0.53);
    snap('after-limit');
  });
  engineCase('hold-limit-shorter-than-attack', {}, ({ eng, snap, plan, opt, advance }) => {
    const info = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ continuous: false, limitS: 0.01, attackS: 2, releaseS: 3 }));
    snap('playing', { info });
    advance(1);
    snap('after');
  });
  engineCase('hold-continuous-unlimited', {}, ({ eng, snap, plan, opt, advance }) => {
    const info = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ continuous: true }));
    snap('playing', { info });
    advance(100);
    snap('still-playing');
    eng.stopAll();
    snap('stopAll');
    advance(101);
    snap('after');
  });
  engineCase('trigger-open-duration', {}, ({ eng, snap, plan, opt, advance }) => {
    const info = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ mode: 'trigger', continuous: false, durationS: 1, limitS: 2 }));
    snap('playing', { info });
    advance(1.04);
    snap('after');
  });
  engineCase('trigger-open-duration-capped-by-limit', {}, ({ eng, snap, plan, opt, advance }) => {
    const info = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ mode: 'trigger', continuous: false, durationS: 5, limitS: 2 }));
    snap('playing', { info });
    advance(2.04);
    snap('after');
  });
  const topologies = [
    ['steps-pulse', { pattern: 'pulse', frequency: 1000 }],
    ['ramps-sweepUp-log', { pattern: 'sweepUp' }],
    ['ramps-pingpong-whole', { pattern: 'pingpong' }],
    ['ramps-chirp-short-attack', { pattern: 'chirp' }],
    ['ramps-sweep-mode-n2', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 500, curve: 'linear', direction: 'up', repeat: 'n', repeatCount: 2 } }],
    ['lfo-siren', { pattern: 'siren' }],
    ['lfo-wobble', { pattern: 'wobble', frequency: 1000 }],
    ['am', { pattern: 'am' }],
    ['fm', { pattern: 'fm', frequency: 1000 }],
    ['dual-mono', { source: 'dual' }],
    ['dual-stereo', { source: 'dual', dual: { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 446, wave: 'triangle', gain: 50, detune: 10 }, levelA: 80, levelB: 60, stereo: true, binaural: true } }],
  ];
  for (const [name, cfg] of topologies) {
    for (const panner of [true, false]) {
      if (!panner && !name.startsWith('dual')) continue;
      engineCase(`topology:${name}${panner ? '' : ':no-StereoPanner'}`, { stereoPanner: panner }, ({ eng, snap, plan, opt, advance }) => {
        const p = plan(cfg);
        eng.play(p, opt({ mode: p.kind === 'finite' ? 'trigger' : 'hold' }));
        snap('playing');
        advance(0.2);
        eng.stopAll();
        snap('stopAll');
        advance(2);
        snap('after');
      });
    }
  }
  const lives = [
    ['const', { pattern: 'tone', frequency: 440 }, { pattern: 'tone', frequency: 880, waveform: 'square' }],
    ['lfo', { pattern: 'siren' }, { pattern: 'siren', pp: { siren: { min: 300, max: 900, rate: 2, shape: 'triangle' } } }],
    ['am', { pattern: 'am' }, { pattern: 'am', frequency: 660, pp: { am: { modFreq: 8, depth: 40 } } }],
    ['fm', { pattern: 'fm' }, { pattern: 'fm', frequency: 2000, pp: { fm: { modFreq: 50, depthHz: 300 } } }],
    ['dual', { source: 'dual' }, { source: 'dual', dual: { a: { freq: 500, wave: 'square', gain: 90, detune: 5 }, b: { freq: 505, wave: 'sine', gain: 100, detune: 0 }, levelA: 70, levelB: 70, stereo: true, binaural: false } }],
    ['type-mismatch', { pattern: 'tone' }, { pattern: 'am' }],
    ['finite-not-live', { pattern: 'finite', frequency: 440 }, { pattern: 'finite', frequency: 880 }],
  ];
  for (const [name, a, b] of lives) {
    engineCase(`updateLive:${name}`, {}, ({ eng, plan, opt, advance }) => {
      const p = plan(a);
      eng.play(p, opt({ mode: p.kind === 'finite' ? 'trigger' : 'hold' }));
      advance(0.1);
      const ok = eng.updateLive(plan(b));
      eng.stopAll();
      advance(5);
      return { ok };
    });
  }
  engineCase('instantaneous-frequency', {}, ({ eng, plan, opt, advance }) => {
    const before = eng.instantaneousFrequency();
    eng.play(plan({ pattern: 'sweepUp', pp: { sweepUp: { start: 100, end: 1000, durationMs: 1000, curve: 'log' } } }), opt({ mode: 'trigger' }));
    const out = [];
    for (const t of [0, 0.02, 0.27, 0.52, 1.02, 1.03]) { advance(t); out.push([t, eng.instantaneousFrequency()]); }
    return { before, out };
  });
  engineCase('setMasterGain-clamped', {}, ({ eng }) => {
    eng.setMasterGain(0.1); // before init: no-op
    eng.init();
    for (const g of [0.1, 1, -1, 'x', 0.25]) eng.setMasterGain(g);
    return { master: eng.master.gain.events };
  });

  // ============================================================ app transport (component + engine, mock audio)
  const appCase = (name, script) => add('app.transport', name, null, () => {
    const audio = makeMockAudio({});
    const E = loadOscilla({ audio });
    const app = E.newApp();
    E.g.engine.on((t, d) => app.onEngine(t, d));
    const snaps = [];
    const snap = (label) => snaps.push({
      label, status: app.status, playing: app.playing, releasing: app.releasing, holding: app.holding, latched: app.latched,
      keyHolding: app.keyHolding, voice: E.g.engine.voice ? { id: E.g.engine.voice.id, endTime: E.g.engine.voice.endTime, limited: E.g.engine.voice.limited } : null,
      nodes: E.g.engine.activeNodeCount, sampleRate: app.sampleRate,
    });
    const advance = (t) => E.g.engine.ctx.advance(t);
    const r = script({ app, E, snap, advance }) || {};
    return { ...r, snaps, alerts: alertList(app), history: app.history.map((h) => [h.mode, h.pattern, h.label, h.freqs, h.duration]) };
  });
  appCase('trigger-open-tone-500ms', ({ app, snap, advance }) => {
    app.trigger(); snap('triggered');
    advance(0.6); snap('after-duration');
  });
  appCase('trigger-programmed-pattern', ({ app, snap, advance }) => {
    app.setPattern('pulse'); app.trigger(); snap('triggered');
    advance(5); snap('after');
  });
  appCase('latch-requires-permission', ({ app, snap, advance }) => {
    app.toggleLatch(); snap('without-permission');
    app.setContinuous(true); app.toggleLatch(); snap('latched');
    advance(50); snap('still-latched');
    app.setContinuous(false); snap('permission-revoked');
    advance(51); snap('after');
  });
  appCase('key-hold-release', ({ app, snap, advance }) => {
    app.holdKey({ repeat: false }); snap('key-down');
    app.holdKey({ repeat: true }); snap('repeat-ignored');
    advance(0.3);
    app.releaseHold(); snap('released');
    advance(1); snap('after');
  });
  appCase('escape-stops-now', ({ app, snap, advance }) => {
    app.setContinuous(true);
    app.holdKey({ repeat: false });
    advance(0.5);
    app.onKeyDown({ key: 'Escape' }); snap('escape');
    advance(0.6); snap('after');
  });
  appCase('invalid-config-errors', ({ app, snap }) => {
    app.setPattern('sequence'); app.pp.sequence.text = '440, 8x0';
    const ok = app.play('trigger'); snap('play');
    return { ok };
  });
  appCase('resetDefaults-while-playing', ({ app, snap, advance }) => {
    app.setContinuous(true); app.setFrequency(1000); app.holdKey({ repeat: false });
    advance(0.2);
    app.resetDefaults(); snap('reset');
    advance(1); snap('after');
    return { frequency: app.frequency, continuousAllowed: app.continuousAllowed, safetyLimit: app.safetyLimit };
  });

  // OSCILLA_VECTORS_UNTIL=36f4b47 leaves them out (for regenerating an older golden).
  if (process.env.OSCILLA_VECTORS_UNTIL !== '36f4b47') defineA7b7a23Cases(R, { engineCaseIn, alertList, safeMaxOf, S48 });

  return R.cases;
}

// ------------------------------------------------------------------ vectors added at a7b7a23
// New V1 behaviour of the engine round (one voice at a time, limitable finite tone, continuous
// sweep scheduled ahead and topped up, live restarts with the old deadline, waveform dips,
// closed-context rebuild, revoke, suspended status) and the plan changes. Separate groups, so
// the cases of every existing group stay contiguous and in their original order.
function defineA7b7a23Cases(R, { engineCaseIn, alertList, safeMaxOf, S48 }) {
  const { add, call } = R;
  const st0 = (E) => E.g.defaultInstrumentState();
  const build = (E, cfg, env) => {
    const st = st0(E);
    return E.g.buildPlan({ ...st, ...cfg, pp: { ...st.pp, ...(cfg.pp || {}) }, sweep: { ...st.sweep, ...(cfg.sweep || {}) } }, env);
  };
  const C48 = { safeMax: safeMaxOf(48000), continuous: true };
  const sweepCont = { source: 'sweep', sweep: { start: 200, end: 2000, durationMs: 500, curve: 'log', direction: 'up', repeat: 'continuous' } };

  // ---- pure: plans
  const planCases = [
    ['sweep-continuous-allowed', sweepCont, C48],
    ['sweep-continuous-not-allowed', sweepCont, S48],
    ['sweep-continuous-pingpong', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 400, curve: 'linear', direction: 'pingpong', repeat: 'continuous' } }, C48],
    ['sweep-n-not-capped-message-continuous', { source: 'sweep', sweep: { start: 100, end: 1000, durationMs: 5000, curve: 'log', direction: 'up', repeat: 'n', repeatCount: 1000 } }, C48],
    ['finite-limitable', { source: 'single', pattern: 'finite', frequency: 440, duration: 10000 }, S48],
    ['fm-never-through-zero', { source: 'single', pattern: 'fm', frequency: 100, pp: { fm: { depthHz: 5000, modFreq: 5 } } }, S48],
    ['fm-freqs-extremes', { source: 'single', pattern: 'fm', frequency: 1000, pp: { fm: { depthHz: 300, modFreq: 50 } } }, S48],
    ['wobble-freqs-extremes', { source: 'single', pattern: 'wobble', frequency: 1000, pp: { wobble: { depth: 200, rate: 5 } } }, S48],
    ['dual-sounding-frequency', { source: 'dual', dual: { a: { freq: 440, detune: 1200, wave: 'sine', gain: 100 }, b: { freq: 440, detune: -100, wave: 'square', gain: 100 }, levelA: 80, levelB: 80 } }, S48],
  ];
  for (const [name, cfg, env] of planCases) add('plan.a7b7a23', `buildPlan:${name}`, { cfg, env }, (E) => planSummary(build(E, cfg, env)));
  add('plan.a7b7a23', 'continuous-plan-progression-wraps', null, (E) => {
    const plan = build(E, sweepCont, C48).plan;
    const out = [];
    for (const t of [0, 0.1, 0.25, 0.5, 0.52, plan.period, plan.period + 0.25, 3.5 * plan.period, 1000 + 0.25]) {
      out.push([t, E.g.planFreqAt(plan, t), E.g.planAmpAt(plan, t)]);
    }
    return { period: plan.period, out };
  });
  call('plan.a7b7a23', 'planTime', [{ period: 0.53 }, 1.06]);
  call('plan.a7b7a23', 'planTime', [{ period: 0 }, 7.5]);
  call('plan.a7b7a23', 'planTime', [{}, 7.5]);
  add('plan.a7b7a23', 'planKey', null, (E) => {
    const a = build(E, { source: 'single', pattern: 'tone', frequency: 440 }, S48).plan;
    const b = { ...a, label: 'other', wave: 'square' };
    return { same: E.g.planKey(a) === E.g.planKey({ ...a, label: 'x' }), wave: E.g.planKey(a) === E.g.planKey(b), ignoreWave: E.g.planKey(a, true) === E.g.planKey(b, true), key: E.g.planKey(a) };
  });
  add('plan.a7b7a23', 'ceilingCurve(0.25)', null, (E) => {
    const c = E.g.ceilingCurve(0.25);
    return { length: c.length, at: [0, 1024, 1536, 1600, 2048, 2496, 2560, 3072, 4096].map((i) => c[i]) };
  });

  // ---- engine
  const ec = (name, mockOpts, script) => engineCaseIn('engine.a7b7a23', name, mockOpts, script);
  const horizon = (eng) => {
    const ev = eng.voice && eng.voice.carrier ? eng.voice.carrier.frequency.events : [];
    return ev.length ? Math.max(...ev.map((e) => (typeof e[2] === 'number' ? e[2] : 0))) : null;
  };
  ec('finite-tone-limited-by-safety', {}, ({ eng, snap, plan, opt, advance }) => {
    const info = eng.play(plan({ pattern: 'finite', frequency: 440, duration: 10000 }), opt({ mode: 'trigger', continuous: false, limitS: 2 }));
    snap('playing', { info, limited: eng.voice.limited, extended: eng.voice.extended });
    advance(2.1);
    snap('after');
  });
  ec('finite-tone-extended-with-permission', {}, ({ eng, snap, plan, opt }) => {
    const info = eng.play(plan({ pattern: 'finite', frequency: 440, duration: 10000 }), opt({ mode: 'trigger', continuous: true, limitS: 2 }));
    snap('playing', { info, limited: eng.voice.limited, extended: eng.voice.extended });
    return { revoked: eng.revokeContinuous() };
  });
  ec('revokeContinuous-only-extended-voices', {}, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ continuous: false, limitS: 2 }));
    const notExtended = eng.revokeContinuous();
    advance(0.3);
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ continuous: true }));
    snap('extended', { extended: eng.voice.extended });
    advance(0.6);
    const extended = eng.revokeContinuous();
    snap('revoked');
    advance(1);
    snap('after');
    return { notExtended, extended };
  });
  ec('replace-during-long-release', {}, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ releaseS: 3 }));
    advance(0.2);
    eng.release();
    snap('long-release');
    advance(0.4);
    const info = eng.play(plan({ pattern: 'tone', frequency: 660 }), opt({ releaseS: 3 }));
    snap('replaced', { info, voiceEnds: [...eng.voices].map((v) => [v.id, v.endTime, v.releasing]) });
    advance(0.5);
    snap('previous-freed');
  });
  ec('escape-during-long-release', {}, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ attackS: 0.5, releaseS: 3 }));
    advance(0.2);
    eng.release();
    const first = eng.voice.endTime;
    advance(0.35);
    eng.stopAll();
    snap('escaped', { first, second: eng.voice.endTime });
    advance(0.5);
    snap('after');
  });
  ec('continuous-sweep-schedule-and-top-up', {}, ({ eng, E, snap, plan, opt, advance }) => {
    const info = eng.play(plan(sweepCont, C48), opt({ mode: 'trigger' }));
    const v = eng.voice;
    const first = { cycle: v.cycle, horizon: horizon(eng), extended: v.extended, endTime: v.endTime };
    advance(5);
    const ran = E.timers.flushOnce();
    const topped = { cycle: v.cycle, horizon: horizon(eng), envEvents: v.env.ev.length };
    advance(5.05);
    eng.stopAll();
    snap('stopped');
    advance(6);
    snap('after');
    return { info, first, ran, topped };
  });
  ec('updateLive:same', {}, ({ eng, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    advance(0.1);
    const ok = eng.updateLive(plan({ pattern: 'tone', frequency: 440 }));
    eng.stopAll();
    advance(1);
    return { ok };
  });
  ec('updateLive:waveform-dip', {}, ({ eng, E, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    advance(0.1);
    const ok = eng.updateLive(plan({ pattern: 'tone', frequency: 440, waveform: 'triangle' }));
    const during = { dipping: eng.voice.dipping, type: eng.voice.carrier.type };
    const again = eng.updateLive(plan({ pattern: 'tone', frequency: 440, waveform: 'triangle' }));
    advance(0.2);
    E.timers.flushOnce();
    const after = { dipping: eng.voice.dipping, type: eng.voice.carrier.type };
    eng.stopAll();
    advance(1);
    return { ok, during, again, after };
  });
  ec('updateLive:restart-keeps-deadline', {}, ({ eng, snap, plan, opt, advance }) => {
    const first = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt({ continuous: false, limitS: 2 }));
    advance(0.5);
    const ok = eng.updateLive(plan({ pattern: 'am' }));
    snap('restarted', { first, deadline: eng.voice.deadline, limited: eng.voice.limited, type: eng.voice.plan.type });
    advance(1.9);
    const late = eng.updateLive(plan({ pattern: 'siren' }));
    advance(2.2);
    snap('after');
    return { ok, late };
  });
  ec('updateLive:dual-stereo-change-without-panner', { stereoPanner: false }, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ source: 'dual' }), opt());
    advance(0.1);
    const d = { a: { freq: 440, wave: 'sine', gain: 100, detune: 0 }, b: { freq: 442, wave: 'sine', gain: 100, detune: 0 }, levelA: 80, levelB: 80, stereo: true, binaural: false };
    const ok = eng.updateLive(plan({ source: 'dual', dual: d }));
    snap('restarted');
    eng.stopAll();
    advance(1);
    return { ok };
  });
  ec('closed-context-rebuilt', {}, ({ eng, snap, plan, opt, advance }) => {
    eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    advance(0.1);
    const old = eng.ctx;
    old.externalState('closed');
    snap('closed', { ctx: !!eng.ctx });
    const info = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    snap('rebuilt', { info, fresh: eng.ctx !== old, oldNodes: old._nodes.length });
    eng.stopAll();
    advance(1);
    snap('after');
  });
  ec('suspended-play-not-running', { state: 'suspended' }, ({ eng, snap, plan, opt }) => {
    const info = eng.play(plan({ pattern: 'finite', frequency: 440, duration: 300 }), opt({ mode: 'trigger' }));
    snap('scheduled', { info, running: eng.running });
    const info2 = eng.play(plan({ pattern: 'tone', frequency: 440 }), opt());
    snap('replaced-on-suspended', { info2 });
  });
  ec('setMasterGain-before-init-applies', {}, ({ eng }) => {
    eng.setMasterGain(0.2);
    eng.init();
    return { master: eng.master.gain.value, gainLevel: eng.gainLevel, ceiling: !!eng.ceiling };
  });

  // ---- app (component + engine)
  const appIn = (name, mockOpts, script) => add('app.a7b7a23', name, { mockOpts }, () => {
    const audio = makeMockAudio(mockOpts);
    const E = loadOscilla({ audio });
    const app = E.newApp();
    E.g.engine.on((t, d) => app.onEngine(t, d));
    const snaps = [];
    const snap = (label, extra = {}) => snaps.push({
      label, status: app.status, icon: app.statusIcon, playing: app.playing, releasing: app.releasing, latched: app.latched,
      voice: E.g.engine.voice ? { id: E.g.engine.voice.id, endTime: E.g.engine.voice.endTime, limited: E.g.engine.voice.limited, extended: E.g.engine.voice.extended } : null,
      nodes: E.g.engine.activeNodeCount, ...extra,
    });
    const advance = (t) => E.g.engine.ctx.advance(t);
    const r = script({ app, E, snap, advance }) || {};
    return { ...r, snaps, alerts: alertList(app) };
  });
  appIn('limit-texts', {}, ({ app }) => {
    const out = {};
    const read = (k) => { app.syncViz(); out[k] = { transport: app.transportText, duration: app.durationText }; };
    app.setPattern('finite'); app.duration = 10000; read('finite-10s');
    app.duration = 1000; read('finite-1s');
    app.duration = 10000; app.setContinuous(true); read('finite-10s-continuous');
    app.setContinuous(false);
    app.setPattern('pulse'); read('pulse');
    app.setMode('sweep'); Object.assign(app.sweep, { start: 200, end: 2000, durationMs: 10000, repeat: 'once', direction: 'up' }); read('sweep-10s');
    app.setContinuous(true); Object.assign(app.sweep, { durationMs: 20, repeat: 'continuous' }); read('sweep-continuous');
    app.setMode('playground'); app.setPattern('tone'); read('tone-continuous');
    app.setContinuous(false); read('tone');
    return out;
  });
  appIn('finite-tone-limited-play', {}, ({ app, snap, advance }) => {
    app.setPattern('finite'); app.duration = 10000; app.syncViz();
    app.trigger(); snap('triggered');
    advance(2.1); snap('after');
  });
  appIn('suspended-status', { state: 'suspended', resumable: false }, ({ app, E, snap }) => {
    app.setPattern('finite'); app.duration = 300;
    app.trigger(); snap('triggered', { listeners: E.document.listeners.map((l) => [l.type, l.capture]) });
    E.g.engine.ctx.externalState('running'); snap('running');
    app.holdEnd(); snap('holdEnd');
  });
  appIn('revoke-stops-hold-and-sweep', {}, ({ app, snap, advance }) => {
    app.setContinuous(true);
    app.holdKey({ repeat: false });
    advance(0.5); snap('holding');
    app.setContinuous(false); snap('revoked');
    advance(1); snap('after');
    app.setMode('sweep'); app.setContinuous(true); app.setSweepRepeat('continuous'); app.syncViz();
    app.trigger(); snap('sweep');
    advance(3);
    app.setContinuous(false); snap('sweep-revoked', { repeat: app.sweep.repeat });
    advance(4); snap('sweep-after');
  });
  appIn('latchKey-and-mic-events', {}, ({ app, snap }) => {
    let prevented = 0;
    app.latchKey({ repeat: false, preventDefault: () => { prevented++; } });
    app.latchKey({ repeat: true, preventDefault: () => { prevented++; } });
    app.micActive = true;
    app.onEngine('mic', { active: false, reason: 'user' });
    const afterUser = app.micActive;
    app.micActive = true;
    app.onEngine('mic', { active: false, reason: 'ended' });
    snap('mic');
    return { prevented, afterUser, afterEnded: app.micActive };
  });
  appIn('closed-context-rebuilt-on-play', {}, ({ app, E, snap, advance }) => {
    app.play('hold'); advance(0.2); snap('playing');
    E.g.engine.ctx.externalState('closed'); snap('closed', { audioState: app.audioState });
    const ok = app.play('hold'); snap('rebuilt', { ok, audioState: app.audioState, sampleRate: app.sampleRate });
    app.stopNow(); advance(1); snap('after');
  });
}

/** Rules from project.audio-engine-discipline, checked on the recorded mock graph. */
function engineInvariants(eng, sr) {
  const v = [];
  const ctx = eng.ctx;
  if (!ctx) return { violations: v };
  const nyq = sr / 2;
  const chain = new Set([eng.master, eng.limiter, eng.trim, eng.ceiling, eng.analyser, ctx.destination].filter(Boolean).map((n) => n.id));
  for (const n of ctx._nodes) {
    for (const [k, p] of Object.entries(n)) {
      if (!p || !Array.isArray(p.events)) continue;
      for (const e of p.events) {
        if (n.kind === 'oscillator' && k === 'frequency' && typeof e[1] === 'number' && n.type !== undefined && e[1] >= nyq * 0.95 + 1e-6 && !(e[1] < 100)) {
          v.push(`osc ${n.id} frequency ${e[1]} ≥ safe maximum`);
        }
        if (n.kind === 'gain' && k === 'gain' && e[0] === 'set' && e[1] === 0) v.push(`gain ${n.id} hard set to 0`);
        if (typeof e[2] === 'number' && e[0] !== 'cancel' && e[0] !== 'cancelAndHold' && !Number.isFinite(e[2])) v.push(`node ${n.id} ${k} non-finite time`);
      }
    }
  }
  const voiceNodes = ctx._nodes.filter((n) => !chain.has(n.id));
  return {
    violations: v,
    activeNodesAtEnd: eng.activeNodeCount,
    undisconnectedVoiceNodes: eng.voices.size ? null : voiceNodes.filter((n) => n.disconnected === 0).map((n) => n.id),
  };
}

function htmlSha(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

function buildGolden() {
  const E = loadOscilla();
  const cases = defineCases();
  const baseline = process.env.OSCILLA_BASELINE || '95dfa81';
  return {
    meta: {
      baseline,
      source: `baseline-${baseline}/index.html`,
      sha256: htmlSha(E.htmlPath),
      fixedNow: FIXED_NOW,
      generator: process.env.OSCILLA_BASELINE ? `OSCILLA_HTML=… OSCILLA_BASELINE=${baseline} node extract.cjs --golden` : 'node extract.cjs --golden',
      node: process.version,
      count: cases.length,
    },
    cases: cases.map((c) => ({ id: c.id, group: c.group, input: enc(c.input), output: enc(c.run(E)) })),
  };
}

module.exports = { defineCases, buildGolden, enc, engineInvariants };
