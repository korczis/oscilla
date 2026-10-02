// Where does the stimulus start inside a capture? FFT cross-correlation of the reference
// (the rendered stimulus) with the captured PCM (spec §212-§213).
//
// r[l] = Σ ref[n]·cap[n + l] for lags l in [minLag, maxLag], computed as IFFT(conj(REF)·CAP)
// with both signals zero-padded to a power of two ≥ Nref + Ncap − 1, so the circular result
// equals the linear correlation for every searched lag (no wrap-around). The two real inputs
// share one complex FFT (ref + j·cap, split by conjugate symmetry). The peak of |r| is the
// matched-filter estimate of the delay (polarity is reported, an inverted input still aligns);
// a parabola through the three samples around it gives the sub-sample offset (V2
// parabolicPeak). For a broadband reference the correlation peak is a band-limited impulse,
// symmetric around the true delay, so integer delays are recovered exactly and fractional ones
// to a fraction of a sample.
//
// peakCorrelation = |r[l]| / √(Σref² · Σcap²[l … l + Nref)), the normalized correlation
// coefficient at the peak (Cauchy-Schwarz: 0 … 1). Noise, a non-flat system response or a
// capture that ends before the stimulus does all lower it.
//
// What the lag is NOT: acoustic latency or time of flight. It is the offset of the stimulus in
// this capture buffer, which includes the output and input pipeline delays of the browser and
// device, unknown and not separable from the acoustic path without a loopback reference.
// Cost: one FFT pair of size nextPow2(Nref + min(Ncap, maxLag + Nref) − 1).

import { createFft } from '../analysis/fft.js';
import { parabolicPeak } from '../analysis/peak-detector.js';
import { nextPow2 } from './spectrum.js';

/**
 * align(reference, captured, sampleRate, { maxLagS, minLagS = 0 })
 *   → { lagSamples, lagSeconds, peakCorrelation, polarity }
 * lagSamples is fractional (parabolic refinement). maxLagS defaults to the whole capture. When
 * either input has no energy the lag is null and peakCorrelation 0 (nothing to align).
 * polarity is +1, or −1 when the best match is the inverted reference.
 */
export function align(reference, captured, sampleRate, options = {}) {
  if (!reference || !reference.length) throw new RangeError('align needs a reference');
  if (!captured || !captured.length) throw new RangeError('align needs a capture');
  if (!(sampleRate > 0)) throw new RangeError('align needs a sample rate');
  const nr = reference.length;
  const nc = captured.length;
  const minLag = Math.max(-(nr - 1), Math.round((options.minLagS || 0) * sampleRate));
  const maxLag = Math.min(
    nc - 1,
    options.maxLagS != null ? Math.round(options.maxLagS * sampleRate) : nc - 1,
  );
  if (maxLag < minLag) throw new RangeError('align: empty lag range');
  const none = { lagSamples: null, lagSeconds: null, peakCorrelation: 0, polarity: null };

  let eRef = 0;
  for (let i = 0; i < nr; i++) eRef += reference[i] * reference[i];
  const ncut = Math.min(nc, maxLag + nr);
  const prefix = new Float64Array(ncut + 1);
  for (let i = 0; i < ncut; i++) prefix[i + 1] = prefix[i] + captured[i] * captured[i];
  if (!(eRef > 0) || !(prefix[ncut] > 0)) return none;

  const size = nextPow2(nr + ncut - 1);
  const fft = createFft(size);
  const zr = new Float64Array(size);
  const zi = new Float64Array(size);
  zr.set(reference);
  for (let i = 0; i < ncut; i++) zi[i] = captured[i];
  fft.forward(zr, zi);

  // S = conj(REF)·CAP with REF = (Z[k] + conj Z[−k]) / 2, CAP = (Z[k] − conj Z[−k]) / 2j.
  // Stored conjugated so the forward FFT acts as the inverse (S is Hermitian, r is real).
  const sr = new Float64Array(size);
  const si = new Float64Array(size);
  for (let k = 0; k < size; k++) {
    const m = (size - k) & (size - 1);
    const a = zr[k];
    const b = zi[k];
    const c = zr[m];
    const d = zi[m];
    const rr = (a + c) / 2;
    const ri = (b - d) / 2;
    const cr = (b + d) / 2;
    const ci = (c - a) / 2;
    sr[k] = rr * cr + ri * ci;
    si[k] = -(rr * ci - ri * cr);
  }
  fft.forward(sr, si);
  const r = (l) => sr[l >= 0 ? l : size + l] / size;

  let best = minLag;
  let bestAbs = -1;
  for (let l = minLag; l <= maxLag; l++) {
    const v = Math.abs(r(l));
    if (v > bestAbs) {
      bestAbs = v;
      best = l;
    }
  }
  const polarity = r(best) < 0 ? -1 : 1;
  let offset = 0;
  if (best > minLag && best < maxLag) {
    offset = parabolicPeak(polarity * r(best - 1), bestAbs, polarity * r(best + 1)).offset;
  }
  const w0 = Math.max(0, best);
  const w1 = Math.min(ncut, best + nr);
  const eWin = w1 > w0 ? prefix[w1] - prefix[w0] : 0;
  const peakCorrelation = eWin > 0 ? Math.min(1, bestAbs / Math.sqrt(eRef * eWin)) : 0;
  const lagSamples = best + offset;
  return { lagSamples, lagSeconds: lagSamples / sampleRate, peakCorrelation, polarity };
}
