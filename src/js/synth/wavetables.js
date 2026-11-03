// The wavetable engine's banks and its morph law (plan K092; the sync bank, K089 part): data and
// pure maths only. A bank is four tables, each a list of partials (audio/additive.js), played as
// four band-limited PeriodicWaves, each scaled to a peak of 1. Morph m in [0, 3] crossfades the
// two neighbouring tables i and i + 1 (x = m − i): their linear weights (1 − x, x) times a
// level factor g(x) that holds the mix's power at the tables' own powers interpolated in dB
// (review of #332: the tables are correlated, so an equal-power law bumped the level by up to
// 3 dB between tables). g comes from the tables' powers and their cross term (closed form over
// the partials), so the morph is level-continuous; one headroom factor per bank, the largest
// peak of the mix over the morph, keeps every mix at or below one table's peak.
// It crossfades neighbouring tables; it is not a per-sample interpolation across many
// tables (that needs an AudioWorklet, K088).
//
// The sync bank holds hard-synced saws at ratios 1, 2, 3 and 4.5 of the note (syncedSawSeries):
// each is exactly periodic with the note, so each table is exact and band-limited. Morphing
// crossfades neighbouring ratios; it is not a continuous sync sweep (that needs the worklet,
// K089).

import {
  harmonicSeries, pulseSeries, synthesizePeriod, syncedSawSeries, waveformPeak,
} from '../audio/additive.js';

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

const G_MAX = 4; // a bound on the level factor (no bank comes near it)
const laws = new Map();

/**
 * Each bank's headroom: 1 / the largest peak of its morph mix (a table peaks at 1), rounded
 * down. Searching that peak takes tens of milliseconds per bank, too long for the moment an
 * engine is built, so it is data here and tests/unit/synth-review-332-round2 recomputes it
 * (morphPeak) and proves every value at or below 1 / the peak and within 1 % of it.
 */
export const MORPH_HEADROOM = Object.freeze({ basic: 0.992, formant: 0.799, pulse: 0.952,
  sync: 0.818 });

/** A table's partials scaled to peak 1, as { n -> [a, b] } (sin and cos coefficients). */
function coefficients(ps) {
  const k = 1 / waveformPeak(ps);
  const out = new Map();
  for (const p of ps) {
    if (p.gain) out.set(p.n, [p.gain * k * Math.cos(p.phase), p.gain * k * Math.sin(p.phase)]);
  }
  return out;
}
/** Mean of x·y over a period for two coefficient maps (Parseval). */
function crossPower(a, b) {
  let s = 0;
  for (const [n, [p, q]] of a) {
    const o = b.get(n);
    if (o) s += (p * o[0] + q * o[1]) / 2;
  }
  return s;
}

/** The level factor g(x) of segment `seg` of a law: mix power = the tables' dB-interpolated. */
function levelFactor(seg, x) {
  const lin = (1 - x) ** 2 * seg.pa + x ** 2 * seg.pb + 2 * x * (1 - x) * seg.c;
  const want = seg.pa ** (1 - x) * seg.pb ** x;
  return lin > 0 ? Math.min(G_MAX, Math.sqrt(want / lin)) : 1;
}

/** The morph law of a bank (cached): per segment its powers and cross term, and the headroom. */
export function morphLaw(bank) {
  const id = WAVETABLE_BANKS[bank] ? bank : 'basic';
  if (laws.has(id)) return laws.get(id);
  const co = WAVETABLE_BANKS[id].partials().map(coefficients);
  const segs = [0, 1, 2].map((i) => ({ pa: crossPower(co[i], co[i]),
    pb: crossPower(co[i + 1], co[i + 1]), c: crossPower(co[i], co[i + 1]) }));
  const law = Object.freeze({ bank: id, segs, headroom: MORPH_HEADROOM[id] });
  laws.set(id, law);
  return law;
}

/**
 * The largest peak of a bank's morph mix before its headroom (the search MORPH_HEADROOM is
 * taken from): `points` samples of a period at `steps` morph points per segment.
 */
export function morphPeak(bank, { points = 8192, steps = 64 } = {}) {
  const law = morphLaw(bank);
  const wave = WAVETABLE_BANKS[law.bank].partials().map((ps) => synthesizePeriod(ps, points,
    1 / waveformPeak(ps)));
  let peak = 1;
  law.segs.forEach((seg, i) => {
    for (let k = 1; k < steps; k++) {
      const x = k / steps;
      const g = levelFactor(seg, x);
      for (let j = 0; j < points; j++) {
        peak = Math.max(peak, Math.abs(g * ((1 - x) * wave[i][j] + x * wave[i + 1][j])));
      }
    }
  });
  return peak;
}

/** Weight of table `i` (0..3) at morph `m` in `bank`: the level-continuous law above. */
export function morphWeight(i, m, bank = 'basic') {
  const law = morphLaw(bank);
  const mm = Math.min(MORPH_MAX, Math.max(0, m));
  const seg = Math.min(MORPH_MAX - 1, Math.floor(mm));
  const x = mm - seg;
  if (i !== seg && i !== seg + 1) return 0;
  const w = i === seg ? 1 - x : x;
  return w ? w * levelFactor(law.segs[seg], x) * law.headroom : 0;
}

/** Table i's share of the crossfade at morph m (1 − |m − i| within 1 of it, else 0). */
export const morphShare = (i, m) => Math.max(0, 1 - Math.abs(Math.min(MORPH_MAX,
  Math.max(0, m)) - i));

/**
 * The WaveShaper curve of table `i` in `bank`: input x in [−1, 1] is morph (x + 1) ·
 * MORPH_MAX / 2, so one morph signal through four shapers gives the four weights; a modulated
 * morph outside [0, 3] holds at the end table (the shaper clamps its input).
 */
export function morphCurve(i, size = MORPH_CURVE_POINTS, bank = 'basic') {
  const out = new Float32Array(size);
  for (let k = 0; k < size; k++) out[k] = morphWeight(i, (k / (size - 1)) * MORPH_MAX, bank);
  return out;
}

/** Which tables sound at morph `m`, for the face: "Saw 100 %" or "Square 50 % · Saw 50 %". */
export function morphText(bank, m) {
  const b = WAVETABLE_BANKS[bank] || WAVETABLE_BANKS.basic;
  return b.tables.map((t, i) => [t, morphShare(i, m)]).filter(([, w]) => w > 0.005)
    .map(([t, w]) => `${t} ${Math.round(w * 100)} %`).join(' · ');
}
