// Live quality bar and final quality panel (spec §64-§66, §109, §118, §156, §239). Pure.
//
// Live bar — INPUT / NOISE / CLIPPING / SIGNAL / CAPTURE — derived only from engine events
// (engine.js onEvent: 'state' | 'preflight' | 'scheduled' | 'progress' | 'noise' | 'run' |
// 'analysis' | 'result' | 'error') and the capture chunks the io reports with each progress
// event (`event.capture`). Today capture.js chunks are { frames, framesTotal }; a chunk that
// also carries live checks { peak, rmsDb, clipped } (linear peak, dB re full scale, count or
// boolean) is used for CLIPPING and SIGNAL. Without them those items say what is known
// (NOT CHECKED YET / level not reported) rather than guessing "NONE" or "ACTIVE".
//
//   initialQualityBar() -> state
//   reduceQualityBar(state, event) -> state      (never mutates `state`)
//   qualityBarView(state) -> { items: [Item], text }
//   Item = { id, label, status: 'ok'|'warn'|'fail'|'pending'|'unknown', value, text, detail,
//     glyph, icon, shape, className, role }      e.g. text "CLIPPING NONE", "CAPTURE 63 %"
//
// Final panel from a QualityAssessment (quality.js):
//   qualityPanel(assessment) -> { status, statusText, glyph, icon, shape, className, summary,
//     reasons: [Reason], groups: { quality, calibration }, metrics: [{ id, label, text }] }
//   Reason = { code, scope, severity, glyph ('✓'|'!'|'✗'), glyphId, icon, shape, text, value,
//     unit, range|null, notMeasured }
// Status always comes with its reasons (§66); no unexplained score.

import { MEASUREMENT_STATES as S } from '../state-machine.js';
import { CLIP_THRESHOLD } from '../capture-checks.js';
import { PREFLIGHT_THRESHOLDS } from '../engine.js';
import { REASON_CODES, QUALITY_RULESETS, summarizeQuality } from '../quality.js';
import { formatDb, formatFrequencyWithResolution } from '../format.js';
import {
  STATUS_PRESENTATION, UNAVAILABLE, qualityStatusPresentation, fixedText, ratioDbText,
  gridResolutionHz, nearestIndex,
} from './common.js';

/**
 * Margin (dB) by which the live capture RMS must exceed the measured background for SIGNAL
 * ACTIVE: 10 dB, the same criterion as a reliable grid point (quality.js reliableMinSnrDb,
 * transfer.js VALID_MIN_SNR_DB), so "active" means the stimulus is clearly above the noise.
 */
export const SIGNAL_ACTIVE_MARGIN_DB = 10;

export const QUALITY_BAR_ITEMS = Object.freeze(['input', 'noise', 'clipping', 'signal',
  'capture']);
const LABELS = Object.freeze({ input: 'INPUT', noise: 'NOISE', clipping: 'CLIPPING',
  signal: 'SIGNAL', capture: 'CAPTURE' });

const INPUT_BLOCKERS = new Set(['MIC_DENIED', 'NO_INPUT', 'UNSUPPORTED', 'CONTEXT_SUSPENDED',
  'UNSUPPORTED_WORKLET', 'MIC_DISCONNECTED']);
const INPUT_WARNINGS = new Set(['INPUT_PROCESSING', 'WORKLET_FALLBACK', 'SAMPLE_RATE_DIFFERS']);
const CLIP_CODES = new Set(['CLIPPING', 'CLIPPING_SEVERE', 'NOISE_CLIPPING', 'INPUT_CLIPPING']);
const CAPTURE_FAIL_CODES = new Set(['DROPOUT', 'DISCONTINUITY', 'FRAMES_MISSING', 'EMPTY',
  'NO_SAMPLES', 'NON_FINITE', 'BAD_SAMPLE_RATE', 'CAPTURE_TIMEOUT']);

const item = (status, value, detail = null) => ({ status, value, detail });

/** The bar before anything happened: every item pending, nothing claimed. */
export function initialQualityBar() {
  return Object.freeze({
    state: S.IDLE,
    input: item('pending', UNAVAILABLE.UNKNOWN, 'Run the setup check.'),
    noise: item('pending', UNAVAILABLE.NOT_MEASURED),
    clipping: item('pending', 'NOT CHECKED YET'),
    signal: item('pending', UNAVAILABLE.NOT_MEASURED),
    capture: item('pending', 'IDLE'),
    noiseRmsDb: null,
    run: null,
    runs: null,
    clipSeen: false,
  });
}

function codesOf(list) {
  return Array.isArray(list) ? list.map((r) => (typeof r === 'string' ? r : r && r.code))
    .filter(Boolean) : [];
}

function first(list, set) {
  return Array.isArray(list) ? list.find((r) => r && set.has(r.code)) || null : null;
}

function pct(fraction) {
  return `${Math.floor(Math.max(0, Math.min(1, fraction)) * 100)} %`;
}

/** reduceQualityBar(state, event) → next state. Unknown events leave it unchanged. */
export function reduceQualityBar(state, event) {
  if (!event || typeof event !== 'object') return state;
  const s = { ...state };
  switch (event.type) {
    case 'state': {
      s.state = event.to;
      if (event.to === S.PREFLIGHT && (event.from === S.IDLE || isTerminal(event.from))) {
        const fresh = initialQualityBar();
        Object.assign(s, fresh, { state: event.to });
        s.input = item('pending', 'CHECKING');
      }
      if (event.to === S.NOISE_CHECK) s.noise = item('pending', 'MEASURING');
      if (event.to === S.ARMED) {
        s.run = event.info && Number.isInteger(event.info.run) ? event.info.run : s.run;
        s.capture = item('pending', 'ARMED', runText(s));
      }
      if (event.to === S.MEASURING && !s.signalLive)
        s.signal = item('pending', 'STIMULUS PLAYING', 'Input level not reported live; '
          + 'the capture is checked when the run ends.');
      if (event.to === S.ANALYZING) {
        s.runs = event.info && Number.isInteger(event.info.runs) ? event.info.runs : s.runs;
        s.capture = item('pending', 'ANALYZING', 'Offline analysis of the captured audio.');
      }
      if (event.to === S.COMPLETE) s.capture = item('ok', 'COMPLETE', runText(s));
      if (event.to === S.ABORTED) s.capture = item('unknown', 'STOPPED');
      if (event.to === S.ERROR) s.capture = item('fail', 'ERROR', event.info && event.info.message);
      if (event.to === S.INVALID) {
        const codes = codesOf(event.info && event.info.reasons);
        if (codes.some((c) => CLIP_CODES.has(c))) {
          s.clipping = item('fail', 'DETECTED', 'The input reached full scale: lower the input '
            + 'gain or the output level and measure again.');
        }
        if (event.info && event.info.quality === 'INVALID')
          s.capture = item('fail', 'INVALID', 'The quality assessment rejected the data.');
        else if (s.capture.status !== 'fail') s.capture = item('fail', 'INVALID', codes.join(', '));
      }
      return s;
    }
    case 'preflight': {
      const blocker = first(event.blockers, INPUT_BLOCKERS);
      const warn = first(event.warnings, INPUT_WARNINGS);
      const facts = event.facts || {};
      const label = facts.input && facts.input.device && facts.input.device.label;
      if (blocker) s.input = item('fail', blocker.code === 'MIC_DENIED' ? 'DENIED' : 'NONE',
        blocker.text);
      else if (facts.input && facts.input.ok === false) s.input = item('fail', 'NONE');
      else if (warn) s.input = item('warn', 'OK', `${label || 'Input device'}: ${warn.text}`);
      else if (event.ready || (facts.input && facts.input.ok))
        s.input = item('ok', 'OK', label || 'Input device (label not exposed by the browser)');
      const lvl = facts.inputLevel;
      if (lvl && Number.isFinite(lvl.rmsDb)) {
        const high = lvl.rmsDb > PREFLIGHT_THRESHOLDS.noisyRmsDb;
        s.noise = item(high ? 'warn' : 'pending', high ? 'HIGH' : 'PRE-CHECK',
          `Preflight background ${formatDb(lvl.rmsDb)}; the noise check measures it.`);
      }
      const clip = first(event.warnings, CLIP_CODES);
      if (clip) s.clipping = item('warn', 'AT INPUT', clip.text);
      return s;
    }
    case 'noise': {
      const rms = event.rmsDb;
      s.noiseRmsDb = Number.isFinite(rms) ? rms : null;
      const clip = first(event.reasons, CLIP_CODES);
      if (clip) {
        s.noise = item('fail', 'CLIPPING', clip.text);
        s.clipping = item('fail', 'DETECTED', clip.text);
        s.clipSeen = true;
      } else if (!Number.isFinite(rms)) {
        s.noise = item('unknown', 'SILENT', 'Digital silence: no input signal or a muted input.');
      } else {
        const high = rms > PREFLIGHT_THRESHOLDS.noisyRmsDb;
        s.noise = item(high ? 'warn' : 'ok', high ? 'HIGH' : 'GOOD',
          `Background ${formatDb(rms)} (threshold ${formatDb(PREFLIGHT_THRESHOLDS.noisyRmsDb)}).`);
      }
      return s;
    }
    case 'scheduled': {
      if (Number.isInteger(event.run)) s.run = event.run;
      return s;
    }
    case 'progress': {
      if (Number.isInteger(event.run)) s.run = event.run;
      const phase = event.phase;
      if (phase === 'analysis') {
        s.capture = item('pending', 'ANALYZING', `${pct(event.overall)} overall`);
      } else if (phase === 'noise') {
        s.capture = item('pending', pct(event.overall), 'Noise-floor check');
      } else if (phase) {
        s.capture = item('pending', pct(event.overall), [runText(s), phaseWord(phase)]
          .filter(Boolean).join(' · '));
      }
      const c = event.capture;
      if (c && typeof c === 'object') liveChunk(s, c, phase);
      return s;
    }
    case 'run': {
      s.run = Number.isInteger(event.run) ? event.run : s.run;
      const clip = first(event.reasons, CLIP_CODES);
      const cap = first(event.reasons, CAPTURE_FAIL_CODES);
      const empty = first(event.reasons, new Set(['NO_INPUT', 'EMPTY']));
      if (clip) {
        s.clipping = item('fail', 'DETECTED', clip.text);
        s.clipSeen = true;
      } else if (!s.clipSeen && s.clipping.status !== 'fail') {
        s.clipping = item('ok', 'NONE', `Run ${s.run + 1}: no clipped samples.`);
      }
      if (empty) s.signal = item('fail', 'NONE', empty.text);
      else if (!event.invalid && s.signal.status !== 'ok')
        s.signal = item('ok', 'RECEIVED', `Run ${s.run + 1} captured.`);
      if (cap) s.capture = item('fail', 'DEFECT', cap.text);
      return s;
    }
    case 'error': {
      if (event.code === 'MIC_DISCONNECTED' || event.code === 'NO_INPUT')
        s.input = item('fail', 'LOST', event.message);
      if (event.code === 'CAPTURE_TIMEOUT') s.capture = item('fail', 'TIMEOUT', event.message);
      return s;
    }
    default:
      return state;
  }
}

function isTerminal(st) {
  return st === S.COMPLETE || st === S.INVALID || st === S.ABORTED || st === S.ERROR;
}

function runText(s) {
  if (!Number.isInteger(s.run)) return null;
  return s.runs ? `Run ${s.run + 1}/${s.runs}` : `Run ${s.run + 1}`;
}

function phaseWord(phase) {
  return { 'pre-roll': 'pre-roll', sweep: 'sweep', tail: 'tail', gap: 'gap', armed: 'armed',
    preflight: 'setup check' }[phase] || null;
}

function liveChunk(s, c, phase) {
  const clipped = c.clipped === true || (Number.isFinite(c.clipped) && c.clipped > 0)
    || (Number.isFinite(c.peak) && c.peak >= CLIP_THRESHOLD);
  if (clipped) {
    s.clipping = item('fail', 'DETECTED', 'The live input reached full scale.');
    s.clipSeen = true;
  } else if (Number.isFinite(c.peak) && !s.clipSeen && s.clipping.status !== 'fail') {
    s.clipping = item('ok', 'NONE', `Live peak ${fixedText(c.peak, 3)} of full scale so far.`);
  }
  if (Number.isFinite(c.rmsDb) && phase === 'sweep') {
    s.signalLive = true;
    if (s.noiseRmsDb === null) {
      s.signal = item('unknown', 'LEVEL ONLY', `Input ${formatDb(c.rmsDb)}; no background `
        + 'measured to compare with.');
    } else {
      const margin = c.rmsDb - s.noiseRmsDb;
      const active = margin >= SIGNAL_ACTIVE_MARGIN_DB;
      s.signal = item(active ? 'ok' : 'warn', active ? 'ACTIVE' : 'WEAK',
        `${ratioDbText(margin, { decimals: 0 })} above the background `
        + `(${SIGNAL_ACTIVE_MARGIN_DB} dB needed).`);
    }
  }
}

/** qualityBarView(state) → { items, text } with text + glyph + icon + shape per item. */
export function qualityBarView(state) {
  const items = QUALITY_BAR_ITEMS.map((id) => {
    const it = state[id];
    const p = STATUS_PRESENTATION[it.status] || STATUS_PRESENTATION.unknown;
    return {
      id,
      label: LABELS[id],
      status: it.status,
      value: it.value,
      text: `${LABELS[id]} ${it.value}`,
      detail: it.detail || null,
      glyph: p.glyph,
      glyphId: p.glyphId,
      icon: p.icon,
      shape: p.shape,
      className: p.className,
      role: p.role,
    };
  });
  return { items, text: items.map((i) => i.text).join(' · ') };
}

// ----------------------------------------------------------------------------- final panel

const SEVERITY_TO_STATUS = Object.freeze({ ok: 'ok', warn: 'warn', fail: 'fail' });

function codeInfo(assessment, code) {
  const rules = QUALITY_RULESETS[assessment.algorithm];
  const codes = rules ? rules.reasonCodes : REASON_CODES;
  return codes[code] || null;
}

/** qualityPanel(assessment) → the final quality panel (see the header). */
export function qualityPanel(assessment) {
  if (!assessment || !assessment.status) {
    const p = qualityStatusPresentation('NOT_ASSESSED');
    return { status: 'NOT_ASSESSED', statusText: p.text, glyph: p.glyph, icon: p.icon,
      shape: p.shape, className: p.className, role: p.role, algorithm: null,
      summary: `Measurement quality: ${p.word}.`, reasons: [],
      groups: { quality: [], calibration: [] }, metrics: [] };
  }
  const p = qualityStatusPresentation(assessment.status);
  const reasons = (assessment.reasons || []).map((r) => {
    const sev = SEVERITY_TO_STATUS[r.severity] || 'unknown';
    const info = codeInfo(assessment, r.code);
    const notMeasured = !!(info && info.notMeasured);
    const pr = STATUS_PRESENTATION[notMeasured && sev === 'warn' ? 'unknown' : sev];
    return {
      code: r.code,
      scope: r.scope,
      severity: r.severity,
      glyph: STATUS_PRESENTATION[sev].glyph,
      glyphId: STATUS_PRESENTATION[sev].glyphId,
      icon: pr.icon,
      shape: pr.shape,
      className: pr.className,
      role: pr.role,
      text: r.text,
      line: `${STATUS_PRESENTATION[sev].glyph} ${r.text}`,
      value: r.value ?? null,
      unit: r.unit ?? null,
      range: r.range ? [r.range[0], r.range[1]] : null,
      notMeasured,
    };
  });
  return {
    status: assessment.status,
    statusText: p.text,
    glyph: p.glyph,
    icon: p.icon,
    shape: p.shape,
    className: p.className,
    role: p.role,
    algorithm: assessment.algorithm,
    summary: summarizeQuality(assessment),
    reasons,
    groups: {
      quality: reasons.filter((r) => r.scope !== 'calibration'),
      calibration: reasons.filter((r) => r.scope === 'calibration'),
    },
    metrics: metricRows(assessment),
  };
}

/**
 * The repeatability the REPEATABILITY reason judged, rounded as that reason rounds it: a
 * passing spread is an upper bound to 0.1 dB, so the table and the reason never disagree
 * (the stored metric stays the raw dispersion; v4 judges a MAD as its σ-equivalent).
 */
function repeatabilityText(a, m, db) {
  const r = (a.reasons || []).find((x) => x.code === 'REPEATABILITY');
  const v = r && Number.isFinite(r.value) ? r.value : m.repeatabilityDb;
  if (!Number.isFinite(v)) return UNAVAILABLE.NOT_MEASURED;
  return db(r && r.severity === 'ok' ? Math.max(0.1, Math.ceil(v * 10) / 10) : v);
}

/** Expert metric rows (§239): every number with its unit, or NOT MEASURED. */
function metricRows(a) {
  const m = a.metrics || {};
  const res = m.resolutionHz > 0 ? m.resolutionHz : null;
  // A range edge is a grid point: known to the coarser of the bin and the grid spacing.
  const grid = a.mask && a.mask.frequencies && a.mask.frequencies.length > 1
    ? a.mask.frequencies : null;
  const hz = (v) => {
    if (!Number.isFinite(v)) return UNAVAILABLE.NOT_MEASURED;
    if (grid) return formatFrequencyWithResolution(v, gridResolutionHz(grid,
      nearestIndex(grid, v), res));
    return res ? formatFrequencyWithResolution(v, res) : `${Number(v.toPrecision(3))} Hz`;
  };
  const db = (v) => (Number.isFinite(v) ? ratioDbText(v, { sign: false })
    : UNAVAILABLE.NOT_MEASURED);
  const range = (r) => (Array.isArray(r) ? `${hz(r[0])}–${hz(r[1])}` : UNAVAILABLE.NOT_MEASURED);
  const rows = [
    ['snrMedian', 'Median SNR', db(m.snrMedianDb)],
    ['snrMin', 'Minimum SNR (1/6-octave pooled, in valid range)', db(m.snrMinDb)],
    ['clipping', 'Clipped samples', Number.isFinite(m.clippingRatio)
      ? `${Number((m.clippingRatio * 100).toPrecision(2))} % of samples`
      : UNAVAILABLE.NOT_MEASURED],
    ['dropouts', 'Dropouts', Array.isArray(m.dropouts) ? String(m.dropouts.length)
      : (Number.isFinite(m.dropouts) ? String(m.dropouts) : UNAVAILABLE.NOT_MEASURED)],
    ['repeatability', 'Repeatability (median run-to-run spread, as judged)',
      repeatabilityText(a, m, db)],
    ['runs', 'Runs', Number.isInteger(m.runs) ? String(m.runs) : UNAVAILABLE.UNKNOWN],
    ['requested', 'Requested range', range(m.requestedRange)],
    ['coverage', 'Valid range', range(m.coverage)],
    ['calibrated', 'Calibrated range', m.calibratedRange ? range(m.calibratedRange)
      : UNAVAILABLE.UNCALIBRATED],
    ['level', 'Level calibration', m.levelCalibrated ? 'CALIBRATED' : UNAVAILABLE.UNCALIBRATED],
    ['resolution', 'Frequency resolution', res ? `${Number(res.toPrecision(3))} Hz`
      : UNAVAILABLE.UNKNOWN],
  ];
  // confidence.v3: the noise estimate's resolution (1/T_noise) and where the SNR is assessed.
  if ('snrResolutionHz' in m) rows.push(['snrResolution', 'SNR resolution (1/noise-check time)',
    m.snrResolutionHz > 0 ? `${Number(m.snrResolutionHz.toPrecision(3))} Hz`
      : UNAVAILABLE.NOT_MEASURED]);
  if ('snrAssessedFromHz' in m) rows.push(['snrAssessed', 'SNR assessed from',
    Number.isFinite(m.snrAssessedFromHz) ? hz(m.snrAssessedFromHz) : UNAVAILABLE.NOT_MEASURED]);
  if ('outputChainLimitHz' in m) rows.push(['chain', 'Output-chain limit',
    m.outputChainLimitHz ? hz(m.outputChainLimitHz) : 'none reported']);
  rows.push(['algorithm', 'Quality rules', a.algorithm || UNAVAILABLE.UNKNOWN]);
  return rows.map(([id, label, text]) => ({ id, label, text }));
}
