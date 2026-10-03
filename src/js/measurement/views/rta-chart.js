// RTA chart view model: FFT, octave and one-third-octave (spec §44-§49, §122, §150, §24).
// Pure.
//
//   buildRtaView(input) -> RtaView
//     input = { rta,            RtaResult (rta.js rtaResult) or { resolution, bands, levelsDb }
//               fft = null,     FFT mode instead: { frequencies, levelsDb } (bin dB, the V2
//                               analyser path) — exactly one of rta / fft
//               peakDb = null,  peak-hold levels (createRtaAverager peakDb), same length
//               frozen = false, averager.frozen
//               live = false,   true for the live input analysis (badge LIVE); stored data is
//                               badged snapshotLabel (default SNAPSHOT), never LIVE
//               snapshotLabel = null, e.g. 'NOISE CHECK SNAPSHOT'
//               averaging = null, { mode: 'instant'|'fast'|'slow' } (or the averager itself),
//                               or { text } describing how a stored spectrum was averaged
//               window = null,  FFT mode: the analysis window name (the peak-bin note)
//               binHz = null,   FFT bin spacing the bands were integrated from (under-resolved
//                               bands, rta.js bandBinCounts)
//               correction = null, calibration/interpolate.js applyFrequencyCorrectionToBands()
//                               (optionally with peakDb: corrected peak levels, live-rta.js)
//               frequencyCovered = null, FFT mode: Uint8Array per bin, 1 where a frequency
//                               profile corrected the bin (live-rta.js correctionCurve)
//               profile = null, the frequency profile that corrected the levels: SPL then uses
//                               level.js levelOffsetWithProfile, as the live frame does
//               fixedRange = false, true: the stable live axis LIVE_RTA_Y_RANGE (shifted by a
//                               valid level offset) instead of the data extent
//               levelCalibration = null }   a VALID LevelCalibration turns levels into dB SPL
//   RtaView = { mode, x, axes, bars: [Bar], series: [descriptor], peaks: [PeakTick], badges,
//     notes, summary }
//   Bar = { index, nominal, label, lo, hi, exact, value (displayed level), text, rawDb, kind,
//     covered, underResolved, zeroPower, peak, peakText }
//
// Bars span their band edges [lo, hi] on the log axis and their height is the band POWER
// (rta.js integrates power over the band's bins; never a sample of the FFT at the centre,
// §47-§48). Levels are "dB relative (dBFS-like)" on the analyser-relative scale unless a valid
// LevelCalibration applies, then "dB SPL" with CALIBRATED (§24). A frequency profile corrects
// only bands it covers (§158). Averaging time constants are the conventional FAST/SLOW values,
// not an IEC-verified meter (§49).

import { bandBinCounts, RTA_MODES, underResolvedBins } from '../rta.js';
import { ZERO_POWER_DB } from '../transfer.js';
import { formatDb, formatFrequencyWithResolution } from '../format.js';
import { toDisplayLevel } from '../../calibration/level.js';
import { formatHzTick, formatHz, linearTicks } from '../../charts/axes.js';
import {
  QUANTITY_KINDS as K, UNAVAILABLE, LINE_STYLES, levelAxis, dbAxisRange, extent, frequencyAxis,
  fixedText,
} from './common.js';

/**
 * The live display's level axis (dB relative, before a level offset): bands span a quiet room
 * (≈ −100 dB) to full scale (a full-scale sine reads −3.01 dB in its band); FFT bins read lower
 * (the band's power is spread over its bins). Fixed so the axis does not jump per frame.
 */
export const LIVE_RTA_Y_RANGE = Object.freeze({
  bands: Object.freeze([-120, 0]),
  fft: Object.freeze([-150, 0]),
});

/** Fixed live axis in display units: the relative range shifted by a valid level offset. */
export function liveRange(mode, levelCalibration) {
  const base = mode === 'fft' ? LIVE_RTA_Y_RANGE.fft : LIVE_RTA_Y_RANGE.bands;
  const off = toDisplayLevel(0, levelCalibration).value;
  const shift = Math.ceil(off / 10) * 10;
  const range = [base[0] + shift, base[1] + shift];
  return { range, ticks: linearTicks(range[0], range[1], { step: mode === 'fft' ? 30 : 20 }) };
}

export const RTA_MODE_LABELS = Object.freeze({
  fft: 'FFT',
  octave: 'OCTAVE',
  third: '1/3 OCTAVE',
});

/**
 * Peak-bin deficit of a tone in FFT mode: how far its strongest mean-square bin reads below its
 * band level, bin-centred and half-way between bins (10·log10 of Σ bins / max bin, measured with
 * spectrum.js createPowerSpectrumAnalyzer; tests/unit/v3-live-rta.test.mjs).
 */
export const FFT_PEAK_BIN_DEFICIT_DB = Object.freeze({
  hann: Object.freeze([1.76, 3.19]),
  'blackman-harris': Object.freeze([3.02, 3.85]),
});

/** "FAST (τ = 125 ms, conventional time constant, not IEC-verified)" */
export function averagingLabel(averaging) {
  if (averaging && typeof averaging.text === 'string') return averaging.text;
  const mode = averaging && averaging.mode;
  if (!mode || !Object.hasOwn(RTA_MODES, mode)) return `averaging ${UNAVAILABLE.UNKNOWN}`;
  const tau = RTA_MODES[mode];
  if (tau === null) return 'INSTANT (no averaging)';
  return `${mode.toUpperCase()} (τ = ${fixedText(tau * 1000, 0)} ms, conventional time constant, `
    + 'not IEC-verified)';
}

const drawableLevel = (v) => Number.isFinite(v) && v > ZERO_POWER_DB;

/** A bin's frequency to the bin spacing (V383: 3 significant digits claimed 0.1 Hz at 5.86 Hz). */
function binText(f, i) {
  const df = f.length > 1 ? Math.abs(f[Math.min(f.length - 1, i + 1)] - f[Math.max(0, i - 1)])
    / (Math.min(f.length - 1, i + 1) - Math.max(0, i - 1)) : 0;
  return df > 0 ? formatFrequencyWithResolution(f[i], df) : formatHz(f[i]);
}

/** buildRtaView(input) → RtaView (see the header); null without data (NOT MEASURED). */
export function buildRtaView(input = {}) {
  const {
    rta = null, fft = null, peakDb = null, frozen = false, averaging = null, binHz = null,
    correction = null, frequencyCovered = null, fixedRange = false, levelCalibration = null,
    live = false, snapshotLabel = null, window = null, profile = null,
  } = input;
  const axisY = levelAxis(levelCalibration);
  const levelKind = axisY.calibrated ? 'spl' : 'relative';
  // With a frequency correction the offset leaves out the profile's correction at the reference
  // frequency (level.js levelOffsetWithProfile), as the live frame does (V383: the text read the
  // raw offset, 2 dB below the drawn bar under a +2 dB deviation profile).
  const display = (db) => toDisplayLevel(db, levelCalibration, profile ? { profile } : {}).value;
  const avgText = averagingLabel(averaging);
  const badges = [axisY.indicator, frozen ? 'FROZEN' : (live ? 'LIVE' : snapshotLabel
    || 'SNAPSHOT')];
  const notes = [];

  if (fft) {
    return fftView({ fft, peakDb, frozen, axisY, levelKind, display, avgText, badges,
      frequencyCovered, fixed: fixedRange ? liveRange('fft', levelCalibration) : null, window });
  }
  if (!rta || !Array.isArray(rta.bands) || !rta.levelsDb
    || rta.levelsDb.length !== rta.bands.length || !rta.bands.length) return null;
  const mode = rta.resolution === 'octave' ? 'octave' : 'third';
  const bands = rta.bands;
  const n = bands.length;
  const under = binHz > 0
    ? bandBinCounts(binHz, bands, Infinity, window || 'hann').underResolved : null;
  const corr = correction && correction.correctedDb && correction.correctedDb.length === n
    ? correction : null;
  if (corr) badges.splice(1, 0, 'CALIBRATED (frequency)');
  else badges.splice(1, 0, `${UNAVAILABLE.UNCALIBRATED} (frequency)`);

  const bars = [];
  for (let i = 0; i < n; i++) {
    const b = bands[i];
    const rawDb = rta.levelsDb[i];
    const covered = corr ? corr.covered[i] === 1 : false;
    const base = covered ? corr.correctedDb[i] : rawDb;
    const zeroPower = !drawableLevel(base);
    const value = zeroPower ? null : display(base);
    // Peak: the corrected peak when given (live-rta.js), else the raw peak shifted by the
    // band's correction.
    const peakBase = covered && corr.peakDb ? corr.peakDb[i]
      : (peakDb ? peakDb[i] + (covered ? corr.correctedDb[i] - rawDb : 0) : null);
    const p = peakBase !== null && drawableLevel(peakBase) ? display(peakBase) : null;
    bars.push({
      index: i,
      nominal: b.nominal,
      label: formatHzTick(b.nominal),
      lo: b.lo,
      hi: b.hi,
      exact: b.exact,
      value,
      text: zeroPower ? 'no energy (zero power)' : formatDb(value, { kind: levelKind }),
      rawDb,
      kind: axisY.calibrated ? K.CALIBRATED : (covered ? K.CALIBRATED : K.DIGITAL),
      covered,
      underResolved: under ? under[i] : null,
      zeroPower,
      peak: p,
      peakText: p === null ? null : formatDb(p, { kind: levelKind }),
    });
  }
  const peaks = bars.filter((b) => b.peak !== null).map((b) => ({ index: b.index, lo: b.lo,
    hi: b.hi, value: b.peak, role: 'observed', dash: LINE_STYLES.peakHold.dash,
    label: 'PEAK HOLD' }));

  const values = bars.map((b) => b.value);
  const y = fixedRange ? liveRange(mode, levelCalibration)
    : dbAxisRange(extent([values, peaks.map((p) => p.value)]), { step: 10, minSpan: 40 });
  const x = frequencyAxis(bands[0].lo, bands[n - 1].hi, 'Band');
  x.ticks = bands.map((b) => b.nominal);
  x.tickLabels = bands.map((b) => formatHzTick(b.nominal));

  if (under && under.some(Boolean)) {
    const low = bars.filter((b) => b.underResolved);
    notes.push(`${low.length} band${low.length === 1 ? '' : 's'} up to `
      + `${formatHz(low[low.length - 1].nominal)} span fewer than `
      + `${underResolvedBins(window || 'hann')} FFT `
      + 'bins: their level is dominated by the window, not the band shape (drawn hatched).');
  }
  if (corr && bars.some((b) => !b.covered))
    notes.push('Bands outside the frequency profile are uncorrected (no extrapolation).');
  notes.push(`Bars are band power integrated over the FFT bins of each band (${
    RTA_MODE_LABELS[mode]}); never an FFT sample at the centre.`);
  notes.push(`Averaging: ${avgText}.`);

  return {
    mode,
    x: Float64Array.from(bands, (b) => b.exact),
    axes: { x, y: { ...axisY, range: y.range, ticks: y.ticks } },
    bars,
    series: [],
    peaks,
    badges,
    notes,
    summary: rtaSummary({ mode, bars, avgText, frozen, levelKind, unit: axisY }),
  };
}

function rtaSummary({ mode, bars, avgText, frozen, levelKind }) {
  const live = bars.filter((b) => !b.zeroPower);
  const head = `RTA, ${RTA_MODE_LABELS[mode]}, ${bars.length} bands, ${avgText}`;
  if (!live.length) return `${head}: no energy in any band${frozen ? '; frozen' : ''}.`;
  let hi = live[0];
  let lo = live[0];
  for (const b of live) {
    if (b.value > hi.value) hi = b;
    if (b.value < lo.value) lo = b;
  }
  return `${head}: highest band ${formatHz(hi.nominal)} at ${formatDb(hi.value,
    { kind: levelKind })}, lowest band ${formatHz(lo.nominal)} at ${formatDb(lo.value,
    { kind: levelKind })}${frozen ? '; frozen' : ''}.`;
}

function fftBinNote(window) {
  const deficit = FFT_PEAK_BIN_DEFICIT_DB[window];
  const name = window === 'blackman-harris' ? 'Blackman-Harris' : window === 'hann' ? 'Hann'
    : null;
  return `FFT bins: mean-square power per bin (PSD × bin width${name ? `, ${name} window`
    : ''}). A tone spreads over the window's main lobe, so its strongest bin reads ${deficit
    ? `${fixedText(deficit[0], 1)}-${fixedText(deficit[1], 1)} dB` : 'a few dB'} below its band `
    + 'level.';
}

function fftView({ fft, peakDb, frozen, axisY, levelKind, display, avgText, badges,
  frequencyCovered, fixed, window }) {
  const f = fft.frequencies;
  if (!f || !fft.levelsDb || f.length !== fft.levelsDb.length || f.length < 2) return null;
  const cov = frequencyCovered && frequencyCovered.length === f.length ? frequencyCovered : null;
  const anyCovered = cov ? cov.some((c) => c === 1) : false;
  badges.splice(1, 0, anyCovered ? 'CALIBRATED (frequency)'
    : `${UNAVAILABLE.UNCALIBRATED} (frequency)`);
  const vals = Array.from(fft.levelsDb, (v) => (drawableLevel(v) ? display(v) : null));
  const series = [{ id: 'fft', label: `OBSERVED spectrum · ${axisY.unit}`, kind: axisY.calibrated
    ? K.CALIBRATED : K.DIGITAL, role: 'observed', values: vals, width: 1, dash: null,
  alpha: 1, show: true, reliable: null, derivation: null }];
  if (peakDb && peakDb.length === f.length) {
    series.push({ id: 'fft-peak', label: 'PEAK HOLD', kind: series[0].kind, role: 'observed',
      values: Array.from(peakDb, (v) => (drawableLevel(v) ? display(v) : null)),
      width: LINE_STYLES.peakHold.width, dash: LINE_STYLES.peakHold.dash,
      alpha: LINE_STYLES.peakHold.alpha, show: true, reliable: null, derivation: null });
  }
  let lo0 = 0;
  while (lo0 < f.length && !(f[lo0] > 0)) lo0++;
  const y = fixed || dbAxisRange(extent(series.map((s) => s.values)), { step: 10, minSpan: 40 });
  let best = -1;
  for (let i = 0; i < vals.length; i++) if (vals[i] !== null && (best < 0 || vals[i] > vals[best]))
    best = i;
  const summary = `RTA, FFT, ${f.length} bins, ${avgText}: ${best < 0 ? 'no energy'
    : `strongest bin ${binText(f, best)} at ${formatDb(vals[best], { kind: levelKind })}`}`
    + `${frozen ? '; frozen' : ''}.`;
  return {
    mode: 'fft',
    x: Float64Array.from(f),
    axes: { x: frequencyAxis(f[Math.min(lo0, f.length - 1)], f[f.length - 1]),
      y: { ...axisY, range: y.range, ticks: y.ticks } },
    bars: [],
    series,
    peaks: [],
    badges,
    notes: [
      fftBinNote(window),
      ...(cov && anyCovered && cov.some((c) => c !== 1)
        ? ['Bins outside the frequency profile are uncorrected (no extrapolation).'] : []),
      `Averaging: ${avgText}.`,
    ],
    summary,
  };
}
