// MEASURE workspace (src/js/ui/measure.js): the closure state `ctx`, the input binding of a level
// calibration (nameInput, inputKnown, levelApplies, levelInUse: ledger W7f, M3), the
// calibration handed to the engine, the engine and its io, and the component's initial state,
// derived getters and lifecycle. Functions of the other parts are reached through `ops`, the
// one table measure.js fills from every part.

import { MEASUREMENT_STATES as S, isActiveState } from '../../measurement/state-machine.js';
import { createMeasurementEngine, assessMeasurement } from '../../measurement/engine.js';
import { MIC_UNAVAILABLE_TEXT } from '../../audio/microphone.js';
import { createCaptureIo, createLoopbackIo, LOOPBACK_LABEL } from '../../measurement/capture.js';
import {
  measureFlow, expertFields, recipeFromFields, CHARACTERIZE_PLAYBACK_CHAIN, OUTPUT_LEVEL_CHOICES,
  safetyNotes, ROOM_NOTES,
} from '../../measurement/views/measure-flow.js';
import {
  initialQualityBar, reduceQualityBar, qualityBarView, qualityPanel,
} from '../../measurement/views/quality-bar.js';
import {
  initialAnnouncements, reduceAnnouncements,
} from '../../measurement/views/announcements.js';
import { PROFILE_CONVENTIONS } from '../../calibration/profile.js';
import {
  isValidLevelCalibration, levelCalibrationApplies, LEVEL_LIMITS, LEVEL_SCALE,
} from '../../calibration/level.js';
import { REFERENCE_CAPTURE_S } from '../../calibration/reference.js';
import { describeStimulus } from '../../experiments/schema.js';
import { setupRecipe } from '../../experiments/definition.js';
import { canonicalJson } from '../../experiments/canonical-json.js';
import { evidenceChanges } from '../measure-experiment.js';
import { createResponseChart, createIrChart, createRtaChart } from '../../charts/measure-charts.js';
import {
  MEASURE_RESULT_TABS, IR_SPANS, RTA_MODE_CHOICES, RTA_AVERAGING_CHOICES, RESPONSE_QUANTITIES,
  LIVE_RTA_FIELDS, LIVE_FIELD_HELP, LEVEL_FROM_TEST_CONTEXT, LEVEL_FROM_MICROPHONE,
  MANUAL_TEST_CONTEXT_LABEL, FIELD_DEFAULTS, plain, levelId,
} from './constants.js';

/** The closure state of one MEASURE workspace (never Alpine-reactive). */
export function createMeasureContext(svc) {
  const ctx = {
    cmp: null,
    me: null,              // measurement engine
    io: null,
    ioKind: null,          // 'microphone' | 'loopback'
    loopback: !!svc.loopback,
    loopbackSystem: { type: 'biquad', filter: 'lowpass', frequency: 1000, Q: Math.SQRT1_2 },
    result: null,          // last engine result (COMPLETE or INVALID)
    resultTest: false,     // it was produced in TEST CONTEXT (showResult; not read off a label)
    evidence: null,        // frozen { result, calibration, notes } of it, as measured
    shown: null,           // what the result panel shows: { kind: 'result'|'experiment', src }
    preflight: null,
    noise: null,
    progress: null,
    error: null,
    bar: initialQualityBar(),
    said: initialAnnouncements(),
    profile: null,         // FrequencyProfile
    levelCal: null,        // LevelCalibration
    levelCalTest: false,   // it was made in TEST CONTEXT (its input was named there, W7f)
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
    checking: null,        // the recipe the setup check in flight was given (R6)
    onStateHook: null,     // test seam only (onceInState)
    // The input named last { device, constraints, sampleRate } and whether TEST CONTEXT named
    // it. Written by nameInput(); whatever decides a binding, an indicator or a displayed
    // level reads it through inputKnown() (W7f). The devicechange handler only tests it for
    // presence before it clears it.
    inputNow: null,
    inputTest: false,
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
    save: null,            // { result, id, now, stored, experiment }: one per result
    runDefinition: null,   // the reference the running / last measurement started with
  };
  return ctx;
}

/** The session functions over `ctx`; `ops` holds those of the other parts. */
export function createSession(ctx, svc, ops) {
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

  function clearLevelCalibration(m) {
    ctx.levelCal = null;
    ctx.levelCalTest = false;
    m.cal.level = null;
    m.cal.useLevel = false;
    m.cal.levelVoid = null;
  }

  /**
   * Name the current input (null: no input is known). `test` says TEST CONTEXT named it: the
   * loopback's own check or capture, a TEST CONTEXT result, or the seam's setInputNow.
   */
  function nameInput(input, test) {
    ctx.inputNow = input || null;
    ctx.inputTest = !!input && !!test;
  }

  /**
   * The input checked in the context the page is in, or null (ledger W7f, ADR 0017 C1). An
   * input belongs to the context that named it: one named in TEST CONTEXT is not a checked
   * input on the microphone, and a microphone is not the input of the loopback. Every reader
   * that decides a binding, an indicator or a displayed level goes through here, so no path
   * can bind a level calibration to, or display one for, an input the page's own context did
   * not check.
   */
  function inputKnown() {
    return ctx.inputNow && ctx.inputTest === ctx.loopback ? ctx.inputNow : null;
  }

  /**
   * The level calibration's applicability to the current input (level.js), and to the context
   * the page is in: one made in TEST CONTEXT never applies on the microphone, nor the reverse.
   */
  function levelApplies() {
    const a = levelCalibrationApplies(ctx.levelCal, inputKnown());
    if (isValidLevelCalibration(ctx.levelCal) && ctx.levelCalTest !== ctx.loopback) {
      return { applies: false, checked: true, differences: [],
        reason: ctx.levelCalTest ? LEVEL_FROM_TEST_CONTEXT : LEVEL_FROM_MICROPHONE };
    }
    return a;
  }

  /**
   * The level calibration to display levels with: on, valid, and taken with the input that
   * was checked in the context the page is in (M3). One that waits for its input check is not
   * in use: the indicator says PENDING INPUT CHECK and "until then levels are relative", and
   * no view may say otherwise (review of #169). The engine is handed the pending one all the
   * same (calibrationInput()): it checks the input it measures.
   */
  function levelInUse(m) {
    if (!(m.cal.useLevel && isValidLevelCalibration(ctx.levelCal))) return null;
    const a = levelApplies();
    return a.applies && a.checked ? ctx.levelCal : null;
  }

  /**
   * levelInUse() for a result or experiment that is shown without evidence of its own: only
   * a calibration made in the context the shown data was taken in (`testContext`: its label
   * or null). A TEST CONTEXT result never reads in dB SPL through a microphone calibration.
   */
  function levelForShown(m, testContext) {
    return !!testContext === ctx.levelCalTest ? levelInUse(m) : null;
  }

  /** The TEST CONTEXT label a level calibration stored now would carry (W7c), or null. */
  function levelLabelNow(manual) {
    // A typed reading binds to inputKnown(), which is an input of the page's own context.
    if (manual) return ctx.loopback ? MANUAL_TEST_CONTEXT_LABEL : null;
    const ref = ctx.reference;
    if (ref) return ref.testContext ? ref.testContext.label || LOOPBACK_LABEL : null;
    return ctx.loopback ? LOOPBACK_LABEL : null;
  }

  /** How many characters of conditions fit beside `label` (LEVEL_LIMITS.maxConditionsLength). */
  function conditionsRoom(label) {
    return LEVEL_LIMITS.maxConditionsLength - (label ? label.length + 1 : 0);
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

  /** `kind`: the io kind of the engine that reports (its input's context, W7f). */
  function onEvent(e, kind) {
    const cmp = ctx.cmp;
    if (!cmp) return;
    ctx.bar = reduceQualityBar(ctx.bar, e);
    const a = reduceAnnouncements(ctx.said, e);
    ctx.said = a.state;
    if (a.message) announce(a.message);
    switch (e.type) {
      case 'preflight':
        // `recipe`: the one this report checked, so the flow can tell a refusal of a sweep
        // the user has corrected since from one of the setup as it is (review of #331, R6).
        ctx.preflight = { ready: e.ready, warnings: e.warnings, blockers: e.blockers,
          facts: e.facts, sampleRate: e.sampleRate, recipe: ctx.checking || null };
        if (e.facts && e.facts.input && e.facts.input.ok) {
          nameInput({ device: e.facts.input.device, constraints: e.facts.input.constraints,
            sampleRate: e.sampleRate }, kind === 'loopback');
          ops.inputOpened(e.facts.input.device);
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
    ops.refresh({ lite: e.type === 'progress' });
    if (ctx.onStateHook && e.type === 'state') ctx.onStateHook(e.to);
  }

  function ensureEngine() {
    // A newly chosen input takes effect here: the io is re-created for it when nothing runs
    // (an engine of the other context is released by setTestContext already).
    const kind = ctx.loopback ? 'loopback' : 'microphone';
    if (ctx.me && !isActiveState(ctx.me.state) && (ctx.ioKind !== kind
      || (kind === 'microphone' && ctx.ioDeviceId !== ctx.deviceId))) disposeEngine();
    if (ctx.me) return ctx.me;
    ctx.io = kind === 'loopback'
      ? createLoopbackIo({ engine: svc.engine, system: ctx.loopbackSystem })
      : createCaptureIo({ engine: svc.engine, deviceId: ctx.deviceId });
    ctx.ioDeviceId = kind === 'microphone' ? ctx.deviceId : null;
    ctx.ioKind = kind;
    ctx.me = createMeasurementEngine({ io: ctx.io, assess: assessMeasurement,
      onEvent: (e) => onEvent(e, kind) });
    return ctx.me;
  }

  function disposeEngine() {
    if (ctx.me) ctx.me.dispose();
    ctx.me = null;
    ctx.io = null;
    ctx.ioKind = null;
  }

  return {
    setupIsDefinition, clearLevelCalibration, nameInput, inputKnown, levelApplies, levelInUse,
    levelForShown, levelLabelNow, conditionsRoom, announce, calibrationInput, recipeNow, onEvent,
    ensureEngine, disposeEngine,
  };
}

export function measureStatePart(ctx, svc, ops) {
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
        available: !!svc.loopback || ops.microphoneAvailable(),
        unavailableText: MIC_UNAVAILABLE_TEXT },
      response: null,
      ir: null,
      rta: null,
      shownKind: null,
      shownTitle: null,
      testContext: null,
      loopback: !!svc.loopback,
      cal: { useFrequency: true, useLevel: false, profile: null, level: null, errors: [],
        warnings: [], levelVoid: null, levelPending: null },
      levelForm: { referenceHz: '1000', referenceDb: '94', observedDb: '', conditions: '',
        error: '', manual: false, capturing: false, reading: null },
      calImport: null,
      input: { options: [], selected: '', missing: false, message: null, status: '' },
      recipeLink: '',
      recipeLinkErrors: [],
      definition: null,      // { text, conditions, differs } of the loaded definition
      name: '',
      notes: '',
      saved: false,
      savedId: null,
      evidenceRun: 0,
      savedAnnotation: null, // the annotation notes the saved record of this result holds
      savedName: null,       // the name the saved record of this result holds
      saving: false,
      error: null,
      setupOpen: false,
      readout: null,
      rtaFrozen: false,
    },
  };
}

export function measureDerivedPart(ctx, svc, ops) {
  return {
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
      // meas.cal.levelVoid and levelPending make this getter follow the input check (refresh()).
      const pending = this.meas.cal.levelPending;
      const a = ops.levelApplies();
      if (this.meas.cal.levelVoid || !a.applies) return 'UNCALIBRATED';
      return pending || !a.checked ? 'PENDING INPUT CHECK' : 'CALIBRATED';
    },
    /** The "Levels" row of the setup summary, in words. */
    get measureLevelsText() {
      if (!(this.meas.cal.level && this.meas.cal.useLevel)) return 'relative (dBFS-like)';
      const ind = this.measureCalIndicator;
      if (ind === 'CALIBRATED') return 'CALIBRATED (reference offset applied)';
      if (ind === 'PENDING INPUT CHECK') return 'relative until the input is checked';
      return 'UNCALIBRATED (the calibration is not valid for this input)';
    },
    /**
     * What differs between the completed result's evidence and the workspace now (calibration,
     * notes), and what a save records instead; [] when nothing does.
     */
    get measureEvidenceNotes() {
      const m = this.meas;
      // Read first, so the binding follows them (ctx is not reactive): the state, the evidence
      // token, the calibration (profile, switches, level, levelVoid) and the notes.
      const deps = [m.state, m.evidenceRun, m.cal.useFrequency, m.cal.profile, m.cal.useLevel,
        m.cal.level, m.cal.levelVoid, m.notes, m.saved, m.savedAnnotation];
      const ev = ctx.evidence;
      if (deps[0] !== S.COMPLETE || !ev || ev.result !== ctx.result) return [];
      const frequency = m.cal.useFrequency && m.cal.profile && ctx.profile
        ? { id: ctx.profile.id, name: ctx.profile.name } : null;
      const level = m.cal.level && !m.cal.levelVoid ? ops.levelInUse(m) : null;
      return evidenceChanges(ev, { calibration: { frequency, level }, notes: m.notes,
        saved: m.saved ? { annotation: m.savedAnnotation } : null });
    },
    get measureFreqIndicator() {
      return this.meas.cal.useFrequency && this.meas.cal.profile ? 'CALIBRATED' : 'UNCALIBRATED';
    },
    get measureLevelId() { return levelId(this.meas.values.level); },
    get measurePrimary() { return this.meas.flow.primaryAction; },
    get measureCanStop() { return this.meas.active; },
  };
}

export function measureLifecyclePart(ctx, svc, ops) {
  return {
    // ------------------------------------------------------------------ lifecycle
    measureInit() {
      ctx.cmp = this;
      ops.renderInputs();
      ops.refresh();
      const md = ops.mediaDevices();
      if (md && typeof md.addEventListener === 'function') {
        md.addEventListener('devicechange', () => {
          // The system default input may have changed underneath "default input" (a microphone
          // plugged in): the input checked last is no longer known to be the one in use, so a
          // level calibration waits for the next check (review F1/F3 of #139; the engine checks
          // the input it measures in any case).
          if (!ctx.deviceId && !ctx.pending && !ctx.refCapture && ctx.inputNow) {
            ops.nameInput(null);
            ops.refresh();
          }
          if (ctx.devicesEnumerated) ops.refreshInputs();
        });
      }
      // Recipe links reach measureApplyRecipeHash through the hash dispatcher (main.js).
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
      ops.rebuildAll();
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
      const live = ops.stopLive();
      const ref = ops.abortReference();
      if (!ctx.me || !isActiveState(ctx.me.state)) return live || ref;
      const ok = ctx.me.abort(reason);
      ops.refresh();
      return ok;
    },
  };
}
