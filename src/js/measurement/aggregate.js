// Aggregation of repeated measurement runs on a common frequency grid: a centre curve, a
// dispersion envelope and a single repeatability figure for the quality assessment.
//
// Input: runs[r][i] is the level in dB of run r at grid point i (all runs on the same grid).
// Zero power is −Infinity dB and is accepted; NaN is rejected.
//
// method 'mean' (dispersion 'std'):
//   centreDb[i] = 10·log10( (1/n) Σ_r 10^(L_r,i / 10) )        energetic (power) mean
//   sdDb[i]     = sqrt( Σ_r (L_r,i − L̄_i)² / (n − 1) )          sample std of the dB values
//   envelope    = centreDb ± sdDb
//   Levels are averaged in POWER because the runs are repeated observations of one power
//   response and a dB average is biased low by the run-to-run scatter (for log-normal scatter of
//   σ dB the bias is ≈ σ²·ln(10)/20 dB). The spread, however, is reported in dB: a measurement's
//   repeatability is read as "± x dB", and a power-domain std is asymmetric once converted. The
//   envelope is therefore the dB spread placed around the power-mean centre. A point where any
//   run is −Infinity has an undefined dB spread (NaN envelope) and is left out of the summary.
//
// method 'median' (dispersion 'p10-p90'):
//   centreDb = median, lowerDb / upperDb = 10th / 90th percentile across runs (linear
//   interpolation between order statistics, Hyndman & Fan 1996 definition 7). The order
//   statistics themselves are the same in dB and in power (the mapping is monotonic); the
//   interpolation between two of them is done in dB, the domain the curves are shown in, and an
//   interpolation towards a −Infinity neighbour stays −Infinity. The per-point
//   spread is the median absolute deviation MAD = median_r |L_r,i − median_r L_r,i| in dB,
//   unscaled (× 1.4826 estimates σ for normally distributed scatter).
//
// repeatabilityDb = median over grid points of sdDb ('mean') or MAD ('median'): one robust
// figure that a few narrow notches cannot dominate. With one run there is no dispersion:
// lowerDb, upperDb, spreadDb, dispersion and repeatabilityDb are null.

const METHODS = ['mean', 'median'];

/** Hyndman-Fan type-7 quantile of an ascending-sorted array segment sorted[0 … n). */
export function quantileSorted(sorted, n, p) {
  if (n <= 0) return NaN;
  const h = (n - 1) * p;
  const j = Math.floor(h);
  const g = h - j;
  if (j + 1 >= n) return sorted[n - 1];
  const a = sorted[j];
  const b = sorted[j + 1];
  if (g === 0 || a === b || a === -Infinity) return a;
  return a + g * (b - a);
}

function sortAscending(buf, n) {
  // Insertion sort: n is the repeat count (≤ 10 by the V3 limits).
  for (let i = 1; i < n; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j];
      j--;
    }
    buf[j + 1] = v;
  }
}

function medianOfFinite(values) {
  const finite = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) finite.push(values[i]);
  if (finite.length === 0) return NaN;
  finite.sort((a, b) => a - b);
  return quantileSorted(finite, finite.length, 0.5);
}

function validate(runs, method) {
  if (!METHODS.includes(method))
    throw new TypeError(`aggregation method must be mean or median, got ${method}`);
  if (!Array.isArray(runs) || runs.length === 0)
    throw new RangeError('aggregateRuns needs at least one run');
  const points = runs[0] && runs[0].length;
  if (!Number.isInteger(points)) throw new TypeError('each run must be an array of dB values');
  for (let r = 0; r < runs.length; r++) {
    if (!runs[r] || runs[r].length !== points)
      throw new RangeError(`run ${r} has ${runs[r] && runs[r].length} points, expected ${points}`);
    for (let i = 0; i < points; i++) {
      if (Number.isNaN(runs[r][i]) || runs[r][i] === Infinity)
        throw new RangeError(`run ${r} point ${i} is not a level in dB: ${runs[r][i]}`);
    }
  }
  return points;
}

/**
 * aggregateRuns(runs, { method = 'mean' }) → { method, runs, points, centreDb, lowerDb,
 *   upperDb, spreadDb, dispersion: 'std'|'p10-p90'|null, repeatabilityDb }
 * All arrays are new Float64Arrays; the input runs are not modified.
 */
export function aggregateRuns(runs, { method = 'mean' } = {}) {
  const points = validate(runs, method);
  const n = runs.length;
  const centreDb = new Float64Array(points);
  if (n === 1) {
    centreDb.set(runs[0]);
    return {
      method, runs: 1, points, centreDb,
      lowerDb: null, upperDb: null, spreadDb: null, dispersion: null, repeatabilityDb: null,
    };
  }
  const lowerDb = new Float64Array(points);
  const upperDb = new Float64Array(points);
  const spreadDb = new Float64Array(points);
  const buf = new Float64Array(n);
  for (let i = 0; i < points; i++) {
    if (method === 'mean') {
      let power = 0;
      let sumDb = 0;
      for (let r = 0; r < n; r++) {
        const v = runs[r][i];
        power += 10 ** (v / 10);
        sumDb += v;
      }
      centreDb[i] = power > 0 ? 10 * Math.log10(power / n) : -Infinity;
      let sd = NaN;
      if (Number.isFinite(sumDb)) {
        const meanDb = sumDb / n;
        let ss = 0;
        for (let r = 0; r < n; r++) ss += (runs[r][i] - meanDb) ** 2;
        sd = Math.sqrt(ss / (n - 1));
      }
      spreadDb[i] = sd;
      lowerDb[i] = centreDb[i] - sd;
      upperDb[i] = centreDb[i] + sd;
    } else {
      for (let r = 0; r < n; r++) buf[r] = runs[r][i];
      sortAscending(buf, n);
      const med = quantileSorted(buf, n, 0.5);
      centreDb[i] = med;
      lowerDb[i] = quantileSorted(buf, n, 0.1);
      upperDb[i] = quantileSorted(buf, n, 0.9);
      if (Number.isFinite(med)) {
        for (let r = 0; r < n; r++) buf[r] = Math.abs(runs[r][i] - med);
        sortAscending(buf, n);
        spreadDb[i] = quantileSorted(buf, n, 0.5);
      } else {
        spreadDb[i] = NaN;
      }
    }
  }
  return {
    method,
    runs: n,
    points,
    centreDb,
    lowerDb,
    upperDb,
    spreadDb,
    dispersion: method === 'mean' ? 'std' : 'p10-p90',
    repeatabilityDb: medianOfFinite(spreadDb),
  };
}
