import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnalyserReader,
  binHz,
  frequencyToBin,
  binToFrequency,
  nearestBin,
  dbToAmplitude,
  amplitudeToDb,
} from '../../src/js/analysis/analyser.js';
import { pearson, createCorrelationMeter } from '../../src/js/analysis/correlation.js';
import { compareFrequencies, centsBetween, QUALITY } from '../../src/js/analysis/compare.js';

const SR = 48000;

function sine(f, n, phase = 0, amp = 0.5) {
  return Float32Array.from(
    { length: n },
    (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR + phase),
  );
}

// ---------- analyser ----------

function fakeAnalyser(fftSize = 16) {
  const a = {
    fftSize,
    context: { sampleRate: SR },
    next: -50,
    reads: 0,
    get frequencyBinCount() {
      return this.fftSize / 2;
    },
    getFloatFrequencyData(out) {
      this.reads++;
      out.fill(this.next);
    },
    getFloatTimeDomainData(out) {
      out.fill(0.25);
    },
  };
  return a;
}

test('analyser helpers: bin maths', () => {
  assert.equal(binHz(48000, 8192), 48000 / 8192);
  assert.equal(frequencyToBin(1000, 48000, 8192), (1000 * 8192) / 48000);
  assert.equal(binToFrequency(10, 48000, 8192), (10 * 48000) / 8192);
  assert.equal(nearestBin(1e9, 48000, 8192), 4095);
  assert.equal(nearestBin(-5, 48000, 8192), 0);
  assert.equal(dbToAmplitude(-Infinity), 0);
  assert.ok(Math.abs(amplitudeToDb(dbToAmplitude(-6)) + 6) < 1e-12);
});

test('analyser reader: throttle, freeze and buffer reuse', () => {
  const an = fakeAnalyser();
  const r = createAnalyserReader(an, { minIntervalMs: 50 });
  const b1 = r.readFrequency(0);
  assert.equal(an.reads, 1);
  r.readFrequency(10);
  assert.equal(an.reads, 1, 'throttled');
  assert.equal(r.readFrequency(60), b1, 'same buffer object');
  assert.equal(an.reads, 2);
  r.freeze(true);
  an.next = -10;
  r.readFrequency(500);
  assert.equal(an.reads, 2);
  assert.equal(b1[0], -50);
  r.freeze(false);
  r.readFrequency(600);
  assert.equal(b1[0], -10);
  assert.equal(r.readTime(600)[0], 0.25);
  assert.equal(r.binHz, SR / 16);
});

test('analyser reader: power averaging with a time constant, frame-rate independent', () => {
  const run = (stepMs) => {
    const an = fakeAnalyser();
    const r = createAnalyserReader(an, { averagingS: 0.5 });
    an.next = -100;
    r.readFrequency(0);
    an.next = -20;
    let t = 0;
    while (t < 500) {
      t += stepMs;
      r.readFrequency(t);
    }
    return r.frequency[0];
  };
  const a = run(10);
  const b = run(50);
  // after one time constant: p = p1 + (p0 - p1)·e^-1 in power
  const p0 = 10 ** -10;
  const p1 = 10 ** -2;
  const expected = 10 * Math.log10(p1 + (p0 - p1) * Math.exp(-1));
  assert.ok(Math.abs(a - expected) < 1e-3, `${a} vs ${expected}`);
  assert.ok(Math.abs(a - b) < 1e-3);
});

test('analyser reader: peak hold and decay', () => {
  const an = fakeAnalyser();
  const r = createAnalyserReader(an, { peakHold: true, peakDecayDbPerS: 10 });
  an.next = -20;
  r.readFrequency(0);
  an.next = -60;
  r.readFrequency(1000);
  assert.ok(Math.abs(r.peak[0] + 30) < 1e-4, `${r.peak[0]}`);
  r.resetPeak();
  assert.equal(r.peak[0], -Infinity);
  an.fftSize = 32;
  r.readFrequency(2000);
  assert.equal(r.frequency.length, 16, 'reallocated after fftSize change');
});

// ---------- correlation ----------

test('pearson: in phase 1, inverted -1, quadrature/uncorrelated ~0, silence null', () => {
  const n = 4800;
  const a = sine(1000, n);
  assert.ok(Math.abs(pearson(a, a) - 1) < 1e-9);
  assert.ok(
    Math.abs(
      pearson(
        a,
        a.map((v) => -v),
      ) + 1,
    ) < 1e-9,
  );
  assert.ok(Math.abs(pearson(a, sine(1000, n, Math.PI / 2))) < 0.01);
  assert.ok(Math.abs(pearson(a, sine(1370, n))) < 0.05);
  let s = 3;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
  const n1 = Float32Array.from({ length: n }, rnd);
  const n2 = Float32Array.from({ length: n }, rnd);
  assert.ok(Math.abs(pearson(n1, n2)) < 0.05);
  assert.equal(pearson(a, new Float32Array(n)), null);
  assert.equal(pearson(new Float32Array(n).fill(0.5), a), null, 'DC only is undefined');
  assert.equal(pearson(a, null), null);
  // amplitude independence
  assert.ok(
    Math.abs(
      pearson(
        a,
        a.map((v) => v * 0.01),
      ) - 1,
    ) < 1e-9,
  );
});

test('correlation meter: smoothing and reset on silence', () => {
  const m = createCorrelationMeter({ timeConstantS: 0.1 });
  const a = sine(500, 2048);
  const inv = a.map((v) => -v);
  assert.equal(m.update(a, a, 0).value, 1);
  const r = m.update(a, inv, 100); // one tau: 1 + (-1 - 1)(1 - e^-1)
  assert.ok(Math.abs(r.value - (1 - 2 * (1 - Math.exp(-1)))) < 1e-9);
  assert.equal(r.instantaneous, -1);
  assert.equal(m.update(a, new Float32Array(2048), 200), null);
  assert.equal(m.value, null);
  assert.equal(m.update(a, inv, 300).value, -1, 'restarts without stale history');
});

// ---------- compare ----------

test('centsBetween', () => {
  assert.ok(Math.abs(centsBetween(440, 880) - 1200) < 1e-9);
  assert.ok(Math.abs(centsBetween(440, 440 * 2 ** (1 / 12)) - 100) < 1e-9);
  assert.equal(centsBetween(0, 440), null);
});

test('compareFrequencies: match within resolution, maths of diff and cents', () => {
  const c = compareFrequencies({
    requestedHz: 15500,
    sampleRate: SR,
    observed: { frequencyHz: 15497.5, uncertaintyHz: 2.93, levelDb: -41.5, levelDbfs: -28 },
  });
  assert.equal(c.quality, QUALITY.MATCH);
  assert.ok(Math.abs(c.diffHz + 2.5) < 1e-9);
  assert.ok(Math.abs(c.diffCents - 1200 * Math.log2(15497.5 / 15500)) < 1e-9);
  assert.ok(c.uncertaintyCents > 0);
  assert.equal(c.withinResolution, true);
  assert.equal(c.levelDbfs, -28);
  assert.equal(c.weak, false);
  assert.equal(c.calibrated, false);
});

test('compareFrequencies: close, harmonic, mismatch, no signal, out of range, unavailable', () => {
  const obs = (f) => ({ frequencyHz: f, uncertaintyHz: 2.93, levelDbfs: -80 });
  assert.equal(
    compareFrequencies({ requestedHz: 1000, observed: obs(1010), sampleRate: SR }).quality,
    QUALITY.CLOSE,
  );
  const h = compareFrequencies({ requestedHz: 1000, observed: obs(3001), sampleRate: SR });
  assert.equal(h.quality, QUALITY.HARMONIC);
  assert.equal(h.harmonic, 3);
  assert.equal(h.weak, true);
  assert.equal(
    compareFrequencies({ requestedHz: 1000, observed: obs(1700), sampleRate: SR }).quality,
    QUALITY.MISMATCH,
  );
  const ns = compareFrequencies({ requestedHz: 1000, observed: null, sampleRate: SR });
  assert.equal(ns.quality, QUALITY.NO_SIGNAL);
  assert.equal(ns.observedHz, null);
  assert.equal(ns.diffHz, null);
  assert.equal(
    compareFrequencies({ requestedHz: 30000, observed: null, sampleRate: SR }).quality,
    QUALITY.OUT_OF_RANGE,
  );
  assert.equal(
    compareFrequencies({ requestedHz: NaN, observed: obs(1000) }).quality,
    QUALITY.UNAVAILABLE,
  );
});
