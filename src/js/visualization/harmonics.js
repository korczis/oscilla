// Harmonic tables of the built-in oscillator shapes (pure): analytic partial counts >= -60 dB and
// the Nyquist split. Extracted from V1 (index.html@a7b7a23, section 7) with the axis logic of
// createSketch.drawHarmonics; bodies unchanged. V2 renders them with uPlot; the additive
// synthesis panel takes its bars from the real PeriodicWave coefficients (audio/additive.js).

// V1: HARMONIC_FLOOR_DB, HARMONIC_LIST_CAP, harmonicLimit, partialCount, harmonicTable
// (index.html@a7b7a23)
export const HARMONIC_FLOOR_DB = -60;
export const HARMONIC_LIST_CAP = 64;

/** Highest partial number of a shape whose amplitude reaches the −60 dB display floor. */
export function harmonicLimit(wave) {
  const r = 10 ** (-HARMONIC_FLOOR_DB / 20); // 1000
  if (wave === 'sawtooth' || wave === 'square') return Math.floor(r);
  if (wave === 'triangle') return Math.floor(Math.sqrt(r));
  return 1;
}

/** Number of non-zero partials with n ≤ nMax (sawtooth: every n; square, triangle: odd n). */
export function partialCount(wave, nMax) {
  if (nMax < 1) return 0;
  if (wave === 'sawtooth') return nMax;
  if (wave === 'square' || wave === 'triangle') return Math.floor((nMax + 1) / 2);
  return 1;
}

/** Theoretical harmonic amplitudes of the built-in oscillator shapes (relative to f).
 *  `below` and `total` are counted analytically over every partial ≥ −60 dB; `list` holds the
 *  partials up to the display axis — at least the first three non-zero ones, at most 64. */
export function harmonicTable(wave, f, nyquist) {
  const list = [];
  if (!(f > 0) || !(nyquist > 0)) {
    return { list, below: 0, total: 0, shown: 0, capped: false, axisMax: 0, summary: '', summaryShort: '', summaryTiny: '' };
  }
  const nLim = harmonicLimit(wave);
  const step = wave === 'sawtooth' ? 1 : 2;
  const total = partialCount(wave, nLim);
  let nBelow = Math.floor(nyquist / f);
  if (nBelow * f >= nyquist) nBelow--;
  const below = partialCount(wave, Math.min(nLim, nBelow));
  const firstOvertone = nLim > 1 ? (1 + step) * f : f;
  const axisMax = Math.max(nyquist * 1.6, firstOvertone * 1.1);
  for (let n = 1; n <= nLim && list.length < HARMONIC_LIST_CAP; n += step) {
    if (list.length >= 3 && n * f > axisMax) break;
    const amp = n === 1 ? 1 : wave === 'triangle' ? 1 / (n * n) : 1 / n;
    list.push({ n, f: n * f, db: 20 * Math.log10(amp), below: n * f < nyquist });
  }
  const shown = list.length;
  const capped = shown < total;
  const more = capped ? ` · first ${shown} shown` : '';
  return {
    list, below, total, shown, capped, axisMax,
    summary: `${below} of ${total} harmonics ≥ −60 dB below Nyquist${more}`,
    summaryShort: `${below}/${total} below Nyquist${more}`,
    summaryTiny: `${below}/${total} below Nyquist`,
  };
}

/**
 * The harmonic table (same shape as harmonicTable) of the additive synthesis that plays: bars
 * are labs/additive coefficients() = audio/additive visualCoefficients() of the PeriodicWave
 * (peak normalisation applied, so db is the level each partial is played at, relative to full
 * scale). Partials at or below OFF_DB (gain 0) are left out; `below` counts those under Nyquist.
 * The table carries `source: 'additive'` and its own title.
 */
export function additiveHarmonicTable(bars, f, nyquist) {
  const list = [];
  const empty = { list, below: 0, total: 0, shown: 0, capped: false, axisMax: 0, summary: '',
    summaryShort: '', summaryTiny: '', source: 'additive', title: ADDITIVE_TITLE };
  if (!(f > 0) || !(nyquist > 0) || !Array.isArray(bars)) return empty;
  let below = 0;
  for (const b of bars) {
    if (!(b.gain > 0) || !(b.n >= 1)) continue;
    const pf = b.n * f;
    const isBelow = pf < nyquist;
    if (isBelow) below++;
    if (list.length < HARMONIC_LIST_CAP) {
      list.push({ n: b.n, f: pf, db: 20 * Math.log10(b.gain), below: isBelow });
    }
  }
  const total = list.length;
  if (!total) return { ...empty, summary: 'additive table is silent', summaryShort: 'silent',
    summaryTiny: 'silent' };
  const axisMax = Math.max(nyquist * 1.6, list[list.length - 1].f * 1.1);
  return {
    list, below, total, shown: total, capped: false, axisMax, source: 'additive',
    title: ADDITIVE_TITLE,
    summary: `additive: ${below} of ${total} partials below Nyquist · levels as played `
      + '(peak-normalised)',
    summaryShort: `additive: ${below}/${total} below Nyquist`,
    summaryTiny: `${below}/${total} below Nyquist`,
  };
}

export const ADDITIVE_TITLE =
  'ADDITIVE SPECTRUM (PeriodicWave coefficients that play, not measured)';

// V1: harmonic chart labels (index.html@a7b7a23)
export const HARMONIC_DB_GRID = [0, -20, -40, -60];
export const HARMONIC_DB_LABELS = HARMONIC_DB_GRID.map(String);
export const HARMONIC_N_LABELS = ['', 'f', '2f', '3f', '4f', '5f', '6f', '7f'];
export const HARMONIC_TITLE = 'THEORETICAL OSCILLATOR SPECTRUM';
export const HARMONIC_DISCLAIMERS = ['digitally representable below Nyquist · actual speaker output unknown', 'theoretical · speaker output unknown', 'speaker output unknown'];

/**
 * Logarithmic frequency axis of the harmonics chart for table h (and the optional second
 * oscillator's table hb): { fmin, fmax }, or null when h has no partials.
 * V1: createSketch.drawHarmonics, axis part (index.html@a7b7a23)
 */
export function harmonicAxis(h, hb) {
  if (!h.list.length) return null;
  const fmin = Math.max(1, h.list[0].f / 2);
  let fmax = Math.max(h.axisMax, h.list[h.list.length - 1].f * 1.1);
  if (hb && hb.list.length) fmax = Math.max(fmax, hb.list[hb.list.length - 1].f * 1.1);
  return { fmin, fmax };
}

/** Bar height of a partial as a 0..1 fraction of the 0…-60 dB scale (V1 drawHarmSet). */
export function harmonicBarFraction(db) {
  return 1 - -db / 60;
}
