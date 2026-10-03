// CSV exports of measurement results (spec §163-§164, §223). Pure; returns text, no DOM.
//
// Every file starts with `#`-prefixed metadata lines (OSCILLA version and commit, experiment
// id, algorithm, sample rate, calibration state, view) and one `# column <name>: <unit>` line
// per column, then a header row with explicit unit-bearing names (never "x,y"), then one row
// per value. Numbers are written in shortest round-trip form; a missing value is an empty
// field. Line ending: LF. RAW is the default view; a DERIVED view (smoothed and/or normalized)
// must say how it was derived and is labelled as not raw.
//
//   csvMeta(experiment) -> meta
//   transferCsv(result, meta, { view, derivation, correctedDb, reliable, run })
//     columns frequency_hz, magnitude_db_relative, magnitude_db_corrected, snr_db, reliable,
//     phase_deg (empty, with the reason in its column line, when the transfer has no phase)
//     `reliable` is the quality assessment's mask (quality.mask.reliable) when the caller passes
//     it — reliableFromQuality() takes it from an experiment only when the mask lies on the
//     transfer's grid — else membership of the valid range, and the column line says which.
//     A transfer marked derivedFrom 'aggregate' (G20: the centre of repeated runs) says so in a
//     `# derived_from:` line and in its column units; `run` (an index of results.runTransfers)
//     adds `# run:` for one run of a repeated measurement.
//   aggregateCsv(aggregate, meta, { view, derivation })
//     columns frequency_hz, centre_db_relative, lower_db_relative, upper_db_relative, spread_db
//   irCsv(ir, meta, { view, derivation })            columns time_s, amplitude
//     amplitude is the impulse response of the capture/stimulus transfer: a dimensionless
//     ratio (a unity digital system peaks near 1), not a level re digital full scale
//   rtaCsv(bands, meta, { view, derivation, correctedDb })
//     columns band_nominal_hz, band_lo_hz, band_hi_hz, level_db_relative
//     [, level_db_corrected] [, level_db_spl]
// meta: { oscillaVersion, oscillaCommit, experimentId, algorithm, sampleRate, calibration }
// (calibration as in an experiment: { frequency: { id, name }|null, level|null }).
//
// Transfer magnitudes are RATIOS (capture / stimulus, dB re a unity digital transfer), never
// levels (G19): magnitude_db_relative is the raw ratio and magnitude_db_corrected the same
// ratio with a microphone frequency profile's deviation removed (calibration/interpolate.js
// applyFrequencyCorrection().correctedDb), allowed only when the metadata names a frequency
// profile. A level calibration never turns a transfer column into "dB SPL": with its offset
// added, |H| would be the SPL a full-scale digital stimulus would produce, a quantity the file
// does not claim. Absolute level is a property of LEVEL outputs: rtaCsv adds level_db_spl
// (band level + the LevelCalibration offset) only under a VALID LevelCalibration.
//
// Level labels come from calibration/level.js (spec §24): uncalibrated level columns carry
// RELATIVE_UNIT and the calibration line names RELATIVE_SCALE_LABEL; "dB SPL" appears only
// in the calibration line and the level_db_spl column when the metadata holds a VALID
// LevelCalibration (isValidLevelCalibration), so no uncalibrated export contains the string
// "SPL".

import { UNKNOWN, describeCalibration } from './schema.js';
import { ZERO_POWER_DB, PHASE_REASONS } from '../measurement/transfer.js';
import {
  RELATIVE_SCALE_LABEL, RELATIVE_UNIT, SPL_UNIT, isValidLevelCalibration, levelOffsetWithProfile,
} from '../calibration/level.js';

export const TRANSFER_COLUMNS = Object.freeze(['frequency_hz', 'magnitude_db_relative',
  'magnitude_db_corrected', 'snr_db', 'reliable', 'phase_deg']);
export const AGGREGATE_COLUMNS = Object.freeze(['frequency_hz', 'centre_db_relative',
  'lower_db_relative', 'upper_db_relative', 'spread_db']);
export const IR_COLUMNS = Object.freeze(['time_s', 'amplitude']);
/** RTA base columns; level_db_corrected and level_db_spl follow when they apply. */
export const RTA_COLUMNS = Object.freeze(['band_nominal_hz', 'band_lo_hz', 'band_hi_hz',
  'level_db_relative']);
const DB_RELATIVE = RELATIVE_UNIT;
/** Unit of a transfer magnitude: a ratio, not a level (G19). */
export const TRANSFER_RATIO_UNIT = 'dB re unity digital transfer (capture/stimulus ratio)';
/** Unit of an impulse-response sample: the transfer's impulse response is a pure ratio. */
export const IR_AMPLITUDE_UNIT = 'dimensionless transfer ratio (impulse response of capture / '
  + 'stimulus; a unity digital system peaks near 1), original scale, not normalized';

const PHASE_WHY = Object.freeze({
  [PHASE_REASONS.NOT_REQUESTED]: 'phase not requested',
  [PHASE_REASONS.NO_ALIGNMENT]: 'no alignment available',
  [PHASE_REASONS.ALIGNMENT_NOT_ROBUST]: 'alignment not robust enough for phase',
  [PHASE_REASONS.AGGREGATED]: 'aggregate of repeated runs: phases are not averaged',
});

/**
 * The quality mask of an experiment as a `reliable` option for transferCsv, or null when the
 * experiment has none or it is not on the transfer's grid (then the CSV falls back to the
 * valid range and says so).
 */
export function reliableFromQuality(quality, transfer) {
  const m = quality && quality.mask;
  if (!m || !m.reliable || !m.frequencies || !transfer || !transfer.frequencies) return null;
  const f = transfer.frequencies;
  if (m.frequencies.length !== f.length || m.reliable.length !== f.length) return null;
  for (let i = 0; i < f.length; i++) if (m.frequencies[i] !== f[i]) return null;
  return m.reliable;
}

/** CSV metadata from an experiment. */
export function csvMeta(e) {
  return {
    oscillaVersion: e.oscillaVersion ?? null,
    oscillaCommit: e.oscillaCommit ?? null,
    experimentId: e.experimentId ?? null,
    algorithm: null,
    sampleRate: e.measurement ? e.measurement.sampleRate ?? null : null,
    calibration: e.calibration ?? null,
  };
}

const clean = (v) => (v === null || v === undefined || v === ''
  ? UNKNOWN : String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(Object.is(v, -0) ? 0 : v)
  : '');
const hasLevelCal = (cal) => !!(cal && isValidLevelCalibration(cal.level));
const hasFrequencyCal = (cal) => !!(cal && cal.frequency);
const hasAnyCal = (cal) => !!(cal && (cal.frequency || hasLevelCal(cal)));

function viewLine(opts) {
  const view = opts.view ?? 'raw';
  if (view === 'raw') return '# view: RAW (unsmoothed, not normalized)';
  if (view !== 'derived') throw new RangeError('view must be "raw" or "derived"');
  const d = opts.derivation || {};
  const smoothing = d.smoothing ?? null;
  const normalization = d.normalization ?? null;
  if (!smoothing && !normalization) {
    throw new RangeError('a derived view needs derivation.smoothing and/or .normalization');
  }
  return `# view: DERIVED, not raw data (smoothing: ${smoothing ? clean(smoothing) : 'none'}; `
    + `normalization: ${normalization ? clean(normalization) : 'none'})`;
}

function header(title, meta, algorithm, sampleRate, opts, columns) {
  const m = meta || {};
  const lines = [
    `# OSCILLA ${title}`,
    `# oscilla_version: ${clean(m.oscillaVersion)}`,
    `# oscilla_commit: ${clean(m.oscillaCommit)}`,
    `# experiment_id: ${clean(m.experimentId)}`,
    `# algorithm: ${clean(m.algorithm || algorithm)}`,
    `# sample_rate_hz: ${clean(m.sampleRate ?? sampleRate)}`,
    `# calibration: ${hasAnyCal(m.calibration) ? clean(describeCalibration(m.calibration))
      : `UNCALIBRATED (frequency profile none; levels: ${RELATIVE_SCALE_LABEL})`}`,
    viewLine(opts),
  ];
  for (const [name, unit] of columns) lines.push(`# column ${name}: ${unit}`);
  lines.push(columns.map((c) => c[0]).join(','));
  return lines;
}

function checkLength(arr, n, what) {
  if (arr != null && arr.length !== n) {
    throw new RangeError(`${what} has ${arr.length} values; expected ${n}`);
  }
}

/**
 * Frequency response CSV from a TransferResult. `correctedDb` is the frequency-profile
 * corrected magnitude (applyFrequencyCorrection().correctedDb); it needs a frequency profile in
 * the metadata and stays a ratio in dB, whatever the level calibration (G19).
 */
export function transferCsv(result, meta, opts = {}) {
  const r = result;
  const n = r.frequencies.length;
  const cal = meta && meta.calibration;
  if (opts.calibratedDb !== undefined || opts.calibratedUnit !== undefined) {
    throw new TypeError('transferCsv: calibratedDb/calibratedUnit were replaced by correctedDb '
      + '(a transfer magnitude is a ratio, never dB SPL)');
  }
  const corrected = opts.correctedDb ?? null;
  if (corrected && !hasFrequencyCal(cal)) {
    throw new RangeError('corrected values given but the metadata names no frequency calibration');
  }
  checkLength(r.magnitudeDb, n, 'magnitudeDb');
  checkLength(r.snrDb, n, 'snrDb');
  checkLength(corrected, n, 'correctedDb');
  checkLength(opts.reliable, n, 'reliable');
  checkLength(r.phaseDeg, n, 'phaseDeg');
  const [vLo, vHi] = r.validRange || [NaN, NaN];
  const derived = r.derivedFrom === 'aggregate';
  if (r.derivedFrom !== undefined && !derived) {
    throw new RangeError(`unknown derivedFrom ${r.derivedFrom}`);
  }
  if (derived && opts.run !== undefined) {
    throw new RangeError('a run index belongs to one run\'s transfer, not the aggregate centre');
  }
  if (opts.run !== undefined && !(Number.isInteger(opts.run) && opts.run >= 0)) {
    throw new RangeError('run must be a run index (integer ≥ 0)');
  }
  const centre = derived ? ', centre of the repeated runs (aggregate; envelope in the aggregate '
    + 'CSV)' : '';
  const title = `transfer function (frequency response)${derived
    ? ', aggregate centre of repeated runs' : ''}`;
  const lines = header(title, meta, r.algorithm, r.sampleRate,
    opts, [
      ['frequency_hz', 'Hz'],
      ['magnitude_db_relative', `${TRANSFER_RATIO_UNIT}, uncorrected${centre}`],
      ['magnitude_db_corrected', corrected
        ? `${TRANSFER_RATIO_UNIT}, frequency-profile corrected (microphone deviation removed)`
        : 'empty (no frequency calibration applied)'],
      ['snr_db', r.snrDb ? `dB, ESTIMATED signal-to-noise ratio${derived
        ? ', lowest of the runs' : ''}` : 'empty (not estimated)'],
      ['reliable', opts.reliable ? '1 = reliable, 0 = not (quality assessment mask)'
        : `1 = inside the valid range ${num(vLo)}-${num(vHi)} Hz${derived
          ? ' (where every run is valid)' : ''}, 0 = outside (quality mask not available)`],
      ['phase_deg', r.phaseDeg ? 'degrees, wrapped to (−180, 180], alignment delay removed'
        : `empty (phase not measured: ${PHASE_WHY[r.phaseReason] || (derived
          ? PHASE_WHY[PHASE_REASONS.AGGREGATED] : 'no reason recorded')})`],
    ]);
  const at = lines.findIndex((l) => l.startsWith('# column '));
  if (derived) {
    lines.splice(at, 0, '# derived_from: aggregate (magnitude = results.aggregate centre of the '
      + 'repeated runs; no phase: the runs\' phases are not averaged)');
  } else if (opts.run !== undefined) {
    lines.splice(at, 0, `# run: ${opts.run} (one run of a repeated measurement, not the `
      + 'aggregate)');
  }
  for (let i = 0; i < n; i++) {
    const f = r.frequencies[i];
    const rel = opts.reliable ? (opts.reliable[i] ? 1 : 0) : (f >= vLo && f <= vHi ? 1 : 0);
    lines.push([num(f), num(r.magnitudeDb[i]), corrected ? num(corrected[i]) : '',
      r.snrDb ? num(r.snrDb[i]) : '', rel, r.phaseDeg ? num(r.phaseDeg[i]) : ''].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Repeated-run aggregate CSV from an AggregateResult (aggregate.js aggregateResult, the stored
 * results.aggregate): centre and envelope are transfer ratios in dB like magnitude_db_relative;
 * the spread is a dB difference. One run: the envelope columns are empty.
 */
export function aggregateCsv(aggregate, meta, opts = {}) {
  const a = aggregate;
  const n = a.frequencies.length;
  checkLength(a.centreDb, n, 'centreDb');
  for (const k of ['lowerDb', 'upperDb', 'spreadDb']) checkLength(a[k], n, k);
  const env = a.lowerDb !== null && a.upperDb !== null;
  const bounds = a.dispersion === 'std' ? 'centre ∓ standard deviation of the runs (dB)'
    : a.dispersion === 'p10-p90' ? '10th / 90th percentile of the runs' : null;
  const lines = header(`aggregate of ${a.runs} run${a.runs === 1 ? '' : 's'} (${a.method})`,
    meta, a.algorithm, null, opts, [
      ['frequency_hz', 'Hz'],
      ['centre_db_relative', `${TRANSFER_RATIO_UNIT}, ${a.method === 'mean'
        ? 'power mean' : 'median'} of the runs`],
      ['lower_db_relative', env ? `${TRANSFER_RATIO_UNIT}, lower bound: ${bounds}`
        : 'empty (one run, no envelope)'],
      ['upper_db_relative', env ? `${TRANSFER_RATIO_UNIT}, upper bound: ${bounds}`
        : 'empty (one run, no envelope)'],
      ['spread_db', a.spreadDb ? `dB, ${a.dispersion === 'std' ? 'sample standard deviation'
        : 'median absolute deviation'} across runs (descriptive, not an uncertainty)`
        : 'empty (one run)'],
    ]);
  lines.splice(lines.length - 6, 0, `# repeatability_db: ${num(a.repeatabilityDb) || 'none'}`);
  for (let i = 0; i < n; i++) {
    lines.push([num(a.frequencies[i]), num(a.centreDb[i]), env ? num(a.lowerDb[i]) : '',
      env ? num(a.upperDb[i]) : '', a.spreadDb ? num(a.spreadDb[i]) : ''].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Impulse response CSV from an IrResult; time_s counts from the first IR sample. */
export function irCsv(ir, meta, opts = {}) {
  const sr = ir.sampleRate;
  if (!(typeof sr === 'number' && sr > 0)) throw new RangeError('irCsv needs ir.sampleRate');
  const lines = header('impulse response', meta, ir.algorithm, sr, opts, [
    ['time_s', 's from the first IR sample'],
    ['amplitude', IR_AMPLITUDE_UNIT],
  ]);
  lines.splice(lines.length - 3, 0,
    `# peak: sample ${num(ir.peakIndex)}, ${num(ir.peakTimeS)} s`,
    `# capture_offset_s: ${num(ir.captureOffsetS) || UNKNOWN}`,
    `# window_s: ${ir.window ? `${num(ir.window[0])}-${num(ir.window[1])}` : 'none'}`);
  for (let i = 0; i < ir.samples.length; i++) lines.push(`${num(i / sr)},${num(ir.samples[i])}`);
  return `${lines.join('\n')}\n`;
}

/**
 * RTA band CSV. `bands` is an RTA result { algorithm, sampleRate, resolution, bands, levelsDb }
 * or an array of { nominal, lo, hi, levelDb }. `correctedDb` (frequency-profile corrected band
 * levels, applyFrequencyCorrectionToBands().correctedDb) adds level_db_corrected and needs a
 * frequency profile in the metadata. Under a VALID level calibration level_db_spl is added:
 * the corrected level when given, else the relative level, plus the calibration offset.
 */
export function rtaCsv(bands, meta, opts = {}) {
  const isResult = !Array.isArray(bands);
  const list = isResult ? bands.bands : bands;
  const levels = isResult ? bands.levelsDb : list.map((b) => b.levelDb);
  const cal = meta && meta.calibration;
  const corrected = opts.correctedDb ?? null;
  if (corrected && !hasFrequencyCal(cal)) {
    throw new RangeError('corrected values given but the metadata names no frequency calibration');
  }
  checkLength(levels, list.length, 'levelsDb');
  checkLength(corrected, list.length, 'correctedDb');
  // Corrected levels take the offset without the profile's correction at the reference
  // frequency (level.js levelOffsetWithProfile, V382); that needs the profile's points, so
  // with only { id, name } level_db_spl is computed from the uncorrected level.
  const fullProfile = corrected && cal.frequency && Array.isArray(cal.frequency.points)
    ? cal.frequency : null;
  const splFromCorrected = !!fullProfile;
  const offset = hasLevelCal(cal) ? levelOffsetWithProfile(cal.level, fullProfile) : null;
  const columns = [
    ['band_nominal_hz', 'Hz (nominal band centre)'],
    ['band_lo_hz', 'Hz (lower band edge)'],
    ['band_hi_hz', 'Hz (upper band edge)'],
    ['level_db_relative', DB_RELATIVE],
  ];
  if (corrected) {
    columns.push(['level_db_corrected', `${DB_RELATIVE}, frequency-profile corrected`]);
  }
  if (offset !== null) {
    const from = splFromCorrected ? 'level_db_corrected' : 'level_db_relative';
    columns.push(['level_db_spl', `${SPL_UNIT} (CALIBRATED: ${from} ${offset < 0 ? '−' : '+'} `
      + `${num(Math.abs(offset))} dB level calibration offset)`]);
  }
  const lines = header(`real-time analyzer bands${isResult && bands.resolution
    ? ` (${bands.resolution === 'third' ? '1/3 octave' : 'octave'})` : ''}`, meta,
  isResult ? bands.algorithm : null, isResult ? bands.sampleRate : null, opts, columns);
  list.forEach((b, i) => {
    const row = [num(b.nominal), num(b.lo), num(b.hi), num(levels[i])];
    if (corrected) row.push(num(corrected[i]));
    if (offset !== null) {
      const base = splFromCorrected ? corrected[i] : levels[i];
      // Zero power (stored as ZERO_POWER_DB) has no sound pressure level: empty field.
      row.push(Number.isFinite(base) && base > ZERO_POWER_DB ? num(base + offset) : '');
    }
    lines.push(row.join(','));
  });
  return `${lines.join('\n')}\n`;
}
