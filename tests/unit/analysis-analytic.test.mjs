// K024 (intent audio-band-signal-lab, criterion analytic-signal): src/js/analysis/analytic.js
// computes the analytic signal of the audio buffer by an FFT Hilbert transform, with the
// inverse transform by conjugation, and derives the envelope, the instantaneous phase and the
// instantaneous frequency within the error bounds the module states (ANALYTIC_BOUNDS).
//
// The signals are synthetic and their analytic signals are known in closed form: an AM tone
// (1 + m cos ωm t) cos ωc t has the envelope 1 + m cos ωm t and the phase ωc t, and an FM tone
// cos(ωc t + β sin ωm t) has the envelope 1 and the phase ωc t + β sin ωm t, both because the
// modulation lies far below the carrier (Bedrosian). Each is checked at 44.1 kHz and 48 kHz on
// a buffer that is not a power of two, so the zero padding the transform needs is exercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  ANALYTIC_BOUNDS,
  analyse,
  analyticSignal,
  envelope,
  instantaneousFrequency,
  instantaneousPhase,
  interiorRange,
  nextPowerOfTwo,
  taperLength,
  trustedBand,
  unwrapPhase,
} from '../../src/js/analysis/analytic.js';
import { createFft } from '../../src/js/analysis/fft.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = path.join(ROOT, 'src/js/analysis/analytic.js');
const RATES = [44100, 48000];
const TAU = 2 * Math.PI;

/** 0.2 s of a signal whose sample n is f(t = n / sampleRate). */
function render(sampleRate, f) {
  const n = Math.round(0.2 * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = f(i / sampleRate);
  return out;
}

const AM = { fc: 1000, fm: 25, m: 0.5 };
const FM = { fc: 3000, fm: 40, beta: 4 };

function amSignal(sampleRate) {
  return render(sampleRate,
    (t) => (1 + AM.m * Math.cos(TAU * AM.fm * t)) * Math.cos(TAU * AM.fc * t));
}
function fmSignal(sampleRate) {
  return render(sampleRate, (t) => Math.cos(TAU * FM.fc * t + FM.beta * Math.sin(TAU * FM.fm * t)));
}

/** The wrapped difference a − b in (−π, π]. */
function angleDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** The largest |error(i)| over the interior samples [start, end). */
function maxOver(start, end, error) {
  let worst = 0;
  for (let i = start; i < end; i++) worst = Math.max(worst, Math.abs(error(i)));
  return worst;
}

test('K024 the module states its error bounds and the conditions they hold under', () => {
  assert.ok(Object.isFrozen(ANALYTIC_BOUNDS), 'ANALYTIC_BOUNDS is frozen');
  const keys = ['edgeFraction', 'taperFraction', 'envelopeRelative', 'phaseRad', 'frequencyHz',
    'realPart', 'taperPeriods'];
  for (const key of keys) {
    assert.equal(typeof ANALYTIC_BOUNDS[key], 'number', `ANALYTIC_BOUNDS.${key} is a number`);
    assert.ok(ANALYTIC_BOUNDS[key] > 0, `ANALYTIC_BOUNDS.${key} is positive`);
  }
  assert.ok(ANALYTIC_BOUNDS.edgeFraction < 0.5, 'an interior remains');
  assert.ok(ANALYTIC_BOUNDS.taperFraction < ANALYTIC_BOUNDS.edgeFraction,
    'the taper lies inside the excluded edge');
  assert.equal(typeof ANALYTIC_BOUNDS.conditions, 'string');
  assert.match(ANALYTIC_BOUNDS.conditions, /interior/);
  assert.match(ANALYTIC_BOUNDS.conditions, /Nyquist/);
});

test('K024 nextPowerOfTwo and interiorRange', () => {
  assert.equal(nextPowerOfTwo(1), 2);
  assert.equal(nextPowerOfTwo(2), 2);
  assert.equal(nextPowerOfTwo(8820), 16384);
  assert.equal(nextPowerOfTwo(16384), 16384);
  assert.deepEqual(interiorRange(1000, 0.1), [100, 900]);
  assert.deepEqual(interiorRange(1000), interiorRange(1000, ANALYTIC_BOUNDS.edgeFraction));
  assert.equal(taperLength(1000, 0.05), 50);
  assert.equal(taperLength(1000, 0), 0);
});

test('K024 trustedBand: taperPeriods periods of its low edge fit in a taper, and it stops '
  + 'the same distance below Nyquist', () => {
  for (const sampleRate of RATES) {
    for (const seconds of [0.1, 0.2, 0.5]) {
      const length = Math.round(seconds * sampleRate);
      const { low, high } = trustedBand(length, sampleRate);
      const taperSeconds = taperLength(length) / sampleRate;
      assert.ok(Math.abs(low * taperSeconds - ANALYTIC_BOUNDS.taperPeriods) < 0.2,
        `${seconds} s at ${sampleRate} Hz: ${low * taperSeconds} periods in a taper`);
      assert.ok(Math.abs(sampleRate / 2 - high - low) < 1e-9, 'symmetric about the band');
      assert.ok(high < sampleRate / 2, 'below Nyquist');
    }
  }
  assert.throws(() => trustedBand(1000, 0), RangeError);
});

test('K024 the real part of the analytic signal is the audio buffer itself', () => {
  for (const sampleRate of RATES) {
    for (const x of [amSignal(sampleRate), fmSignal(sampleRate)]) {
      const z = analyticSignal(x);
      assert.equal(z.length, x.length);
      assert.equal(z.re.length, x.length);
      assert.equal(z.im.length, x.length);
      assert.equal(z.size, nextPowerOfTwo(x.length));
      assert.equal(z.taper, taperLength(x.length));
      const between = maxOver(z.taper, x.length - z.taper, (i) => z.re[i] - x[i]);
      assert.ok(between <= ANALYTIC_BOUNDS.realPart,
        `${sampleRate} Hz: real part differs by ${between}, bound ${ANALYTIC_BOUNDS.realPart}`);
      // Inside each taper the real part is the buffer under the raised cosine, and nowhere else.
      assert.ok(Math.abs(z.re[0]) <= ANALYTIC_BOUNDS.realPart, 'the taper starts at zero');
      // With no taper the inverse by conjugation returns the buffer everywhere.
      const plain = analyticSignal(x, { taperFraction: 0 });
      assert.equal(plain.taper, 0);
      const everywhere = maxOver(0, x.length, (i) => plain.re[i] - x[i]);
      assert.ok(everywhere <= ANALYTIC_BOUNDS.realPart, `untapered: ${everywhere}`);
    }
  }
});

test('K024 the taper is what makes the stated frequency bound hold on the interior', () => {
  // Without it, the circular discontinuity at the ends leaks into the interior: on this AM
  // tone the frequency error is several hertz, far outside the bound.
  const sampleRate = 48000;
  const x = amSignal(sampleRate);
  const [start, end] = interiorRange(x.length);
  const error = (z) => {
    const f = instantaneousFrequency(z, sampleRate);
    return maxOver(start, end - 1, (i) => f[i] - AM.fc);
  };
  const tapered = error(analyticSignal(x));
  const plain = error(analyticSignal(x, { taperFraction: 0 }));
  assert.ok(tapered <= ANALYTIC_BOUNDS.frequencyHz, `tapered ${tapered} Hz`);
  assert.ok(plain > 10 * ANALYTIC_BOUNDS.frequencyHz, `untapered ${plain} Hz`);
});

test('K024 the bounds hold at both ends of trustedBand for a 0.1 s buffer', () => {
  const fm = 20;
  for (const sampleRate of RATES) {
    const length = Math.round(0.1 * sampleRate);
    const { low, high } = trustedBand(length, sampleRate);
    // AM content lies at fc and fc +- fm, so these carriers put it on the band's edges.
    for (const fc of [low + fm, high - fm]) {
      const x = new Float32Array(length);
      const trueEnv = (i) => 1 + AM.m * Math.cos(TAU * fm * (i / sampleRate));
      for (let i = 0; i < length; i++) x[i] = trueEnv(i) * Math.cos(TAU * fc * (i / sampleRate));
      const { envelope: env, phase, frequency, interior: [start, end] } = analyse(x, sampleRate);
      const label = `${sampleRate} Hz, carrier ${fc.toFixed(1)} Hz`;
      const envErr = maxOver(start, end, (i) => (env[i] - trueEnv(i)) / trueEnv(i));
      assert.ok(envErr <= ANALYTIC_BOUNDS.envelopeRelative, `${label}: envelope ${envErr}`);
      const phaseErr = maxOver(start, end, (i) => angleDiff(phase[i], TAU * fc * (i / sampleRate)));
      assert.ok(phaseErr <= ANALYTIC_BOUNDS.phaseRad, `${label}: phase ${phaseErr}`);
      const freqErr = maxOver(start, end - 1, (i) => frequency[i] - fc);
      assert.ok(freqErr <= ANALYTIC_BOUNDS.frequencyHz, `${label}: frequency ${freqErr}`);
    }
  }
});

test('K024 the analytic signal has no negative-frequency content', () => {
  const x = amSignal(48000);
  const z = analyticSignal(x);
  const n = nextPowerOfTwo(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(z.re);
  im.set(z.im);
  createFft(n).forward(re, im);
  let positive = 0;
  let negative = 0;
  for (let k = 1; k < n / 2; k++) positive += Math.hypot(re[k], im[k]);
  for (let k = n / 2 + 1; k < n; k++) negative += Math.hypot(re[k], im[k]);
  // The truncated buffer is no longer exactly one-sided after the padding is cut off, but the
  // energy that leaks to negative frequencies is small next to the positive side.
  assert.ok(negative < 0.02 * positive, `negative ${negative} vs positive ${positive}`);
});

for (const sampleRate of RATES) {
  test(`K024 AM at ${sampleRate} Hz: envelope, phase and frequency within the stated bounds`,
  () => {
    const x = amSignal(sampleRate);
    const { analytic, envelope: env, phase, frequency, band } = analyse(x, sampleRate);
    const [start, end] = interiorRange(x.length);
    const trueEnv = (i) => 1 + AM.m * Math.cos(TAU * AM.fm * (i / sampleRate));
    const envErr = maxOver(start, end, (i) => (env[i] - trueEnv(i)) / trueEnv(i));
    assert.ok(envErr <= ANALYTIC_BOUNDS.envelopeRelative,
      `envelope relative error ${envErr}, bound ${ANALYTIC_BOUNDS.envelopeRelative}`);
    const phaseErr = maxOver(start, end,
      (i) => angleDiff(phase[i], TAU * AM.fc * (i / sampleRate)));
    assert.ok(phaseErr <= ANALYTIC_BOUNDS.phaseRad,
      `phase error ${phaseErr} rad, bound ${ANALYTIC_BOUNDS.phaseRad}`);
    const freqErr = maxOver(start, end - 1, (i) => frequency[i] - AM.fc);
    assert.ok(freqErr <= ANALYTIC_BOUNDS.frequencyHz,
      `frequency error ${freqErr} Hz, bound ${ANALYTIC_BOUNDS.frequencyHz}`);
    assert.equal(frequency.length, x.length - 1);
    assert.equal(analytic.length, x.length);
    const { low, high } = band;
    assert.ok(low <= AM.fc - AM.fm && AM.fc + AM.fm <= high, 'the test signal is in the band');
  });

  test(`K024 FM at ${sampleRate} Hz: envelope, phase and frequency within the stated bounds`,
  () => {
    const x = fmSignal(sampleRate);
    const z = analyticSignal(x);
    const env = envelope(z);
    const phase = instantaneousPhase(z);
    const frequency = instantaneousFrequency(z, sampleRate);
    const [start, end] = interiorRange(x.length);
    const truePhase = (i) => {
      const t = i / sampleRate;
      return TAU * FM.fc * t + FM.beta * Math.sin(TAU * FM.fm * t);
    };
    const envErr = maxOver(start, end, (i) => env[i] - 1);
    assert.ok(envErr <= ANALYTIC_BOUNDS.envelopeRelative,
      `envelope relative error ${envErr}, bound ${ANALYTIC_BOUNDS.envelopeRelative}`);
    const phaseErr = maxOver(start, end, (i) => angleDiff(phase[i], truePhase(i)));
    assert.ok(phaseErr <= ANALYTIC_BOUNDS.phaseRad,
      `phase error ${phaseErr} rad, bound ${ANALYTIC_BOUNDS.phaseRad}`);
    // frequency[i] is the mean frequency between samples i and i + 1: the true phase step there.
    const freqErr = maxOver(start, end - 1,
      (i) => frequency[i] - ((truePhase(i + 1) - truePhase(i)) * sampleRate) / TAU);
    assert.ok(freqErr <= ANALYTIC_BOUNDS.frequencyHz,
      `frequency error ${freqErr} Hz, bound ${ANALYTIC_BOUNDS.frequencyHz}`);
    // The deviation the plan states, read back: peak frequency fc + β·fm, minimum fc − β·fm.
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = start; i < end - 1; i++) {
      hi = Math.max(hi, frequency[i]);
      lo = Math.min(lo, frequency[i]);
    }
    const deviation = FM.beta * FM.fm;
    assert.ok(Math.abs(hi - (FM.fc + deviation)) <= 0.01 * deviation, `peak ${hi} Hz`);
    assert.ok(Math.abs(lo - (FM.fc - deviation)) <= 0.01 * deviation, `minimum ${lo} Hz`);
  });
}

test('K024 unwrapPhase removes the 2π jumps of a wrapped phase', () => {
  const sampleRate = 48000;
  const x = render(sampleRate, (t) => Math.cos(TAU * 1500 * t));
  const z = analyticSignal(x);
  const unwrapped = unwrapPhase(instantaneousPhase(z));
  const [start, end] = interiorRange(x.length);
  for (let i = start + 1; i < end; i++)
    assert.ok(Math.abs(unwrapped[i] - unwrapped[i - 1]) < Math.PI, `step at ${i}`);
  const slope = ((unwrapped[end - 1] - unwrapped[start]) / (end - 1 - start)) * sampleRate / TAU;
  assert.ok(Math.abs(slope - 1500) <= ANALYTIC_BOUNDS.frequencyHz, `slope ${slope} Hz`);
});

test('K024 bad input is refused with a helpful message', () => {
  assert.throws(() => analyticSignal(new Float32Array(0)), RangeError);
  assert.throws(() => analyticSignal(null), TypeError);
  const z = analyticSignal(new Float32Array([0, 1, 0, -1]));
  assert.throws(() => instantaneousFrequency(z, 0), RangeError);
  assert.throws(() => instantaneousFrequency(z, Number.NaN), RangeError);
  assert.throws(() => interiorRange(10, 0.5), RangeError);
  assert.throws(() => analyticSignal(new Float32Array(8), { taperFraction: 0.5 }), RangeError);
});

test('K024 the module calls its output the analytic signal of the audio buffer, never device I/Q',
  () => {
    const text = readFileSync(MODULE, 'utf8');
    assert.match(text, /analytic signal of the audio buffer/);
    assert.match(text, /never device I\/Q/);
    // project.no-fake-science and intent audio-band-signal-lab: no reception is claimed.
    for (const banned of [/\bradio\b/i, /\bSDR\b/, /\bRF\b/, /\bantenna/i, /\bdBm\b/, /waterfall/i])
      assert.doesNotMatch(text, banned);
  });
