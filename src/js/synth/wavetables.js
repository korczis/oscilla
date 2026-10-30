// The wavetable engine's banks and its morph law (plan K092; the sync bank, K089 part): data and
// pure maths only. A bank is four tables, each a list of partials (audio/additive.js), played as
// four band-limited PeriodicWaves. Morph m in [0, 3] crossfades the two neighbouring tables with
// equal power: table i weighs cos((m − i)·π/2) when |m − i| < 1, else 0, so Σ w² = 1 everywhere.
// It crossfades neighbouring tables; it is not a per-sample interpolation across many
// tables (that needs an AudioWorklet, K088).
//
// The sync bank holds hard-synced saws at ratios 1, 2, 3 and 4.5 of the note (syncedSawSeries):
// each is exactly periodic with the note, so each table is exact and band-limited. Morphing
// crossfades neighbouring ratios; it is not a continuous sync sweep (that needs the worklet,
// K089).

import { harmonicSeries, pulseSeries, syncedSawSeries } from '../audio/additive.js';

export const WAVETABLE_PARTIALS = 64;
export const MORPH_MAX = 3;
export const SYNC_RATIOS = Object.freeze([1, 2, 3, 4.5]);
export const MORPH_CURVE_POINTS = 1025;

/** Partials whose gains are `g(n)`, n = 1..count, on sines. */
const shaped = (g, count = WAVETABLE_PARTIALS) => Array.from({ length: count }, (_, i) => ({
  n: i + 1, gain: Math.max(0, g(i + 1)), phase: 0 }));
/** A formant-like table: harmonics weighted by a resonance at harmonic `h` of width `w`. */
const formant = (h, w) => shaped((n) => Math.exp(-(((n - h) / w) ** 2)) / Math.sqrt(n));

export const WAVETABLE_BANKS = Object.freeze({
  basic: Object.freeze({ label: 'Basic', tables: ['Sine', 'Triangle', 'Square', 'Saw'],
    partials: () => [harmonicSeries('sine', WAVETABLE_PARTIALS),
      harmonicSeries('triangle', WAVETABLE_PARTIALS), harmonicSeries('square', WAVETABLE_PARTIALS),
      harmonicSeries('sawtooth', WAVETABLE_PARTIALS)] }),
  formant: Object.freeze({ label: 'Formant', tables: ['Res 2', 'Res 4', 'Res 8', 'Res 16'],
    partials: () => [formant(2, 1.2), formant(4, 1.6), formant(8, 2.4), formant(16, 3.5)] }),
  pulse: Object.freeze({ label: 'Pulse', tables: ['50 %', '25 %', '12.5 %', '6.25 %'],
    partials: () => [0.5, 0.25, 0.125, 0.0625].map((w) => pulseSeries(w, WAVETABLE_PARTIALS)) }),
  sync: Object.freeze({ label: 'Hard sync',
    tables: SYNC_RATIOS.map((r) => `Sync × ${r}`),
    partials: () => SYNC_RATIOS.map((r) => syncedSawSeries(r, WAVETABLE_PARTIALS)) }),
});
export const WAVETABLE_BANK_IDS = Object.freeze(Object.keys(WAVETABLE_BANKS));

/** Weight of table `i` (0..3) at morph `m`: the equal-power law above. */
export function morphWeight(i, m) {
  const x = Math.min(MORPH_MAX, Math.max(0, m)) - i;
  return Math.abs(x) < 1 ? Math.cos((x * Math.PI) / 2) : 0;
}

/**
 * The WaveShaper curve of table `i`: input x in [−1, 1] is morph (x + 1) · MORPH_MAX / 2, so
 * one morph signal through four shapers gives the four weights; a modulated morph outside
 * [0, 3] holds at the end table (the shaper clamps its input).
 */
export function morphCurve(i, size = MORPH_CURVE_POINTS) {
  const out = new Float32Array(size);
  for (let k = 0; k < size; k++) out[k] = morphWeight(i, (k / (size - 1)) * MORPH_MAX);
  return out;
}

/** Which tables sound at morph `m`, for the face: "Saw 100 %" or "Square 71 % · Saw 71 %". */
export function morphText(bank, m) {
  const b = WAVETABLE_BANKS[bank] || WAVETABLE_BANKS.basic;
  return b.tables.map((t, i) => [t, morphWeight(i, m)]).filter(([, w]) => w > 0.005)
    .map(([t, w]) => `${t} ${Math.round(w * 100)} %`).join(' · ');
}
