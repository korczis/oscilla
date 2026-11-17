// Guided measurement flow, expert fields, presets, output levels and safety notes for the
// MEASURE workspace (spec §29-§30, §77-§78, §106-§108, §115, §152-§155, §208, §238). Pure.
//
//   measureFlow(ctx) -> { steps: [Step], current, primaryAction, secondaryActions, canBypass,
//     ready, blockers, warnings, runText }
//     ctx = { state (MEASUREMENT_STATES), preflight (engine preflight report | null; its
//             `recipe`, when given, is the one it checked: a setup changed since then drops
//             the report's Stimulus reasons), recipe,
//             calibration: { frequency, level } | null, result (engine result | null),
//             progress (engine.progress() | last progress event | null), saved = false,
//             expert = false, noise (engine 'noise' event | result.noise | null),
//             error ({ code, message } | null), levelChecked = true (false: calibration.level
//             waits for its input check, and the Calibration step says so) }
//     Step = { id, n, label, status: 'todo'|'current'|'done'|'blocked'|'warn', detail,
//              reasons: [{ code, text }], shown }   shown: the one step a phone shows (U104:
//              the current one, else the blocked one, else the last)
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
import { fixedText, QUANTITY_KINDS, UNAVAILABLE } from './common.js';
import { SAFE_NYQUIST_FACTOR_TEXT } from '../../core/constants.js';

// ----------------------------------------------------------------------------- output level

/**
 * Output level choices (spec §152, §208): the DIGITAL peak of the rendered stimulus
 * (engine.js MEASUREMENT_LEVELS), before the master gain. Never a sound level, never "SPL".
 */
export const OUTPUT_LEVEL_CHOICES = Object.freeze(['low', 'medium', 'high'].map((id) => {
  const value = MEASUREMENT_LEVELS[id];
  return Object.freeze({
    id,
    // The shown name (U115); the id ('low', 'medium', 'high') is the data value.
    label: { low: 'NÍZKÁ', medium: 'STŘEDNÍ', high: 'VYSOKÁ' }[id],
    value,
    detail: `digitální špička ${value} (${fixedText(20 * Math.log10(value), 1)} dBFS digitálně), `
      + 'před hlavní hlasitostí; akustická úroveň je neznámá',
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
const NOISE_CHECK_HELP = `Výchozí ${DEFAULT_NOISE_CHECK_S} s: SNR se posuzuje jen nad `
  + 'přibližně 10 / (0,1156 × délka) Hz (17 Hz pro 5 s, 87 Hz pro 1 s), takže kratší kontrola '
  + 'nechá spodní pásmo neposouzené. 0 ji vynechá (SNR nezměřeno).';

const CHARACTERIZE_RECIPE = Object.freeze({
  stimulus: Object.freeze({ kind: 'log-sweep', f1: 20, f2: 20000, duration: 10, level: 'low' }),
  repeats: 3,
  analysis: Object.freeze({ noiseCheckS: DEFAULT_NOISE_CHECK_S, preRollS: DEFAULT_TIMING.preRollS,
    postRollS: DEFAULT_TIMING.postRollS, gapS: DEFAULT_TIMING.gapS, phase: false,
    aggregation: 'mean' }),
});

/** How many times, in words: 'once', 'twice', 'three times', else '<n> times'. */
export function timesText(n) {
  return ['', 'once', 'twice', 'three times'][n] || `${n} times`;
}

export const CHARACTERIZE_PLAYBACK_CHAIN = Object.freeze({
  id: 'characterize-playback-chain',
  label: 'CHARACTERIZE PLAYBACK CHAIN',
  resultLabel: 'OBSERVED PLAYBACK / CAPTURE CHAIN RESPONSE',
  description: 'Measures the observed playback/capture chain response: a noise-floor check, '
    + `then a logarithmic sweep played and captured ${timesText(CHARACTERIZE_RECIPE.repeats)} `
    + 'and averaged. The result includes the output processing, speaker, room, microphone '
    + 'position, microphone, ADC and browser input processing; it is not the response of the '
    + 'speaker alone.',
  steps: Object.freeze(['noise', 'sweep', 'response', 'quality', 'save']),
  recipe: CHARACTERIZE_RECIPE,
});

// ----------------------------------------------------------------------------- safety, room

/** Room / distance (spec §107) and repeatability (§108) notes. */
export const ROOM_NOTES = Object.freeze([
  Object.freeze({ id: 'position', text: 'Poloha mikrofonu mění odezvu: odrazy a módy '
    + 'místnosti jsou součástí měřeného. Vzdálenost a místo si poznamenejte k experimentu.' }),
  Object.freeze({ id: 'repeat', text: 'Opakované běhy se automaticky průměrují; jejich rozptyl '
    + 'ukazuje, jak opakovatelný je výsledek.' }),
]);

const SAFETY = Object.freeze({
  conservative: 'Začněte na NÍZKÉ výstupní úrovni a zvyšujte ji jen tolik, kolik je třeba; '
    + 'měření samo nikdy nezvyšuje zisk, aby přehlušilo šum.',
  stop: 'Escape nebo Zastavit zvuk okamžitě ukončí.',
  headphones: 'Vysoká výstupní úroveň: před použitím sluchátek ji snižte.',
  lowFrequency: 'Velmi nízké frekvence mohou rozkmitat reproduktor do velké výchylky a '
    + 'zkreslení dřív, než jsou zřetelně slyšet; nezvyšujte úroveň, dokud je neuslyšíte.',
  highFrequency: 'Slabé vnímání velmi vysokých frekvencí neznamená slabý výstup; mikrofon a '
    + 'jeho kalibrace tam také mohou být slabé.',
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
  Object.freeze({ id: 'input', label: 'Vstup' }),
  Object.freeze({ id: 'calibration', label: 'Kalibrace' }),
  Object.freeze({ id: 'noise', label: 'Kontrola šumu' }),
  Object.freeze({ id: 'stimulus', label: 'Stimul' }),
  Object.freeze({ id: 'measure', label: 'Měření' }),
  Object.freeze({ id: 'review', label: 'Posouzení' }),
  Object.freeze({ id: 'save', label: 'Uložení' }),
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
  STIMULUS_NOT_PLAYED: 'stimulus', STIMULUS_NOT_HEARD: 'stimulus',
});

const INFO_ONLY = new Set(['UNCALIBRATED', 'LEVEL_RELATIVE']);

function reasonsFor(list, step) {
  return (Array.isArray(list) ? list : [])
    .filter((r) => r && (REASON_STEP[r.code] || 'measure') === step)
    .map((r) => ({ code: r.code, text: r.text, severity: r.severity || null }));
}

/** The recipe as text with its keys in order, so two equal recipes compare equal. */
function recipeKey(recipe) {
  const order = (v) => (Array.isArray(v) ? v.map(order) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, order(v[k])])) : v);
  return JSON.stringify(order(recipe));
}

function levelName(level) {
  const c = OUTPUT_LEVEL_CHOICES.find((x) => (typeof level === 'string' ? x.id : x.value)
    === level);
  return c ? c.label : (typeof level === 'number' ? `digitální špička ${level}`
    : UNAVAILABLE.UNKNOWN);
}

/**
 * measureFlow(ctx) → the guided flow (see the header). Expert mode (`expert`) may bypass the
 * guidance: the primary action can start measure() directly, which runs its own preflight.
 */
export function measureFlow(ctx = {}) {
  const {
    state = S.IDLE, preflight = null, recipe = null, calibration = null, result = null,
    progress = null, saved = false, expert = false, error = null, levelChecked = true,
  } = ctx;
  const noise = ctx.noise || (result && result.noise) || null;
  // A report whose `recipe` (the one it checked) is not the setup's any more says nothing of
  // the Stimulus step: its stimulus reasons are about a sweep the user has since corrected.
  const stale = !!(preflight && preflight.recipe && recipe)
    && recipeKey(preflight.recipe) !== recipeKey(recipe);
  const notStale = (list) => (Array.isArray(list) ? list : [])
    .filter((r) => !(stale && r && REASON_STEP[r.code] === 'stimulus'));
  const blockers = preflight ? notStale(preflight.blockers) : [];
  const warnings = preflight ? notStale(preflight.warnings) : [];
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
  const runText = run !== null ? `Běh ${run + 1}/${repeats}` : null;
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
      detail: b.length ? b[0].text : (preflight
        ? `${label || 'Vstupní zařízení (název neznámý)'}`
          + `${preflight.sampleRate ? `, ${preflight.sampleRate} Hz` : ''}`
        : 'Zatím nezkontrolováno'),
    });
  }
  // 2 calibration (optional; only invalid data blocks)
  {
    const b = reasonsFor(blockers, 'calibration');
    const freq = calibration && calibration.frequency;
    const lvl = calibration && calibration.level;
    const detail = b.length ? b[0].text : [
      freq ? `frekvenční profil „${freq.name || UNAVAILABLE.UNKNOWN}“`
        : `frekvence ${UNAVAILABLE.UNCALIBRATED}`,
      // A level calibration that waits for its input check is not CALIBRATED yet.
      lvl ? (levelChecked ? `úroveň ${QUANTITY_KINDS.CALIBRATED}`
        : 'úroveň čeká na kontrolu vstupu') : 'úroveň relativní (obdoba dBFS)',
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
    else if (skipped) detail = 'Vynecháno: SNR bude nezměřeno';
    else if (state === S.NOISE_CHECK) detail = 'Měří se pozadí…';
    else if (noise) detail = rms === null ? 'Digitální ticho' : `Pozadí ${fixedText(rms, 1)} `
      + 'dB relativně (obdoba dBFS)';
    else detail = `${noiseCheckS} s pozadí před sweepem`;
    set('noise', { complete: skipped ? preflightDone || measured : !!noise && !clip,
      blocked: !!clip, warn: skipped || w.length > 0, reasons: clip ? [clip] : w, detail });
  }
  // 4 stimulus
  {
    const b = reasonsFor(blockers, 'stimulus');
    const w = reasonsFor(warnings, 'stimulus');
    // A blocked step says why, as the input and calibration steps do (C021): the description
    // of the sweep the check refused is not the reason it refused it.
    let detail = st ? `${describeStimulus({ ...st, kind: st.kind || 'log-sweep' })}, `
      + `výstup ${levelName(st.level)}, běhy: ${repeats}`
      : 'Žádný stimul nezvolen';
    if (b.length) detail = b[0].text;
    else if (stale) detail += ' (změněno od kontroly nastavení)';
    set('stimulus', { complete: (!!preflight && !stale && !b.length) || measured,
      blocked: b.length > 0, warn: w.length > 0, reasons: [...b, ...w], detail });
  }
  // 5 measure
  {
    const failed = state === S.ERROR || (resultInvalid && !resultReasons.some((r) => r.code
      === 'NOISE_CLIPPING') && quality !== 'INVALID');
    let detail = 'Nezahájeno';
    if (reached(S.ARMED, S.MEASURING)) detail = runText || 'Spouští se…';
    else if (state === S.ANALYZING) detail = 'Analyzuje se zachycený zvuk…';
    else if (measured) detail = `Zachycené běhy: ${result && result.runs ? result.runs.length
      : repeats}`;
    else if (state === S.ABORTED) detail = 'Zastaveno; nic se neuchovalo';
    if (failed) detail = state === S.ERROR ? (error && error.message) || 'Chyba'
      : (resultReasons[0] && resultReasons[0].text) || 'Neplatný záznam';
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
      detail: quality ? `Kvalita ${quality}` : (state === S.COMPLETE
        ? `Kvalita ${UNAVAILABLE.NOT_ASSESSED}` : 'Odezva, impulsní odezva a kvalita'),
    });
  }
  // 7 save
  set('save', { complete: !!saved, detail: saved ? 'Uloženo jako experiment'
    : 'Uložte výsledek jako experiment (místně, jen v tomto prohlížeči)' });

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
  // U104: the one step a phone shows (the row folds to it below 768 px, instrument.css): the
  // current one, else the blocked one, else the last. With a blocked step or every step done
  // (saved) no step is current, and the folded row showed none, a blocked fail icon included.
  const shown = current || steps[steps.length - 1];
  for (const s of steps) s.shown = s === shown;

  return {
    steps,
    current: current ? current.id : null,
    primaryAction: primaryAction({ state, preflight, blockers, saved, expert, quality }),
    secondaryActions: secondaryActions({ state, active }),
    canBypass: !!expert,
    ready: preflightDone && !stale && blockers.length === 0,
    blockers,
    warnings,
    runText,
  };
}

function primaryAction({ state, preflight, blockers, saved, expert, quality }) {
  const a = (id, label, enabled = true, reason = null) => ({ id, label, enabled, reason });
  switch (state) {
    case S.IDLE:
      return expert ? a('measure', 'Měřit (nejdřív proběhne kontrola nastavení)')
        : a('preflight', 'Zkontrolovat nastavení');
    case S.PREFLIGHT:
    case S.NOISE_CHECK:
    case S.ARMED:
    case S.MEASURING:
    case S.ANALYZING:
      return a('stop', 'Zastavit (Esc)');
    case S.READY:
      return a('measure', 'Spustit měření');
    case S.COMPLETE:
      return saved ? a('repeat', 'Měřit znovu')
        : a('save', 'Uložit experiment', quality !== 'INVALID');
    case S.INVALID:
      return preflight && !preflight.ready
        ? a('preflight', 'Znovu zkontrolovat nastavení', true, blockers.length ? blockers[0].text
          : null)
        : a('preflight', 'Měřit znovu');
    case S.ABORTED:
      return a('preflight', 'Zkontrolovat nastavení');
    case S.ERROR:
      return a('acknowledge', 'Zavřít chybu');
    default:
      return a('preflight', 'Zkontrolovat nastavení');
  }
}

function secondaryActions({ state, active }) {
  const out = [];
  if (state === S.READY) out.push({ id: 'stop', label: 'Zrušit' });
  if (state === S.COMPLETE) out.push({ id: 'repeat', label: 'Opakovat (nový experiment)' });
  if (!active) out.push({ id: 'expert', label: 'Expertní nastavení' });
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
    { id: 'stimulus', label: 'Stimul', disclosure: 'basic', fields: [
      field({ id: 'f1', path: 'stimulus.f1', label: 'Počáteční frekvence', kind: 'number',
        unit: 'Hz', min: 1, max: fTop, step: 1, default: 20 }),
      field({ id: 'f2', path: 'stimulus.f2', label: 'Koncová frekvence', kind: 'number', unit: 'Hz',
        min: 1, max: fTop, step: 1, default: Math.min(20000, fTop),
        help: `Omezeno na ${SAFE_NYQUIST_FACTOR_TEXT} × Nyquist vzorkovací frekvence zařízení.` }),
      field({ id: 'duration', path: 'stimulus.duration', label: 'Délka sweepu', kind: 'number',
        unit: 's', min: 1, max: CONTRACT_LIMITS.maxSweepS, step: 0.5, default: 10 }),
      field({ id: 'level', path: 'stimulus.level', label: 'Výstupní úroveň', kind: 'choice',
        choices: OUTPUT_LEVEL_CHOICES.map((c) => ({ value: c.id, label: c.label,
          detail: c.detail })), default: 'low', help: 'Digitální úroveň, ne hladina zvuku.' }),
    ] },
    { id: 'repeats', label: 'Opakování', disclosure: 'basic', fields: [
      field({ id: 'repeats', path: 'repeats', label: 'Běhy', kind: 'number', min: 1,
        max: CONTRACT_LIMITS.maxRepeats, step: 1, default: 3 }),
      field({ id: 'aggregation', path: 'analysis.aggregation', label: 'Agregace',
        kind: 'choice', choices: [{ value: 'mean', label: 'Průměr (výkonový)' },
          { value: 'median', label: 'Medián' }], default: 'mean' }),
    ] },
    { id: 'calibration', label: 'Kalibrace', disclosure: 'basic', fields: [
      field({ id: 'frequencyCorrection', path: null, label: 'Frekvenční korekce',
        kind: 'toggle', default: true, help: 'Použije načtený profil mikrofonu tam, kde pokrývá; '
          + 'RAW se vždy uchová.' }),
      field({ id: 'levelCalibration', path: null, label: 'Kalibrace absolutní úrovně',
        kind: 'toggle', default: false, help: 'Absolutní úrovně umožní jen kalibrace úrovně, '
          + 'kterou uděláte podle vnější reference; drží se jen v paměti stránky (obnovení ji '
          + 'zahodí) a žádná výchozí neexistuje.' }),
    ] },
    { id: 'view', label: 'Zobrazení', disclosure: 'basic', fields: [
      field({ id: 'smoothing', path: null, label: 'Vyhlazení', kind: 'choice',
        choices: SMOOTHING_FRACTIONS.map((n) => ({ value: n, label: n === 0 ? 'Žádné'
          : `1/${n} oktávy` })), default: 0, help: 'Odvozený pohled; RAW se uchová.' }),
      field({ id: 'normalization', path: null, label: 'Normalizace', kind: 'choice',
        choices: [{ value: 'none', label: 'Žádná' }, { value: '1k', label: '0 dB na 1 kHz' },
          { value: 'band', label: '0 dB = průměr 500 Hz–2 kHz' }], default: 'none',
        help: 'Když je zapnutá, nese štítek NORMALIZED.' }),
    ] },
    { id: 'timing', label: 'Časování', disclosure: 'advanced', fields: [
      ...['noiseCheckS', 'preRollS', 'postRollS', 'gapS'].map((k) => field({ id: k,
        path: `analysis.${k}`, label: { noiseCheckS: 'Kontrola šumu', preRollS: 'Náběh',
          postRollS: 'Doběh (dozvuk)', gapS: 'Mezera mezi běhy' }[k], kind: 'number',
        unit: 's', min: k === 'noiseCheckS' ? 0 : TIMING_LIMITS[k][0],
        max: k === 'noiseCheckS' ? Math.min(TIMING_LIMITS[k][1], CONTRACT_LIMITS.maxNoiseS)
          : TIMING_LIMITS[k][1], step: 0.05,
        default: k === 'noiseCheckS' ? DEFAULT_NOISE_CHECK_S : DEFAULT_TIMING[k],
        disclosure: 'advanced', help: k === 'noiseCheckS' ? NOISE_CHECK_HELP : null })),
    ] },
    { id: 'analysis', label: 'Analýza', disclosure: 'advanced', fields: [
      field({ id: 'phase', path: 'analysis.phase', label: 'Fáze (při spolehlivém zarovnání)',
        kind: 'toggle', default: false, disclosure: 'advanced' }),
      field({ id: 'rtaMode', path: null, label: 'Režim RTA', kind: 'choice',
        choices: [{ value: 'fft', label: 'FFT' }, { value: 'octave', label: 'Oktáva' },
          { value: 'third', label: '1/3 oktávy' }], default: 'third', disclosure: 'advanced' }),
      field({ id: 'fftSize', path: null, label: 'Velikost FFT', kind: 'choice',
        choices: [4096, 8192, 16384, 32768].map((v) => ({ value: v, label: String(v) })),
        default: 8192, disclosure: 'advanced', help: 'Rozlišení Δf = vzorkovací frekvence / '
          + 'velikost FFT.' }),
      field({ id: 'window', path: null, label: 'Okno', kind: 'choice',
        choices: [{ value: 'hann', label: 'Hann' },
          { value: 'blackman-harris', label: 'Blackman-Harris' }], default: 'hann',
        disclosure: 'advanced' }),
      field({ id: 'averaging', path: null, label: 'Průměrování RTA', kind: 'choice',
        choices: Object.keys(RTA_MODES).map((m) => ({ value: m, label: m.toUpperCase() })),
        default: 'fast', disclosure: 'advanced' }),
    ] },
    { id: 'device', label: 'Zařízení', disclosure: 'advanced', fields: [
      field({ id: 'sampleRate', path: null, label: 'Vzorkovací frekvence', kind: 'readonly',
        readonly: true, unit: 'Hz', default: sampleRate || UNAVAILABLE.UNKNOWN,
        disclosure: 'advanced', help: 'Frekvence běžícího audio kontextu; stimul se vykresluje '
          + 'v ní.' }),
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
