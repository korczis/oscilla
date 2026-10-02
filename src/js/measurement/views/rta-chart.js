// RTA chart view model: FFT, octave and one-third-octave (spec §44-§49, §122, §150, §24).
// Pure.
//
//   buildRtaView(input) -> RtaView
//     input = { rta,            RtaResult (rta.js rtaResult) or { resolution, bands, levelsDb }
//               fft = null,     FFT mode instead: { frequencies, levelsDb } (bin dB, the V2
//                               analyser path) — exactly one of rta / fft
//               peakDb = null,  peak-hold levels (createRtaAverager peakDb), same length
//               frozen = false, averager.frozen
//               averaging = null, { mode: 'instant'|'fast'|'slow' } (or the averager itself)
//               binHz = null,   FFT bin spacing the bands were integrated from (under-resolved
//                               bands, rta.js bandBinCounts)
//               correction = null, calibration/interpolate.js applyFrequencyCorrectionToBands()
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

import { bandBinCounts, RTA_MODES, UNDER_RESOLVED_BINS } from '../rta.js';
import { ZERO_POWER_DB } from '../transfer.js';
import { formatDb } from '../format.js';
import { toDisplayLevel } from '../../calibration/level.js';
import { formatHzTick, formatHz } from '../../charts/axes.js';
import {
  QUANTITY_KINDS as K, UNAVAILABLE, LINE_STYLES, levelAxis, dbAxisRange, extent, frequencyAxis,
  fixedText,
} from './common.js';

export const RTA_MODE_LABELS = Object.freeze({
  fft: 'FFT',
  octave: 'OCTAVE',
  third: '1/3 OCTAVE',
});

/** "FAST (τ = 125 ms, conventional time constant, not IEC-verified)" */
export function averagingLabel(averaging) {
  const mode = averaging && averaging.mode;
  if (!mode || !Object.hasOwn(RTA_MODES, mode)) return `averaging ${UNAVAILABLE.UNKNOWN}`;
  const tau = RTA_MODES[mode];
  if (tau === null) return 'INSTANT (no averaging)';
  return `${mode.toUpperCase()} (τ = ${fixedText(tau * 1000, 0)} ms, conventional time constant, `
    + 'not IEC-verified)';
}

const drawableLevel = (v) => Number.isFinite(v) && v > ZERO_POWER_DB;

/** buildRtaView(input) → RtaView (see the header); null without data (NOT MEASURED). */
export function buildRtaView(input = {}) {
  const {
    rta = null, fft = null, peakDb = null, frozen = false, averaging = null, binHz = null,
    correction = null, levelCalibration = null,
  } = input;
  const axisY = levelAxis(levelCalibration);
  const levelKind = axisY.calibrated ? 'spl' : 'relative';
  const display = (db) => toDisplayLevel(db, levelCalibration).value;
  const avgText = averagingLabel(averaging);
  const badges = [axisY.indicator, frozen ? 'FROZEN' : 'LIVE'];
  const notes = [];

  if (fft) return fftView({ fft, peakDb, frozen, axisY, levelKind, display, avgText, badges });
  if (!rta || !Array.isArray(rta.bands) || !rta.levelsDb
    || rta.levelsDb.length !== rta.bands.length || !rta.bands.length) return null;
  const mode = rta.resolution === 'octave' ? 'octave' : 'third';
  const bands = rta.bands;
  const n = bands.length;
  const under = binHz > 0 ? bandBinCounts(binHz, bands).underResolved : null;
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
    const p = peakDb && drawableLevel(peakDb[i]) ? display(peakDb[i] + (covered
      ? corr.correctedDb[i] - rawDb : 0)) : null;
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
  const y = dbAxisRange(extent([values, peaks.map((p) => p.value)]), { step: 10, minSpan: 40 });
  const x = frequencyAxis(bands[0].lo, bands[n - 1].hi, 'Band');
  x.ticks = bands.map((b) => b.nominal);
  x.tickLabels = bands.map((b) => formatHzTick(b.nominal));

  if (under && under.some(Boolean)) {
    const low = bars.filter((b) => b.underResolved);
    notes.push(`${low.length} band${low.length === 1 ? '' : 's'} up to `
      + `${formatHz(low[low.length - 1].nominal)} span fewer than ${UNDER_RESOLVED_BINS} FFT `
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

function fftView({ fft, peakDb, frozen, axisY, levelKind, display, avgText, badges }) {
  const f = fft.frequencies;
  if (!f || !fft.levelsDb || f.length !== fft.levelsDb.length || f.length < 2) return null;
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
  const y = dbAxisRange(extent(series.map((s) => s.values)), { step: 10, minSpan: 40 });
  let best = -1;
  for (let i = 0; i < vals.length; i++) if (vals[i] !== null && (best < 0 || vals[i] > vals[best]))
    best = i;
  const summary = `RTA, FFT, ${f.length} bins, ${avgText}: ${best < 0 ? 'no energy'
    : `strongest bin ${formatHz(f[best])} at ${formatDb(vals[best], { kind: levelKind })}`}`
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
    notes: [`Averaging: ${avgText}.`],
    summary,
  };
}
