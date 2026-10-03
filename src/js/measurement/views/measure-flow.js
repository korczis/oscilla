// Guided measurement flow, expert fields, presets, output levels and safety notes for the
// MEASURE workspace (spec §29-§30, §77-§78, §106-§108, §115, §152-§155, §208, §238). Pure.
//
//   measureFlow(ctx) -> { steps: [Step], current, primaryAction, secondaryActions, canBypass,
//     ready, blockers, warnings, runText }
//     ctx = { state (MEASUREMENT_STATES), preflight (engine preflight report | null), recipe,
//             calibration: { frequency, level } | null, result (engine result | null),
//             progress (engine.progress() | last progress event | null), saved = false,
//             expert = false, noise (engine 'noise' event | result.noise | null),
//             error ({ code, message } | null) }
//     Step = { id, n, label, status: 'todo'|'current'|'done'|'blocked'|'warn', detail,
//              reasons: [{ code, text }] }
//   The seven steps of §77: input, calibration, noise check, stimulus, measure, review, save.
//   'warn' = passed with warnings (never blocking, §30); 'blocked' = a blocker or an invalid
//   outcome stops the flow there; 'current' = the first step not yet done.
//
//   expertFields({ disclosure = 'basic' | 'advanced', sampleRate }) -> { groups: [Group] }
//   recipeFromFields(values, base = CHARACTERIZE_PLAYBACK_CHAIN.recipe) -> recipe
//   OUTPUT_LEVEL_CHOICES, CHARACTERIZE_PLAYBACK_CHAIN, safetyNotes(ctx), ROOM_NOTES

import { MEASUREMENT_STATES as S, isActiveState } from '../state-machine.js';
import {
  CONTRACT_LIMITS, DEFAULT_TIMING, MEASUREMENT_LEVELS, TIMING_LIMITS,
} from '../engine.js';
import { SMOOTHING_FRACTIONS } from '../smoothing.js';
import { RTA_MODES } from '../rta.js';
import { safeMaxFrequency } from '../stimulus.js';
import { describeStimulus } from '../../experiments/schema.js';
import { fixedText, UNAVAILABLE } from './common.js';

// ----------------------------------------------------------------------------- output level

/**
 * Output level choices (spec §152, §208): the DIGITAL peak of the rendered stimulus
 * (engine.js MEASUREMENT_LEVELS), before the master gain. Never a sound level, never "SPL".
 */
export const OUTPUT_LEVEL_CHOICES = Object.freeze(['low', 'medium', 'high'].map((id) => {
  const value = MEASUREMENT_LEVELS[id];
  return Object.freeze({
    id,
    label: id.toUpperCase(),
    value,
    detail: `digital peak ${value} (${fixedText(20 * Math.log10(value), 1)} dBFS digital), `
      + 'before the master volume; the acoustic level is unknown',
  });
}));

// ----------------------------------------------------------------------------- preset

/**
 * CHARACTERIZE PLAYBACK CHAIN (spec §106): noise check, sweep, response, quality, save. The
 * result is the OBSERVED response of the whole chain — output DSP, speaker, room, microphone,
 * ADC and browser input processing together — never "the speaker response".
 */
/**
 * Default noise-check length (s) of the workspace and the preset. The SNR of a grid point is
 * assessed only where the noise capture resolves it: below about 10 / (0.1156 · T) Hz (T the
 * noise-check length; quality.js, 1/6-octave pooling) a point is "SNR not assessed", so a 1 s
 * check could never assess below ~87 Hz and a default 20 Hz sweep could never reach GOOD; 5 s
 * assesses from ~17 Hz. The engine's own DEFAULT_TIMING is unchanged (a recipe without the
 * field keeps its meaning).
 */
export const DEFAULT_NOISE_CHECK_S = 5;
const NOISE_CHECK_HELP = `${DEFAULT_NOISE_CHECK_S} s by default: the SNR is assessed only above `
  + 'about 10 / (0.1156 × length) Hz (17 Hz for 5 s, 87 Hz for 1 s), so a shorter check leaves '
  + 'the low end NOT ASSESSED. 0 skips it (SNR NOT MEASURED).';

export const CHARACTERIZE_PLAYBACK_CHAIN = Object.freeze({
  id: 'characterize-playback-chain',
  label: 'CHARACTERIZE PLAYBACK CHAIN',
  resultLabel: 'OBSERVED PLAYBACK / CAPTURE CHAIN RESPONSE',
  description: 'Measures the observed playback/capture chain response: a noise-floor check, '
    + 'then a logarithmic sweep played and captured three times and averaged. The result '
    + 'includes the output processing, speaker, room, microphone position, microphone, ADC and '
    + 'browser input processing; it is not the response of the speaker alone.',
  steps: Object.freeze(['noise', 'sweep', 'response', 'quality', 'save']),
  recipe: Object.freeze({
    stimulus: Object.freeze({ kind: 'log-sweep', f1: 20, f2: 20000, duration: 10, level: 'low' }),
    repeats: 3,
    analysis: Object.freeze({ noiseCheckS: DEFAULT_NOISE_CHECK_S, preRollS: DEFAULT_TIMING.preRollS,
      postRollS: DEFAULT_TIMING.postRollS, gapS: DEFAULT_TIMING.gapS, phase: false,
      aggregation: 'mean' }),
  }),
});

// ----------------------------------------------------------------------------- safety, room

/** Room / distance (spec §107) and repeatability (§108) notes. */
export const ROOM_NOTES = Object.freeze([
  Object.freeze({ id: 'position', text: 'The microphone position changes the response: '
    + 'reflections and room modes are part of what is measured. Note the distance and '
    + 'location with the experiment.' }),
  Object.freeze({ id: 'repeat', text: 'Repeated runs are averaged automatically; their spread '
    + 'shows how repeatable the result is.' }),
]);

const SAFETY = Object.freeze({
  conservative: 'Start at a LOW output level and raise it only as far as needed; the '
    + 'measurement never raises the gain on its own to overcome noise.',
  stop: 'Escape or STOP ends the sound immediately.',
  headphones: 'High output level: lower it before using headphones.',
  lowFrequency: 'Very low frequencies can drive a speaker to large excursion and distortion '
    + 'before they are clearly audible; do not turn the level up until they become audible.',
  highFrequency: 'Weak perception of very high frequencies does not imply weak output; the '
    + 'microphone and its calibration may also be poor there.',
});

/** Below this sweep start the low-frequency excursion note is shown (Hz). */
export const LOW_FREQUENCY_NOTE_HZ = 40;
/** Above this sweep end the high-frequency perception note is shown (Hz). */
export const HIGH_FREQUENCY_NOTE_HZ = 12000;

/**
 * safetyNotes({ recipe, preflight }) → [{ id, severity: 'info'|'warn', text }]
 * Always the conservative-level and hard-stop notes (§152); headphones when the preflight
 * reports HIGH_OUTPUT or the level is HIGH (§153); low/high-frequency notes by sweep range
 * (§154-§155).
 */
export function safetyNotes({ recipe = null, preflight = null } = {}) {
  const st = recipe && recipe.stimulus ? recipe.stimulus : {};
  const out = [
    { id: 'conservative', severity: 'info', text: SAFETY.conservative },
    { id: 'stop', severity: 'info', text: SAFETY.stop },
  ];
  const warned = (code) => !!(preflight && Array.isArray(preflight.warnings)
    && preflight.warnings.some((w) => w.code === code));
  const level = typeof st.level === 'string' ? MEASUREMENT_LEVELS[st.level] : st.level;
  if (warned('HIGH_OUTPUT') || level >= MEASUREMENT_LEVELS.high)
    out.push({ id: 'headphones', severity: 'warn', text: SAFETY.headphones });
  if (st.f1 > 0 && st.f1 < LOW_FREQUENCY_NOTE_HZ)
    out.push({ id: 'low-frequency', severity: 'info', text: SAFETY.lowFrequency });
  if (st.f2 > HIGH_FREQUENCY_NOTE_HZ)
    out.push({ id: 'high-frequency', severity: 'info', text: SAFETY.highFrequency });
  return out;
}

// ----------------------------------------------------------------------------- flow

export const FLOW_STEPS = Object.freeze([
  Object.freeze({ id: 'input', label: 'Input' }),
  Object.freeze({ id: 'calibration', label: 'Calibration' }),
  Object.freeze({ id: 'noise', label: 'Noise check' }),
  Object.freeze({ id: 'stimulus', label: 'Stimulus' }),
  Object.freeze({ id: 'measure', label: 'Measure' }),
  Object.freeze({ id: 'review', label: 'Review' }),
  Object.freeze({ id: 'save', label: 'Save' }),
]);

/** Which step a preflight reason code belongs to. */
export const REASON_STEP = Object.freeze({
  MIC_DENIED: 'input', NO_INPUT: 'input', UNSUPPORTED: 'input', CONTEXT_SUSPENDED: 'input',
  UNSUPPORTED_WORKLET: 'input', INPUT_PROCESSING: 'input', WORKLET_FALLBACK: 'input',
  SAMPLE_RATE_DIFFERS: 'input', INPUT_CLIPPING: 'input', MIC_DISCONNECTED: 'input',
  INVALID_CALIBRATION: 'calibration', UNCALIBRATED: 'calibration',
  LEVEL_RELATIVE: 'calibration',
  NOISE_HIGH: 'noise', NOISE_CLIPPING: 'noise',
  INVALID_RECIPE: 'stimulus', MEMORY_LIMIT: 'stimulus', ANALYSIS_MEMORY: 'stimulus',
  RANGE_CLAMPED: 'stimulus',
  OUTPUT_SILENT: 'stimulus', HIGH_OUTPUT: 'stimulus', LIMITER_RANGE: 'stimulus',
  OTHER_AUDIO: 'stimulus', OUTPUT_CHAIN_DEVIATION: 'stimulus', CHAIN_NOTES_IGNORED: 'stimulus',
});

const INFO_ONLY = new Set(['UNCALIBRATED', 'LEVEL_RELATIVE']);

function reasonsFor(list, step) {
  return (Array.isArray(list) ? list : [])
    .filter((r) => r && (REASON_STEP[r.code] || 'measure') === step)
    .map((r) => ({ code: r.code, text: r.text, severity: r.severity || null }));
}

function levelName(level) {
  if (typeof level === 'string') return level.toUpperCase();
  const c = OUTPUT_LEVEL_CHOICES.find((x) => x.value === level);
  return c ? c.label : (typeof level === 'number' ? `digital peak ${level}` : UNAVAILABLE.UNKNOWN);
}

/**
 * measureFlow(ctx) → the guided flow (see the header). Expert mode (`expert`) may bypass the
 * guidance: the primary action can start measure() directly, which runs its own preflight.
 */
export function measureFlow(ctx = {}) {
  const {
    state = S.IDLE, preflight = null, recipe = null, calibration = null, result = null,
    progress = null, saved = false, expert = false, error = null,
  } = ctx;
  const noise = ctx.noise || (result && result.noise) || null;
  const blockers = preflight && Array.isArray(preflight.blockers) ? preflight.blockers : [];
  const warnings = preflight && Array.isArray(preflight.warnings) ? preflight.warnings : [];
  const preflightDone = !!(preflight && preflight.ready);
  const active = isActiveState(state);
  const st = recipe && recipe.stimulus ? recipe.stimulus : null;
  const repeats = recipe && Number.isInteger(recipe.repeats) ? recipe.repeats : 1;
  const noiseCheckS = recipe && recipe.analysis && recipe.analysis.noiseCheckS !== undefined
    ? recipe.analysis.noiseCheckS : DEFAULT_TIMING.noiseCheckS;
  const reached = (...states) => states.includes(state);
  const measured = reached(S.ANALYZING, S.COMPLETE) || !!(result && result.state === S.COMPLETE);
  const resultInvalid = state === S.INVALID && !!result && !(result.preflight
    && result.preflight.ready === false);
  const quality = result && result.quality ? result.quality.status : null;
  const run = progress && Number.isInteger(progress.run) ? progress.run : null;
  const runText = run !== null ? `Run ${run + 1}/${repeats}` : null;
  const resultReasons = result && Array.isArray(result.reasons) ? result.reasons : [];

  const raw = {};
  const set = (id, o) => { raw[id] = { complete: false, blocked: false, warn: false, detail: null,
    reasons: [], ...o }; };

  // 1 input
  {
    const b = reasonsFor(blockers, 'input');
    const w = reasonsFor(warnings, 'input');
    const label = preflight && preflight.facts && preflight.facts.input
      && preflight.facts.input.device && preflight.facts.input.device.label;
    const errIn = error && (error.code === 'MIC_DISCONNECTED' || error.code === 'MIC_DENIED');
    set('input', {
      complete: (!!preflight && !b.length) || measured,
      blocked: b.length > 0 || errIn,
      warn: w.length > 0,
      reasons: errIn ? [{ code: error.code, text: error.message }, ...b] : [...b, ...w],
      detail: b.length ? b[0].text : (preflight ? `${label || 'Input device (label not exposed)'}`
        + `${preflight.sampleRate ? `, ${preflight.sampleRate} Hz` : ''}` : 'Not checked yet'),
    });
  }
  // 2 calibration (optional; only invalid data blocks)
  {
    const b = reasonsFor(blockers, 'calibration');
    const freq = calibration && calibration.frequency;
    const lvl = calibration && calibration.level;
    const detail = b.length ? b[0].text : [
      freq ? `frequency profile "${freq.name || UNAVAILABLE.UNKNOWN}"`
        : `frequency ${UNAVAILABLE.UNCALIBRATED}`,
      lvl ? 'level CALIBRATED' : 'level relative (dBFS-like)',
    ].join(', ');
    set('calibration', { complete: (!!preflight && !b.length) || measured,
      blocked: b.length > 0, warn: false,
    reasons: b.length ? b
      : reasonsFor(warnings, 'calibration').filter((r) => INFO_ONLY.has(r.code)),
    detail });
  }
  // 3 noise check
  {
    const w = reasonsFor(warnings, 'noise');
    const clip = resultReasons.find((r) => r.code === 'NOISE_CLIPPING');
    const skipped = noiseCheckS === 0;
    const rms = noise && Number.isFinite(noise.rmsDb) ? noise.rmsDb : null;
    let detail;
    if (clip) detail = clip.text;
    else if (skipped) detail = 'Skipped: SNR will be NOT MEASURED';
    else if (state === S.NOISE_CHECK) detail = 'Measuring the background…';
    else if (noise) detail = rms === null ? 'Digital silence' : `Background ${fixedText(rms, 1)} `
      + 'dB relative (dBFS-like)';
    else detail = `${noiseCheckS} s of background before the sweep`;
    set('noise', { complete: skipped ? preflightDone || measured : !!noise && !clip,
      blocked: !!clip, warn: skipped || w.length > 0, reasons: clip ? [clip] : w, detail });
  }
  // 4 stimulus
  {
    const b = reasonsFor(blockers, 'stimulus');
    const w = reasonsFor(warnings, 'stimulus');
    set('stimulus', { complete: (!!preflight && !b.length) || measured, blocked: b.length > 0,
      warn: w.length > 0, reasons: [...b, ...w],
      detail: st ? `${describeStimulus({ ...st, kind: st.kind || 'log-sweep' })}, `
        + `${levelName(st.level)} output, ${repeats} run${repeats === 1 ? '' : 's'}`
        : 'No stimulus chosen' });
  }
  // 5 measure
  {
    const failed = state === S.ERROR || (resultInvalid && !resultReasons.some((r) => r.code
      === 'NOISE_CLIPPING') && quality !== 'INVALID');
    let detail = 'Not started';
    if (reached(S.ARMED, S.MEASURING)) detail = runText || 'Starting…';
    else if (state === S.ANALYZING) detail = 'Analyzing the captured audio…';
    else if (measured) detail = `${result && result.runs ? result.runs.length : repeats} `
      + `run${repeats === 1 ? '' : 's'} captured`;
    else if (state === S.ABORTED) detail = 'Stopped; nothing was kept';
    if (failed) detail = state === S.ERROR ? (error && error.message) || 'Error'
      : (resultReasons[0] && resultReasons[0].text) || 'Invalid capture';
    set('measure', { complete: measured, blocked: failed,
      reasons: failed ? resultReasons.map((r) => ({ code: r.code, text: r.text })) : [], detail });
  }
  // 6 review
  {
    const invalidQ = quality === 'INVALID';
    set('review', {
      complete: state === S.COMPLETE && (saved || !!quality || !!result),
      blocked: invalidQ,
      warn: quality === 'POOR' || (state === S.COMPLETE && !quality),
      reasons: invalidQ ? resultReasons.map((r) => ({ code: r.code, text: r.text })) : [],
      detail: quality ? `Quality ${quality}` : (state === S.COMPLETE
        ? `Quality ${UNAVAILABLE.NOT_ASSESSED}` : 'Response, impulse response and quality'),
    });
  }
  // 7 save
  set('save', { complete: !!saved, detail: saved ? 'Saved as an experiment'
    : 'Save the result as an experiment (local, this browser only)' });

  // Statuses: blocked, warn (complete with warnings), done, the first open step current.
  let currentFound = false;
  let blockedSeen = false;
  const steps = FLOW_STEPS.map(({ id, label }, i) => {
    const r = raw[id];
    let status;
    if (r.blocked) {
      status = 'blocked';
      blockedSeen = true;
    } else if (r.complete) status = r.warn ? 'warn' : 'done';
    else if (!currentFound && !blockedSeen) {
      status = 'current';
      currentFound = true;
    } else status = 'todo';
    // Review becomes current only when the measurement is done.
    if (id === 'review' && status === 'current' && !measured) status = 'todo';
    return { id, n: i + 1, label, status, detail: r.detail, reasons: r.reasons };
  });
  const current = (steps.find((s) => s.status === 'current') || steps.find((s) => s.status
    === 'blocked') || null);

  return {
    steps,
    current: current ? current.id : null,
    primaryAction: primaryAction({ state, preflight, blockers, saved, expert, quality }),
    secondaryActions: secondaryActions({ state, active }),
    canBypass: !!expert,
    ready: preflightDone && blockers.length === 0,
    blockers,
    warnings,
    runText,
  };
}

function primaryAction({ state, preflight, blockers, saved, expert, quality }) {
  const a = (id, label, enabled = true, reason = null) => ({ id, label, enabled, reason });
  switch (state) {
    case S.IDLE:
      return expert ? a('measure', 'Measure (setup check runs first)')
        : a('preflight', 'Check setup');
    case S.PREFLIGHT:
    case S.NOISE_CHECK:
    case S.ARMED:
    case S.MEASURING:
    case S.ANALYZING:
      return a('stop', 'Stop (Esc)');
    case S.READY:
      return a('measure', 'Start measurement');
    case S.COMPLETE:
      return saved ? a('repeat', 'Measure again')
        : a('save', 'Save experiment', quality !== 'INVALID');
    case S.INVALID:
      return blockers.length && preflight && !preflight.ready
        ? a('preflight', 'Check setup again', true, blockers[0].text)
        : a('preflight', 'Measure again');
    case S.ABORTED:
      return a('preflight', 'Check setup');
    case S.ERROR:
      return a('acknowledge', 'Dismiss error');
    default:
      return a('preflight', 'Check setup');
  }
}

function secondaryActions({ state, active }) {
  const out = [];
  if (state === S.READY) out.push({ id: 'stop', label: 'Cancel' });
  if (state === S.COMPLETE) out.push({ id: 'repeat', label: 'Repeat (new experiment)' });
  if (!active) out.push({ id: 'expert', label: 'Expert settings' });
  return out;
}

// ----------------------------------------------------------------------------- expert fields

const field = (o) => Object.freeze({ disclosure: 'basic', unit: null, min: null, max: null,
  step: null, choices: null, help: null, readonly: false, ...o });

/**
 * expertFields({ disclosure, sampleRate }) → { groups: [{ id, label, disclosure, fields }] }
 * Progressive disclosure (§78): 'basic' shows range, duration, output level, repeats,
 * calibration and smoothing; 'advanced' adds timing, analysis, RTA/FFT settings and the
 * read-only device facts (§239: sample rate, FFT, window). Limits come from the engine,
 * stimulus, smoothing and RTA modules, never from literals here.
 */
export function expertFields({ disclosure = 'basic', sampleRate = null } = {}) {
  const fTop = sampleRate > 0 ? safeMaxFrequency(sampleRate) : 20000;
  const groups = [
    { id: 'stimulus', label: 'Stimulus', disclosure: 'basic', fields: [
      field({ id: 'f1', path: 'stimulus.f1', label: 'Start frequency', kind: 'number', unit: 'Hz',
        min: 1, max: fTop, step: 1, default: 20 }),
      field({ id: 'f2', path: 'stimulus.f2', label: 'End frequency', kind: 'number', unit: 'Hz',
        min: 1, max: fTop, step: 1, default: Math.min(20000, fTop),
        help: 'Limited to 0.95 × Nyquist of the device rate.' }),
      field({ id: 'duration', path: 'stimulus.duration', label: 'Sweep duration', kind: 'number',
        unit: 's', min: 1, max: CONTRACT_LIMITS.maxSweepS, step: 0.5, default: 10 }),
      field({ id: 'level', path: 'stimulus.level', label: 'Output level', kind: 'choice',
        choices: OUTPUT_LEVEL_CHOICES.map((c) => ({ value: c.id, label: c.label,
          detail: c.detail })), default: 'low', help: 'A digital level, not a sound level.' }),
    ] },
    { id: 'repeats', label: 'Repeats', disclosure: 'basic', fields: [
      field({ id: 'repeats', path: 'repeats', label: 'Runs', kind: 'number', min: 1,
        max: CONTRACT_LIMITS.maxRepeats, step: 1, default: 3 }),
      field({ id: 'aggregation', path: 'analysis.aggregation', label: 'Aggregation',
        kind: 'choice', choices: [{ value: 'mean', label: 'Mean (power)' },
          { value: 'median', label: 'Median' }], default: 'mean' }),
    ] },
    { id: 'calibration', label: 'Calibration', disclosure: 'basic', fields: [
      field({ id: 'frequencyCorrection', path: null, label: 'Frequency correction',
        kind: 'toggle', default: true, help: 'Applies the loaded microphone profile where it '
          + 'covers; RAW is always kept.' }),
      field({ id: 'levelCalibration', path: null, label: 'Absolute level calibration',
        kind: 'toggle', default: false, help: 'Only a stored reference calibration enables '
          + 'absolute levels; there is no default.' }),
    ] },
    { id: 'view', label: 'View', disclosure: 'basic', fields: [
      field({ id: 'smoothing', path: null, label: 'Smoothing', kind: 'choice',
        choices: SMOOTHING_FRACTIONS.map((n) => ({ value: n, label: n === 0 ? 'None'
          : `1/${n} octave` })), default: 0, help: 'A derived view; RAW is kept.' }),
      field({ id: 'normalization', path: null, label: 'Normalization', kind: 'choice',
        choices: [{ value: 'none', label: 'None' }, { value: '1k', label: '0 dB at 1 kHz' },
          { value: 'band', label: '0 dB = mean 500 Hz–2 kHz' }], default: 'none',
        help: 'Labelled NORMALIZED whenever on.' }),
    ] },
    { id: 'timing', label: 'Timing', disclosure: 'advanced', fields: [
      ...['noiseCheckS', 'preRollS', 'postRollS', 'gapS'].map((k) => field({ id: k,
        path: `analysis.${k}`, label: { noiseCheckS: 'Noise check', preRollS: 'Pre-roll',
          postRollS: 'Post-roll (tail)', gapS: 'Gap between runs' }[k], kind: 'number',
        unit: 's', min: k === 'noiseCheckS' ? 0 : TIMING_LIMITS[k][0],
        max: k === 'noiseCheckS' ? Math.min(TIMING_LIMITS[k][1], CONTRACT_LIMITS.maxNoiseS)
          : TIMING_LIMITS[k][1], step: 0.05,
        default: k === 'noiseCheckS' ? DEFAULT_NOISE_CHECK_S : DEFAULT_TIMING[k],
        disclosure: 'advanced', help: k === 'noiseCheckS' ? NOISE_CHECK_HELP : null })),
    ] },
    { id: 'analysis', label: 'Analysis', disclosure: 'advanced', fields: [
      field({ id: 'phase', path: 'analysis.phase', label: 'Phase (when alignment is robust)',
        kind: 'toggle', default: false, disclosure: 'advanced' }),
      field({ id: 'rtaMode', path: null, label: 'RTA mode', kind: 'choice',
        choices: [{ value: 'fft', label: 'FFT' }, { value: 'octave', label: 'Octave' },
          { value: 'third', label: '1/3 octave' }], default: 'third', disclosure: 'advanced' }),
      field({ id: 'fftSize', path: null, label: 'FFT size', kind: 'choice',
        choices: [4096, 8192, 16384, 32768].map((v) => ({ value: v, label: String(v) })),
        default: 8192, disclosure: 'advanced', help: 'Resolution Δf = sample rate / FFT size.' }),
      field({ id: 'window', path: null, label: 'Window', kind: 'choice',
        choices: [{ value: 'hann', label: 'Hann' },
          { value: 'blackman-harris', label: 'Blackman-Harris' }], default: 'hann',
        disclosure: 'advanced' }),
      field({ id: 'averaging', path: null, label: 'RTA averaging', kind: 'choice',
        choices: Object.keys(RTA_MODES).map((m) => ({ value: m, label: m.toUpperCase() })),
        default: 'fast', disclosure: 'advanced' }),
    ] },
    { id: 'device', label: 'Device', disclosure: 'advanced', fields: [
      field({ id: 'sampleRate', path: null, label: 'Sample rate', kind: 'readonly',
        readonly: true, unit: 'Hz', default: sampleRate || UNAVAILABLE.UNKNOWN,
        disclosure: 'advanced', help: 'The running audio context rate; the stimulus is '
          + 'rendered at it.' }),
    ] },
  ];
  const shown = disclosure === 'advanced' ? groups
    : groups.filter((g) => g.disclosure === 'basic');
  return { disclosure, groups: shown, hidden: groups.length - shown.length };
}

/** A recipe from expert field values (path-addressed), on top of `base`; never mutates. */
export function recipeFromFields(values = {}, base = CHARACTERIZE_PLAYBACK_CHAIN.recipe) {
  const r = { stimulus: { ...base.stimulus }, repeats: base.repeats,
    analysis: { ...base.analysis } };
  const all = expertFields({ disclosure: 'advanced' }).groups.flatMap((g) => g.fields);
  for (const f of all) {
    if (!f.path || !Object.hasOwn(values, f.id)) continue;
    const [head, key] = f.path.split('.');
    if (key === undefined) r[head] = values[f.id];
    else r[head][key] = values[f.id];
  }
  return r;
}
