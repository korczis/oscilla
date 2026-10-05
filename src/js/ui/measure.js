// MEASURE workspace: the DOM/Alpine adapter over the V3 measurement layer (spec §29-§36,
// §72-§78, §106-§112, §115-§118, §150-§158; docs/v3/ui-integration.md). Composed into the ONE
// OSCILLA component by main.js (Object.defineProperties, never spread).
//
// This layer renders view models; it computes no level, mask, range or label. Engine events go
// through the pure reducers of src/js/measurement/views (quality-bar, announcements) and the
// result through the pure view builders (measure-flow, response-chart, ir-chart, rta-chart);
// the charts (src/js/charts/measure-charts.js) draw those descriptors with the existing uPlot
// conventions. The measurement engine, its io, the result with its typed arrays, the
// calibration objects and the chart instances live in the closure `ctx`, never in Alpine's
// reactive state (rule project.audio-engine-discipline: Alpine never wraps engine objects).
//
// Output exclusivity (spec §74): while a measurement is in progress the instrument cannot play
// (main.js refuses engine.play and notifies), and starting a measurement stops the instrument,
// the sequencer and every voice. Escape and STOP abort through engine.abort (§111); page hide
// aborts through the capture io's own pagehide/visibility handling and main.js (§169); leaving
// the MEASURE workspace aborts a measurement in progress.
//
// Live RTA (spec §44-§49, §122-§123, §150; docs/v3/ui-integration.md "Live RTA"): the RTA tab
// starts a live analysis of the input on request. It opens the input through the capture io's
// own permission path (capture.js openLiveTap: one AnalyserNode on the measurement input),
// reads the analyser's time-domain samples with the V2 reader (analysis/analyser.js) on the
// shared frame loop, and computes the spectrum with measurement/live-rta.js (the spectrum.js
// mean-square scale of every band level). Per frame it only pushes samples and repaints the
// chart (no allocation, no Alpine write); the view model (summary, badges, readout text) is
// rebuilt LIVE_VIEW_INTERVAL_MS apart. Leaving the RTA tab or the workspace, Escape, page hide
// and starting a setup check or measurement stop it and release the tracks and nodes; it
// cannot start while a measurement is in progress (exclusive input). Live RTA is feedback:
// nothing of it is stored.
//
// TEST CONTEXT (§146, §249): `?measure=loopback` (or OSCILLA.measure.useLoopback()) replaces
// the microphone with capture.js createLoopbackIo, a known synthetic digital system. The
// workspace then says so in a banner and in every saved experiment; it is never presented as a
// measurement of a physical system.
//
// Level calibration (M3 of the V3 review): the dialog measures the reference itself — "Capture
// reference" records REFERENCE_CAPTURE_S seconds through the SAME capture io as a measurement
// (io.captureNoise, stimulus-free) and reads the one-third-octave band level at the reference
// frequency on the MEASURE mean-square scale (calibration/reference.js), names that scale, and
// stores the capture's input (hashed deviceId, sample rate, applied processing) with the
// LevelCalibration. The capture is abortable (Stop, Cancel, Escape, leaving the workspace) and
// releases the input afterwards. Typing the reading is an advanced option labelled with the
// same scale. A calibration whose input differs from the current one (latest preflight, result
// or reference capture) is not applied: the indicator reads UNCALIBRATED and says why.
//
// Frequency profiles (M4): the import states the sign convention and a one-point preview; when
// the file's header does not state it (correction / gain / EQ / cal), a dialog requires the
// explicit choice before the profile is loaded (calibration/parse.js).
//
// View options never fail a measurement (M6): a normalization whose reference lies outside the
// result's grid is disabled for that result (the selection resets to None), and a view that
// still cannot be built is reported as a note, never as "Measurement failed".
//
// Profile export (V315): the loaded frequency profile exports as CSV or JSON
// (calibration/export.js); both files are deterministic and parse back to the same profile id.
//
// Input device (V322, spec §29 step 1): after the microphone permission (setup check, live RTA,
// reference capture) the inputs are listed with enumerateDevices (views/input-devices.js) and
// refreshed on 'devicechange'. The default input stays the default (no deviceId). A chosen
// input is passed to createCaptureIo as deviceId (getUserMedia deviceId { exact }); the io is
// re-created for it at the next capture, and the experiment records it hashed
// (constraints.requested.deviceId). A chosen input that disappears stays selected, marked
// "not available", with a readable message and an assertive announcement; nothing switches
// microphones silently.
//
// Recipe link (V355, spec §102): "Copy recipe link" writes the setup's recipe into the URL hash
// (`mr`, core/url-state-measure.js; recipe only, never results, calibration or device) next to
// the instrument's own hash state. A link read at load or on hashchange is validated like every
// import and refused whole when anything is wrong; a valid one fills the setup and opens
// MEASURE, and never starts a check or a measurement.
//
// Definitions (ADR 0043): measureLoadDefinition fills the setup from a definition version's
// recipe and keeps that version's run reference. A measurement records it only when the setup
// it starts with is exactly that recipe (definition.js setupRecipe, compared canonically) and
// the recipe that ran is what the version asks for (measure-experiment.js); otherwise the run
// carries the definition derived from its own recipe, and the panel and a notification say so.
// The reference is taken when the measurement starts: a later edit of the setup never moves
// the run to another definition. A Studio run (measureRunRecipe) never takes it. A derived
// reference (a saved run's own recipe) is not kept loaded: only its recipe fills the setup.
//
// Saving is idempotent per result: the experiment id and timestamp are chosen once for a
// result (saveKey), so a retry after a failed save writes the same record (a no-op when the first
// write was stored) and never a second copy of one run.

import { MEASUREMENT_STATES as S, isActiveState } from '../measurement/state-machine.js';
import {
  createMeasurementEngine, assessMeasurement, mapError, MEASUREMENT_ERRORS, MEASUREMENT_LEVELS,
  NOISE_FFT,
} from '../measurement/engine.js';
import {
  createLiveRta, LIVE_RTA_FFT_SIZES, LIVE_RTA_WINDOWS,
} from '../measurement/live-rta.js';
import { createAnalyserReader } from '../analysis/analyser.js';
import { onFrame } from '../charts/frame-loop.js';
import { hasMicrophoneApi, MIC_UNAVAILABLE_TEXT } from '../audio/microphone.js';
import { createCaptureIo, createLoopbackIo, LOOPBACK_LABEL } from '../measurement/capture.js';
import { bandCenters, createRtaAverager, rtaResult } from '../measurement/rta.js';
import {
  measureFlow, expertFields, recipeFromFields, CHARACTERIZE_PLAYBACK_CHAIN, OUTPUT_LEVEL_CHOICES,
  safetyNotes, ROOM_NOTES,
} from '../measurement/views/measure-flow.js';
import {
  initialQualityBar, reduceQualityBar, qualityBarView, qualityPanel,
} from '../measurement/views/quality-bar.js';
import { initialAnnouncements, reduceAnnouncements } from '../measurement/views/announcements.js';
import {
  buildResponseView, buildPhaseView, normalizationAvailability, responseSource,
} from '../measurement/views/response-chart.js';
import { buildIrView } from '../measurement/views/ir-chart.js';
import { buildRtaView, RTA_MODE_LABELS, averagingLabel } from '../measurement/views/rta-chart.js';
import { UNAVAILABLE } from '../measurement/views/common.js';
import { parseCalibrationText, MAX_IMPORT_BYTES } from '../calibration/parse.js';
import { coverage as profileCoverage } from '../calibration/interpolate.js';
import { PROFILE_CONVENTIONS } from '../calibration/profile.js';
import {
  createLevelCalibration, isValidLevelCalibration, levelCalibrationApplies, LEVEL_LIMITS,
  LEVEL_SCALE,
} from '../calibration/level.js';
import { measureReferenceLevel, REFERENCE_CAPTURE_S } from '../calibration/reference.js';
import { newExperimentId, describeStimulus } from '../experiments/schema.js';
import { setupRecipe } from '../experiments/definition.js';
import { canonicalJson } from '../experiments/canonical-json.js';
import { definitionText } from '../measurement/views/experiment-summary.js';
import { experimentFromResult, experimentTestContext } from './measure-experiment.js';
import { formatHz } from '../charts/axes.js';
import { createResponseChart, createIrChart, createRtaChart } from '../charts/measure-charts.js';
import { readFileText, downloadBlob } from './exporters.js';
import { exportProfileFile } from '../calibration/export.js';
import { inputDeviceView } from '../measurement/views/input-devices.js';
import {
  encodeRecipeLink, decodeRecipeLink, recipeParamOf, withRecipeParam, RECIPE_WIRE_KEYS,
} from '../core/url-state-measure.js';
import { withoutStudioParams } from '../core/url-state-studio.js';

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
const LIVE_FIELD_HELP = 'Live RTA (RTA tab); not part of the measurement recipe.';

const FIELD_DEFAULTS = (() => {
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
const RECIPE_FIELD_IDS = Object.freeze(Object.values(RECIPE_WIRE_KEYS));
function recipeValues(values) {
  const out = {};
  for (const id of RECIPE_FIELD_IDS) if (Object.hasOwn(values, id)) out[id] = values[id];
  return out;
}

function randomBytes16() {
  const b = new Uint8Array(16);
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** A plain, JSON-safe copy (Alpine state never holds engine objects or typed arrays). */
const plain = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

function levelId(level) {
  if (typeof level === 'string') return level;
  const c = OUTPUT_LEVEL_CHOICES.find((x) => x.value === level);
  return c ? c.id : null;
}

function calText(cal) {
  const f = cal.profile;
  return f ? `${f.name}` : UNAVAILABLE.UNCALIBRATED;
}

/**
 * createMeasureUi(svc) → the MEASURE part of the component.
 * svc: { engine (AudioEngine), stopPlayback(cmp) (instrument, sequencer, voices),
 *        loopback: boolean (TEST CONTEXT from the URL) }
 */
export function createMeasureUi(svc) {
  const ctx = {
    cmp: null,
    me: null,              // measurement engine
    io: null,
    ioKind: null,          // 'microphone' | 'loopback'
    loopback: !!svc.loopback,
    loopbackSystem: { type: 'biquad', filter: 'lowpass', frequency: 1000, Q: Math.SQRT1_2 },
    result: null,          // last engine result (COMPLETE or INVALID)
    shown: null,           // what the result panel shows: { kind: 'result'|'experiment', src }
    preflight: null,
    noise: null,
    progress: null,
    error: null,
    bar: initialQualityBar(),
    said: initialAnnouncements(),
    profile: null,         // FrequencyProfile
    levelCal: null,        // LevelCalibration
    calibrationObj: null,  // the object identity the engine compares between preflight/measure
    repeatOf: null,
    charts: { response: null, ir: null, rta: null },
    rta: null,             // { averager, bands, power, sampleRate } (stored noise-check bands)
    rtaView: null,
    live: null,            // { token, tap, rta (live-rta.js), reader, lastAt, nextViewAt, off }
    liveStarting: false,
    liveToken: 0,
    pending: null,         // the running measure()/preflight() promise
    lastRecipe: null,
    onStateHook: null,     // test seam only (onceInState)
    inputNow: null,        // the current input { device, constraints, sampleRate } (binding check)
    reference: null,       // { reading, input, referenceHz, testContext } of the last capture
    refCapture: null,      // the running reference capture { io } (abortable)
    pendingImport: null,   // { text, fileName } of a profile waiting for its sign convention
    deviceId: null,        // the chosen input (raw deviceId, page only); null = default input
    deviceLabel: null,     // its label as listed, for the "not available" message
    ioDeviceId: null,      // the deviceId the current capture io was created with
    devices: [],           // the last enumerateDevices() result (plain { kind, deviceId, label })
    devicesEnumerated: false,
    lastRecipeParam: null, // the `mr` hash value last applied or written (V355)
    definition: null,      // the loaded definition version's run reference (ADR 0043)
    saveKey: null,         // { result, id, now }: one id and timestamp per result (idempotent)
    runDefinition: null,   // the reference the running / last measurement started with
  };

  /** Is `recipe` (a setup recipe) exactly what the loaded definition version asks for? */
  function setupIsDefinition(recipe) {
    if (!ctx.definition) return false;
    try {
      return canonicalJson(setupRecipe(recipe)) === canonicalJson(ctx.definition.execution
        .recipe);
    } catch (e) {
      return false;
    }
  }

  /** The level calibration's applicability to the current input (level.js). */
  function levelApplies() {
    return levelCalibrationApplies(ctx.levelCal, ctx.inputNow);
  }

  /** The level calibration to display levels with: on, valid and taken with this input (M3). */
  function levelInUse(m) {
    return m.cal.useLevel && isValidLevelCalibration(ctx.levelCal) && levelApplies().applies
      ? ctx.levelCal : null;
  }

  function announce(message) {
    const m = ctx.cmp.meas.live;
    const key = message.politeness === 'assertive' ? 'assertive' : 'polite';
    // Re-announce the same words: clear first, then set on the next task.
    m[key] = '';
    setTimeout(() => { m[key] = message.text; }, 30);
  }

  function calibrationInput() {
    const cmp = ctx.cmp;
    const frequency = cmp.meas.cal.useFrequency && ctx.profile ? ctx.profile : null;
    const level = cmp.meas.cal.useLevel && isValidLevelCalibration(ctx.levelCal)
      && levelApplies().applies ? ctx.levelCal : null;
    const prev = ctx.calibrationObj;
    if (prev && prev.frequency === frequency && prev.level === level) return prev;
    ctx.calibrationObj = frequency || level ? { frequency, level } : null;
    if (!ctx.calibrationObj) ctx.calibrationObj = { frequency: null, level: null };
    return ctx.calibrationObj;
  }

  function recipeNow() {
    return recipeFromFields(ctx.cmp.meas.values);
  }

  function onEvent(e) {
    const cmp = ctx.cmp;
    if (!cmp) return;
    ctx.bar = reduceQualityBar(ctx.bar, e);
    const a = reduceAnnouncements(ctx.said, e);
    ctx.said = a.state;
    if (a.message) announce(a.message);
    switch (e.type) {
      case 'preflight':
        ctx.preflight = { ready: e.ready, warnings: e.warnings, blockers: e.blockers,
          facts: e.facts, sampleRate: e.sampleRate };
        if (e.facts && e.facts.input && e.facts.input.ok) {
          ctx.inputNow = { device: e.facts.input.device, constraints: e.facts.input.constraints,
            sampleRate: e.sampleRate };
          inputOpened(e.facts.input.device);
        }
        break;
      case 'noise':
        ctx.noise = { rmsDb: e.rmsDb, peak: e.peak, reasons: e.reasons };
        break;
      case 'progress':
        ctx.progress = { phase: e.phase, run: e.run, overall: e.overall };
        break;
      case 'error':
        ctx.error = { code: e.code, message: e.message };
        break;
      case 'state':
        if (e.to === S.PREFLIGHT && (e.from === S.IDLE || [S.COMPLETE, S.INVALID, S.ABORTED]
          .includes(e.from))) {
          ctx.preflight = null;
          ctx.noise = null;
          ctx.progress = null;
          ctx.error = null;
        }
        break;
      default:
        break;
    }
    refresh({ lite: e.type === 'progress' });
    if (ctx.onStateHook && e.type === 'state') ctx.onStateHook(e.to);
  }

  function ensureEngine() {
    // A newly chosen input takes effect here: the io is re-created for it when nothing runs.
    if (ctx.me && ctx.ioKind === 'microphone' && ctx.ioDeviceId !== ctx.deviceId
      && !isActiveState(ctx.me.state)) disposeEngine();
    if (ctx.me) return ctx.me;
    const kind = ctx.loopback ? 'loopback' : 'microphone';
    ctx.io = kind === 'loopback'
      ? createLoopbackIo({ engine: svc.engine, system: ctx.loopbackSystem })
      : createCaptureIo({ engine: svc.engine, deviceId: ctx.deviceId });
    ctx.ioDeviceId = kind === 'microphone' ? ctx.deviceId : null;
    ctx.ioKind = kind;
    ctx.me = createMeasurementEngine({ io: ctx.io, assess: assessMeasurement, onEvent });
    return ctx.me;
  }

  function disposeEngine() {
    if (ctx.me) ctx.me.dispose();
    ctx.me = null;
    ctx.io = null;
    ctx.ioKind = null;
  }

  // ---------------------------------------------------------------- input device (V322)
  function mediaDevices() {
    try {
      const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
      return md && typeof md.enumerateDevices === 'function' ? md : null;
    } catch (e) {
      return null;
    }
  }

  function renderInputs() {
    const cmp = ctx.cmp;
    if (!cmp) return;
    const v = inputDeviceView({ devices: ctx.devices, selectedId: ctx.deviceId,
      selectedLabel: ctx.deviceLabel, enumerated: ctx.devicesEnumerated, loopback: ctx.loopback,
      available: !!mediaDevices() });
    cmp.meas.input = { options: v.options, selected: v.selected, missing: v.missing,
      message: v.message, status: v.status, disabled: v.disabled };
  }

  /** List the inputs (after the permission); announce a chosen input that disappeared. */
  async function refreshInputs() {
    const md = mediaDevices();
    if (!md || !ctx.cmp) {
      renderInputs();
      return false;
    }
    let list;
    try {
      list = await md.enumerateDevices();
    } catch (e) {
      renderInputs();
      return false;
    }
    ctx.devices = Array.from(list || [], (d) => ({ kind: d.kind, deviceId: d.deviceId,
      label: d.label }));
    ctx.devicesEnumerated = true;
    const wasMissing = !!ctx.cmp.meas.input.missing;
    renderInputs();
    const m = ctx.cmp.meas.input;
    if (m.missing && !wasMissing) announce({ politeness: 'assertive', text: m.message });
    return true;
  }

  /** The microphone was opened (permission granted): the list can be read now. */
  function inputOpened(device) {
    if (ctx.ioKind !== 'microphone') return;
    if (ctx.deviceId && device && device.label) ctx.deviceLabel = device.label;
    refreshInputs();
  }

  function selectInput(cmp, raw) {
    const value = typeof raw === 'string' ? raw : '';
    if (ctx.loopback) return false;
    if (value === (ctx.deviceId || '')) return true;
    if (cmp.meas.busy || ctx.refCapture || ctx.pending) {
      cmp.notify('warning', 'Input not changed', 'A measurement or a reference capture is using '
        + 'the input; stop it before choosing another input.');
      renderInputs(); // the select shows the input still in use
      return false;
    }
    const opt = cmp.meas.input.options.find((o) => o.value === value);
    if (!opt) {
      renderInputs();
      return false;
    }
    stopLive(); // the live RTA listens to the previous input
    if (ctx.me && ctx.me.state === S.READY) ctx.me.reset(); // releases the checked input
    ctx.deviceId = value || null;
    ctx.deviceLabel = value ? opt.label.replace(/ — not available$/, '') : null;
    ctx.inputNow = null; // a level calibration is checked against the new input first (M3)
    ctx.preflight = null;
    renderInputs();
    refresh();
    announce({ politeness: 'polite', text: `Input: ${value ? ctx.deviceLabel
      : 'default input'}. Run the setup check for this input.` });
    return true;
  }

  // ---------------------------------------------------------------- view refresh
  function inputFacts() {
    const p = ctx.preflight;
    const f = p && p.facts ? p.facts : null;
    const rows = [];
    const label = f && f.input && f.input.device ? f.input.device.label : null;
    rows.push({ id: 'device', label: 'Input', text: f ? (label || (ctx.ioKind === 'loopback'
      ? 'TEST CONTEXT loopback (no device)' : 'Device label not exposed by the browser'))
      : UNAVAILABLE.UNKNOWN });
    rows.push({ id: 'rate', label: 'Sample rate', text: p && p.sampleRate ? `${p.sampleRate} Hz`
      : UNAVAILABLE.UNKNOWN });
    const applied = f && f.input && f.input.constraints ? f.input.constraints.applied : null;
    const proc = (k) => (applied && typeof applied[k] === 'boolean' ? (applied[k] ? 'on' : 'off')
      : UNAVAILABLE.UNKNOWN);
    rows.push({ id: 'processing', label: 'Echo / noise / AGC', text: f ? (ctx.ioKind === 'loopback'
      ? 'not applicable (loopback)' : `${proc('echoCancellation')} / ${proc('noiseSuppression')}`
        + ` / ${proc('autoGainControl')}`) : UNAVAILABLE.UNKNOWN });
    rows.push({ id: 'capture', label: 'Capture', text: f && f.worklet ? (f.worklet.supported
      ? (f.worklet.mode === 'audioworklet' ? 'AudioWorklet' : 'ScriptProcessor (fallback)')
      : 'unsupported') : UNAVAILABLE.UNKNOWN });
    return rows;
  }

  function refresh({ lite = false } = {}) {
    const cmp = ctx.cmp;
    if (!cmp) return;
    const m = cmp.meas;
    const state = ctx.me ? ctx.me.state : S.IDLE;
    m.state = state;
    m.active = isActiveState(state);
    m.busy = m.active && state !== S.READY;
    const recipe = recipeNow();
    m.flow = plain(measureFlow({
      state, preflight: ctx.preflight, recipe, calibration: calibrationInput(),
      result: ctx.result && ctx.result.state ? { state: ctx.result.state,
        reasons: ctx.result.reasons, runs: ctx.result.runs, quality: ctx.result.quality,
        preflight: ctx.result.preflight, noise: ctx.result.noise } : null,
      progress: ctx.progress, saved: m.saved, expert: m.expert, noise: ctx.noise,
      error: ctx.error,
    }));
    m.bar = plain(qualityBarView(ctx.bar));
    const p = ctx.progress;
    m.progressPct = p && m.busy && Number.isFinite(p.overall) ? Math.floor(p.overall * 100) : null;
    m.runText = m.flow.runText;
    if (lite) return;
    m.inputRows = inputFacts();
    const lv = ctx.levelCal ? levelApplies() : null;
    m.cal.levelVoid = lv && !lv.applies && lv.checked ? lv.reason : null;
    m.safety = safetyNotes({ recipe, preflight: ctx.preflight });
    m.stimulusText = describeStimulus({ ...recipe.stimulus, kind: 'log-sweep' });
    m.error = ctx.error ? { ...ctx.error } : null;
    if (m.definition) m.definition.differs = !setupIsDefinition(recipe);
  }

  // ---------------------------------------------------------------- result presentation
  function shownSource() {
    return ctx.shown ? ctx.shown.src : null;
  }

  function hasResponse(src) {
    return !!src && !!(src.transfer || (src.results && (src.results.transfer
      || src.results.aggregate)));
  }

  /** Which normalizations the shown result can use (M6); plain for Alpine. */
  function normalizationOptions(src) {
    const out = {};
    let f = null;
    try {
      const s = hasResponse(src) ? responseSource(src, { useCalibration: false }) : null;
      f = s ? s.frequencies : null;
    } catch (e) {
      f = null;
    }
    for (const [id, spec] of Object.entries(NORMALIZATIONS)) {
      const a = f ? normalizationAvailability(f, spec) : { ok: spec === null, reason: null };
      out[id] = { ok: a.ok, reason: a.reason };
    }
    return out;
  }

  /** A new result or experiment: a normalization it cannot use resets to None (M6). */
  function resetInvalidViewOptions(src) {
    const m = ctx.cmp.meas;
    m.normAvail = normalizationOptions(src);
    const sel = m.normAvail[m.view.normalization];
    if (sel && !sel.ok) m.view.normalization = 'none';
  }

  function rebuildResponse() {
    const cmp = ctx.cmp;
    const m = cmp.meas;
    const src = shownSource();
    const phase = m.expert && m.view.quantity === 'phase';
    let view = null;
    let magnitude = null;
    if (hasResponse(src)) {
      magnitude = buildResponseView(src, {
        smoothing: m.view.smoothing,
        normalization: NORMALIZATIONS[m.view.normalization] || null,
        useCalibration: true,
        showEnvelope: true,
        profile: ctx.profile,
        levelCalibration: levelInUse(m),
      });
      view = phase ? buildPhaseView(src) : magnitude;
    }
    m.response = view ? {
      quantity: phase ? 'phase' : 'magnitude',
      summary: view.summary,
      badges: view.badges.slice(),
      notes: view.notes.slice(),
      quality: { text: view.quality.text, className: view.quality.className,
        icon: view.quality.icon, shape: view.quality.shape, severity: view.quality.severity },
      yLabel: `${view.axes.y.label} (${view.axes.y.unit})`,
      legend: view.series.filter((d) => !/^envelope-/.test(d.id) && !/-unreliable$/.test(d.id))
        .map((d) => ({ id: d.id, label: d.label, role: d.role, faded: d.alpha < 1 })),
      envelope: view.bands && view.bands.length ? view.bands[0].label : null,
      authoritative: magnitude ? magnitude.authoritative : true,
      phase: magnitude ? { available: magnitude.phase.available, text: magnitude.phase.text }
        : null,
    } : null;
    if (ctx.charts.response) ctx.charts.response.setView(view);
    return view;
  }

  function rebuildIr() {
    const cmp = ctx.cmp;
    const m = cmp.meas;
    const src = shownSource();
    const ir = src ? (src.ir || (src.results && src.results.ir) || null) : null;
    const span = IR_SPANS.find((s) => s.id === m.view.irSpan) || IR_SPANS[1];
    let view = null;
    if (ir) {
      // The view slices the visible span before decimating (M7), so every span change
      // rebuilds it; "Full" is the whole response (first to last sample).
      view = buildIrView(ir, { scale: m.view.irScale, normalize: m.view.irNormalize,
        window: m.view.irWindow ? IR_WINDOW_MS : null,
        range: span.range ? [span.range[0], span.range[1]] : 'full' });
    }
    m.ir = view ? { summary: view.summary, badges: view.badges.slice(), notes: view.notes.slice(),
      yLabel: `${view.axes.y.label}`, window: view.windowRegion ? view.windowRegion.label : null }
      : null;
    if (ctx.charts.ir) ctx.charts.ir.setView(view);
    return view;
  }

  function noiseRta(result) {
    const n = result && result.noise;
    if (!n || !n.bands || !Array.isArray(n.bands.levelsDb)) return null;
    const sr = result.sampleRate || (result.preflight && result.preflight.sampleRate);
    if (!(sr > 0)) return null;
    const bands = bandCenters('third', 20, 20000, sr);
    if (bands.length !== n.bands.levelsDb.length) return null;
    const levelsDb = Float64Array.from(n.bands.levelsDb);
    return { sampleRate: sr, binHz: sr / NOISE_FFT, rta: rtaResult({ sampleRate: sr,
      resolution: 'third', bands, levelsDb, fftSize: NOISE_FFT, window: 'hann' }) };
  }

  function liveSourceText(kind) {
    return kind === 'loopback'
      ? 'LIVE · TEST CONTEXT loopback input (the output chain through the synthetic system)'
      : 'LIVE · microphone input (feedback only, not stored)';
  }

  function liveCalibration(m) {
    // V383: a level calibration bound to an input applies to the live RTA only once the input
    // has been checked: the live tap reports no device facts, and with no input known
    // levelCalibrationApplies() cannot tell mic B from the mic A it was taken with.
    const level = levelInUse(m);
    const unchecked = level && level.input && !ctx.inputNow;
    return { profile: m.cal.useFrequency && ctx.profile ? ctx.profile : null,
      levelCalibration: unchecked ? null : level };
  }

  function rebuildLiveRta(m, L) {
    const cal = liveCalibration(m);
    if (cal.profile !== L.rta.profile || cal.levelCalibration !== L.rta.levelCalibration) {
      L.rta.setCalibration(cal); // restarts the analysis (and unfreezes it)
    }
    m.rtaFrozen = L.rta.frozen;
    const view = buildRtaView({ ...L.rta.viewInput(), fixedRange: true });
    m.rta = view ? { summary: view.summary, badges: view.badges.slice(),
      notes: view.notes.slice(), yLabel: `${view.axes.y.label} (${view.axes.y.unit})`,
      mode: RTA_MODE_LABELS[view.mode], source: liveSourceText(L.kind), live: true } : null;
    const chart = ctx.charts.rta;
    if (chart) {
      chart.setLive(L.rta.frame, { showPeaks: m.view.rtaPeakHold });
      chart.updateView(view);
    }
    return view;
  }

  function rebuildRta() {
    const cmp = ctx.cmp;
    const m = cmp.meas;
    if (ctx.live) return rebuildLiveRta(m, ctx.live);
    let view = null;
    const st = ctx.rta;
    if (st && st.last) {
      // A stored snapshot, never LIVE: the noise check's Welch average (engine summarizeNoise);
      // peak hold spans successive noise checks.
      view = buildRtaView({
        rta: { resolution: 'third', bands: st.bands, levelsDb: st.last.levelsDb },
        peakDb: m.view.rtaPeakHold && st.last.peakDb ? st.last.peakDb : null,
        frozen: st.averager.frozen,
        snapshotLabel: 'NOISE CHECK SNAPSHOT',
        averaging: { text: 'Welch average of the whole noise check (Hann, 50 % overlap); peak '
          + 'hold across successive noise checks' },
        binHz: st.binHz,
        levelCalibration: levelInUse(m),
      });
    }
    m.rta = view ? { summary: view.summary, badges: view.badges.slice(), notes: view.notes.slice(),
      yLabel: `${view.axes.y.label} (${view.axes.y.unit})`, mode: RTA_MODE_LABELS[view.mode],
      source: 'Background (noise check), one-third-octave band power', live: false } : null;
    if (ctx.charts.rta) {
      ctx.charts.rta.setLive(null);
      ctx.charts.rta.setView(view);
    }
    return view;
  }

  // ---------------------------------------------------------------- live RTA
  function liveTick(now) {
    const L = ctx.live;
    if (!L) return;
    const dt = L.lastAt === null ? 0 : Math.max(0, (now - L.lastAt) / 1000);
    L.lastAt = now;
    if (!L.rta.frozen) L.rta.push(L.reader.readTime(now), dt);
    if (ctx.charts.rta) ctx.charts.rta.redraw();
    if (now >= L.nextViewAt) {
      L.nextViewAt = now + LIVE_VIEW_INTERVAL_MS;
      rebuildRta();
    }
  }

  function endLive(L) {
    ctx.live = null;
    if (L.off) L.off();
    const m = ctx.cmp.meas;
    m.rtaLive.running = false;
    m.rtaLive.kind = null;
    m.rtaFrozen = ctx.rta ? ctx.rta.averager.frozen : false;
    announce({ politeness: 'polite', text: 'Live RTA stopped' });
    rebuildRta();
  }

  /** The io closed the tap by itself (page hide, track ended, a measurement, dispose). */
  function liveClosed(token, reason) {
    const L = ctx.live;
    if (!L || L.token !== token || L.closing) return; // stopLive() is already cleaning up
    endLive(L);
    if (reason === 'track-ended') {
      ctx.cmp.meas.rtaLive.error = 'Live RTA stopped: the input device was disconnected or '
        + 'stopped.';
    }
  }

  /** Stop the live RTA (or its pending start); true when something was stopped. */
  function stopLive() {
    let stopped = false;
    if (ctx.liveStarting) {
      ctx.liveToken += 1; // the pending start sees a stale token and closes what it opened
      ctx.liveStarting = false;
      if (ctx.cmp) ctx.cmp.meas.rtaLive.starting = false;
      if (ctx.io) ctx.io.cancel();
      stopped = true;
    }
    const L = ctx.live;
    if (!L) return stopped;
    L.closing = true;
    try { L.tap.close(); } catch (e) { /* already released */ }
    endLive(L);
    return true;
  }

  function liveAnalysis(m, sampleRate) {
    return createLiveRta({ sampleRate, fftSize: m.view.rtaFftSize, window: m.view.rtaWindow,
      mode: m.view.rtaMode, averaging: m.view.rtaAveraging, ...liveCalibration(m) });
  }

  /** A new frame length or window: resize the tap's analyser, restart the analysis. */
  function reconfigureLive(m) {
    const L = ctx.live;
    if (!L) return;
    if (L.tap.analyser.fftSize !== m.view.rtaFftSize) L.tap.analyser.fftSize = m.view.rtaFftSize;
    L.rta = liveAnalysis(m, L.rta.sampleRate); // the reader follows the analyser's fftSize
    L.lastAt = null;
    m.rtaFrozen = false;
    rebuildRta();
  }

  async function startLive(cmp) {
    const m = cmp.meas;
    if (ctx.live || ctx.liveStarting || !m.rtaLive.available) return false;
    m.rtaLive.error = null;
    if (m.busy) {
      m.rtaLive.error = MEASUREMENT_ERRORS.BUSY;
      return false;
    }
    const me = ensureEngine();
    if (me.state === S.READY) me.reset(); // a checked setup keeps the input open: release it
    svc.engine.init(); // in the user gesture (autoplay policy)
    const token = ++ctx.liveToken;
    ctx.liveStarting = true;
    m.rtaLive.starting = true;
    const kind = ctx.ioKind;
    try {
      const tap = await ctx.io.openLiveTap({ fftSize: m.view.rtaFftSize,
        onClosed: (reason) => liveClosed(token, reason) });
      if (token !== ctx.liveToken) {
        tap.close();
        return false;
      }
      const rta = liveAnalysis(m, tap.sampleRate);
      const L = { token, tap, rta, kind, lastAt: null, nextViewAt: 0, off: null, closing: false,
        reader: createAnalyserReader(tap.analyser, { sampleRate: tap.sampleRate }) };
      ctx.live = L;
      m.rtaLive.running = true;
      m.rtaLive.kind = kind;
      m.rtaFrozen = false;
      announce({ politeness: 'polite', text: 'Live RTA started' });
      rebuildRta();
      L.off = onFrame(liveTick);
      inputOpened(null);
      return true;
    } catch (e) {
      if (token === ctx.liveToken) {
        const err = mapError(e, 'NO_INPUT');
        if (err.code !== 'ABORTED') m.rtaLive.error = err.message;
      }
      return false;
    } finally {
      if (token === ctx.liveToken) {
        ctx.liveStarting = false;
        m.rtaLive.starting = false;
      }
    }
  }

  function updateRtaFrame() {
    const st = ctx.rta;
    if (!st) return;
    // The averager returns the same buffers; keep a copy for the view (frozen keeps the last).
    const res = st.averager.push(st.lastPower, 0);
    st.last = { levelsDb: Float64Array.from(res.levelsDb),
      peakDb: res.peakDb ? Float64Array.from(res.peakDb) : null };
  }

  function acceptResultForRta(result) {
    const r = noiseRta(result);
    if (!r) return;
    const n = r.rta.bands.length;
    if (!ctx.rta || ctx.rta.size !== n) {
      ctx.rta = { size: n,
        averager: createRtaAverager({ mode: 'instant', peakHold: true, size: n }),
        bands: r.rta.bands, sampleRate: r.sampleRate, binHz: r.binHz, last: null,
        lastPower: null };
    }
    ctx.rta.lastPower = Float64Array.from(r.rta.levelsDb, (db) => (db > -300 ? 10 ** (db / 10)
      : 0));
    updateRtaFrame();
  }
  /** One view; a view that cannot be built is a note, never a failed measurement (M6). */
  function safely(name, fn) {
    try {
      return fn();
    } catch (e) {
      console.error(`OSCILLA ${name} view:`, e);
      const m = ctx.cmp.meas;
      const note = `The ${name} view could not be drawn with these view options (${e.message
        || e}); the measurement itself is kept.`;
      const key = name === 'impulse response' ? 'ir' : name === 'RTA' ? 'rta' : 'response';
      m[key] = { summary: note, badges: [], notes: [note], yLabel: '', legend: [], envelope: null,
        authoritative: false, quality: null, phase: null, mode: '', source: '', window: null };
      const c = ctx.charts[key];
      if (c) c.setView(null);
      return null;
    }
  }

  function rebuildAll() {
    safely('frequency response', rebuildResponse);
    safely('impulse response', rebuildIr);
    safely('RTA', rebuildRta);
    const cmp = ctx.cmp;
    const src = shownSource();
    const q = src ? src.quality || null : null;
    cmp.meas.quality = plain(qualityPanel(q));
    cmp.meas.shownKind = ctx.shown ? ctx.shown.kind : null;
    cmp.meas.shownTitle = ctx.shown ? ctx.shown.title : null;
    cmp.meas.testContext = ctx.shown && ctx.shown.testContext ? ctx.shown.testContext : null;
  }

  function showResult(result) {
    ctx.result = result;
    if (result && result.input && (result.input.device || result.input.constraints)) {
      ctx.inputNow = { device: result.input.device, constraints: result.input.constraints,
        sampleRate: result.sampleRate };
    }
    if (result && (result.transfer || result.ir)) {
      const tc = result.testContext ? result.testContext.label || LOOPBACK_LABEL : null;
      ctx.shown = { kind: 'result', src: result, title: tc ? 'TEST CONTEXT result' : 'Latest '
        + 'measurement', testContext: tc };
    } else if (result && result.state === S.INVALID) {
      ctx.shown = null;
    }
    try {
      acceptResultForRta(result);
    } catch (e) {
      console.error('OSCILLA RTA from the noise check:', e);
    }
    if (ctx.cmp) resetInvalidViewOptions(shownSource());
    rebuildAll();
  }

  // ---------------------------------------------------------------- experiment building
  function experimentOf(result, cmp) {
    const m = cmp.meas;
    // The level calibration is saved only when it applies to the input of THIS result.
    const resultInput = result.input ? { device: result.input.device,
      constraints: result.input.constraints, sampleRate: result.sampleRate } : null;
    const level = m.cal.useLevel && levelCalibrationApplies(ctx.levelCal, resultInput).applies
      ? ctx.levelCal : null;
    const st = ctx.lastRecipe && ctx.lastRecipe.stimulus;
    if (!ctx.saveKey || ctx.saveKey.result !== result) {
      ctx.saveKey = { result, id: newExperimentId(randomBytes16()), now: Date.now() };
    }
    return experimentFromResult(result, {
      now: ctx.saveKey.now, id: ctx.saveKey.id, build: svc.build,
      name: m.name, notes: m.notes, profile: ctx.profile,
      levelCalibration: level, repeatOf: ctx.repeatOf,
      requested: st ? { f1: Number(st.f1), f2: Number(st.f2) } : null,
      definition: ctx.runDefinition,
    });
  }

  // ---------------------------------------------------------------- level reference capture
  function referenceSummary(r, referenceHz) {
    const db = (v) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} dB`;
    return {
      ok: r.ok,
      referenceHz,
      observedDb: r.ok ? r.observedDbRelative : null,
      text: r.ok ? `Reading ${db(r.observedDbRelative)} relative, ${r.band.nominal} Hz `
        + `one-third-octave band (${(100 * r.bandFraction).toFixed(0)} % of the captured power, `
        + `${r.durationS.toFixed(1)} s at ${r.sampleRate} Hz)` : null,
      errors: r.errors.slice(),
      warnings: r.warnings.slice(),
    };
  }

  async function captureReference(cmp) {
    const f = cmp.meas.levelForm;
    if (ctx.refCapture) return false;
    if (ctx.me && isActiveState(ctx.me.state) && ctx.me.state !== S.READY) {
      f.error = 'A measurement is running; stop it before capturing the reference.';
      return false;
    }
    const referenceHz = Number(f.referenceHz);
    if (!(referenceHz >= LEVEL_LIMITS.minReferenceHz && referenceHz <= LEVEL_LIMITS.maxReferenceHz)) {
      f.error = `The reference frequency must be ${LEVEL_LIMITS.minReferenceHz}–`
        + `${LEVEL_LIMITS.maxReferenceHz} Hz.`;
      return false;
    }
    stopLive(); // the live RTA shares the capture io and its input
    ensureEngine();
    if (ctx.me.state === S.READY) ctx.me.reset(); // the reference capture owns the input now
    svc.engine.init();
    // A microphone reference must not hear the instrument; the loopback TEST CONTEXT captures
    // the instrument's own output, which is its only possible reference.
    if (ctx.ioKind !== 'loopback') svc.stopPlayback(cmp);
    const io = ctx.io;
    ctx.refCapture = { io };
    ctx.reference = null;
    f.capturing = true;
    f.error = '';
    f.reading = null;
    try {
      const cap = await io.captureNoise(REFERENCE_CAPTURE_S, {});
      const r = measureReferenceLevel(cap, { referenceHz });
      ctx.reference = { reading: r, referenceHz,
        input: { device: cap.device || null, constraints: cap.constraints || null,
          sampleRate: cap.sampleRate }, testContext: cap.testContext || null };
      ctx.inputNow = ctx.reference.input;
      inputOpened(cap.device || null);
      f.reading = referenceSummary(r, referenceHz);
      if (!r.ok) f.error = r.errors.join(' ');
      return r.ok;
    } catch (e) {
      const aborted = e && (e.code === 'ABORTED' || e.name === 'AbortError');
      f.error = aborted ? 'Reference capture stopped; nothing was stored.'
        : `Reference capture failed: ${e && e.message ? e.message : String(e)}`;
      return false;
    } finally {
      try { io.cancel('reference-done'); } catch (err) { /* already released */ }
      ctx.refCapture = null;
      f.capturing = false;
      refresh();
    }
  }

  function abortReference() {
    if (!ctx.refCapture) return false;
    try { ctx.refCapture.io.cancel('user'); } catch (e) { /* released */ }
    return true;
  }

  // ---------------------------------------------------------------- frequency profile import
  function loadProfile(cmp, r) {
    ctx.profile = r.profile;
    ctx.pendingImport = null;
    cmp.meas.calImport = null;
    const cov = profileCoverage(r.profile);
    cmp.meas.cal.errors = [];
    cmp.meas.cal.warnings = r.warnings.slice(0, 5).map((x) => (x.line ? `line ${x.line}: `
      : '') + x.text);
    cmp.meas.cal.profile = { name: r.profile.name, id: r.profile.id, points:
      r.profile.points.length, coverageText: cov ? `${formatHz(cov[0])}–${formatHz(cov[1])}`
        : UNAVAILABLE.UNKNOWN, convention: r.profile.convention,
      conventionText: PROFILE_CONVENTIONS[r.profile.convention].label,
      conventionBasis: r.convention ? r.convention.text : null,
      preview: r.preview ? r.preview.text : null };
    cmp.meas.cal.useFrequency = true;
    if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
    refresh();
    rebuildAll();
    cmp.notify('success', 'Frequency profile loaded', `"${r.profile.name}", `
      + `${r.profile.points.length} points; applied only inside ${cmp.meas.cal.profile
        .coverageText} (no extrapolation). Sign: ${cmp.meas.cal.profile.conventionText}. `
      + `${r.preview ? r.preview.text : ''}`);
    return true;
  }

  // ---------------------------------------------------------------- actions
  async function runPreflight(cmp) {
    stopLive(); // exclusive input: the live RTA never runs beside a capture
    const me = ensureEngine();
    if (ctx.me.state !== S.IDLE && !isActiveState(ctx.me.state)) me.reset();
    svc.engine.init();
    ctx.result = null;
    ctx.shown = null;
    cmp.meas.saved = false;
    cmp.meas.savedId = null;
    rebuildAll();
    try {
      ctx.pending = me.preflight(recipeNow(), { calibration: calibrationInput() });
      await ctx.pending;
    } catch (e) {
      if (!(e && e.code === 'ABORTED')) {
        cmp.notify('error', 'Setup check failed', e.message || String(e));
      }
    } finally {
      ctx.pending = null;
      refresh();
    }
  }

  /** True when the level calibration in use is bound to an input this session has not seen. */
  function levelNeedsInputCheck(cmp) {
    return cmp.meas.cal.useLevel && isValidLevelCalibration(ctx.levelCal)
      && ctx.levelCal.input && !ctx.inputNow;
  }

  /** Run one measurement of `given` (Studio, V424) or of the setup fields; resolves the result. */
  async function runMeasure(cmp, given = null, startAt = null) {
    stopLive();
    const me = ensureEngine();
    svc.engine.init();
    svc.stopPlayback(cmp);
    if ([S.COMPLETE, S.INVALID, S.ABORTED].includes(me.state)) me.reset();
    cmp.meas.saved = false;
    cmp.meas.savedId = null;
    ctx.result = null;
    if (ctx.shown && ctx.shown.kind === 'result') ctx.shown = null;
    rebuildAll();
    const recipe = given || recipeNow();
    ctx.lastRecipe = recipe;
    ctx.runDefinition = !given && setupIsDefinition(recipe) ? ctx.definition : null;
    if (!given && ctx.definition && !ctx.runDefinition) {
      cmp.notify('warning', 'Not run from the definition', 'The setup differs from the loaded '
        + 'definition, so this run records the definition derived from its own recipe.');
    }
    let result = null;
    try {
      // A bound level calibration is checked against the input before it is applied: without
      // a known current input, the setup check opens it first (M3).
      if (levelNeedsInputCheck(cmp) && me.state !== S.READY) {
        ctx.pending = me.preflight(recipe, { calibration: calibrationInput() });
        await ctx.pending;
      }
      ctx.pending = me.measure(recipe, { calibration: calibrationInput(), startAt });
      result = await ctx.pending;
    } catch (e) {
      if (!(e && e.code === 'ABORTED')) {
        cmp.notify('error', 'Measurement failed', e.message || String(e));
      }
    } finally {
      ctx.pending = null;
      refresh();
    }
    // Presenting the result is outside the measurement: a view problem never fails it (M6).
    if (result) {
      showResult(result);
      refresh();
    }
    return result;
  }

  return {
    MEASURE_RESULT_TABS,
    IR_SPANS,
    RTA_MODE_CHOICES,
    RTA_AVERAGING_CHOICES,
    OUTPUT_LEVEL_CHOICES,
    ROOM_NOTES,
    CHARACTERIZE_PLAYBACK_CHAIN,
    LEVEL_LIMITS,
    LEVEL_SCALE,
    RESPONSE_QUANTITIES,
    REFERENCE_CAPTURE_S,
    PROFILE_CONVENTIONS,
    meas: {
      state: S.IDLE,
      active: false,
      busy: false,
      expert: false,
      values: { ...FIELD_DEFAULTS },
      flow: plain(measureFlow({ state: S.IDLE, recipe: recipeFromFields(FIELD_DEFAULTS) })),
      bar: plain(qualityBarView(initialQualityBar())),
      quality: plain(qualityPanel(null)),
      progressPct: null,
      runText: null,
      inputRows: [],
      safety: safetyNotes({ recipe: recipeFromFields(FIELD_DEFAULTS) }),
      stimulusText: describeStimulus({ ...recipeFromFields(FIELD_DEFAULTS).stimulus,
        kind: 'log-sweep' }),
      live: { polite: '', assertive: '' },
      tab: 'response',
      view: { smoothing: 0, normalization: 'none', irScale: 'linear', irNormalize: false,
        irWindow: false, irSpan: 'early', rtaPeakHold: false,
        rtaMode: FIELD_DEFAULTS.rtaMode, rtaAveraging: FIELD_DEFAULTS.averaging,
        rtaFftSize: FIELD_DEFAULTS.fftSize, rtaWindow: FIELD_DEFAULTS.window,
        quantity: 'magnitude' },
      normAvail: { none: { ok: true, reason: null }, '1k': { ok: true, reason: null },
        band: { ok: true, reason: null } },
      rtaLive: { running: false, starting: false, error: null, kind: null,
        available: !!svc.loopback || hasMicrophoneApi(typeof navigator !== 'undefined'
          ? navigator : null), unavailableText: MIC_UNAVAILABLE_TEXT },
      response: null,
      ir: null,
      rta: null,
      shownKind: null,
      shownTitle: null,
      testContext: null,
      loopback: !!svc.loopback,
      cal: { useFrequency: true, useLevel: false, profile: null, level: null, errors: [],
        warnings: [], levelVoid: null },
      levelForm: { referenceHz: '1000', referenceDb: '94', observedDb: '', conditions: '',
        error: '', manual: false, capturing: false, reading: null },
      calImport: null,
      input: { options: [], selected: '', missing: false, message: null, status: '',
        disabled: true },
      recipeLink: '',
      recipeLinkErrors: [],
      definition: null,      // { text, conditions, differs } of the loaded definition
      name: '',
      notes: '',
      saved: false,
      savedId: null,
      saving: false,
      error: null,
      setupOpen: false,
      readout: null,
      rtaFrozen: false,
    },

    // ------------------------------------------------------------------ derived
    get measureExpertGroups() {
      return expertFields({ disclosure: this.meas.expert ? 'advanced' : 'basic',
        sampleRate: ctx.preflight ? ctx.preflight.sampleRate : null }).groups
        .filter((g) => g.id !== 'calibration' && g.id !== 'view')
        // The output level has its own LOW / MEDIUM / HIGH control in the Stimulus panel.
        // RTA mode, FFT size, window and averaging drive the live RTA (no recipe path).
        .map((g) => ({ ...g, fields: g.fields.filter((f) => f.id !== 'level')
          .map((f) => (Object.hasOwn(LIVE_RTA_FIELDS, f.id) ? { ...f, live: true,
            help: LIVE_FIELD_HELP } : f)) }));
    },
    get measureCalIndicator() {
      if (!(this.meas.cal.useLevel && this.meas.cal.level)) return 'UNCALIBRATED';
      // meas.cal.levelVoid makes this getter reactive to the input check (refresh()).
      return this.meas.cal.levelVoid || !levelApplies().applies ? 'UNCALIBRATED' : 'CALIBRATED';
    },
    get measureFreqIndicator() {
      return this.meas.cal.useFrequency && this.meas.cal.profile ? 'CALIBRATED' : 'UNCALIBRATED';
    },
    get measureLevelId() { return levelId(this.meas.values.level); },
    get measurePrimary() { return this.meas.flow.primaryAction; },
    get measureCanStop() { return this.meas.active; },

    // ------------------------------------------------------------------ lifecycle
    measureInit() {
      ctx.cmp = this;
      renderInputs();
      refresh();
      const md = mediaDevices();
      if (md && typeof md.addEventListener === 'function') {
        md.addEventListener('devicechange', () => { if (ctx.devicesEnumerated) refreshInputs(); });
      }
      if (typeof window !== 'undefined' && window.location) {
        this.measureApplyRecipeHash(window.location.hash, { origin: 'load' });
        window.addEventListener('hashchange', () => this.measureApplyRecipeHash(window.location
          .hash, { origin: 'hashchange' }));
      }
    },
    /** Mount the charts once the view exists (main.js, after the labs). */
    measureMountCharts(root) {
      const host = (id) => root.querySelector(`#${id}`);
      const onReadout = (key) => (lines) => { this.meas.readout = { key, lines: lines || null }; };
      try {
        ctx.charts.response = createResponseChart(host('osc-measure-chart-response'),
          { onReadout: onReadout('response') });
        ctx.charts.ir = createIrChart(host('osc-measure-chart-ir'));
        ctx.charts.rta = createRtaChart(host('osc-measure-chart-rta'),
          { onReadout: onReadout('rta') });
      } catch (e) {
        console.error('OSCILLA measure charts failed:', e);
      }
      rebuildAll();
    },
    measureRefreshCharts() {
      for (const c of Object.values(ctx.charts)) if (c) c.refreshTheme();
    },
    /** The visible result chart after a layout change (it may have been hidden). */
    measureRelayout() {
      const c = ctx.charts[this.meas.tab];
      if (c) c.relayout();
    },
    /** True while a measurement owns the output (main.js refuses instrument playback). */
    measureOwnsOutput() {
      return !!ctx.me && isActiveState(ctx.me.state) && ctx.me.state !== S.READY;
    },
    /**
     * Abort from Escape, page hide or leaving the workspace (a measurement and the live RTA);
     * false when nothing ran.
     */
    measureAbort(reason = 'user') {
      const live = stopLive();
      const ref = abortReference();
      if (!ctx.me || !isActiveState(ctx.me.state)) return live || ref;
      const ok = ctx.me.abort(reason);
      refresh();
      return ok;
    },

    // ------------------------------------------------------------------ flow actions
    async measureRunPrimary() {
      const a = this.meas.flow.primaryAction;
      if (!a || !a.enabled) return;
      switch (a.id) {
        case 'preflight': await runPreflight(this); break;
        case 'measure': await runMeasure(this); break;
        case 'stop': this.measureAbort('user'); break;
        case 'save': await this.measureSave(); break;
        case 'repeat': await this.measureRepeat(); break;
        case 'acknowledge':
          if (ctx.me) ctx.me.reset();
          ctx.error = null;
          refresh();
          break;
        default: break;
      }
    },
    async measureRunSecondary(id) {
      if (id === 'stop') this.measureAbort('user');
      else if (id === 'repeat') await this.measureRepeat();
      else if (id === 'expert') this.measureSetExpert(!this.meas.expert);
    },
    measureStop() {
      this.measureAbort('user');
    },
    /**
     * Studio hook (V3.1 plan V424, docs/v31/timeline.md "Measurement clips"): run `recipe` (a
     * Studio topology's, studio/provenance.js recipeFromStudio) through THIS workspace's
     * MeasurementEngine (the same io, calibration, state machine, abort paths and output
     * exclusivity as MEASURE) and save it as measureSave does, with `decorate` (the Studio
     * provenance block) applied to the experiment, its first capture not before `startAt` (the
     * clip's audio-clock time). Resolves { ok, state, experimentId, name, experiment, reason };
     * never rejects.
     */
    async measureRunRecipe(recipe, { decorate = null, startAt = null } = {}) {
      if (this.measureOwnsOutput() || ctx.pending) {
        return { ok: false, state: ctx.me ? ctx.me.state : S.IDLE,
          reason: 'A measurement is already in progress.' };
      }
      let result = null;
      try {
        result = await runMeasure(this, recipe, startAt);
      } catch (e) {
        return { ok: false, state: ctx.me ? ctx.me.state : S.IDLE, reason: e.message || String(e) };
      }
      const state = result ? result.state : (ctx.me ? ctx.me.state : S.IDLE);
      if (!result || state !== S.COMPLETE) {
        const why = result && Array.isArray(result.reasons) ? result.reasons
          .filter((x) => x.severity !== 'ok').map((x) => x.text).slice(0, 2).join(' ') : '';
        return { ok: false, state, reason: why || (ctx.error ? ctx.error.message : state) };
      }
      let saved = null;
      const id = await this.measureSave({ decorate: (e) => {
        saved = decorate ? decorate(e) : e;
        return saved;
      } });
      return id ? { ok: true, state, experimentId: id, name: saved.name, experiment: saved }
        : { ok: false, state, reason: 'The experiment was not saved.' };
    },
    async measureStart() {
      await runMeasure(this);
    },
    async measureCheck() {
      await runPreflight(this);
    },
    /** REPEAT (§104): the same recipe again; the saved result is a NEW experiment. */
    async measureRepeat() {
      if (this.meas.savedId) ctx.repeatOf = this.meas.savedId;
      await runMeasure(this);
    },
    measureSetExpert(on) {
      this.meas.expert = !!on;
      if (!this.meas.expert && this.meas.view.quantity !== 'magnitude') {
        this.meas.view.quantity = 'magnitude';
        safely('frequency response', rebuildResponse);
      }
      refresh();
    },
    measureSetValue(id, raw, kind) {
      if (Object.hasOwn(LIVE_RTA_FIELDS, id)) {
        this.measureSetView(LIVE_RTA_FIELDS[id], id === 'fftSize' ? Number(raw) : raw);
        return;
      }
      let v = raw;
      if (kind === 'number') {
        v = Number(raw);
        if (!Number.isFinite(v)) return;
      } else if (kind === 'toggle') v = !!raw;
      this.meas.values[id] = v;
      // A changed recipe invalidates a READY preflight (the engine compares the recipe).
      if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
      refresh();
    },
    measureSetLevel(id) {
      if (!Object.hasOwn(MEASUREMENT_LEVELS, id)) return;
      this.measureSetValue('level', id, 'choice');
    },
    measureLevelKeydown(e) { this.rovingKeydown(e); },
    /** Choose the measurement input ('' = the default input), V322. */
    measureSelectInput(id) {
      return selectInput(this, id);
    },
    /** Re-read the input list (after the permission was granted). */
    async measureRefreshInputs() {
      return refreshInputs();
    },

    // ------------------------------------------------------------------ recipe link (V355)
    /** The setup's recipe as the `mr` hash value (a recipe only: never results). */
    measureRecipeParam() {
      return encodeRecipeLink(recipeValues(this.meas.values));
    },
    /** This page's URL with the recipe in its hash (other hash parameters kept). */
    measureRecipeUrl() {
      const loc = typeof window !== 'undefined' ? window.location : null;
      if (!loc) return null;
      // A recipe link opens MEASURE: the Studio deep-link keys (V422) are not carried along.
      return `${loc.href.split('#')[0]}#${withRecipeParam(withoutStudioParams(loc.hash),
        this.measureRecipeParam())}`;
    },
    /** Put the recipe link in the address bar and on the clipboard (dialog when unavailable). */
    async measureCopyRecipeLink() {
      const url = this.measureRecipeUrl();
      if (!url) return null;
      ctx.lastRecipeParam = this.measureRecipeParam(); // our own link is not one to apply
      try { window.history.replaceState(null, '', url); } catch (e) { /* file:// in some */ }
      this.meas.recipeLink = url;
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext !== false) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch (e) {
        copied = false;
      }
      if (copied) {
        this.notify('success', 'Recipe link copied', 'The link loads this measurement recipe '
          + '(sweep, level, runs, timing); it carries no result, calibration or input device and '
          + 'never starts a measurement.');
      } else this.openModal('osc-dlg-recipe-link');
      return url;
    },
    /**
     * Apply a recipe link from a location hash (V355): validated like every import, refused
     * whole when invalid, never starts anything. Returns true (applied), false (refused) or
     * null (no recipe in the hash, or the one already applied).
     */
    measureApplyRecipeHash(hash, { origin = 'link' } = {}) {
      const param = recipeParamOf(hash);
      if (param === null) {
        ctx.lastRecipeParam = null;
        return null;
      }
      if (param === ctx.lastRecipeParam) return null;
      ctx.lastRecipeParam = param;
      const r = decodeRecipeLink(param, { defaults: recipeValues(FIELD_DEFAULTS) });
      if (!r.ok) {
        this.meas.recipeLinkErrors = r.errors.slice(0, 5);
        this.notify('warning', 'Recipe link not applied', `${r.errors.slice(0, 3).join('; ')}. `
          + 'The measurement setup is unchanged.');
        return false;
      }
      if (this.meas.busy || ctx.refCapture) {
        this.meas.recipeLinkErrors = ['a measurement is running'];
        this.notify('warning', 'Recipe link not applied', 'A measurement is running; stop it and '
          + 'open the link again.');
        ctx.lastRecipeParam = null;
        return false;
      }
      Object.assign(this.meas.values, r.values);
      this.meas.recipeLinkErrors = [];
      ctx.repeatOf = null;
      this.meas.saved = false;
      this.meas.savedId = null;
      if (ctx.me && ctx.me.state === S.READY) ctx.me.reset(); // the recipe changed
      refresh();
      if (origin === 'load') this.workspace = 'measure';
      else if (this.workspace !== 'measure') this.setWorkspace('measure');
      this.notify('info', 'Measurement recipe loaded from the link', `${this.meas.stimulusText}, `
        + `${this.meas.values.repeats} run(s). Nothing runs until you press Check setup or Start `
        + 'measurement.');
      return true;
    },
    measureSetTab(tab) {
      if (!MEASURE_RESULT_TABS.some((t) => t.id === tab)) return;
      if (tab !== 'rta') stopLive(); // the live RTA runs only while it is seen
      this.meas.tab = tab;
      this.meas.readout = null;
      this.$nextTick(() => {
        const c = ctx.charts[tab];
        if (c) c.relayout();
      });
    },
    measureSetView(key, value) {
      if (key === 'rtaMode' && !RTA_MODE_CHOICES.some((c) => c.id === value)) return false;
      if (key === 'rtaAveraging' && !RTA_AVERAGING_CHOICES.some((c) => c.id === value)) {
        return false;
      }
      if (key === 'rtaFftSize' && !LIVE_RTA_FFT_SIZES.includes(value)) return false;
      if (key === 'rtaWindow' && !LIVE_RTA_WINDOWS.includes(value)) return false;
      if (key === 'normalization') {
        const a = this.meas.normAvail[value];
        if (!Object.hasOwn(NORMALIZATIONS, value) || (a && !a.ok)) return false;
      }
      if (key === 'quantity' && !RESPONSE_QUANTITIES.some((q) => q.id === value)) return false;
      this.meas.view[key] = value;
      const field = Object.keys(LIVE_RTA_FIELDS).find((f) => LIVE_RTA_FIELDS[f] === key);
      if (field) this.meas.values[field] = value; // the expert field shows the same choice
      const L = ctx.live;
      if (L && key === 'rtaMode') L.rta.setMode(value);
      if (L && key === 'rtaAveraging') L.rta.setAveraging(value);
      if (L && (key === 'rtaMode' || key === 'rtaAveraging')) this.meas.rtaFrozen = false;
      if (L && (key === 'rtaFftSize' || key === 'rtaWindow')) {
        reconfigureLive(this.meas);
        return true;
      }
      if (['smoothing', 'normalization', 'quantity'].includes(key)) {
        safely('frequency response', rebuildResponse);
      } else if (key.startsWith('ir')) safely('impulse response', rebuildIr);
      else if (key.startsWith('rta')) safely('RTA', rebuildRta);
      return true;
    },
    /** Start or stop the live RTA (the RTA tab's button). */
    async measureRtaLiveToggle() {
      if (ctx.live || ctx.liveStarting) {
        stopLive();
        return false;
      }
      return startLive(this);
    },
    measureRtaFreeze() {
      const L = ctx.live;
      if (L) {
        if (L.rta.frozen) L.rta.unfreeze();
        else L.rta.freeze();
        this.meas.rtaFrozen = L.rta.frozen;
        rebuildRta();
        return;
      }
      const st = ctx.rta;
      if (!st) return;
      if (st.averager.frozen) st.averager.unfreeze();
      else st.averager.freeze();
      this.meas.rtaFrozen = st.averager.frozen;
      rebuildRta();
    },
    measureRtaReset() {
      const L = ctx.live;
      if (L) {
        L.rta.resetPeaks();
        rebuildRta();
        return;
      }
      const st = ctx.rta;
      if (!st) return;
      st.averager.reset();
      if (st.lastPower) updateRtaFrame();
      rebuildRta();
    },

    // ------------------------------------------------------------------ calibration
    measureImportCalibrationClick() {
      const input = document.getElementById('osc-measure-cal-file');
      if (input) { input.value = ''; input.click(); }
    },
    async measureImportCalibrationFile(e) {
      const file = e && e.target && e.target.files && e.target.files[0];
      if (!file) return false;
      try {
        // m6: the size is checked before the file is read (1 MiB calibration limit).
        const text = await readFileText(file, { maxBytes: MAX_IMPORT_BYTES,
          what: `"${file.name}"` });
        return this.measureImportCalibrationText(text, file.name);
      } catch (err) {
        this.meas.cal.errors = [err.message || String(err)];
        this.notify('error', 'Calibration not imported', err.message || String(err));
        return false;
      }
    },
    /**
     * Parse a CSV/TXT or JSON frequency profile (calibration/parse.js); never extrapolated.
     * Returns true (loaded), false (rejected) or 'needs-choice' when the file does not state
     * its sign convention: the convention dialog then asks for it (M4). opts.convention is an
     * explicit choice ('deviation' | 'correction').
     */
    measureImportCalibrationText(text, fileName = 'profile', { convention } = {}) {
      const name = String(fileName).replace(/\.[^.]+$/, '');
      const r = parseCalibrationText(text, { name, importedAt: new Date().toISOString(),
        convention });
      if (!r.ok) {
        this.meas.cal.errors = r.errors.slice(0, 5).map((x) => (x.line ? `line ${x.line}: `
          : '') + x.text);
        this.notify('error', 'Calibration not imported', this.meas.cal.errors.join(' '));
        return false;
      }
      if (r.needsConvention) {
        ctx.pendingImport = { text, fileName };
        this.meas.calImport = { name, basis: r.convention.text, choice: null,
          options: Object.values(PROFILE_CONVENTIONS).map((c) => ({ id: c.id, label: c.label,
            preview: r.previews[c.id] ? r.previews[c.id].text : null })) };
        this.openModal('osc-dlg-cal-convention');
        return 'needs-choice';
      }
      return loadProfile(this, r);
    },
    /** The explicit sign convention of the pending import (M4); loads the profile. */
    measureConfirmCalibrationConvention(choice = this.meas.calImport && this.meas.calImport.choice) {
      const p = ctx.pendingImport;
      if (!p || !Object.hasOwn(PROFILE_CONVENTIONS, choice)) return false;
      const ok = this.measureImportCalibrationText(p.text, p.fileName, { convention: choice });
      if (ok === true) this.closeModal('osc-dlg-cal-convention');
      return ok === true;
    },
    measureCancelCalibrationImport() {
      ctx.pendingImport = null;
      this.meas.calImport = null;
      this.closeModal('osc-dlg-cal-convention');
    },
    /** Export the loaded frequency profile as 'csv' or 'json' (V315); returns the text. */
    measureExportCalibration(format) {
      if (!ctx.profile) return null;
      try {
        const f = exportProfileFile(ctx.profile, format);
        downloadBlob(new Blob([f.text], { type: f.type }), f.fileName);
        this.notify('success', 'Frequency profile exported', `${f.fileName}: ${ctx.profile.points
          .length} points, sign convention ${ctx.profile.convention}; it imports back unchanged.`);
        return f.text;
      } catch (err) {
        this.notify('error', 'Profile not exported', err.message || String(err));
        return null;
      }
    },
    measureClearCalibration() {
      ctx.profile = null;
      this.meas.cal.profile = null;
      if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
      refresh();
      rebuildAll();
    },
    measureToggleCalibration(key) {
      this.meas.cal[key] = !this.meas.cal[key];
      if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
      refresh();
      rebuildAll();
    },
    measureOpenLevelCalibration() {
      this.meas.levelForm.error = '';
      this.openModal('osc-dlg-level-cal');
    },
    /** Capture the reference reading through the measurement input (M3). */
    async measureCaptureLevelReference() {
      return captureReference(this);
    },
    /** Stop a running reference capture (nothing is stored). */
    measureAbortLevelReference() {
      return abortReference();
    },
    measureCloseLevelCalibration() {
      abortReference();
      this.closeModal('osc-dlg-level-cal');
    },
    measureSetLevelManual(on) {
      this.meas.levelForm.manual = !!on;
      this.meas.levelForm.error = '';
    },
    /**
     * Absolute level calibration (§23): an explicit external reference; no default exists. The
     * reading is the captured one (method 'captured', bound to the capture's input) unless the
     * advanced manual entry is on (method 'manual', bound to the current input when known); both
     * are on LEVEL_SCALE.
     */
    measureSaveLevelCalibration() {
      const f = this.meas.levelForm;
      try {
        const referenceHz = Number(f.referenceHz);
        let observed;
        let input;
        let method;
        let conditions = f.conditions;
        if (f.manual) {
          observed = Number(f.observedDb === '' ? NaN : f.observedDb);
          input = ctx.inputNow;
          method = 'manual';
        } else {
          const ref = ctx.reference;
          if (!ref || !ref.reading.ok) {
            throw new Error('Capture the reference first (or enter the reading by hand under '
              + 'Advanced).');
          }
          if (ref.referenceHz !== referenceHz) {
            throw new Error(`The reference was captured at ${ref.referenceHz} Hz; capture it `
              + `again at ${referenceHz} Hz.`);
          }
          observed = ref.reading.observedDbRelative;
          input = ref.input;
          method = 'captured';
          if (ref.testContext) {
            const tc = ref.testContext.label || LOOPBACK_LABEL;
            conditions = [tc, conditions].filter((t) => t && String(t).trim()).join(' ');
          }
        }
        const cal = createLevelCalibration({
          referenceHz,
          referenceDbSpl: Number(f.referenceDb),
          observedDbRelative: observed,
          conditions,
          createdAt: new Date().toISOString(),
          method,
          input,
        });
        ctx.levelCal = cal;
        this.meas.cal.level = { referenceHz: cal.referenceHz, referenceDb: cal.referenceDbSpl,
          observedDb: cal.observedDbRelative, offsetDb: cal.offsetDb, conditions: cal.conditions,
          method: cal.method, bound: !!cal.input };
        this.meas.cal.useLevel = true;
        f.error = '';
        this.closeModal('osc-dlg-level-cal');
        if (ctx.me && ctx.me.state === S.READY) ctx.me.reset();
        refresh();
        rebuildAll();
        return true;
      } catch (err) {
        f.error = err.message || String(err);
        return false;
      }
    },
    measureClearLevelCalibration() {
      ctx.levelCal = null;
      this.meas.cal.level = null;
      this.meas.cal.useLevel = false;
      this.meas.cal.levelVoid = null;
      refresh();
      rebuildAll();
    },
    get measureFreqCalText() { return calText({ profile: this.meas.cal.profile }); },
    /** Why "Save experiment" is disabled, or '' when it is enabled. */
    get measureSaveReason() {
      if (this.meas.saving) return 'Saving…';
      if (this.meas.saved) return 'This measurement is already saved as an experiment.';
      if (this.meas.state !== S.COMPLETE) return 'Available once a measurement is COMPLETE.';
      return '';
    },
    /** The loaded FrequencyProfile (closure object, not reactive) for experiment views. */
    measureCurrentProfile() { return ctx.profile; },
    /** The id of the frequency profile a measurement started now applies, or null. */
    measureAppliedProfileId() {
      return this.meas.cal.useFrequency && ctx.profile ? ctx.profile.id || null : null;
    },

    // ------------------------------------------------------------------ experiment actions
    async measureSave({ decorate = null } = {}) {
      const result = ctx.result;
      if (!result || result.state !== S.COMPLETE || this.meas.saving) return null;
      this.meas.saving = true;
      try {
        const base = experimentOf(result, this);
        const e = decorate ? decorate(base) : base;
        const id = await this.experimentsPut(e);
        this.meas.saved = true;
        this.meas.savedId = id;
        ctx.repeatOf = null;
        refresh();
        const d = ctx.runDefinition;
        const from = !d ? '' : e.definition.hash === d.hash ? `from definition ${definitionText(d,
          d)}, ` : 'NOT from the loaded definition (the recipe that ran differs), ';
        this.notify('success', 'Experiment saved', `"${e.name}" (${from}${this.exps.persistent
          ? 'stored in this browser' : 'kept in memory for this page view only: export it to keep '
          + 'it'}).`);
        return id;
      } catch (err) {
        this.notify('error', 'Experiment not saved', err.message || String(err));
        return null;
      } finally {
        this.meas.saving = false;
      }
    },
    /** Show a saved experiment's result in the result panel (inspection, §75). */
    measureShowExperiment(e, title) {
      ctx.shown = { kind: 'experiment', src: e, title: title || `Saved experiment "${e.name
        || '(unnamed)'}"`, testContext: experimentTestContext(e) };
      resetInvalidViewOptions(e);
      rebuildAll();
    },
    /** The current setup's recipe (measure-flow.js recipeFromFields). */
    measureSetupRecipe() {
      return recipeNow();
    },
    /**
     * Load a definition version (its run reference, definition.js definitionRef or an
     * experiment's `definition`) into the setup. An authored one stays loaded (the panel shows
     * it; `name` and `match` say how it relates to the stored definition, and a 'match' names
     * the run); a derived one is a saved run's recipe as played and only fills the setup.
     */
    measureLoadDefinition(ref, { name = null, match = 'absent', repeatOf = null } = {}) {
      this.measureLoadRecipe(ref.execution.recipe, { repeatOf });
      if (ref.derived) {
        this.measureClearDefinition();
        return;
      }
      ctx.definition = { ...ref, name, match };
      if (name && match === 'match') this.meas.name = name;
      this.meas.definition = { text: definitionText(ref, { name, match }),
        conditions: ref.execution.conditions.notes, differs: false };
      refresh();
    },
    /** Stop using the loaded definition (the next run derives its own). */
    measureClearDefinition() {
      ctx.definition = null;
      this.meas.definition = null;
    },
    /** Load a recipe (an experiment's) into the setup; the next save is a NEW experiment. */
    measureLoadRecipe(recipe, { repeatOf = null } = {}) {
      const st = recipe.stimulus || {};
      const a = recipe.analysis || {};
      const v = this.meas.values;
      for (const [k, val] of Object.entries({ f1: st.f1, f2: st.f2, duration: st.duration,
        level: levelId(st.level) || st.level, repeats: recipe.repeats,
        aggregation: a.aggregation, noiseCheckS: a.noiseCheckS, preRollS: a.preRollS,
        postRollS: a.postRollS, gapS: a.gapS, phase: a.phase })) {
        if (val !== undefined && val !== null) v[k] = val;
      }
      ctx.repeatOf = repeatOf;
      this.meas.saved = false;
      this.meas.savedId = null;
      if (ctx.me && !isActiveState(ctx.me.state)) ctx.me.reset();
      refresh();
    },

    // ------------------------------------------------------------------ test seam
    measureTestSeam() {
      const self = this;
      return {
        get state() { return ctx.me ? ctx.me.state : S.IDLE; },
        get engine() { return ctx.me; },
        get io() { return ctx.io; },
        get ioKind() { return ctx.ioKind; },
        get result() { return ctx.result; },
        get history() { return ctx.me ? ctx.me.history.map((h) => h.to) : []; },
        /** TEST CONTEXT: replace the microphone with a known synthetic system. */
        useLoopback(system = null) {
          if (ctx.me && isActiveState(ctx.me.state)) return false;
          stopLive();
          disposeEngine();
          ctx.loopback = true;
          if (system) ctx.loopbackSystem = system;
          self.meas.loopback = true;
          renderInputs();
          refresh();
          return true;
        },
        useMicrophone() {
          if (ctx.me && isActiveState(ctx.me.state)) return false;
          stopLive();
          disposeEngine();
          ctx.loopback = false;
          self.meas.loopback = false;
          renderInputs();
          refresh();
          return true;
        },
        /**
         * Test hook: run `fn` once, synchronously, when the engine enters `state` (abort at an
         * exact stage without timing races). Returns a promise of { state, ran }.
         */
        onceInState(state, fn) {
          return new Promise((resolve) => {
            ctx.onStateHook = (to) => {
              if (to !== state) return;
              ctx.onStateHook = null;
              // After the engine's own transition has finished (no re-entrant abort).
              queueMicrotask(() => {
                let ran = true;
                try { fn(); } catch (err) { ran = String(err && err.message); }
                resolve({ state: to, ran, now: ctx.me ? ctx.me.state : null });
              });
            };
          });
        },
        clearStateHook() { ctx.onStateHook = null; },
        get live() { return { ...self.meas.live }; },
        setValues(values) {
          Object.assign(self.meas.values, values);
          refresh();
        },
        counts() {
          const io = ctx.io;
          return {
            engineNodes: svc.engine.activeNodeCount,
            ioNodes: io ? io.activeNodeCount : 0,
            ioSources: io ? io.activeSourceCount : 0,
            captures: io ? io.activeCaptureCount : 0,
            ports: io ? io.openPortCount : 0,
            tracks: io ? io.openTrackCount : 0,
            liveTap: io ? io.liveTapOpen : false,
            liveLoop: ctx.live && ctx.live.off ? 1 : 0,
          };
        },
        /** The live RTA's current frame as plain data (null when it is not running). */
        liveRta() {
          const L = ctx.live;
          if (!L) return null;
          const f = L.rta.frame;
          const fin = (v) => (Number.isFinite(v) ? v : null);
          return { mode: f.mode, averaging: L.rta.averaging, frozen: L.rta.frozen,
            frames: f.frames, sampleRate: L.rta.sampleRate, fftSize: L.rta.fftSize,
            window: L.rta.window, analyserFftSize: L.tap.analyser.fftSize,
            calibrated: { ...f.calibrated }, kind: L.kind,
            bands: f.bands ? f.bands.map((b) => b.nominal) : null,
            frequencies: f.frequencies ? Array.from(f.frequencies) : null,
            values: Array.from(f.values, fin), peaks: Array.from(f.peaks, fin),
            underResolved: f.underResolved ? f.underResolved.slice() : null };
        },
        /** rta.js rtaResult of the live bands (what an explicit snapshot would store). */
        liveRtaSnapshot() {
          const r = ctx.live ? ctx.live.rta.snapshot() : null;
          return r ? { ...r, levelsDb: Array.from(r.levelsDb) } : null;
        },
        experimentFromResult: () => (ctx.result ? experimentOf(ctx.result, self) : null),
        get levelCalibration() { return ctx.levelCal; },
        get inputNow() { return ctx.inputNow; },
        get reference() { return ctx.reference; },
        get referenceCapturing() { return !!ctx.refCapture; },
        /** Test hook: the current input (as a preflight would report it). */
        setInputNow(input) {
          ctx.inputNow = input;
          refresh();
        },
        /** Test hook: show any engine-like result (view-option robustness, M6). */
        showResult(result) {
          showResult(result);
          refresh();
        },
        get responseView() { return ctx.charts.response ? ctx.charts.response.view : null; },
        /** The chosen input (raw id, page only) and the one the current io was opened with. */
        get deviceId() { return ctx.deviceId; },
        get ioDeviceId() { return ctx.ioDeviceId; },
        refreshInputs: () => refreshInputs(),
        get irView() { return ctx.charts.ir ? ctx.charts.ir.view : null; },
      };
    },
  };
}
