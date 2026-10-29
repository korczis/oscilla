// MEASURE workspace (src/js/ui/measure.js): the view refresh and the result presentation. It
// renders the view models of src/js/measurement/views (response, IR and RTA charts, the
// stored noise-check snapshot) and computes no level, mask, range or label itself; a view that
// cannot be built is a note, never a failed measurement (M6).

import { MEASUREMENT_STATES as S, isActiveState } from '../../measurement/state-machine.js';
import { NOISE_FFT } from '../../measurement/engine.js';
import { LIVE_RTA_FFT_SIZES, LIVE_RTA_WINDOWS } from '../../measurement/live-rta.js';
import { LOOPBACK_LABEL } from '../../measurement/capture.js';
import { bandCenters, createRtaAverager, rtaResult } from '../../measurement/rta.js';
import { measureFlow, safetyNotes } from '../../measurement/views/measure-flow.js';
import { qualityBarView, qualityPanel } from '../../measurement/views/quality-bar.js';
import {
  buildResponseView, buildPhaseView, normalizationAvailability, responseSource,
} from '../../measurement/views/response-chart.js';
import { buildIrView } from '../../measurement/views/ir-chart.js';
import { buildRtaView, RTA_MODE_LABELS } from '../../measurement/views/rta-chart.js';
import { UNAVAILABLE } from '../../measurement/views/common.js';
import { describeStimulus } from '../../experiments/schema.js';
import {
  MEASURE_RESULT_TABS, IR_SPANS, RTA_MODE_CHOICES, RTA_AVERAGING_CHOICES, RESPONSE_QUANTITIES,
  IR_WINDOW_MS, NORMALIZATIONS, LIVE_RTA_FIELDS, LEVEL_PENDING_TEXT, plain,
} from './constants.js';

/** The views functions over `ctx`; `ops` holds those of the other parts. */
export function createViews(ctx, svc, ops) {
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
    const recipe = ops.recipeNow();
    const lv = ctx.levelCal ? ops.levelApplies() : null;
    m.flow = plain(measureFlow({
      state, preflight: ctx.preflight, recipe, calibration: ops.calibrationInput(),
      levelChecked: !!lv && lv.applies && lv.checked,
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
    m.cal.levelVoid = lv && !lv.applies && lv.checked ? lv.reason : null;
    m.cal.levelPending = lv && m.cal.useLevel && lv.applies && !lv.checked ? LEVEL_PENDING_TEXT
      : null;
    m.safety = safetyNotes({ recipe, preflight: ctx.preflight });
    m.stimulusText = describeStimulus({ ...recipe.stimulus, kind: 'log-sweep' });
    m.error = ctx.error ? { ...ctx.error } : null;
    if (m.definition) m.definition.differs = !ops.setupIsDefinition(recipe);
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
        levelCalibration: ops.levelForShown(m, ctx.shown.testContext),
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
    // V383: a level calibration applies to the live RTA only once the input has been checked:
    // the live tap reports no device facts, and with no input known levelCalibrationApplies()
    // cannot tell mic B from the mic A it was taken with (nor refuse an unbound one, C1).
    // levelInUse() is null until then, as for every other view.
    return { profile: m.cal.useFrequency && ctx.profile ? ctx.profile : null,
      levelCalibration: ops.levelInUse(m) };
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

  /**
   * The level calibration of a stored noise-check snapshot: the one its measurement applied
   * (the evidence of that result), never one loaded or created afterwards; the current one only
   * for a TEST CONTEXT result shown without a run (test seam), and then only one that was made
   * in TEST CONTEXT and whose input is checked (levelForShown).
   */
  function snapshotLevel(st, m) {
    const ev = ctx.evidence;
    if (ev && st.result && ev.result === st.result) return ev.calibration.level;
    return ops.levelForShown(m, st.result && st.result.testContext);
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
        levelCalibration: snapshotLevel(st, m),
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
    ctx.rta.result = result; // the measurement the snapshot belongs to (its calibration)
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
    // Where it was produced: named when a context change drops it (setTestContext).
    ctx.resultTest = !!result && (ctx.loopback || !!result.testContext);
    // The input the result was captured from is the current one in the result's own context
    // only: a TEST CONTEXT result names a TEST CONTEXT input (inputKnown, W7f).
    if (result && result.input && (result.input.device || result.input.constraints)) {
      ops.nameInput({ device: result.input.device, constraints: result.input.constraints,
        sampleRate: result.sampleRate }, !!result.testContext);
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

  return {
    inputFacts, refresh, shownSource, hasResponse, normalizationOptions, resetInvalidViewOptions,
    rebuildResponse, rebuildIr, noiseRta, liveSourceText, liveCalibration, rebuildLiveRta,
    snapshotLevel, rebuildRta, updateRtaFrame, acceptResultForRta, safely, rebuildAll, showResult,
  };
}

export function measureViewPart(ctx, svc, ops) {
  return {
    measureSetTab(tab) {
      if (!MEASURE_RESULT_TABS.some((t) => t.id === tab)) return;
      if (tab !== 'rta') ops.stopLive(); // the live RTA runs only while it is seen
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
        ops.reconfigureLive(this.meas);
        return true;
      }
      if (['smoothing', 'normalization', 'quantity'].includes(key)) {
        ops.safely('frequency response', ops.rebuildResponse);
      } else if (key.startsWith('ir')) ops.safely('impulse response', ops.rebuildIr);
      else if (key.startsWith('rta')) ops.safely('RTA', ops.rebuildRta);
      return true;
    },
    /** Start or stop the live RTA (the RTA tab's button). */
    async measureRtaLiveToggle() {
      if (ctx.live || ctx.liveStarting) {
        ops.stopLive();
        return false;
      }
      return ops.startLive(this);
    },
    measureRtaFreeze() {
      const L = ctx.live;
      if (L) {
        if (L.rta.frozen) L.rta.unfreeze();
        else L.rta.freeze();
        this.meas.rtaFrozen = L.rta.frozen;
        ops.rebuildRta();
        return;
      }
      const st = ctx.rta;
      if (!st) return;
      if (st.averager.frozen) st.averager.unfreeze();
      else st.averager.freeze();
      this.meas.rtaFrozen = st.averager.frozen;
      ops.rebuildRta();
    },
    measureRtaReset() {
      const L = ctx.live;
      if (L) {
        L.rta.resetPeaks();
        ops.rebuildRta();
        return;
      }
      const st = ctx.rta;
      if (!st) return;
      st.averager.reset();
      if (st.lastPower) ops.updateRtaFrame();
      ops.rebuildRta();
    },
  };
}
