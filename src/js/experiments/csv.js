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
//   transferCsv(result, meta, { view, derivation, calibratedDb, calibratedUnit, reliable })
//     columns frequency_hz, magnitude_db_relative, magnitude_db_calibrated, snr_db, reliable
//   irCsv(ir, meta, { view, derivation })            columns time_s, amplitude
//   rtaCsv(bands, meta, { view, derivation })
//     columns band_nominal_hz, band_lo_hz, band_hi_hz, level_db_relative
// meta: { oscillaVersion, oscillaCommit, experimentId, algorithm, sampleRate, calibration }
// (calibration as in an experiment: { frequency: { id, name }|null, level|null }).
//
// Level labels come from calibration/level.js (spec §24): uncalibrated level columns carry
// RELATIVE_UNIT and the calibration line names RELATIVE_SCALE_LABEL; "dB SPL" appears only
// when the metadata holds a VALID LevelCalibration (isValidLevelCalibration), so no
// uncalibrated export contains the string "SPL".

import { UNKNOWN, describeCalibration } from './schema.js';
import {
  RELATIVE_SCALE_LABEL, RELATIVE_UNIT, SPL_UNIT, isValidLevelCalibration,
} from '../calibration/level.js';

export const TRANSFER_COLUMNS = Object.freeze(['frequency_hz', 'magnitude_db_relative',
  'magnitude_db_calibrated', 'snr_db', 'reliable']);
export const IR_COLUMNS = Object.freeze(['time_s', 'amplitude']);
export const RTA_COLUMNS = Object.freeze(['band_nominal_hz', 'band_lo_hz', 'band_hi_hz',
  'level_db_relative']);
const DB_RELATIVE = RELATIVE_UNIT;

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

/** Frequency response CSV from a TransferResult. */
export function transferCsv(result, meta, opts = {}) {
  const r = result;
  const n = r.frequencies.length;
  const cal = meta && meta.calibration;
  const calibrated = opts.calibratedDb ?? null;
  if (calibrated && !hasAnyCal(cal)) {
    throw new RangeError('calibrated values given but the metadata carries no calibration');
  }
  checkLength(r.magnitudeDb, n, 'magnitudeDb');
  checkLength(r.snrDb, n, 'snrDb');
  checkLength(calibrated, n, 'calibratedDb');
  checkLength(opts.reliable, n, 'reliable');
  const [vLo, vHi] = r.validRange || [NaN, NaN];
  const calUnit = opts.calibratedUnit
    || (hasLevelCal(cal) ? `${SPL_UNIT} (CALIBRATED)`
      : `${RELATIVE_UNIT}, frequency-profile corrected`);
  const lines = header('transfer function (frequency response)', meta, r.algorithm, r.sampleRate,
    opts, [
      ['frequency_hz', 'Hz'],
      ['magnitude_db_relative', DB_RELATIVE],
      ['magnitude_db_calibrated', calibrated ? calUnit : 'empty (no calibration applied)'],
      ['snr_db', r.snrDb ? 'dB, ESTIMATED signal-to-noise ratio' : 'empty (not estimated)'],
      ['reliable', opts.reliable ? '1 = reliable, 0 = not (quality assessment)'
        : `1 = inside the valid range ${num(vLo)}-${num(vHi)} Hz, 0 = outside`],
    ]);
  for (let i = 0; i < n; i++) {
    const f = r.frequencies[i];
    const rel = opts.reliable ? (opts.reliable[i] ? 1 : 0) : (f >= vLo && f <= vHi ? 1 : 0);
    lines.push([num(f), num(r.magnitudeDb[i]), calibrated ? num(calibrated[i]) : '',
      r.snrDb ? num(r.snrDb[i]) : '', rel].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Impulse response CSV from an IrResult; time_s counts from the first IR sample. */
export function irCsv(ir, meta, opts = {}) {
  const sr = ir.sampleRate;
  if (!(typeof sr === 'number' && sr > 0)) throw new RangeError('irCsv needs ir.sampleRate');
  const lines = header('impulse response', meta, ir.algorithm, sr, opts, [
    ['time_s', 's from the first IR sample'],
    ['amplitude', 'linear, relative to digital full scale (original scale, not normalized)'],
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
 * or an array of { nominal, lo, hi, levelDb }.
 */
export function rtaCsv(bands, meta, opts = {}) {
  const isResult = !Array.isArray(bands);
  const list = isResult ? bands.bands : bands;
  const levels = isResult ? bands.levelsDb : list.map((b) => b.levelDb);
  checkLength(levels, list.length, 'levelsDb');
  const lines = header(`real-time analyzer bands${isResult && bands.resolution
    ? ` (${bands.resolution === 'third' ? '1/3 octave' : 'octave'})` : ''}`, meta,
  isResult ? bands.algorithm : null, isResult ? bands.sampleRate : null, opts, [
    ['band_nominal_hz', 'Hz (nominal band centre)'],
    ['band_lo_hz', 'Hz (lower band edge)'],
    ['band_hi_hz', 'Hz (upper band edge)'],
    ['level_db_relative', DB_RELATIVE],
  ]);
  list.forEach((b, i) => {
    lines.push([num(b.nominal), num(b.lo), num(b.hi), num(levels[i])].join(','));
  });
  return `${lines.join('\n')}\n`;
}
