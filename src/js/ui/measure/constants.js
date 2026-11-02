// MEASURE workspace (src/js/ui/measure.js): the constants and pure helpers every part of the
// adapter shares. No DOM, no engine, no closure state.

import {
  expertFields, CHARACTERIZE_PLAYBACK_CHAIN, OUTPUT_LEVEL_CHOICES,
} from '../../measurement/views/measure-flow.js';
import { RTA_MODE_LABELS, averagingLabel } from '../../measurement/views/rta-chart.js';
import { UNAVAILABLE } from '../../measurement/views/common.js';
import { RECIPE_WIRE_KEYS } from '../../core/url-state-measure.js';

/** Result tabs (role=tab via the shell's tab binding is not used: these are measure-local). */
export const MEASURE_RESULT_TABS = Object.freeze([
  Object.freeze({ id: 'response', label: 'Frequency response' }),
  Object.freeze({ id: 'ir', label: 'Impulse response' }),
  Object.freeze({ id: 'rta', label: 'RTA' }),
]);

/** IR zoom spans in ms re the direct peak (view only; the IR is kept whole). */
export const IR_SPANS = Object.freeze([
  Object.freeze({ id: 'direct', label: 'Direct', range: Object.freeze([-2, 20]) }),
  Object.freeze({ id: 'early', label: 'Early', range: Object.freeze([-5, 200]) }),
  Object.freeze({ id: 'full', label: 'Full', range: null }),
]);

/** RTA modes (segmented choice of the RTA tab; spec §44). */
export const RTA_MODE_CHOICES = Object.freeze(['fft', 'octave', 'third'].map((id) => Object
  .freeze({ id, label: RTA_MODE_LABELS[id] })));

/** RTA averaging (segmented choice; time constants from rta.js RTA_MODES, spec §49). */
export const RTA_AVERAGING_CHOICES = Object.freeze(['instant', 'fast', 'slow'].map((id) => Object
  .freeze({ id, label: id === 'instant' ? 'Instant' : id === 'fast' ? 'Fast' : 'Slow',
    detail: averagingLabel({ mode: id }) })));

/** Live RTA view-model rebuild interval (summary, badges, readout text); bars repaint per frame. */
export const LIVE_VIEW_INTERVAL_MS = 250;

/** Response chart quantities (phase is an expert view, m3). */
export const RESPONSE_QUANTITIES = Object.freeze([
  Object.freeze({ id: 'magnitude', label: 'Magnitude' }),
  Object.freeze({ id: 'phase', label: 'Phase' }),
]);

/** Window region shown on the IR chart (view only) when enabled, ms re the direct peak. */
export const IR_WINDOW_MS = Object.freeze([-1, 10]);

export const NORMALIZATIONS = Object.freeze({
  none: null,
  '1k': Object.freeze({ mode: 'at-frequency', hz: 1000 }),
  band: Object.freeze({ mode: 'band-mean', lo: 500, hi: 2000 }),
});

/**
 * Expert fields without a recipe path that drive the live RTA (spec §78, §239): field id →
 * meas.view key. They never change the measurement recipe.
 */
export const LIVE_RTA_FIELDS = Object.freeze({
  rtaMode: 'rtaMode', averaging: 'rtaAveraging', fftSize: 'rtaFftSize', window: 'rtaWindow',
});
export const LIVE_FIELD_HELP = 'Live RTA (RTA tab); not part of the measurement recipe.';
/**
 * A level calibration is on but no input has been checked since the input may have changed
 * (review F3 of #139): no display applies it until the setup check or a measurement confirms
 * the input it belongs to, so the indicator does not say CALIBRATED.
 */
export const LEVEL_PENDING_TEXT = 'Pending input check: the level calibration is applied only '
  + 'once the setup check or a measurement confirms the input it was taken with; until then '
  + 'levels are relative (dBFS-like).';
/** Why a level calibration cannot be stored before an input is known (ledger C1). */
export const LEVEL_NEEDS_INPUT = 'Run the setup check first: a level calibration is valid only '
  + 'for the input it was taken with, and no input has been checked yet, so a reading typed now '
  + 'could not be bound to one.';

/**
 * Why a level calibration made in one context does not apply in the other (ledger W7f): its
 * input was named there, and no check here can show that it is the input in use now. It is
 * kept across the transition (owner decision of 2026-10-11) and applies again in its own
 * context once its input is checked there.
 */
export const LEVEL_FROM_TEST_CONTEXT = 'UNCALIBRATED: the level calibration was made in TEST '
  + 'CONTEXT (digital loopback, no microphone), so it does not apply to a microphone input. '
  + 'It is kept for TEST CONTEXT; calibrate again for this input.';
export const LEVEL_FROM_MICROPHONE = 'UNCALIBRATED: the level calibration was taken with a '
  + 'microphone input, so it does not apply in TEST CONTEXT (digital loopback, no microphone). '
  + 'It is kept, and applies again once that input is checked after leaving TEST CONTEXT.';
/** What a level reading typed by hand in TEST CONTEXT says of itself (ledger W7c). */
export const MANUAL_TEST_CONTEXT_LABEL = 'TEST CONTEXT: reading typed by hand while the page '
  + 'was in TEST CONTEXT (digital loopback, no microphone checked).';

export const FIELD_DEFAULTS = (() => {
  const out = {};
  for (const g of expertFields({ disclosure: 'advanced' }).groups) {
    for (const f of g.fields) {
      if (f.path || Object.hasOwn(LIVE_RTA_FIELDS, f.id)) out[f.id] = f.default;
    }
  }
  // The preset is the starting point (its recipe overrides the generic field defaults).
  const r = CHARACTERIZE_PLAYBACK_CHAIN.recipe;
  Object.assign(out, { f1: r.stimulus.f1, f2: r.stimulus.f2, duration: r.stimulus.duration,
    level: r.stimulus.level, repeats: r.repeats, aggregation: r.analysis.aggregation,
    noiseCheckS: r.analysis.noiseCheckS, preRollS: r.analysis.preRollS,
    postRollS: r.analysis.postRollS, gapS: r.analysis.gapS, phase: r.analysis.phase });
  return Object.freeze(out);
})();

/** The setup values a recipe link carries (field id → value), see url-state-measure.js. */
export const RECIPE_FIELD_IDS = Object.freeze(Object.values(RECIPE_WIRE_KEYS));
export function recipeValues(values) {
  const out = {};
  for (const id of RECIPE_FIELD_IDS) if (Object.hasOwn(values, id)) out[id] = values[id];
  return out;
}

export function randomBytes16() {
  const b = new Uint8Array(16);
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** A plain, JSON-safe copy (Alpine state never holds engine objects or typed arrays). */
export const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

export function levelId(level) {
  if (typeof level === 'string') return level;
  const c = OUTPUT_LEVEL_CHOICES.find((x) => x.value === level);
  return c ? c.id : null;
}

export function calText(cal) {
  const f = cal.profile;
  return f ? `${f.name}` : UNAVAILABLE.UNCALIBRATED;
}
